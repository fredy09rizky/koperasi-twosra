import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './types/bindings.js';
import publicRoutes from './routes/public.js';
import paymentRoutes from './routes/payment.js';
import adminRoutes from './routes/admin.js';
import { requestLogger } from './middleware/request-logger.js';
import { csrfMiddleware } from './middleware/csrf.js';
import { cleanupOldReservationRows, ensureStockReservationSchema, releaseExpiredReservations } from './utils/stock-reservations.js';
import { getGlobalLogger } from './utils/logger.js';
import { RateLimiterDurableObject } from './durable/rate-limiter.js';
import { getAllowedOrigins } from './utils/origin-policy.js';

// Entry point Worker.
// File ini merakit route public/payment/admin, CORS, security headers, dan cron sweep.
const app = new Hono<{ Bindings: Bindings }>();

function isAssetRequest(pathname: string): boolean {
	return !pathname.startsWith('/api/');
}

function buildAssetCacheControl(pathname: string): string {
	if (pathname === '/' || pathname.endsWith('.html')) {
		return 'public, max-age=0, must-revalidate';
	}

	if (/\.(?:css|js|mjs)$/i.test(pathname)) {
		return 'public, max-age=604800, stale-while-revalidate=86400';
	}

	if (/\.(?:png|jpg|jpeg|webp|avif|svg|ico|mp3|woff2?|ttf)$/i.test(pathname)) {
		return 'public, max-age=2592000, stale-while-revalidate=86400';
	}

	return 'public, max-age=3600, stale-while-revalidate=86400';
}

async function serveStaticAsset(request: Request, env: Bindings): Promise<Response> {
	const assetResponse = await env.ASSETS.fetch(request);
	if (!assetResponse || assetResponse.status >= 400) {
		return assetResponse;
	}

	const url = new URL(request.url);
	const headers = new Headers(assetResponse.headers);
	headers.set('Cache-Control', buildAssetCacheControl(url.pathname));

	// Security headers untuk HTML pages — mencegah XSS, klikjacking, dan API abuse.
	if (url.pathname.endsWith('.html') || url.pathname === '/') {
		headers.set(
			'Content-Security-Policy',
			[
				"default-src 'self'",
				"script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
				"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
				"font-src 'self' https://fonts.gstatic.com",
				"img-src 'self' data: https:",
				"connect-src 'self' https://app.pakasir.com",
				"frame-ancestors 'none'",
				"base-uri 'self'",
				"object-src 'none'",
				"form-action 'self'"
			].join('; ')
		);
		headers.set('X-Content-Type-Options', 'nosniff');
		headers.set('X-Frame-Options', 'DENY');
		headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		// Batasi akses ke API browser sensitif yang tidak dibutuhkan aplikasi ini.
		headers.set(
			'Permissions-Policy',
			[
				'camera=()',
				'microphone=()',
				'geolocation=()',
				'payment=(self)',
				'usb=()',
				'bluetooth=()',
				'accelerometer=()',
				'gyroscope=()'
			].join(', ')
		);
		// Workers selalu di atas HTTPS; header ini memastikan browser tidak pernah downgrade.
		headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	return new Response(assetResponse.body, {
		status: assetResponse.status,
		statusText: assetResponse.statusText,
		headers
	});
}

// Middleware CORS global untuk route API, tetapi tetap dibatasi origin yang diizinkan.
app.use('/api/*', cors({
	origin: (origin, c) => {
		const allowedOrigins = getAllowedOrigins(c.req.url, c.env);
		// Kembalikan null jika origin tidak diizinkan → browser tidak mendapat header CORS
		// dan otomatis memblokir akses response dari sisi JavaScript.
		return allowedOrigins.has(origin) ? origin : null;
	},
	allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Authorization'],
	credentials: true
}));

// Security headers untuk seluruh respons API.
app.use('*', async (c, next) => {
	c.header('X-Content-Type-Options', 'nosniff');
	c.header('X-Frame-Options', 'DENY');
	c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
	await next();
});

// Tambahkan requestId dan context logger otomatis untuk seluruh endpoint API.
app.use('/api/*', requestLogger);

// Proteksi CSRF untuk seluruh route yang mengubah state.
app.use('/api/*', csrfMiddleware());

// Pasang seluruh kelompok route ke aplikasi utama.
app.route('/', publicRoutes);
app.route('/', paymentRoutes);
app.route('/api/admin', adminRoutes);

// Penanganan error global agar respons API tetap konsisten.
app.onError((err, c) => {
	getGlobalLogger(c.env?.ENVIRONMENT).error('Global error handler triggered', {
		message: err.message,
		name: err.name,
		stack: err.stack,
	});

	// Tangani error JWT dengan respons 401 yang seragam.
	if (err.name === 'JwtTokenExpired' || err.name === 'JwtTokenInvalid' || err.name === 'JwtTokenSignatureMismatched') {
		return c.json({ success: false, message: 'Sesi tidak valid atau telah berakhir (Unauthorized)' }, 401);
	}

	// Hormati respons bawaan HTTPException bila memang sengaja dilempar route.
	if (err instanceof Error && err.name === 'HTTPException') {
		return (err as any).getResponse();
	}

	return c.json({ success: false, message: 'Terjadi Kesalahan Server Internal' }, 500);
});

/**
 * Validasi environment variables di awal agar error konfigurasi langsung terdeteksi.
 * Dipanggil di request pertama untuk memastikan semua secret penting sudah diisi.
 */
let envValidated = false;
function validateEnvOnStartup(env: Bindings) {
	if (envValidated) return;

	const errors: string[] = [];

	// JWT_SECRET: wajib untuk autentikasi admin
	if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
		errors.push('JWT_SECRET harus diisi dan minimal 32 karakter');
	}

	const normalizedEnvironment = String(env.ENVIRONMENT || '').trim().toLowerCase();
	if (normalizedEnvironment !== 'development' && normalizedEnvironment !== 'production') {
		errors.push('ENVIRONMENT harus diisi dengan development atau production');
	}

	// Payment gateway: wajib untuk QRIS
	if (!env.PAKASIR_PROJECT_SLUG?.trim()) {
		errors.push('PAKASIR_PROJECT_SLUG harus diisi');
	}
	if (!env.PAKASIR_API_KEY?.trim()) {
		errors.push('PAKASIR_API_KEY harus diisi');
	}

	// Telegram: wajib untuk notifikasi operasional
	if (!env.TELEGRAM_BOT_TOKEN?.trim()) {
		errors.push('TELEGRAM_BOT_TOKEN harus diisi');
	}
	if (!env.TELEGRAM_CHAT_ID?.trim()) {
		errors.push('TELEGRAM_CHAT_ID harus diisi');
	}
	if (!env.TELEGRAM_TOPIC_ORDER?.trim()) {
		errors.push('TELEGRAM_TOPIC_ORDER harus diisi');
	}
	if (!env.TELEGRAM_TOPIC_SECURITY?.trim()) {
		errors.push('TELEGRAM_TOPIC_SECURITY harus diisi');
	}
	if (!env.TELEGRAM_TOPIC_ADMIN?.trim()) {
		errors.push('TELEGRAM_TOPIC_ADMIN harus diisi');
	}

	if (errors.length > 0) {
		getGlobalLogger(env.ENVIRONMENT).error('Environment validation failed', { errors });
		throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
	}

	envValidated = true;
}

