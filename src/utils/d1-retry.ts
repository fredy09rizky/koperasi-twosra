import { createLogger, normalizeEnvironment, type AppEnvironment } from './logger.js';
import { getErrorMessage } from './type-safe.js';

type D1RetryOptions = {
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	jitterRatio?: number;
	label?: string;
	environment?: AppEnvironment;
};

const RETRYABLE_D1_PATTERNS = [
	/network connection lost/i,
	/storage caused object to be reset/i,
	/reset because its code was updated/i,
	/\bdatabase is locked\b/i,
	/\bdb is locked\b/i,
	/\bdatabase is busy\b/i,
	/\boverloaded\b/i,
	/\btemporar(?:y|ily)\b/i,
	/\btimeout\b/i,
	/\btoo many requests\b/i
];

export function isRetryableD1Error(error: unknown): boolean {
	const message = getErrorMessage(error);
	if (!message) return false;
	return RETRYABLE_D1_PATTERNS.some((pattern) => pattern.test(message));
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number, jitterRatio: number): number {
	const expDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)));
	const jitterWindow = Math.max(0, Math.floor(expDelay * jitterRatio));
	const jitterOffset = jitterWindow > 0 ? Math.floor((Math.random() * (jitterWindow * 2 + 1)) - jitterWindow) : 0;
	return Math.max(0, expDelay + jitterOffset);
}

export async function withD1Retry<T>(
	task: () => Promise<T>,
	options: D1RetryOptions = {}
): Promise<T> {
	const {
		maxAttempts = 3,
		baseDelayMs = 80,
		maxDelayMs = 800,
		jitterRatio = 0.35,
		label = 'D1 query',
		environment = 'development'
	} = options;

	const logger = createLogger({
		service: 'koperasi-backend',
		environment: normalizeEnvironment(environment),
	});

	let attempt = 0;
	let lastError: unknown = null;

	while (attempt < maxAttempts) {
		attempt += 1;
		try {
			return await task();
		} catch (error) {
			lastError = error;
			const retryable = isRetryableD1Error(error);
			const canRetry = retryable && attempt < maxAttempts;
			if (!canRetry) {
				throw error;
			}

			const delayMs = computeDelayMs(attempt, baseDelayMs, maxDelayMs, jitterRatio);
			logger.warn('Retry query D1 karena error sementara', {
				label,
				attempt,
				maxAttempts,
				delayMs,
				error: error instanceof Error ? error.message : String(error),
			});
			await sleep(delayMs);
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error('D1 query gagal setelah retry');
}
