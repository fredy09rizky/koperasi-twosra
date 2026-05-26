import { Hono, type Context } from 'hono';
import type { Bindings } from '../types/bindings.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { sanitizeLogValue, formatWindowLabel, toIsoUtcTimestamp, maskToken } from '../utils/log.js';
import { getRequestMetaLines } from '../utils/request-meta.js';
import { getTelegramTopicId, resolveTelegramConfig, sendOperationalLog } from '../utils/telegram.js';
import { ensureCheckoutSessionPaymentSchema } from '../utils/checkout-session-schema.js';
import { ensureStoreStatusSchema, getStoreStatus } from '../utils/store-status.js';
import {
	ensureStockReservationSchema,
	releaseExpiredReservations,
	releaseReservationsByCheckoutToken
} from '../utils/stock-reservations.js';
import { resolveEnvironmentMode } from '../utils/logger.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { getRequestLogger } from '../utils/route-helpers.js';
import {
	getErrorMessage,
	isRecord,
	normalizeContentfulStatusCode,
	readStringProperty
} from '../utils/type-safe.js';
import { formatSqlTimestamp } from '../utils/format.js';
import {
	buildCheckoutItemValidation,
	buildIdempotentQrisResponse,
	calculateCheckoutPricing,
	CHECKOUT_SESSION_TTL_MS,
	CHECKOUT_TOKEN_REGEX,
	cleanupCheckoutSessions,
	createCheckoutSessionWithReservations,
	generateCheckoutToken,
	generateOrderId,
	getCheckoutSession,
	type CheckoutItemValidationResult
} from '../services/payment-sessions.js';
import {
	cancelPakasirTransaction,
	createPakasirQris,
	getPakasirCredentials,
	getPakasirTransactionDetail
} from '../services/pakasir-gateway.js';

// Route payment dipanggil langsung oleh frontend checkout:
// - `public/js/checkout/form.payment.flow.js` dan `form.payment.polling.js` menangani session, QRIS, polling, dan cancel
// - `public.ts` lalu memakai snapshot session yang dibuat file ini saat menyimpan order final
const paymentRoutes = new Hono<{ Bindings: Bindings }>();
type PaymentContext = Context<{ Bindings: Bindings }>;

const PAYMENT_EVENT_TYPES = {
	recovery_restored: {
		title: 'Log Frontend: sesi pembayaran dipulihkan',
		sendToTelegram: false
	},
	recovery_started: {
		title: 'Log Frontend: mode pemulihan dimulai',
		sendToTelegram: false
	},
	recovery_window_expired: {
		title: 'Log Frontend: window pemulihan habis',
		sendToTelegram: false
	},
	recovery_retry_exhausted: {
		title: 'Log Frontend: retry pemulihan habis',
		sendToTelegram: true
	},
	order_save_fallback: {
		title: 'Log Frontend: pembayaran sukses tetapi pencatatan order fallback',
		sendToTelegram: true
	}
} as const;

type PaymentEventType = keyof typeof PAYMENT_EVENT_TYPES;
type PaymentEventSessionRow = {
	checkout_token?: string;
	order_id?: string;
	amount?: number;
	status?: string;
	payment_started_at?: string | null;
	gateway_expires_at?: string | null;
	gateway_status?: string | null;
	expires_at?: string | null;
};

