import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDatabase } from './helpers.js';

describe('Koperasi Backend API', () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	describe('CSRF Protection', () => {
		it('POST /api/checkout/session with same origin succeeds', async () => {
			// SELF.fetch otomatis menyertakan Origin yang sesuai dengan worker origin
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 5000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).not.toBe(403);
			const payload = await response.json<any>();
			if (response.status === 200) {
				expect(payload.success).toBe(true);
				return;
			}
			expect(response.status).toBe(429);
			expect(payload.success).toBe(false);
		});

		it('POST /api/checkout/session with foreign origin is rejected', async () => {
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'https://evil-site.com'
				},
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 5000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(403);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(payload.message).toContain('Origin validation failed');
		});

		it('POST /api/checkout/session with allowed extra origin succeeds', async () => {
			const previousAllowedOrigins = env.CORS_ALLOWED_ORIGINS;
			env.CORS_ALLOWED_ORIGINS = 'https://domain-a.com,https://domain-b.com';
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'https://domain-a.com'
				},
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 5000
				})
			});

			try {
				const response = await SELF.fetch(request);
				expect(response.status).not.toBe(403);
				const payload = await response.json<any>();
				if (response.status === 200) {
					expect(payload.success).toBe(true);
					return;
				}
				expect(response.status).toBe(429);
				expect(payload.success).toBe(false);
			} finally {
				env.CORS_ALLOWED_ORIGINS = previousAllowedOrigins;
			}
		});

		it('POST /api/admin/store-status without Origin header is rejected', async () => {
			// Admin routes wajib punya Origin header
			const request = new Request('http://example.com/api/admin/store-status', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ accepting_orders: false })
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(403);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(payload.message).toContain('Origin validation failed');
		});

		it('POST /api/checkout/session without Origin/Referer and without internal key is rejected', async () => {
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 5000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(403);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(payload.message).toContain('Origin validation failed');
		});

		it('POST /api/checkout/session without Origin/Referer succeeds with valid x-internal-key', async () => {
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-internal-key': String(env.INTERNAL_WEBHOOK_KEY)
				},
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 5000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).not.toBe(403);
			const payload = await response.json<any>();
			if (response.status === 200) {
				expect(payload.success).toBe(true);
				return;
			}
			expect(response.status).toBe(429);
			expect(payload.success).toBe(false);
		});

		it('GET requests are not affected by CSRF', async () => {
			const request = new Request('http://example.com/api/products');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
		});
	});
});
