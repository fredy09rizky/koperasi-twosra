import { Hono } from 'hono';
import type { Bindings } from '../types/bindings.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { toIsoUtcTimestamp, formatWindowLabel, maskToken } from '../utils/log.js';
import { ensureOrderItemSchema } from '../utils/order-item-schema.js';
import { ensureOrderPickupSchema } from '../utils/order-pickup-schema.js';
import { ensureStoreStatusSchema, getStoreStatus } from '../utils/store-status.js';
import { createOperationalLogPromise } from '../utils/operational-log.js';
import { getErrorMessage } from '../utils/type-safe.js';
import { getRequestLogger } from '../utils/route-helpers.js';
import { optimizeImageRequest } from '../services/image-optimizer.js';
import { buildPublicProductsResponse } from '../services/public-products.js';
import { finalizePaidOrderRequest } from '../services/public-order-finalization.js';

// Route public adalah titik sambung utama frontend publik:
// - `public/js/data.js` dan `app.core.js` membaca katalog lewat `/api/products`
// - `public/js/checkout/form.payment.flow.js` menyimpan order final lewat `/api/orders`
// - halaman verifikasi publik membaca detail order lewat `/api/orders/verify/:token`
const publicRoutes = new Hono<{ Bindings: Bindings }>();
// queueOperationalLog di file ini memakai createOperationalLogPromise yang menentukan
// topic Telegram secara otomatis dari prefix judul ('Rate Limit:' → Security, lainnya → Order).
// Tidak diekstrak ke shared utility karena payment.ts punya routing topic yang berbeda
// (memisahkan 'order' vs 'security' dengan logika getPaymentTelegramTopic sendiri).
function queueOperationalLog(c: any, title: string, lines: string[]) {
	const logPromise = createOperationalLogPromise(c, title, lines);
	if (logPromise && c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
		c.executionCtx.waitUntil(logPromise);
	}
}