const checkoutSessionRateLimit = createRateLimitMiddleware({
	namespace: 'checkout-session',
	windowMs: 5 * 60 * 1000,
	max: 20,
	message: 'Terlalu banyak percobaan checkout. Coba lagi beberapa menit lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: checkout session', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const paymentCreateRateLimit = createRateLimitMiddleware({
	namespace: 'payment-qris',
	windowMs: 5 * 60 * 1000,
	max: 20,
	message: 'Terlalu banyak permintaan pembuatan QRIS. Coba lagi beberapa menit lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: pembuatan QRIS', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const paymentStatusRateLimit = createRateLimitMiddleware({
	namespace: 'payment-status',
	windowMs: 5 * 60 * 1000,
	max: 180,
	message: 'Terlalu banyak pengecekan status pembayaran. Tunggu sebentar lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: cek status pembayaran', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Checkout Token: ${sanitizeLogValue(c.req.query('checkout_token') || '-', 64)}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const paymentCancelRateLimit = createRateLimitMiddleware({
	namespace: 'payment-cancel',
	windowMs: 5 * 60 * 1000,
	max: 20,
	message: 'Terlalu banyak pembatalan transaksi. Tunggu sebentar lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: pembatalan transaksi', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const paymentEventRateLimit = createRateLimitMiddleware({
	namespace: 'payment-event',
	windowMs: 10 * 60 * 1000,
	max: 20,
	message: 'Terlalu banyak event pembayaran dari browser. Tunggu sebentar lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: event frontend pembayaran', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});

// queueOperationalLog di file ini memakai getPaymentTelegramTopic untuk memisahkan
// topic 'order' vs 'security' berdasarkan prefix judul — berbeda dari public.ts yang
// memakai createOperationalLogPromise dengan routing otomatis. Karena perbedaan routing
// ini disengaja, queueOperationalLog tidak diekstrak ke shared utility.
function getPaymentTelegramTopic(c: PaymentContext, title: string): number | null {
	try {
		const config = resolveTelegramConfig(c.env);
		if (title.startsWith('Incident:') || title.startsWith('Rate Limit:')) {
			return getTelegramTopicId(config, 'security');
		}
		return getTelegramTopicId(config, 'order');
	} catch {
		return null;
	}
}

function queueOperationalLog(
	c: PaymentContext,
	title: string,
	lines: string[]
) {
	try {
		// Non-blocking: log operasional tidak boleh menggagalkan transaksi utama
		// meskipun Telegram lambat atau offline.
		const { token, chatId } = resolveTelegramConfig(c.env);
		const logPromise = sendOperationalLog(token, chatId, getPaymentTelegramTopic(c, title), {
			title,
			lines: [...lines, ...getRequestMetaLines(c.req.raw.headers)]
		}, resolveEnvironmentMode(c.env));
		if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
			c.executionCtx.waitUntil(logPromise);
		} else {
			void logPromise;
		}
	} catch {
		// Log operasional bersifat opsional; jangan ganggu flow utama.
	}
}

/**
 * Membuat sesi checkout sebelum QRIS dimulai.
 * Total selalu dihitung ulang dari DB agar endpoint payment tidak mempercayai subtotal dari browser.
 */
paymentRoutes.post('/api/checkout/session', checkoutSessionRateLimit, async (c) => {
	try {
		const logger = getRequestLogger(c);
		await ensureStockReservationSchema(c.env);
		await ensureCheckoutSessionPaymentSchema(c.env);
		await ensureStoreStatusSchema(c.env);
		await cleanupCheckoutSessions(c.env);

		const storeStatus = await getStoreStatus(c.env);
		if (!storeStatus.accepting_orders) {
			return c.json({
				success: false,
				code: 'E-STORE-CLOSED',
				message: 'Koperasi sedang tidak menerima pesanan. Silakan coba lagi nanti.'
			}, 403);
		}

		let body: Record<string, unknown>;
		try {
			const rawBody = await c.req.json();
			body = isRecord(rawBody) ? rawBody : {};
		} catch (parseError) {
			logger.warn('Checkout session rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json({ success: false, message: 'Format JSON tidak valid' }, 400);
		}
		const items = Array.isArray(body.items) ? body.items : [];
		const clientTotal = Number(body.total);

		if (items.length === 0) {
			return c.json({ success: false, message: 'Keranjang belanja kosong' }, 400);
		}

		if (!Number.isFinite(clientTotal) || clientTotal <= 0 || !Number.isInteger(clientTotal)) {
			return c.json({ success: false, message: 'Total checkout tidak valid' }, 400);
		}

		let checkoutItems: CheckoutItemValidationResult;
		try {
			checkoutItems = buildCheckoutItemValidation(items);
		} catch (error: unknown) {
			const errorMessage = getErrorMessage(error);
			if (errorMessage === 'INVALID_PRODUCT_CODE') {
				return c.json({ success: false, message: 'Kode produk tidak valid' }, 400);
			}
			if (errorMessage === 'INVALID_PRODUCT_QUANTITY') {
				return c.json({ success: false, message: `Jumlah produk ${readStringProperty(error, 'productCode')} tidak valid` }, 400);
			}
			if (errorMessage === 'TOO_MANY_PRODUCT_TYPES') {
				return c.json({ success: false, message: 'Maksimal 5 jenis barang berbeda per pesanan' }, 400);
			}
			throw error;
		}

		const { quantityByCode, itemCodes, placeholders } = checkoutItems;
		const expiresAt = formatSqlTimestamp(new Date(Date.now() + CHECKOUT_SESSION_TTL_MS));

		let sessionCreated = false;
		let generatedOrderId = '';
		let checkoutToken = '';
		let calculatedTotal = 0;
		let finalizedProductMap = new Map<string, any>();

		// Retry kecil ini menangani collision langka pada token/order id tanpa memaksa user mengulang checkout dari awal.
		for (let attempt = 0; attempt < 5; attempt++) {
			checkoutToken = generateCheckoutToken();
			generatedOrderId = generateOrderId();
			try {
				await releaseExpiredReservations(c.env);

				const pricingResult = await calculateCheckoutPricing(
					c.env,
					itemCodes,
					placeholders,
					quantityByCode
				);
				calculatedTotal = pricingResult.calculatedTotal;

				if (calculatedTotal < 1000) {
					throw new Error('TOTAL_TOO_LOW');
				}

				if (calculatedTotal !== clientTotal) {
					throw new Error('TOTAL_MISMATCH');
				}

				await createCheckoutSessionWithReservations({
					env: c.env,
					checkoutToken,
					orderId: generatedOrderId,
					calculatedTotal,
					expiresAt,
					quantityByCode,
					txProductMap: pricingResult.txProductMap
				});
				finalizedProductMap = pricingResult.txProductMap;
				sessionCreated = true;
				break;
			} catch (error: unknown) {
				const errorMessage = getErrorMessage(error);
				if (errorMessage === 'STOCK_NOT_ENOUGH') {
					const details = isRecord(error) ? error.details : null;
					const rawDetails = Array.isArray(details)
						? details.map((value: unknown) => sanitizeLogValue(value, 90)).filter(Boolean)
						: [];
					const previewDetails = rawDetails.slice(0, 2).join(', ');
					const remainingCount = rawDetails.length > 2 ? rawDetails.length - 2 : 0;
					const conflictSummary = previewDetails
						? `${previewDetails}${remainingCount > 0 ? ` dan ${remainingCount} produk lain` : ''}`
						: '';

					return c.json({
						success: false,
						code: 'E-STOCK-CHECKOUT',
						message: conflictSummary
							? `Stok berubah: ${conflictSummary}. Silakan kembali ke keranjang untuk menyesuaikan pesanan.`
							: 'Stok produk tidak mencukupi. Silakan kembali ke keranjang untuk menyesuaikan pesanan.',
						conflicted_products: rawDetails
					}, 409);
				}
				if (errorMessage === 'PRODUCT_NOT_FOUND') {
					return c.json({ success: false, message: 'Produk tidak ditemukan di server' }, 400);
				}
				if (errorMessage === 'TOTAL_TOO_LOW') {
					return c.json({ success: false, message: 'Minimal total pesanan adalah Rp1.000' }, 400);
				}
				if (errorMessage === 'TOTAL_MISMATCH') {
					return c.json({
						success: false,
						code: 'E-CHECKOUT-TAMPERING',
						message: 'Total checkout tidak cocok dengan data server. Silakan muat ulang keranjang dan coba lagi.'
					}, 400);
				}
				if (errorMessage.includes('UNIQUE constraint failed')) {
					// Ulangi bila collision unik langka terjadi pada order_id atau checkout_token.
					continue;
				}
				throw error;
			}
		}

		if (!sessionCreated) {
			return c.json({ success: false, message: 'Gagal menyiapkan sesi checkout' }, 500);
		}

		const itemSummary = Array.from(quantityByCode.entries()).map(([code, quantity]) => {
			const product = finalizedProductMap.get(code);
			const productName = sanitizeLogValue(product?.name || code, 60);
			return `${quantity}x ${productName} (${code})`;
		});

		queueOperationalLog(c, 'Log Payment: sesi checkout dibuat', [
			`Order ID: ${generatedOrderId}`,
			`Checkout Token: ${maskToken(checkoutToken)}`,
			`Amount: ${calculatedTotal}`,
			`Jenis barang: ${quantityByCode.size}`,
			`Ringkasan item: ${itemSummary.join('; ') || '-'}`,
			`Recovery window sampai: ${toIsoUtcTimestamp(expiresAt)}`
		]);

		return c.json({
			success: true,
			checkout_token: checkoutToken,
			order_id: generatedOrderId,
			amount: calculatedTotal,
			recovery_expires_at: expiresAt,
			expires_at: expiresAt
		});
	} catch (error) {
		const logger = getRequestLogger(c);
		logger.error('Checkout session error', {
			error: getErrorMessage(error),
		});
		return c.json({ success: false, message: 'Gagal menyiapkan sesi checkout' }, 500);
	}
});

/**
 * Membuat transaksi QRIS ke gateway pembayaran.
 */
paymentRoutes.post('/api/payment/qris', paymentCreateRateLimit, async (c) => {
	try {
		const logger = getRequestLogger(c);
		let body: Record<string, unknown>;
		try {
			const rawBody = await c.req.json();
			body = isRecord(rawBody) ? rawBody : {};
		} catch (parseError) {
			logger.warn('Payment QRIS rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json({ success: false, message: 'Format JSON tidak valid' }, 400);
		}
		const checkoutToken = readStringProperty(body, 'checkout_token');
		if (!CHECKOUT_TOKEN_REGEX.test(checkoutToken)) {
			return c.json({ success: false, message: 'Token checkout tidak valid' }, 400);
		}
		const { projectSlug } = getPakasirCredentials(c.env);
		const session = await getCheckoutSession(c.env, checkoutToken);

		if (!session) {
			return c.json({ success: false, message: 'Sesi checkout tidak ditemukan atau sudah kedaluwarsa' }, 404);
		}

		if (session.status !== 'ACTIVE') {
			return c.json({ success: false, message: 'Sesi checkout sudah tidak aktif' }, 409);
		}

		const existingQrisPayload = buildIdempotentQrisResponse(session, projectSlug);
		if (existingQrisPayload) {
			queueOperationalLog(c, 'Log Payment: QRIS replay dari snapshot checkout', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`Amount: ${session.amount}`,
				`Gateway Status Terakhir: ${session.gateway_status || 'pending'}`,
				`Recovery window sampai: ${toIsoUtcTimestamp(session.expires_at)}`
			]);
			return c.json(existingQrisPayload);
		}

		const qrisSnapshot = await createPakasirQris(c.env, session);
		const gatewayResponse = qrisSnapshot.gatewayResponse;
		const { response } = gatewayResponse;
		if (gatewayResponse.parseError) {
			queueOperationalLog(c, 'Log Payment: response gateway QRIS tidak valid', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`HTTP Status Gateway: ${response.status}`,
				`Payload Gateway: ${sanitizeLogValue(gatewayResponse.rawText, 180)}`
			]);
			return c.json({ success: false, message: 'Gateway pembayaran mengembalikan format respons tidak valid' }, 502);
		}
		const data = isRecord(qrisSnapshot.data) ? qrisSnapshot.data : {};
		const paymentData = isRecord(data.payment) ? data.payment : {};
		const {
			paymentStartedAt,
			gatewayExpiresAt,
			gatewayPaymentNumber,
			gatewayTotalPayment,
			gatewayFee
		} = qrisSnapshot;

		if (response.ok) {
			await withD1Retry(
				() => c.env.DB.prepare(
					`UPDATE checkout_sessions
					 SET payment_started_at = ?, gateway_expires_at = ?, gateway_status = ?, gateway_total_payment = ?, gateway_fee = ?, gateway_payment_number = ?
					 WHERE checkout_token = ?`
				).bind(
					paymentStartedAt,
					gatewayExpiresAt,
					'pending',
					gatewayTotalPayment,
					gatewayFee,
					gatewayPaymentNumber,
					checkoutToken
				).run(),
				{ label: 'payment.qris.persist-gateway-snapshot', environment: resolveEnvironmentMode(c.env) }
			);

			queueOperationalLog(c, 'Log Payment: QRIS berhasil dibuat', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`Amount: ${session.amount}`,
				`Total Payment Gateway: ${gatewayTotalPayment}`,
				`Fee Gateway: ${gatewayFee}`,
				`Payment Started At: ${toIsoUtcTimestamp(paymentStartedAt) || '-'}`,
				`Gateway Expired At: ${gatewayExpiresAt ? toIsoUtcTimestamp(gatewayExpiresAt) : '-'}`,
				`Recovery window sampai: ${toIsoUtcTimestamp(session.expires_at)}`
			]);
		} else {
			queueOperationalLog(c, 'Log Payment: QRIS gagal dibuat di gateway', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`Amount: ${session.amount}`,
				`HTTP Status Gateway: ${response.status}`,
				`Pesan Gateway: ${sanitizeLogValue(readStringProperty(data, 'message') || readStringProperty(data, 'error') || 'Tanpa pesan', 180)}`
			]);
		}

		// Kontrak API stabil — tidak meneruskan seluruh `data` gateway ke client agar field
		// internal gateway (mis. merchant credentials, metadata) tidak bocor ke browser.
		// Frontend membaca `resJson.payment.*` sesuai format Pakasir; kita pertahankan shape itu
		// tetapi hanya sertakan field yang benar-benar dibutuhkan.
		return c.json({
			success: response.ok,
			message: response.ok ? 'OK' : sanitizeLogValue(readStringProperty(data, 'message') || readStringProperty(data, 'error') || 'Gagal membuat QRIS', 180),
			payment: response.ok ? {
				payment_number: gatewayPaymentNumber || '',
				qris_url: readStringProperty(paymentData, 'qris_url') || readStringProperty(data, 'qris_url'),
				qr_code: readStringProperty(paymentData, 'qr_code') || readStringProperty(data, 'qr_code'),
				total_payment: gatewayTotalPayment,
				amount: session.amount,
				expired_at: gatewayExpiresAt
			} : null,
			checkout_token: session.checkout_token,
			order_id: session.order_id,
			amount: session.amount,
			payment_started_at: paymentStartedAt,
			gateway_expires_at: gatewayExpiresAt,
			recovery_expires_at: session.expires_at,
			expires_at: session.expires_at
		}, normalizeContentfulStatusCode(response.status, response.ok ? 200 : 502));
	} catch (error: unknown) {
		if (getErrorMessage(error) === 'PAYMENT_CONFIG_MISSING') {
			return c.json({ success: false, message: 'Konfigurasi gateway pembayaran belum lengkap' }, 500);
		}

		const logger = getRequestLogger(c);
		logger.error('Pakasir QRIS proxy error', {
			error: getErrorMessage(error),
		});
		return c.json({ success: false, message: 'Gagal terhubung ke gateway pembayaran' }, 500);
	}
});

/**
 * Mengecek status transaksi ke gateway pembayaran.
 */
paymentRoutes.get('/api/payment/status', paymentStatusRateLimit, async (c) => {
	try {
		const checkoutToken = String(c.req.query('checkout_token') || '').trim();
		if (!CHECKOUT_TOKEN_REGEX.test(checkoutToken)) {
			return c.json({ success: false, message: 'Token checkout tidak valid' }, 400);
		}
		getPakasirCredentials(c.env);
		const session = await getCheckoutSession(c.env, checkoutToken);

		if (!session) {
			return c.json({ success: false, message: 'Sesi checkout tidak ditemukan atau sudah kedaluwarsa' }, 404);
		}

		if (session.status !== 'ACTIVE') {
			return c.json({ success: false, message: 'Sesi checkout sudah tidak aktif' }, 409);
		}

		const gatewayResponse = await getPakasirTransactionDetail(c.env, session);
		const { response } = gatewayResponse;
		if (gatewayResponse.parseError) {
			queueOperationalLog(c, 'Log Payment: response status gateway tidak valid', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`HTTP Status Gateway: ${response.status}`,
				`Payload Gateway: ${sanitizeLogValue(gatewayResponse.rawText, 180)}`
			]);
			return c.json({ success: false, message: 'Gateway pembayaran mengembalikan format respons tidak valid' }, 502);
		}
		const data = isRecord(gatewayResponse.data) ? gatewayResponse.data : {};
		const transaction = isRecord(data.transaction) ? data.transaction : {};
		const previousGatewayStatus = String(session.gateway_status || '').toLowerCase();
		const gatewayStatus = readStringProperty(transaction, 'status').toLowerCase() || null;
		const gatewayCompletedAt = readStringProperty(transaction, 'completed_at');
		const resolvedPaymentStartedAt = session.payment_started_at || formatSqlTimestamp(new Date());
		const resolvedGatewayExpiresAt = session.gateway_expires_at || null;
		const resolvedGatewayStatus = gatewayStatus || (response.status === 404 ? 'not_found' : session.gateway_status || null);

		if (response.ok || response.status === 404) {
			await withD1Retry(
				() => c.env.DB.prepare(
					`UPDATE checkout_sessions
					 SET gateway_status = ?,
					     payment_started_at = COALESCE(payment_started_at, ?),
					     gateway_expires_at = COALESCE(gateway_expires_at, ?)
					 WHERE checkout_token = ?`
				).bind(
					resolvedGatewayStatus,
					resolvedPaymentStartedAt,
					resolvedGatewayExpiresAt,
					checkoutToken
				).run(),
				{ label: 'payment.status.persist-gateway-status', environment: resolveEnvironmentMode(c.env) }
			);
		}

		if (response.status === 404 && previousGatewayStatus !== 'not_found') {
			queueOperationalLog(c, 'Log Payment: transaksi gateway tidak ditemukan', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`Amount: ${session.amount}`,
				`Status sebelumnya: ${previousGatewayStatus || 'kosong'}`
			]);
		}

		if (response.ok && gatewayStatus && gatewayStatus !== previousGatewayStatus) {
			if (['canceled', 'cancelled', 'failed', 'expired'].includes(gatewayStatus)) {
				queueOperationalLog(c, 'Log Payment: transaksi gateway berakhir tidak sukses', [
					`Order ID: ${session.order_id}`,
					`Checkout Token: ${maskToken(checkoutToken)}`,
					`Gateway Status: ${gatewayStatus}`,
					`Recovery window sampai: ${toIsoUtcTimestamp(session.expires_at)}`
				]);
			}

			if (gatewayStatus === 'completed' && resolvedPaymentStartedAt) {
				const paymentStartedMs = Date.parse(String(resolvedPaymentStartedAt).replace(' ', 'T') + 'Z');
				const completedAtMs = Date.parse(gatewayCompletedAt);
				if (Number.isFinite(paymentStartedMs) && Number.isFinite(completedAtMs) && completedAtMs - paymentStartedMs > 2 * 60 * 1000) {
					queueOperationalLog(c, 'Log Payment: transaksi selesai setelah masuk window recovery', [
						`Order ID: ${session.order_id}`,
						`Checkout Token: ${maskToken(checkoutToken)}`,
						`Completed At: ${toIsoUtcTimestamp(gatewayCompletedAt) || gatewayCompletedAt}`,
						`Recovery window sampai: ${toIsoUtcTimestamp(session.expires_at)}`
					]);
				}
			}
		}

		if (response.ok && gatewayStatus === 'completed' && gatewayCompletedAt) {
			await withD1Retry(
				() => c.env.DB.prepare(
					'UPDATE checkout_sessions SET gateway_status = ? WHERE checkout_token = ?'
				).bind('completed', checkoutToken).run(),
				{ label: 'payment.status.mark-completed', environment: resolveEnvironmentMode(c.env) }
			);
		}

		if (response.ok && gatewayStatus && ['canceled', 'cancelled', 'failed', 'expired'].includes(gatewayStatus)) {
			await withD1Retry(
				() => c.env.DB.prepare(
					`UPDATE checkout_sessions
					 SET status = ?, gateway_status = ?
					 WHERE checkout_token = ? AND status = ?`
				).bind('CANCELLED', gatewayStatus, checkoutToken, 'ACTIVE').run(),
				{ label: 'payment.status.cancel-on-gateway-failed', environment: resolveEnvironmentMode(c.env) }
			);
			await releaseReservationsByCheckoutToken(c.env, checkoutToken, `GATEWAY_${gatewayStatus.toUpperCase()}`);
		}

		// Kontrak API stabil — hanya field yang dibutuhkan polling loop frontend.
		// `transaction.status` dipertahankan untuk kompatibilitas dengan logika polling frontend (`resJson.transaction?.status`).
		// `gateway_status` adalah field canonical baru yang lebih eksplisit untuk penggunaan mendatang.
		return c.json({
			success: response.ok || response.status === 404,
			gateway_status: resolvedGatewayStatus,
			transaction: {
				status: resolvedGatewayStatus,
				completed_at: gatewayCompletedAt ? toIsoUtcTimestamp(gatewayCompletedAt) : null
			},
			checkout_token: session.checkout_token,
			order_id: session.order_id,
			amount: session.amount,
			payment_started_at: resolvedPaymentStartedAt,
			gateway_expires_at: resolvedGatewayExpiresAt,
			recovery_expires_at: session.expires_at,
			expires_at: session.expires_at
		}, normalizeContentfulStatusCode(response.status, response.ok ? 200 : 502));
	} catch (error: unknown) {
		if (getErrorMessage(error) === 'PAYMENT_CONFIG_MISSING') {
			return c.json({ success: false, message: 'Konfigurasi gateway pembayaran belum lengkap' }, 500);
		}

		const logger = getRequestLogger(c);
		logger.error('Pakasir Status proxy error', {
			error: getErrorMessage(error),
		});
		return c.json({ success: false, message: 'Gagal mengecek status pembayaran' }, 500);
	}
});

/**
 * Menerima event penting dari frontend untuk kebutuhan log operasional Telegram.
 */
paymentRoutes.post('/api/payment/event', paymentEventRateLimit, async (c) => {
	try {
		const logger = getRequestLogger(c);
		let body: Record<string, unknown>;
		try {
			const rawBody = await c.req.json();
			body = isRecord(rawBody) ? rawBody : {};
		} catch (parseError) {
			logger.warn('Payment event rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json({ success: false, message: 'Format JSON tidak valid' }, 400);
		}
		const checkoutToken = readStringProperty(body, 'checkout_token');
		const eventType = readStringProperty(body, 'event_type') as PaymentEventType;
		const note = sanitizeLogValue(body.note || '-', 240);
		const mode = sanitizeLogValue(body.mode || '-', 40);
		const retryCount = Number(body.retry_count);

		if (!CHECKOUT_TOKEN_REGEX.test(checkoutToken)) {
			return c.json({ success: false, message: 'Token checkout tidak valid' }, 400);
		}

		if (!(eventType in PAYMENT_EVENT_TYPES)) {
			return c.json({ success: false, message: 'Jenis event pembayaran tidak valid' }, 400);
		}

		const session = await c.env.DB.prepare(
			`SELECT checkout_token, order_id, amount, status, payment_started_at, gateway_expires_at, gateway_status, expires_at
			 FROM checkout_sessions
			 WHERE checkout_token = ?`
		).bind(checkoutToken).first() as PaymentEventSessionRow | null;

		if (!session) {
			return c.json({ success: false, message: 'Sesi checkout tidak ditemukan' }, 404);
		}

		// Route ini tidak mengubah state transaksi; fungsinya hanya menangkap momen frontend yang backend tidak bisa lihat sendiri.
		const lines = [
			`Order ID: ${session.order_id}`,
			`Checkout Token: ${maskToken(checkoutToken)}`,
			`Status Sesi: ${sanitizeLogValue(session.status || '-', 40)}`,
			`Gateway Status: ${sanitizeLogValue(session.gateway_status || '-', 40)}`,
			`Amount: ${Number(session.amount || 0)}`,
			`Payment Started At: ${sanitizeLogValue(toIsoUtcTimestamp(session.payment_started_at || '') || '-', 60)}`,
			`Gateway Expired At: ${sanitizeLogValue(toIsoUtcTimestamp(session.gateway_expires_at || '') || '-', 60)}`,
			`Recovery window sampai: ${sanitizeLogValue(toIsoUtcTimestamp(session.expires_at || '') || '-', 60)}`,
			`Mode Frontend: ${mode || '-'}`,
			`Retry Count: ${Number.isInteger(retryCount) && retryCount >= 0 ? retryCount : '-'}`,
			`Catatan: ${note || '-'}`
		];

		const eventConfig = PAYMENT_EVENT_TYPES[eventType];
		if (eventConfig.sendToTelegram) {
			queueOperationalLog(c, eventConfig.title, lines);
		} else {
			logger.info('Frontend payment event dicatat tanpa Telegram', {
				eventType,
				title: eventConfig.title,
				orderId: String(session.order_id || ''),
				checkoutToken: maskToken(checkoutToken),
				mode: mode || '-',
				retryCount: Number.isInteger(retryCount) && retryCount >= 0 ? retryCount : null,
				note: note || '-'
			});
		}

		return c.json({ success: true });
	} catch (error) {
		const logger = getRequestLogger(c);
		logger.error('Payment event log error', {
			error: getErrorMessage(error),
		});
		return c.json({ success: false, message: 'Gagal mencatat event pembayaran' }, 500);
	}
});

/**
 * Membatalkan transaksi aktif.
 */
paymentRoutes.post('/api/payment/cancel', paymentCancelRateLimit, async (c) => {
	try {
		const logger = getRequestLogger(c);
		let body: Record<string, unknown>;
		try {
			const rawBody = await c.req.json();
			body = isRecord(rawBody) ? rawBody : {};
		} catch (parseError) {
			logger.warn('Payment cancel rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json({ success: false, message: 'Format JSON tidak valid' }, 400);
		}
		const checkoutToken = readStringProperty(body, 'checkout_token');
		if (!CHECKOUT_TOKEN_REGEX.test(checkoutToken)) {
			return c.json({ success: false, message: 'Token checkout tidak valid' }, 400);
		}
		const cancelReason = sanitizeLogValue(body.cancel_reason || '-', 240);
		const cancelSource = sanitizeLogValue(body.cancel_source || 'frontend', 60);
		getPakasirCredentials(c.env);
		const session = await getCheckoutSession(c.env, checkoutToken);

		if (!session) {
			return c.json({ success: false, message: 'Sesi checkout tidak ditemukan atau sudah kedaluwarsa' }, 404);
		}

		if (session.status !== 'ACTIVE') {
			return c.json({ success: false, message: 'Sesi checkout sudah tidak aktif' }, 409);
		}

		const gatewayResponse = await cancelPakasirTransaction(c.env, session);
		const { response } = gatewayResponse;
		if (gatewayResponse.parseError) {
			queueOperationalLog(c, 'Log Payment: response cancel gateway tidak valid', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`HTTP Status Gateway: ${response.status}`,
				`Payload Gateway: ${sanitizeLogValue(gatewayResponse.rawText, 180)}`
			]);
			return c.json({ success: false, message: 'Gateway pembayaran mengembalikan format respons tidak valid' }, 502);
		}
		const data = isRecord(gatewayResponse.data) ? gatewayResponse.data : {};

		if (response.ok) {
			await withD1Retry(
				() => c.env.DB.prepare(
					'UPDATE checkout_sessions SET status = ?, gateway_status = ? WHERE checkout_token = ? AND status = ?'
				).bind('CANCELLED', 'canceled', checkoutToken, 'ACTIVE').run(),
				{ label: 'payment.cancel.persist-status', environment: resolveEnvironmentMode(c.env) }
			);
			await releaseReservationsByCheckoutToken(c.env, checkoutToken, 'CANCELLED');

			queueOperationalLog(c, 'Log Payment: transaksi dibatalkan dari aplikasi', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`Amount: ${session.amount}`,
				`Sumber Cancel: ${cancelSource}`,
				`Alasan Cancel: ${cancelReason || '-'}`,
				`Gateway Status Sebelumnya: ${sanitizeLogValue(session.gateway_status || '-', 40)}`,
				`Recovery window sampai: ${toIsoUtcTimestamp(session.expires_at)}`
			]);
		} else {
			queueOperationalLog(c, 'Log Payment: pembatalan ke gateway gagal', [
				`Order ID: ${session.order_id}`,
				`Checkout Token: ${maskToken(checkoutToken)}`,
				`Amount: ${session.amount}`,
				`Sumber Cancel: ${cancelSource}`,
				`Alasan Cancel: ${cancelReason || '-'}`,
				`HTTP Status Gateway: ${response.status}`,
				`Pesan Gateway: ${sanitizeLogValue(readStringProperty(data, 'message') || readStringProperty(data, 'error') || 'Tanpa pesan', 180)}`
			]);
		}

		// Kontrak API stabil — cancel hanya perlu melaporkan sukses/gagal.
		// Tidak ada field lain dari gateway yang digunakan oleh frontend cancel handler.
		return c.json({
			success: response.ok,
			message: response.ok
				? (sanitizeLogValue(readStringProperty(data, 'message') || 'Transaksi berhasil dibatalkan', 180))
				: (sanitizeLogValue(readStringProperty(data, 'message') || readStringProperty(data, 'error') || 'Gagal membatalkan transaksi pada gateway', 180))
		}, normalizeContentfulStatusCode(response.status, response.ok ? 200 : 502));
	} catch (error: unknown) {
		if (getErrorMessage(error) === 'PAYMENT_CONFIG_MISSING') {
			return c.json({ success: false, message: 'Konfigurasi gateway pembayaran belum lengkap' }, 500);
		}

		const logger = getRequestLogger(c);
		logger.error('Pakasir Cancel proxy error', {
			error: getErrorMessage(error),
		});
		return c.json({ success: false, message: 'Gagal membatalkan transaksi pada gateway' }, 500);
	}
});

export default paymentRoutes;
