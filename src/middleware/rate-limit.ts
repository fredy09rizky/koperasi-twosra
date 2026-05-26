import type { MiddlewareHandler } from 'hono';
import { getClientIp, summarizeUserAgent } from '../utils/request-meta.js';

// Middleware rate limit untuk route payment/public/admin.
// Jalur utama memakai Durable Objects; in-memory dipakai sebagai fallback sementara
// saat binding DO tidak tersedia atau circuit breaker sedang terbuka.
type RateLimitInfo = {
	clientId: string;
	namespace: string;
	windowMs: number;
	max: number;
	currentCount: number;
	retryAfterSeconds: number;
	resetAt: number;
	userAgentSummary: string;
};

type RateLimitOptions = {
	namespace: string;
	windowMs: number;
	max: number;
	message: string;
	onLimit?: (c: any, info: RateLimitInfo) => void | Promise<void>;
};

type RateLimitBucket = {
	count: number;
	resetAt: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const rateLimitLogWindows = new Map<string, number>();
const RATE_LIMIT_DO_TIMEOUT_MS = 2_000;

// Circuit breaker untuk Durable Objects rate limiter.
// Jika DO gagal > 5x dalam 60 detik, fallback ke in-memory sementara.
type CircuitBreakerState = 'closed' | 'open' | 'half-open';
type CircuitBreaker = {
	state: CircuitBreakerState;
	failures: number;
	lastFailureAt: number;
	lastSuccessAt: number;
};
const doCircuitBreaker: CircuitBreaker = {
	state: 'closed',
	failures: 0,
	lastFailureAt: 0,
	lastSuccessAt: 0
};
const DO_CIRCUIT_BREAKER_THRESHOLD = 5; // Gagal > 5x
const DO_CIRCUIT_BREAKER_WINDOW_MS = 60_000; // Window 60 detik
const DO_CIRCUIT_BREAKER_RECOVERY_MS = 30_000; // Coba lagi setelah 30 detik

type DistributedRateLimitResult = {
	count: number;
	resetAt: number;
	remaining: number;
	allowed: boolean;
};

/**
 * Evaluasi apakah circuit breaker harus dibuka/ditutup berdasarkan pola kegagalan.
 */
function evaluateCircuitBreaker(now: number): void {
	const cb = doCircuitBreaker;

	// Jika circuit open, cek apakah sudah waktunya coba lagi (half-open)
	if (cb.state === 'open') {
		if (now - cb.lastFailureAt >= DO_CIRCUIT_BREAKER_RECOVERY_MS) {
			cb.state = 'half-open';
			cb.failures = 0;
		}
		return;
	}

	// Jika circuit closed/half-open, reset failures jika sudah lewat window
	if (now - cb.lastFailureAt >= DO_CIRCUIT_BREAKER_WINDOW_MS) {
		cb.failures = 0;
		cb.state = 'closed';
	}
}

/**
 * Catat keberhasilan atau kegagalan request ke Durable Objects.
 */
function recordCircuitBreakerResult(success: boolean, now: number): void {
	const cb = doCircuitBreaker;

	if (success) {
		cb.lastSuccessAt = now;
		// Jika half-open dan berhasil, tutup circuit lagi
		if (cb.state === 'half-open') {
			cb.state = 'closed';
			cb.failures = 0;
		}
		return;
	}

	cb.failures += 1;
	cb.lastFailureAt = now;

	// Jika failures melebihi threshold, buka circuit
	if (cb.failures >= DO_CIRCUIT_BREAKER_THRESHOLD) {
		cb.state = 'open';
	}
}

async function checkDistributedRateLimit(
	c: any,
	bucketKey: string,
	windowMs: number,
	max: number,
	now: number
): Promise<DistributedRateLimitResult | null> {
	const namespace = c?.env?.RATE_LIMITER;
	if (!namespace || typeof namespace.getByName !== 'function') {
		return null;
	}

	// Evaluasi circuit breaker sebelum mencoba request ke DO
	evaluateCircuitBreaker(now);

	// Jika circuit open, langsung fallback ke in-memory
	if (doCircuitBreaker.state === 'open') {
		return null;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), RATE_LIMIT_DO_TIMEOUT_MS);
	try {
		const stub = namespace.getByName(bucketKey);
		const response = await stub.fetch('https://rate-limiter/internal/check', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				windowMs,
				max,
				now
			}),
			signal: controller.signal
		});

		if (!response.ok) {
			recordCircuitBreakerResult(false, now);
			return null;
		}
		const data: any = await response.json();
		const count = Number(data?.count || 0);
		const resetAt = Number(data?.resetAt || 0);
		const remaining = Number(data?.remaining || 0);
		const allowed = Boolean(data?.allowed);
		if (!Number.isFinite(count) || !Number.isFinite(resetAt) || !Number.isFinite(remaining)) {
			recordCircuitBreakerResult(false, now);
			return null;
		}

		recordCircuitBreakerResult(true, now);
		return {
			count: Math.max(0, Math.trunc(count)),
			resetAt: Math.max(now, Math.trunc(resetAt)),
			remaining: Math.max(0, Math.trunc(remaining)),
			allowed
		};
	} catch {
		recordCircuitBreakerResult(false, now);
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

function cleanupExpiredBuckets(now: number) {
	// Bucket lama dibersihkan opportunistic agar Map tidak tumbuh terus.
	for (const [key, bucket] of rateLimitBuckets.entries()) {
		if (bucket.resetAt <= now) {
			rateLimitBuckets.delete(key);
		}
	}
}

function cleanupExpiredRateLimitLogs(now: number) {
	for (const [key, resetAt] of rateLimitLogWindows.entries()) {
		if (resetAt <= now) {
			rateLimitLogWindows.delete(key);
		}
	}
}

export function resetRateLimitStateForTests() {
	rateLimitBuckets.clear();
	rateLimitLogWindows.clear();
	doCircuitBreaker.state = 'closed';
	doCircuitBreaker.failures = 0;
	doCircuitBreaker.lastFailureAt = 0;
	doCircuitBreaker.lastSuccessAt = 0;
}

export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
	// Factory ini sengaja generik agar setiap route cukup mengirim namespace + limit.
	// File route lalu bisa fokus pada pesan bisnis dan callback log saat limit terlewati.
	return async (c, next) => {
		const now = Date.now();
		const clientId = getClientIp(c.req.raw.headers);
		const bucketKey = `${options.namespace}:${clientId}`;
		let currentCount = 0;
		let resetAt = now + options.windowMs;
		let remaining = options.max;
		let allowed = true;

		const distributedResult = await checkDistributedRateLimit(
			c,
			bucketKey,
			options.windowMs,
			options.max,
			now
		);

		if (distributedResult) {
			currentCount = distributedResult.count;
			resetAt = distributedResult.resetAt;
			remaining = distributedResult.remaining;
			allowed = distributedResult.allowed;
		} else {
			if (rateLimitBuckets.size > 2000) {
				cleanupExpiredBuckets(now);
			}
			if (rateLimitLogWindows.size > 2000) {
				cleanupExpiredRateLimitLogs(now);
			}
			const existingBucket = rateLimitBuckets.get(bucketKey);
			let bucket: RateLimitBucket;
			if (!existingBucket || existingBucket.resetAt <= now) {
				bucket = {
					count: 1,
					resetAt: now + options.windowMs
				};
				rateLimitBuckets.set(bucketKey, bucket);
			} else {
				existingBucket.count += 1;
				bucket = existingBucket;
			}
			currentCount = bucket.count;
			resetAt = bucket.resetAt;
			remaining = Math.max(options.max - bucket.count, 0);
			allowed = bucket.count <= options.max;
		}

		c.header('X-RateLimit-Limit', String(options.max));
		c.header('X-RateLimit-Remaining', String(remaining));
		c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

		if (!allowed) {
			const retryAfterSeconds = Math.max(Math.ceil((resetAt - now) / 1000), 1);
			c.header('Retry-After', String(retryAfterSeconds));

			if (typeof options.onLimit === 'function') {
				try {
					const lastLoggedWindow = rateLimitLogWindows.get(bucketKey);
					if (lastLoggedWindow !== resetAt) {
						rateLimitLogWindows.set(bucketKey, resetAt);
						const result = options.onLimit(c, {
							clientId,
							namespace: options.namespace,
							windowMs: options.windowMs,
							max: options.max,
							currentCount,
							retryAfterSeconds,
							resetAt,
							userAgentSummary: summarizeUserAgent(c.req.raw.headers)
						});
						if (result && typeof (result as Promise<void>).then === 'function') {
							if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
								c.executionCtx.waitUntil(result as Promise<void>);
							} else {
								void result;
							}
						}
					}
				} catch (_error) {
					// Logging rate limit tidak boleh mengganggu flow utama.
				}
			}

			return c.json({
				success: false,
				message: options.message
			}, 429);
		}

		await next();
	};
}