const orderCreateRateLimit = createRateLimitMiddleware({
	namespace: 'orders-create',
	windowMs: 10 * 60 * 1000,
	max: 30,
	message: 'Terlalu banyak percobaan menyimpan order. Coba lagi beberapa menit lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: simpan order', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const orderVerifyRateLimit = createRateLimitMiddleware({
	namespace: 'orders-verify',
	windowMs: 5 * 60 * 1000,
	max: 60,
	message: 'Terlalu banyak percobaan verifikasi publik. Tunggu sebentar lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: verifikasi order publik', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const imageOptimizeRateLimit = createRateLimitMiddleware({
	namespace: 'image-optimize',
	windowMs: 60 * 1000,
	max: 60,
	message: 'Terlalu banyak permintaan optimasi gambar. Tunggu sebentar lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: optimasi gambar', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});

function buildImageSourceLogValue(rawUrl: string): string {
	const trimmed = String(rawUrl || '').trim();
	if (!trimmed) return '-';

	try {
		const parsed = new URL(trimmed);
		const compactPath = parsed.pathname.length > 160
			? `${parsed.pathname.slice(0, 160)}...`
			: parsed.pathname;
		return `${parsed.protocol}//${parsed.host}${compactPath}`;
	} catch {
		const noQuery = trimmed.split('?')[0].split('#')[0];
		return noQuery.length > 200 ? `${noQuery.slice(0, 200)}...` : noQuery;
	}
}

/**
 * Endpoint health check sederhana.
 */
publicRoutes.get('/', (c) => c.text('Koperasi Backend is Running!'));

/**
 * Endpoint health check detail untuk monitoring.
 * Memberikan informasi status database, storage, dan komponen penting.
 */
publicRoutes.get('/api/health', async (c) => {
	const logger = getRequestLogger(c);
	try {
		const checks: Record<string, { status: string; details?: string }> = {
			api: { status: 'ok' },
			database: { status: 'unknown' },
			storage: { status: 'unknown' }
		};

		// Cek database
		try {
			await c.env.DB.prepare('SELECT 1 as test').first();
			checks.database = { status: 'ok' };
		} catch (dbError) {
			logger.warn('Health check database degraded', {
				error: dbError instanceof Error ? dbError.message : String(dbError),
			});
			checks.database = {
				status: 'degraded'
			};
		}

		// Cek storage (R2) - jangan laporkan "ok" penuh jika baru sebatas binding ada.
		if (c.env.IMG_BUCKET) {
			checks.storage = {
				status: 'binding_present',
				details: 'Binding R2 terpasang, tetapi endpoint health tidak melakukan probe bucket aktif.'
			};
		} else {
			checks.storage = { status: 'not_configured' };
		}

		const allHealthy = Object.values(checks).every(c => (
			c.status === 'ok'
			|| c.status === 'not_configured'
			|| c.status === 'binding_present'
		));
		const statusCode = allHealthy ? 200 : 503;

		return c.json({
			status: allHealthy ? 'healthy' : 'degraded',
			timestamp: new Date().toISOString(),
			checks
		}, statusCode);
	} catch (error) {
		logger.error('Health check endpoint failed', {
			error: error instanceof Error ? error.message : String(error),
		});
		return c.json({
			status: 'error',
			timestamp: new Date().toISOString()
		}, 500);
	}
});

/**
 * Optimasi gambar eksternal/lokal agar frontend tidak langsung mengunduh file sangat besar.
 */
publicRoutes.get('/api/image-optimize', imageOptimizeRateLimit, async (c) => {
	try {
		const result = await optimizeImageRequest({
			env: c.env,
			requestUrl: c.req.url,
			rawUrl: c.req.query('url') || '',
			widthRaw: c.req.query('w'),
			heightRaw: c.req.query('h'),
			qualityRaw: c.req.query('q'),
			fitRaw: c.req.query('fit')
		});
		return result.response;
	} catch (error) {
		const logger = getRequestLogger(c);
		logger.error('Gagal optimasi gambar produk', {
			sourceUrl: buildImageSourceLogValue(String(c.req.query('url') || '')),
			width: c.req.query('w'),
			height: c.req.query('h'),
			quality: c.req.query('q'),
			error: error instanceof Error ? error.message : String(error),
		});
		return c.text('Gagal memproses gambar', 500);
	}
});

/**
 * Menyajikan gambar produk dari bucket R2.
 */
publicRoutes.get('/api/images/:key', async (c) => {
	const key = c.req.param('key');

	try {
		const object = await c.env.IMG_BUCKET.get(key);

		if (object === null) {
			return c.text('Gambar tidak ditemukan', 404);
		}

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);
		headers.set('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=86400');
		headers.set('X-Content-Type-Options', 'nosniff');

		return new Response(object.body, { headers });
	} catch (error) {
		const logger = getRequestLogger(c);
		logger.error('Gagal mengambil gambar dari R2', {
			imageKey: key,
			error: error instanceof Error ? error.message : String(error),
		});
		return c.text('Gagal mengambil gambar dari penyimpanan', 500);
	}
});

/**
 * Mengambil status operasional web untuk frontend publik.
 */
publicRoutes.get('/api/store-status', async (c) => {
	try {
		await ensureStoreStatusSchema(c.env);
		const storeStatus = await getStoreStatus(c.env);

		return c.json({
			success: true,
			data: {
				accepting_orders: storeStatus.accepting_orders,
				updated_at: storeStatus.updated_at ? toIsoUtcTimestamp(storeStatus.updated_at) : null,
				updated_by: storeStatus.updated_by
			}
		});
	} catch (error) {
		const logger = getRequestLogger(c);
		logger.error('Gagal mengambil status operasional web', {
			error: error instanceof Error ? error.message : String(error),
		});
		return c.json({ success: false, message: 'Gagal mengambil status operasional web' }, 500);
	}
});

/**
 * Mengambil daftar produk dengan stok publik yang sudah dikurangi reservasi aktif.
 */
publicRoutes.get('/api/products', async (c) => {
	try {
		return await buildPublicProductsResponse(c.env, c.req.header('if-none-match') || '');
	} catch (error) {
		const logger = getRequestLogger(c);
		logger.error('Gagal mengambil katalog produk publik', {
			error: getErrorMessage(error),
		});
		return c.json({ success: false, message: 'Database error' }, 500);
	}
});

/**
 * Membuat order final dengan validasi keamanan berbasis snapshot checkout server.
 */
publicRoutes.post('/api/orders', orderCreateRateLimit, async (c) => finalizePaidOrderRequest(c));

/**
 * Mengambil detail order berdasarkan token verifikasi publik.
 */
publicRoutes.get('/api/orders/verify/:token', orderVerifyRateLimit, async (c) => {
	const verificationToken = c.req.param('token').trim();
	try {
		await ensureOrderItemSchema(c.env);
		await ensureOrderPickupSchema(c.env);

		if (!/^[a-f0-9]{48}$/i.test(verificationToken)) {
			return c.json({ success: false, message: 'Token verifikasi tidak valid' }, 400);
		}

		const order: any = await c.env.DB.prepare(
			`SELECT id, customer_name, customer_class, pickup_time, total_amount, fee, payment_status, pickup_status, picked_up_at, created_at
			 FROM orders WHERE verification_token = ?`
		).bind(verificationToken).first();

		if (!order) {
			return c.json({ success: false, message: 'Transaksi tidak ditemukan' }, 404);
		}

		// SELECT eksplisit - tidak memakai SELECT * agar kolom yang ditambahkan di masa depan
		// tidak bocor ke publik tanpa review eksplisit.
		const { results: itemsRows } = await c.env.DB.prepare(
			'SELECT product_name, product_code_snapshot, quantity, price_at_purchase FROM order_items WHERE order_id = ?'
		).bind(order.id).all();

		// Respons verifikasi publik hanya memuat field yang aman ditampilkan.
		// wa_number sengaja dikecualikan - nomor WA adalah data pribadi yang tidak perlu
		// dilihat oleh siapa pun yang memindai QR code verifikasi.
		return c.json({
			success: true,
			data: {
				id: String(order.id),
				customer_name: String(order.customer_name || ''),
				customer_class: String(order.customer_class || ''),
				pickup_time: String(order.pickup_time || ''),
				total_amount: Number(order.total_amount || 0),
				fee: Number(order.fee || 0),
				payment_status: String(order.payment_status || ''),
				// Verifikasi publik hanya membaca status pickup; perubahan status tetap eksklusif di area admin.
				pickup_status: String(order?.pickup_status || 'BELUM_DIAMBIL'),
				picked_up_at: order?.picked_up_at ? toIsoUtcTimestamp(order?.picked_up_at) : null,
				created_at: toIsoUtcTimestamp(order?.created_at),
				items: itemsRows
			}
		});
	} catch (error) {
		const logger = getRequestLogger(c);
		logger.error('Gagal mengambil detail verifikasi pesanan', {
			token: maskToken(verificationToken),
			error: error instanceof Error ? error.message : String(error),
		});
		return c.json({ success: false, message: 'Terjadi kesalahan sistem internal' }, 500);
	}
});

export default publicRoutes;