async function runReservationSweep(env: Bindings, shouldPurgeOldRows: boolean) {
	// Dipanggil oleh cron Worker untuk menjaga stok publik tetap akurat walau
	// browser user sudah ditutup atau alur checkout berhenti di tengah jalan.
	// Sweep rutin selalu melepaskan reservasi kedaluwarsa; purge baris lama dipisah agar pembersihan berat tidak terjadi setiap tick cron.
	await ensureStockReservationSchema(env);
	await releaseExpiredReservations(env);
	if (shouldPurgeOldRows) {
		await cleanupOldReservationRows(env);
	}
}

const worker = {
	fetch: async (request: Request, env: Bindings, executionCtx: ExecutionContext) => {
		// Validasi environment di request pertama agar error konfigurasi langsung terlihat.
		validateEnvOnStartup(env);

		const url = new URL(request.url);
		if (isAssetRequest(url.pathname)) {
			const assetResponse = await serveStaticAsset(request, env);
			if (assetResponse && assetResponse.status < 400) {
				return assetResponse;
			}
		}

		return app.fetch(request, env, executionCtx);
	},
	scheduled: async (controller: any, env: Bindings) => {
		try {
			const scheduledTime = Number(controller?.scheduledTime);
			const shouldPurgeOldRows = Number.isFinite(scheduledTime)
				? new Date(scheduledTime).getUTCMinutes() === 0
				: false;
			await runReservationSweep(env, shouldPurgeOldRows);
		} catch (error) {
			getGlobalLogger(env.ENVIRONMENT).error('Cron sweep reservasi gagal', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}
};

export default worker;
export { RateLimiterDurableObject };
