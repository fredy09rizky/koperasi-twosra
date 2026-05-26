import type { MiddlewareHandler } from 'hono';
import { getAllowedOrigins } from '../utils/origin-policy.js';

/**
 * Middleware CSRF berbasis validasi Origin/Referer.
 *
 * Pendekatan ini dipilih karena:
 * - Admin menggunakan cookie HttpOnly (rawan CSRF)
 * - Public routes juga menerima POST dari browser
 * - Tidak memerlukan token CSRF yang kompleks untuk SPA sederhana
 *
 * Cara kerja:
 * - Untuk request dengan Origin header, validasi apakah sesuai dengan worker origin
 * - Untuk request tanpa Origin (legacy/same-origin), validasi Referer header
 * - Request tanpa Origin dan Referer hanya diizinkan untuk caller internal
 *   yang menyertakan x-internal-key valid
 */
export function csrfMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const method = c.req.method;

		// Hanya proteksi method yang mengubah state
		if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
			await next();
			return;
		}

		const origin = c.req.raw.headers.get('Origin');
		const referer = c.req.raw.headers.get('Referer');
		const allowedOrigins = getAllowedOrigins(c.req.url, c.env);

		// Jika ada Origin header, validasi
		if (origin) {
			if (!allowedOrigins.has(origin)) {
				return c.json(
					{ success: false, message: 'Origin validation failed' },
					403
				);
			}
		}
		// Jika tidak ada Origin tapi ada Referer, validasi Referer
		else if (referer) {
			try {
				const refererOrigin = new URL(referer).origin;
				if (!allowedOrigins.has(refererOrigin)) {
					return c.json(
						{ success: false, message: 'Origin validation failed' },
						403
					);
				}
			} catch {
				// Invalid URL, tolak untuk keamanan
				return c.json(
					{ success: false, message: 'Origin validation failed' },
					403
				);
			}
		}
		// Jika tidak ada Origin dan tidak ada Referer:
		// - Admin routes selalu ditolak (harus berasal dari browser admin)
		// - Public mutating routes hanya boleh dari caller internal dengan shared secret
		else {
			if (c.req.path.startsWith('/api/admin')) {
				return c.json(
					{ success: false, message: 'Origin validation failed' },
					403
				);
			}

			const internalHeader = c.req.raw.headers.get('x-internal-key');
			const expectedInternalKey = String(c.env?.INTERNAL_WEBHOOK_KEY || '').trim();
			if (!expectedInternalKey || internalHeader !== expectedInternalKey) {
				return c.json(
					{ success: false, message: 'Origin validation failed' },
					403
				);
			}
		}

		await next();
	};
}
