import { DurableObject } from 'cloudflare:workers';

type RateLimitRequestPayload = {
	windowMs: number;
	max: number;
	now?: number;
};

type RateLimitBucket = {
	count: number;
	resetAt: number;
};

function parsePositiveInt(value: unknown): number {
	const num = Number(value);
	if (!Number.isFinite(num)) return 0;
	return Math.max(0, Math.trunc(num));
}

export class RateLimiterDurableObject extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'POST') {
			return Response.json({ success: false, message: 'Method Not Allowed' }, { status: 405 });
		}

		let body: RateLimitRequestPayload | null = null;
		try {
			body = await request.json<RateLimitRequestPayload>();
		} catch {
			return Response.json({ success: false, message: 'Invalid JSON payload' }, { status: 400 });
		}

		const windowMs = parsePositiveInt(body?.windowMs);
		const max = parsePositiveInt(body?.max);
		// Clamp `now` ke maksimal 60 detik ke depan dari waktu server untuk mencegah
		// manipulasi nilai yang bisa membuat bucket tidak pernah reset.
		const clientNow = parsePositiveInt(body?.now);
		const now = clientNow > 0 ? Math.min(clientNow, Date.now() + 60_000) : Date.now();
		if (windowMs <= 0 || max <= 0) {
			return Response.json({ success: false, message: 'Invalid rate limit config' }, { status: 400 });
		}

		const bucketKey = 'bucket';
		const existing = await this.ctx.storage.get<RateLimitBucket>(bucketKey);
		let bucket: RateLimitBucket;

		if (!existing || Number(existing.resetAt || 0) <= now) {
			bucket = {
				count: 1,
				resetAt: now + windowMs
			};
		} else {
			bucket = {
				count: Number(existing.count || 0) + 1,
				resetAt: Number(existing.resetAt || now + windowMs)
			};
		}

		await this.ctx.storage.put(bucketKey, bucket);

		const remaining = Math.max(max - bucket.count, 0);
		return Response.json({
			success: true,
			allowed: bucket.count <= max,
			count: bucket.count,
			remaining,
			resetAt: bucket.resetAt
		});
	}
}

