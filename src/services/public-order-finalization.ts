import type { Context } from 'hono';
import type { Bindings, D1RunResult } from '../types/bindings.js';
import { ensureCheckoutSessionPaymentSchema } from '../utils/checkout-session-schema.js';
import { ensureOrderItemSchema } from '../utils/order-item-schema.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { formatSqlTimestamp } from '../utils/format.js';
import { maskToken, sanitizeLogValue, toIsoUtcTimestamp } from '../utils/log.js';
import { createLogger, resolveEnvironmentMode } from '../utils/logger.js';
import { createOperationalLogPromise } from '../utils/operational-log.js';
import { getRequestLogger } from '../utils/route-helpers.js';
import {
	getErrorMessage,
	getErrorStack,
	isRecord,
	normalizeContentfulStatusCode,
	readStringProperty
} from '../utils/type-safe.js';
import {
	consumeReservationsByCheckoutToken,
	ensureStockReservationSchema,
	fetchActiveReservationsByCheckoutToken,
	releaseExpiredReservations,
	releaseReservationsByCheckoutToken
} from '../utils/stock-reservations.js';
import { getTelegramTopicId, resolveTelegramConfig, sendOperationalLog, sendOrderNotification } from '../utils/telegram.js';
import { resolvePickupTime } from './public-pickup.js';
import { verifyPakasirPaymentCompleted } from './pakasir-gateway.js';
import {
	buildItemSummaryLines,
	buildServerOrderSummary,
	buildStoredOrderSummary,
	type SecureOrderItem,
	type StoredOrderRow
} from './public-order-summary.js';

export type { SecureOrderItem } from './public-order-summary.js';

export const CUSTOMER_NAME_MAX_LENGTH = 22;
const NAME_REGEX = /^[\p{L}\s.'\-()]+$/u;
const CLASS_REGEX = /^(X|XI|XII)\s+(TP|TKR|TKP|DPIB|TITL|TKJ)$/;
const WA_REGEX = /^62[0-9]{8,15}$/;
const CHECKOUT_TOKEN_REGEX = /^[a-f0-9]{48}$/i;
type OrderFinalizationContext = Context<{ Bindings: Bindings }>;

type SecureOrderBuildResult = {
	secureItems: SecureOrderItem[];
	calculatedTotal: number;
};
type ProductRow = Record<string, unknown> & {
	code?: string;
	name?: string;
	price?: number;
};

export type PaymentSnapshotResolution = {
	clientPaymentAmount: number;
	clientFee: number;
	fee: number;
	resolvedPaymentAmount: number;
	hasClientPaymentAmountMismatch: boolean;
};

export type ClientPayloadMismatchResult = {
	hasClientPayloadMismatch: boolean;
	quantityDiffLines: string[];
	priceDiffLines: string[];
};

export type PersistPaidOrderParams = {
	env: Bindings;
	checkoutToken: string;
	orderId: string;
	customerName: string;
	customerClass: string;
	waNumber: string;
	pickupTime: string;
	subtotal: number;
	fee: number;
	verificationToken: string;
	secureItems: SecureOrderItem[];
	logger?: ReturnType<typeof createLogger>;
};

// queueOperationalLog di file ini memakai createOperationalLogPromise (routing topic
// otomatis dari judul) — sama dengan public.ts. Tidak diekstrak ke shared utility
// karena service ini bukan route handler langsung; ia dipanggil dari public.ts dan
// perlu akses ke executionCtx milik context Hono yang diteruskan sebagai parameter.
function queueOperationalLog(c: OrderFinalizationContext, title: string, lines: string[]) {
	const logPromise = createOperationalLogPromise(c, title, lines);
	if (logPromise && c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
		c.executionCtx.waitUntil(logPromise);
	}
}

export function generateVerificationToken(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildQuantityByCode(items: unknown[]): {
	quantityByCode: Map<string, number>;
	clientPriceByCode: Map<string, number>;
} {
	const quantityByCode = new Map<string, number>();
	const clientPriceByCode = new Map<string, number>();

	for (const item of items) {
		if (!isRecord(item)) continue;
		const product: Record<string, unknown> = isRecord(item.product) ? item.product : {};
		const productCode = readStringProperty(product, 'code');
		const quantity = Number(item.quantity);
		const clientPrice = Number(product.price);

		if (!productCode || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
			continue;
		}

		quantityByCode.set(productCode, (quantityByCode.get(productCode) || 0) + quantity);
		if (Number.isFinite(clientPrice)) {
			clientPriceByCode.set(productCode, clientPrice);
		}
	}

	return { quantityByCode, clientPriceByCode };
}

function buildProductLabelMap(items: SecureOrderItem[]): Map<string, string> {
	return new Map(items.map((item) => [item.product.code, item.secure_name]));
}

function getTotalQuantity(quantityByCode: Map<string, number>): number {
	let total = 0;
	quantityByCode.forEach((quantity) => {
		total += quantity;
	});
	return total;
}

function buildQuantityDiffLines(
	clientQuantityByCode: Map<string, number>,
	serverQuantityByCode: Map<string, number>,
	productLabelMap: Map<string, string>
): string[] {
	const codes = new Set([
		...Array.from(clientQuantityByCode.keys()),
		...Array.from(serverQuantityByCode.keys())
	]);
	return Array.from(codes)
		.map((code) => {
			const clientQuantity = clientQuantityByCode.get(code) || 0;
			const serverQuantity = serverQuantityByCode.get(code) || 0;
			if (clientQuantity === serverQuantity) return '';
			const safeName = productLabelMap.get(code) || code;
			return `Selisih qty: ${code} / ${safeName} -> client ${clientQuantity}, server ${serverQuantity}`;
		})
		.filter(Boolean)
		.slice(0, 8);
}

function buildPriceDiffLines(
	clientPriceByCode: Map<string, number>,
	items: SecureOrderItem[],
	productLabelMap: Map<string, string>
): string[] {
	return items
		.map((item) => {
			const code = item.product.code;
			if (!clientPriceByCode.has(code)) return '';

			const clientPrice = Number(clientPriceByCode.get(code));
			const serverPrice = Number(item.secure_price);
			if (!Number.isFinite(clientPrice) || clientPrice === serverPrice) {
				return '';
			}

			const safeName = productLabelMap.get(code) || code;
			return `Selisih harga: ${code} / ${safeName} -> client ${clientPrice}, server ${serverPrice}`;
		})
		.filter(Boolean)
		.slice(0, 8);
}

export function buildReservedQuantityByCode(
	reservedItems: Array<{ product_code: string; quantity: number }>
): Map<string, number> {
	const reservedQuantityByCode = new Map<string, number>();
	reservedItems.forEach((row) => {
		reservedQuantityByCode.set(
			row.product_code,
			(reservedQuantityByCode.get(row.product_code) || 0) + row.quantity
		);
	});
	return reservedQuantityByCode;
}

export function buildSecureOrderItems(
	reservedQuantityByCode: Map<string, number>,
	dbProducts: ProductRow[],
	clientPriceByCode: Map<string, number>
): SecureOrderBuildResult {
	const dbProductMap = new Map<string, ProductRow>(dbProducts.map((product) => [String(product.code), product]));
	let calculatedTotal = 0;

	const secureItems: SecureOrderItem[] = Array.from(reservedQuantityByCode.entries()).map(([code, quantity]) => {
		const realProduct = dbProductMap.get(code);
		if (!realProduct) {
			throw new Error('PRODUCT_NOT_FOUND');
		}

		calculatedTotal += Number(realProduct.price) * quantity;

		return {
			product: {
				code,
				price: clientPriceByCode.get(code) || 0
			},
			quantity,
			secure_price: Number(realProduct.price),
			secure_name: String(realProduct.name)
		};
	});

	return { secureItems, calculatedTotal };
}

export function resolveServerPaymentSnapshot(params: {
	clientTotal: number;
	paymentAmount: unknown;
	hasGatewayPaymentSnapshot: boolean;
	sessionGatewayFee: number;
	sessionGatewayTotalPayment: number;
	sessionAmount: number;
}): PaymentSnapshotResolution {
	const clientPaymentAmount = Number(params.paymentAmount);
	const clientFee = Number.isFinite(clientPaymentAmount) && Number.isFinite(params.clientTotal)
		? Math.max(0, Math.trunc(clientPaymentAmount - params.clientTotal))
		: 0;
	const fee = params.hasGatewayPaymentSnapshot
		? (Number.isFinite(params.sessionGatewayFee)
			? Math.max(0, Math.trunc(params.sessionGatewayFee))
			: Math.max(0, Math.trunc(params.sessionGatewayTotalPayment - params.sessionAmount)))
		: 0;
	const resolvedPaymentAmount = params.hasGatewayPaymentSnapshot
		? Math.max(params.sessionAmount, Math.trunc(params.sessionGatewayTotalPayment))
		: params.sessionAmount + fee;
	const hasClientPaymentAmountMismatch = params.hasGatewayPaymentSnapshot
		? (!Number.isFinite(clientPaymentAmount) || Math.trunc(clientPaymentAmount) !== resolvedPaymentAmount)
		: false;

	return {
		clientPaymentAmount,
		clientFee,
		fee,
		resolvedPaymentAmount,
		hasClientPaymentAmountMismatch
	};
}

export function detectClientPayloadMismatch(params: {
	clientTotal: number;
	calculatedTotal: number;
	clientQuantityByCode: Map<string, number>;
	serverQuantityByCode: Map<string, number>;
	clientPriceByCode: Map<string, number>;
	secureItems: SecureOrderItem[];
	hasClientPaymentAmountMismatch: boolean;
	rawItems: unknown[];
}): ClientPayloadMismatchResult {
	let reservationMismatch = params.serverQuantityByCode.size !== params.clientQuantityByCode.size;
	if (!reservationMismatch && params.clientQuantityByCode.size > 0) {
		for (const [code, quantity] of params.clientQuantityByCode.entries()) {
			if ((params.serverQuantityByCode.get(code) || 0) !== quantity) {
				reservationMismatch = true;
				break;
			}
		}
	}

	const hasClientTotalMismatch = Number.isFinite(params.clientTotal) && Number.isInteger(params.clientTotal)
		? params.calculatedTotal !== params.clientTotal
		: true;
	const productLabelMap = buildProductLabelMap(params.secureItems);
	const quantityDiffLines = buildQuantityDiffLines(
		params.clientQuantityByCode,
		params.serverQuantityByCode,
		productLabelMap
	);
	const priceDiffLines = buildPriceDiffLines(
		params.clientPriceByCode,
		params.secureItems,
		productLabelMap
	);

	return {
		hasClientPayloadMismatch:
			reservationMismatch ||
			hasClientTotalMismatch ||
			params.hasClientPaymentAmountMismatch ||
			priceDiffLines.length > 0 ||
			params.rawItems.length === 0,
		quantityDiffLines,
		priceDiffLines
	};
}

function buildClientItemSummary(rawItems: unknown[]): string {
	if (rawItems.length === 0) return '-';
	return rawItems.map((item) => {
		const itemRecord: Record<string, unknown> = isRecord(item) ? item : {};
		const product: Record<string, unknown> = isRecord(itemRecord.product) ? itemRecord.product : {};
		const code = sanitizeLogValue(readStringProperty(product, 'code') || '-', 20);
		const quantity = sanitizeLogValue(itemRecord.quantity || '-', 20);
		return `${quantity}x ${code}`;
	}).join('; ');
}

export function buildSecurityAlertLines(params: {
	orderId: string;
	checkoutToken: string;
	customerName: string;
	sessionAmount: number;
	clientTotal: number;
	calculatedTotal: number;
	clientPaymentAmount: number;
	resolvedPaymentAmount: number;
	clientFee: number;
	fee: number;
	clientQuantityByCode: Map<string, number>;
	serverQuantityByCode: Map<string, number>;
	secureItems: SecureOrderItem[];
	rawItems: unknown[];
	quantityDiffLines: string[];
	priceDiffLines: string[];
}): string[] {
	const safeClientTotal = Number.isFinite(params.clientTotal) ? params.clientTotal : 0;
	const safeClientPaymentAmount = Number.isFinite(params.clientPaymentAmount)
		? Math.trunc(params.clientPaymentAmount)
		: 0;

	return [
		`Order ID: ${params.orderId}`,
		`Checkout Token: ${maskToken(params.checkoutToken)}`,
		`Nama: ${params.customerName}`,
		`Session Amount: ${params.sessionAmount}`,
		`Client Total: ${safeClientTotal}`,
		`Server Total: ${params.calculatedTotal}`,
		`Client Payment Amount: ${safeClientPaymentAmount}`,
		`Server Payment Amount: ${params.resolvedPaymentAmount}`,
		`Client Fee: ${params.clientFee}`,
		`Server Fee: ${params.fee}`,
		`Total Dibayar: ${params.resolvedPaymentAmount}`,
		`Fee Gateway: ${params.fee}`,
		`Selisih Total: ${safeClientTotal - params.calculatedTotal}`,
		`Selisih Payment Amount: ${safeClientPaymentAmount - params.resolvedPaymentAmount}`,
		`Jumlah unit client: ${getTotalQuantity(params.clientQuantityByCode)}`,
		`Jumlah unit server: ${getTotalQuantity(params.serverQuantityByCode)}`,
		`Ringkasan item server: ${buildItemSummaryLines(params.secureItems).join('; ') || '-'}`,
		`Ringkasan item client: ${buildClientItemSummary(params.rawItems)}`,
		...params.quantityDiffLines,
		...params.priceDiffLines,
		`Aksi sistem: payload client diabaikan, order diproses dari snapshot checkout server`
	];
}

export async function ensureExistingOrderVerificationToken(
	env: Bindings,
	orderId: string,
	existingToken: unknown
): Promise<string> {
	let verificationToken = String(existingToken || '').trim();
	if (!verificationToken) {
		verificationToken = generateVerificationToken();
		await withD1Retry(
			() => env.DB.prepare('UPDATE orders SET verification_token = ? WHERE id = ?')
				.bind(verificationToken, orderId)
				.run(),
			{ label: 'public.orders.ensure-verification-token', environment: resolveEnvironmentMode(env) }
		);
	}
	return verificationToken;
}

export function isUniqueConstraintError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase();
	return message.includes('unique constraint failed');
}

async function persistPaidOrderFallback(
	params: PersistPaidOrderParams,
	logger: ReturnType<typeof createLogger>
): Promise<void> {
	let orderInserted = false;
	let orderItemsInserted = false;
	let reservationsConsumed = false;
	let sessionCompleted = false;
	const stockUpdatedItems: SecureOrderItem[] = [];

	try {
		await ensureOrderItemSchema(params.env);
		await params.env.DB.prepare(
			`INSERT INTO orders (id, customer_name, customer_class, wa_number, pickup_time, total_amount, fee, payment_status, verification_token)
	       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).bind(
			params.orderId,
			params.customerName,
			params.customerClass,
			params.waNumber,
			params.pickupTime,
			params.subtotal,
			params.fee,
			'PAID',
			params.verificationToken
		).run();
		orderInserted = true;

		if (params.secureItems.length > 0) {
			const stmt = params.env.DB.prepare(
				`INSERT INTO order_items (order_id, product_name, product_code_snapshot, quantity, price_at_purchase)
	       VALUES (?, ?, ?, ?, ?)`
			);
			const batchData = params.secureItems.map((item: SecureOrderItem) =>
				stmt.bind(params.orderId, item.secure_name, item.product.code, item.quantity, item.secure_price)
			);
			await params.env.DB.batch(batchData);
			orderItemsInserted = true;
		}

		if (params.secureItems.length > 0) {
			const stockStmt = params.env.DB.prepare(
				`UPDATE products SET stock = stock - ? WHERE code = ? AND stock >= ?`
			);
			const stockBatchData = params.secureItems.map((item: SecureOrderItem) =>
				stockStmt.bind(item.quantity, item.product.code, item.quantity)
			);
			const stockResults = await params.env.DB.batch(stockBatchData);

			const hasStockConflict = stockResults.some((result: D1RunResult, index) => {
				if (!result?.success) return true;
				if (typeof result?.meta?.changes === 'number' && result.meta.changes !== 1) return true;
				stockUpdatedItems.push(params.secureItems[index] as SecureOrderItem);
				return false;
			});

			if (hasStockConflict) {
				throw new Error('STOCK_CONFLICT');
			}
		}

		const consumeResult = await params.env.DB.prepare(
			`UPDATE stock_reservations
			 SET status = ?, consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
			 WHERE checkout_token = ? AND order_id = ? AND status = ? AND expires_at > CURRENT_TIMESTAMP`
		).bind('CONSUMED', params.checkoutToken, params.orderId, 'RESERVED').run();
		const consumedReservationChanges = Number(consumeResult?.meta?.changes || 0);
		if (!Number.isFinite(consumedReservationChanges) || consumedReservationChanges !== params.secureItems.length) {
			throw new Error('RESERVATION_CONFLICT');
		}
		reservationsConsumed = true;

		const sessionUpdateResult = await params.env.DB.prepare(
			'UPDATE checkout_sessions SET status = ? WHERE checkout_token = ? AND status = ?'
		).bind('COMPLETED', params.checkoutToken, 'ACTIVE').run();
		const sessionChanges = Number(sessionUpdateResult?.meta?.changes || 0);
		if (sessionChanges !== 1) {
			throw new Error('SESSION_CONFLICT');
		}
		sessionCompleted = true;
	} catch (error) {
		if (sessionCompleted) {
			try {
				await params.env.DB.prepare(
					'UPDATE checkout_sessions SET status = ? WHERE checkout_token = ? AND status = ?'
				).bind('ACTIVE', params.checkoutToken, 'COMPLETED').run();
			} catch (rollbackSessionError) {
				logger.error('Rollback fallback session checkout gagal', {
					orderId: params.orderId,
					checkoutToken: maskToken(params.checkoutToken),
					error: rollbackSessionError instanceof Error ? rollbackSessionError.message : String(rollbackSessionError),
				});
			}
		}

		if (reservationsConsumed) {
			try {
				await params.env.DB.prepare(
					`UPDATE stock_reservations
					 SET status = ?, consumed_at = NULL
					 WHERE checkout_token = ? AND order_id = ? AND status = ?`
				).bind('RESERVED', params.checkoutToken, params.orderId, 'CONSUMED').run();
			} catch (rollbackReservationError) {
				logger.error('Rollback fallback reservasi gagal', {
					orderId: params.orderId,
					checkoutToken: maskToken(params.checkoutToken),
					error: rollbackReservationError instanceof Error ? rollbackReservationError.message : String(rollbackReservationError),
				});
			}
		}

		if (orderItemsInserted) {
			try {
				await params.env.DB.prepare('DELETE FROM order_items WHERE order_id = ?')
					.bind(params.orderId)
					.run();
			} catch (rollbackItemsError) {
				logger.error('Rollback fallback order items gagal', {
					orderId: params.orderId,
					checkoutToken: maskToken(params.checkoutToken),
					error: rollbackItemsError instanceof Error ? rollbackItemsError.message : String(rollbackItemsError),
				});
			}
		}

		if (orderInserted) {
			try {
				await params.env.DB.prepare('DELETE FROM orders WHERE id = ?')
					.bind(params.orderId)
					.run();
			} catch (rollbackOrderError) {
				logger.error('Rollback fallback order utama gagal', {
					orderId: params.orderId,
					checkoutToken: maskToken(params.checkoutToken),
					error: rollbackOrderError instanceof Error ? rollbackOrderError.message : String(rollbackOrderError),
				});
			}
		}

		if (stockUpdatedItems.length > 0) {
			try {
				const restoreStmt = params.env.DB.prepare('UPDATE products SET stock = stock + ? WHERE code = ?');
				const restoreBatch = stockUpdatedItems.map((item) =>
					restoreStmt.bind(item.quantity, item.product.code)
				);
				await params.env.DB.batch(restoreBatch);
			} catch (rollbackStockError) {
				logger.error('Rollback fallback stok gagal', {
					orderId: params.orderId,
					checkoutToken: maskToken(params.checkoutToken),
					error: rollbackStockError instanceof Error ? rollbackStockError.message : String(rollbackStockError),
				});
			}
		}

		throw error;
	}
}

export async function persistPaidOrder(params: PersistPaidOrderParams): Promise<void> {
	const logger = params.logger || createLogger({
		service: 'koperasi-backend',
		environment: resolveEnvironmentMode(params.env),
	});
	await persistPaidOrderFallback(params, logger);
}

export async function finalizePaidOrderRequest(c: OrderFinalizationContext) {
	try {
		const routeLogger = getRequestLogger(c);
		const telegramConfig = resolveTelegramConfig(c.env);
		await ensureStockReservationSchema(c.env);
		await ensureCheckoutSessionPaymentSchema(c.env);
		await ensureOrderItemSchema(c.env);
		await releaseExpiredReservations(c.env);

		let orderData: Record<string, unknown>;
		try {
			const rawOrderData = await c.req.json();
			orderData = isRecord(rawOrderData) ? rawOrderData : {};
		} catch (parseError) {
			routeLogger.warn('Order creation rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json({ success: false, message: 'Format JSON tidak valid' }, 400);
		}
		const {
			checkout_token,
			id_transaksi,
			nama,
			kelas,
			wa,
			pickup_date,
			pickup_slot,
			total,
			payment_amount,
			items
		} = orderData;

		if (
			typeof checkout_token !== 'string' ||
			typeof nama !== 'string' ||
			typeof kelas !== 'string' ||
			typeof wa !== 'string' ||
			typeof pickup_date !== 'string' ||
			typeof pickup_slot !== 'string'
		) {
			return c.json({ success: false, message: 'Data pesanan tidak lengkap' }, 400);
		}

		const normalizedCheckoutToken = checkout_token.trim();
		const clientOrderId = typeof id_transaksi === 'string' ? id_transaksi.trim() : '';
		const normalizedName = nama.trim();
		const normalizedClass = kelas.trim().toUpperCase();
		const normalizedWa = wa.trim();

		if (!CHECKOUT_TOKEN_REGEX.test(normalizedCheckoutToken)) {
			return c.json({ success: false, message: 'Token checkout tidak valid' }, 400);
		}

		if (!normalizedName || normalizedName.length > CUSTOMER_NAME_MAX_LENGTH || !NAME_REGEX.test(normalizedName)) {
			return c.json({ success: false, message: 'Nama pemesan tidak valid' }, 400);
		}

		if (!CLASS_REGEX.test(normalizedClass)) {
			return c.json({ success: false, message: 'Format kelas tidak valid' }, 400);
		}

		if (!WA_REGEX.test(normalizedWa)) {
			return c.json({ success: false, message: 'Nomor WhatsApp tidak valid' }, 400);
		}

		const clientTotal = Number(total);
		const rawItems = Array.isArray(items) ? items : [];
		const {
			quantityByCode: quantityByCode,
			clientPriceByCode
		} = buildQuantityByCode(rawItems);

		const pickupResolution = resolvePickupTime(pickup_date.trim(), pickup_slot.trim());
		if (!pickupResolution.ok || !pickupResolution.pickupTime) {
			return c.json({ success: false, message: pickupResolution.message || 'Jadwal pengambilan tidak valid' }, 400);
		}
		const resolvedPickupTime = pickupResolution.pickupTime;

		const checkoutSession = await withD1Retry(
			() => c.env.DB.prepare(
				`SELECT checkout_token, order_id, amount, status, payment_started_at, gateway_status, gateway_total_payment, gateway_fee, expires_at
				 FROM checkout_sessions
				 WHERE checkout_token = ?`
			).bind(normalizedCheckoutToken).first(),
			{ label: 'public.orders.load-checkout-session', environment: resolveEnvironmentMode(c.env) }
		) as Record<string, unknown> | null;

		if (!checkoutSession) {
			return c.json({ success: false, message: 'Sesi checkout tidak ditemukan atau sudah kedaluwarsa' }, 404);
		}

		const sessionExpiresAt = String(checkoutSession.expires_at || '');
		const nowSql = formatSqlTimestamp(new Date());
		if (sessionExpiresAt && sessionExpiresAt <= nowSql) {
			await c.env.DB.prepare(
				'UPDATE checkout_sessions SET status = ? WHERE checkout_token = ? AND status = ?'
			).bind('CANCELLED', normalizedCheckoutToken, 'ACTIVE').run();
			await releaseReservationsByCheckoutToken(c.env, normalizedCheckoutToken, 'EXPIRED');
			queueOperationalLog(c, 'Log Order: sesi checkout kedaluwarsa saat simpan order', [
				`Order ID: ${sanitizeLogValue(checkoutSession.order_id || '-', 80)}`,
				`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
				`Nama: ${normalizedName}`,
				`Gateway Status Terakhir: ${sanitizeLogValue(checkoutSession.gateway_status || '-', 40)}`,
				`Expired At: ${toIsoUtcTimestamp(sessionExpiresAt) || sessionExpiresAt}`
			]);
			return c.json({ success: false, message: 'Sesi checkout tidak ditemukan atau sudah kedaluwarsa' }, 404);
		}

		const sessionStatus = String(checkoutSession.status || '');
		const sessionGatewayStatus = String(checkoutSession.gateway_status || '').trim().toLowerCase();
		const sessionGatewayTotalPayment = Number(checkoutSession.gateway_total_payment);
		const hasGatewayPaymentSnapshot = Number.isFinite(sessionGatewayTotalPayment) && sessionGatewayTotalPayment > 0;
		const sessionGatewayFee = Number(checkoutSession.gateway_fee);
		if (!['ACTIVE', 'COMPLETED'].includes(sessionStatus)) {
			await releaseReservationsByCheckoutToken(c.env, normalizedCheckoutToken, 'SESSION_NOT_ACTIVE');
			queueOperationalLog(c, 'Log Order: sesi checkout tidak aktif saat simpan order', [
				`Order ID: ${sanitizeLogValue(checkoutSession.order_id || '-', 80)}`,
				`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
				`Nama: ${normalizedName}`,
				`Status Sesi: ${sessionStatus}`,
				`Gateway Status Terakhir: ${sessionGatewayStatus || '-'}`
			]);
			return c.json({ success: false, message: 'Sesi checkout sudah tidak aktif' }, 409);
		}

		const paymentStartedAtRaw = String(checkoutSession.payment_started_at || '').trim();
		const paymentStartedAtMs = paymentStartedAtRaw ? Date.parse(paymentStartedAtRaw.replace(' ', 'T') + 'Z') : NaN;
		// Order yang dicatat lebih dari 2 menit setelah QRIS dibuat diperlakukan sebagai hasil flow recovery.
		const wasRecoveredFlow = Number.isFinite(paymentStartedAtMs)
			? (Date.now() - paymentStartedAtMs) > (2 * 60 * 1000)
			: false;

		const normalizedOrderId = String(checkoutSession.order_id || '').trim();
		if (!normalizedOrderId || normalizedOrderId.length > 64) {
			return c.json({ success: false, message: 'ID transaksi checkout tidak valid' }, 400);
		}

		if (clientOrderId && clientOrderId !== normalizedOrderId) {
			return c.json({ success: false, message: 'ID transaksi tidak cocok dengan sesi checkout' }, 400);
		}

		const respondWithExistingOrder = async (
			existingOrderRow: StoredOrderRow,
			options?: {
				responseMessage?: string;
				pickupTime?: string;
				orderSummary?: unknown;
				sanitizedFromCheckoutSession?: boolean;
			}
		) => {
			const verificationToken = await ensureExistingOrderVerificationToken(
				c.env,
				normalizedOrderId,
				existingOrderRow.verification_token
			);
			const pickupTimeForResponse = options?.pickupTime || readStringProperty(existingOrderRow, 'pickup_time') || resolvedPickupTime;

			if (sessionStatus === 'ACTIVE') {
				try {
					await c.env.DB.prepare(
						'UPDATE checkout_sessions SET status = ? WHERE checkout_token = ? AND status = ?'
					).bind('COMPLETED', normalizedCheckoutToken, 'ACTIVE').run();
				} catch (sessionSyncError) {
					routeLogger.warn('Sinkronisasi status checkout session gagal saat replay idempotent', {
						orderId: normalizedOrderId,
						checkoutToken: maskToken(normalizedCheckoutToken),
						error: sessionSyncError instanceof Error ? sessionSyncError.message : String(sessionSyncError),
					});
				}
			}
			try {
				await consumeReservationsByCheckoutToken(c.env, normalizedCheckoutToken, normalizedOrderId);
			} catch (reservationSyncError) {
				routeLogger.warn('Sinkronisasi reservasi gagal saat replay idempotent', {
					orderId: normalizedOrderId,
					checkoutToken: maskToken(normalizedCheckoutToken),
					error: reservationSyncError instanceof Error ? reservationSyncError.message : String(reservationSyncError),
				});
			}

			if (wasRecoveredFlow) {
				const recoveryExistingPromise = sendOperationalLog(
					telegramConfig.token,
					telegramConfig.chatId,
					getTelegramTopicId(telegramConfig, 'order'),
					{
						title: 'Log Recovery: order sudah tercatat saat retry pemulihan',
						lines: [
							`Order ID: ${normalizedOrderId}`,
							`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
							`Gateway Status: ${sessionGatewayStatus || 'unknown'}`,
							`Pickup Time: ${pickupTimeForResponse}`
						]
					},
					resolveEnvironmentMode(c.env)
				);
				if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
					c.executionCtx.waitUntil(recoveryExistingPromise);
				} else {
					void recoveryExistingPromise;
				}
			}

			return c.json({
				success: true,
				message: options?.responseMessage || 'Order already recorded',
				verification_token: verificationToken,
				pickup_time: pickupTimeForResponse,
				order_summary: options?.orderSummary || null,
				sanitized_from_checkout_session: Boolean(options?.sanitizedFromCheckoutSession)
			});
		};

		const existingOrderBeforeVerify = await withD1Retry(
			() => c.env.DB.prepare(
				`SELECT id, verification_token, customer_name, customer_class, pickup_time, total_amount, fee, created_at
				 FROM orders
				 WHERE id = ?`
			).bind(normalizedOrderId).first(),
			{ label: 'public.orders.load-existing-before-verify', environment: resolveEnvironmentMode(c.env) }
		) as StoredOrderRow | null;
		if (existingOrderBeforeVerify) {
			const storedOrderSummary = await buildStoredOrderSummary(c.env, existingOrderBeforeVerify);
			return respondWithExistingOrder(existingOrderBeforeVerify, {
				responseMessage: 'Order already recorded',
				pickupTime: readStringProperty(existingOrderBeforeVerify, 'pickup_time') || resolvedPickupTime,
				orderSummary: storedOrderSummary,
				sanitizedFromCheckoutSession: false
			});
		}

		const reservedItems = await fetchActiveReservationsByCheckoutToken(
			c.env,
			normalizedCheckoutToken,
			normalizedOrderId
		);
		if (reservedItems.length === 0) {
			return c.json(
				{ success: false, message: 'Sesi checkout sudah kedaluwarsa atau reservasi stok tidak ditemukan.' },
				409
			);
		}

		const reservedQuantityByCode = buildReservedQuantityByCode(reservedItems);

		if (reservedQuantityByCode.size > 5) {
			return c.json({ success: false, message: 'Maksimal 5 jenis barang berbeda per pesanan' }, 400);
		}

		const itemCodes = Array.from(reservedQuantityByCode.keys());
		const placeholders = itemCodes.map(() => '?').join(',');
		const query = `SELECT code, price, name, stock FROM products WHERE code IN (${placeholders})`;
		const productsResult = await withD1Retry(
			() => c.env.DB.prepare(query).bind(...itemCodes).all(),
			{ label: 'public.orders.load-products', environment: resolveEnvironmentMode(c.env) }
		);
		const dbProducts = Array.isArray(productsResult?.results) ? productsResult.results as ProductRow[] : [];

		if (dbProducts.length !== itemCodes.length) {
			return c.json({ success: false, message: 'Ada produk yang tidak ditemukan di server' }, 400);
		}

		const { secureItems, calculatedTotal } = buildSecureOrderItems(
			reservedQuantityByCode,
			dbProducts,
			clientPriceByCode
		);

		if (calculatedTotal < 1000) {
			return c.json({ success: false, message: 'Minimal total pesanan adalah Rp1.000' }, 400);
		}

		const sessionAmount = Number(checkoutSession.amount);
		if (!Number.isFinite(sessionAmount) || sessionAmount <= 0 || sessionAmount !== calculatedTotal) {
			return c.json({ success: false, message: 'Data checkout berubah. Silakan ulangi checkout dari awal.' }, 409);
		}

		// Pastikan transaksi benar-benar sudah dibayar langsung ke gateway lewat verifikasi di sisi server.
		const expectedGatewayTotalPayment = hasGatewayPaymentSnapshot
			? Math.trunc(sessionGatewayTotalPayment)
			: null;
		const paymentVerification = await verifyPakasirPaymentCompleted(
			c.env,
			normalizedOrderId,
			sessionAmount,
			expectedGatewayTotalPayment
		);
		if (!paymentVerification.ok) {
			queueOperationalLog(c, 'Log Order: verifikasi pembayaran gagal sebelum simpan order', [
				`Order ID: ${normalizedOrderId}`,
				`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
				`Nama: ${normalizedName}`,
				`Gateway Status Session: ${sessionGatewayStatus || '-'}`,
				`HTTP Status Internal: ${paymentVerification.status}`,
				`Pesan: ${sanitizeLogValue(paymentVerification.message, 180)}`
			]);
			return c.json(
				{ success: false, message: paymentVerification.message },
				normalizeContentfulStatusCode(paymentVerification.status, 502)
			);
		}
		const verifiedPaymentCompletedAt = paymentVerification.completedAt || '';

		if (!hasGatewayPaymentSnapshot) {
			queueOperationalLog(c, 'Incident: pembayaran valid tetapi order gagal dicatat', [
				`Order ID: ${normalizedOrderId}`,
				`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
				`Nama: ${normalizedName}`,
				`Session Amount: ${sessionAmount}`,
				`Server Total: ${calculatedTotal}`,
				`Gateway Status: ${sessionGatewayStatus || 'completed'}`,
				`Penyebab: GATEWAY_PAYMENT_SNAPSHOT_MISSING`,
				`Langkah admin: cek metadata pembayaran gateway pada checkout session sebelum proses manual`
			]);
			return c.json(
				{
					success: false,
					message: 'Pembayaran berhasil terdeteksi, tetapi data biaya gateway belum lengkap. Simpan bukti bayar dan hubungi admin.'
				},
				409
			);
		}

		const {
			clientPaymentAmount,
			clientFee,
			fee,
			resolvedPaymentAmount,
			hasClientPaymentAmountMismatch
		} = resolveServerPaymentSnapshot({
			clientTotal,
			paymentAmount: payment_amount,
			hasGatewayPaymentSnapshot,
			sessionGatewayFee,
			sessionGatewayTotalPayment,
			sessionAmount
		});
		const {
			hasClientPayloadMismatch,
			quantityDiffLines,
			priceDiffLines
		} = detectClientPayloadMismatch({
			clientTotal,
			calculatedTotal,
			clientQuantityByCode: quantityByCode,
			serverQuantityByCode: reservedQuantityByCode,
			clientPriceByCode,
			secureItems,
			hasClientPaymentAmountMismatch,
			rawItems
		});
		let securityAlertPromise: Promise<void> | null = null;
		const serverOrderSummary = buildServerOrderSummary(
			normalizedOrderId,
			normalizedName,
			normalizedClass,
			resolvedPickupTime,
			verifiedPaymentCompletedAt,
			secureItems,
			calculatedTotal,
			fee
		);
		if (hasClientPayloadMismatch) {
			routeLogger.warn('Security alert: payload order berubah setelah checkout', {
				orderId: normalizedOrderId,
				checkoutToken: maskToken(normalizedCheckoutToken),
				customerName: normalizedName,
				sessionAmount,
				clientTotal,
				calculatedTotal,
			});
			securityAlertPromise = createOperationalLogPromise(
				c,
				'Security Alert: payload order berubah setelah checkout',
				buildSecurityAlertLines({
					orderId: normalizedOrderId,
					checkoutToken: normalizedCheckoutToken,
					customerName: normalizedName,
					sessionAmount,
					clientTotal,
					calculatedTotal,
					clientPaymentAmount,
					resolvedPaymentAmount,
					clientFee,
					fee,
					clientQuantityByCode: quantityByCode,
					serverQuantityByCode: reservedQuantityByCode,
					secureItems,
					rawItems,
					quantityDiffLines,
					priceDiffLines
				})
			);
			if (securityAlertPromise) {
				if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
					c.executionCtx.waitUntil(securityAlertPromise);
				} else {
					void securityAlertPromise;
				}
			}
		}

		const existingOrder = await withD1Retry(
			() => c.env.DB.prepare('SELECT id, verification_token FROM orders WHERE id = ?')
				.bind(normalizedOrderId)
				.first(),
			{ label: 'public.orders.load-existing-order', environment: resolveEnvironmentMode(c.env) }
		) as StoredOrderRow | null;

		if (existingOrder) {
			return respondWithExistingOrder(existingOrder, {
				responseMessage: 'Order already recorded',
				pickupTime: resolvedPickupTime,
				orderSummary: serverOrderSummary,
				sanitizedFromCheckoutSession: hasClientPayloadMismatch
			});
		}

		const verificationToken = generateVerificationToken();
		try {
			await persistPaidOrder({
				env: c.env,
				checkoutToken: normalizedCheckoutToken,
				orderId: normalizedOrderId,
				customerName: normalizedName,
				customerClass: normalizedClass,
				waNumber: normalizedWa,
				pickupTime: resolvedPickupTime,
				subtotal: calculatedTotal,
				fee,
				verificationToken,
				secureItems,
				logger: routeLogger
			});
		} catch (error: unknown) {
			const errorMessage = getErrorMessage(error);
			if (errorMessage === 'STOCK_CONFLICT') {
				queueOperationalLog(c, 'Incident: pembayaran valid tetapi order gagal dicatat', [
					`Order ID: ${normalizedOrderId}`,
					`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
					`Nama: ${normalizedName}`,
					`Session Amount: ${sessionAmount}`,
					`Server Total: ${calculatedTotal}`,
					`Total Dibayar: ${resolvedPaymentAmount}`,
					`Fee Gateway: ${fee}`,
					`Gateway Status: ${sessionGatewayStatus || 'unknown'}`,
					`Penyebab: STOCK_CONFLICT`,
					`Langkah admin: cek stok, pembayaran, lalu verifikasi order manual bila perlu`
				]);
				return c.json(
					{ success: false, message: 'Stok berubah saat checkout. Hubungi admin untuk pengecekan transaksi.' },
					409
				);
			}

			if (errorMessage === 'RESERVATION_CONFLICT') {
				queueOperationalLog(c, 'Incident: pembayaran valid tetapi order gagal dicatat', [
					`Order ID: ${normalizedOrderId}`,
					`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
					`Nama: ${normalizedName}`,
					`Session Amount: ${sessionAmount}`,
					`Server Total: ${calculatedTotal}`,
					`Total Dibayar: ${resolvedPaymentAmount}`,
					`Fee Gateway: ${fee}`,
					`Gateway Status: ${sessionGatewayStatus || 'unknown'}`,
					`Penyebab: RESERVATION_CONFLICT`,
					`Langkah admin: cek status reservasi checkout dan pembayaran sebelum proses manual`
				]);
				return c.json(
					{ success: false, message: 'Reservasi stok checkout sudah tidak valid. Silakan mulai checkout ulang.' },
					409
				);
			}

			if (errorMessage === 'SESSION_CONFLICT') {
				queueOperationalLog(c, 'Incident: pembayaran valid tetapi order gagal dicatat', [
					`Order ID: ${normalizedOrderId}`,
					`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
					`Nama: ${normalizedName}`,
					`Session Amount: ${sessionAmount}`,
					`Server Total: ${calculatedTotal}`,
					`Total Dibayar: ${resolvedPaymentAmount}`,
					`Fee Gateway: ${fee}`,
					`Gateway Status: ${sessionGatewayStatus || 'unknown'}`,
					`Penyebab: SESSION_CONFLICT`,
					`Langkah admin: cek status checkout session sebelum tindak lanjut manual`
				]);
				return c.json(
					{ success: false, message: 'Sesi checkout sudah tidak aktif. Silakan mulai checkout ulang.' },
					409
				);
			}

			if (isUniqueConstraintError(error)) {
				const existingOrderAfterConflict = await withD1Retry(
					() => c.env.DB.prepare(
						'SELECT id, verification_token FROM orders WHERE id = ?'
					).bind(normalizedOrderId).first(),
					{ label: 'public.orders.load-existing-order-after-unique', environment: resolveEnvironmentMode(c.env) }
				) as StoredOrderRow | null;

				if (existingOrderAfterConflict) {
					routeLogger.warn('Order idempotent recovery setelah unique constraint', {
						orderId: normalizedOrderId,
						checkoutToken: maskToken(normalizedCheckoutToken),
						error: errorMessage,
					});
					return respondWithExistingOrder(existingOrderAfterConflict, {
						responseMessage: 'Order already recorded',
						pickupTime: resolvedPickupTime,
						orderSummary: serverOrderSummary,
						sanitizedFromCheckoutSession: hasClientPayloadMismatch
					});
				}
			}

			queueOperationalLog(c, 'Incident: pembayaran valid tetapi order gagal dicatat', [
				`Order ID: ${normalizedOrderId}`,
				`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
				`Nama: ${normalizedName}`,
				`Session Amount: ${sessionAmount}`,
				`Server Total: ${calculatedTotal}`,
				`Total Dibayar: ${resolvedPaymentAmount}`,
				`Fee Gateway: ${fee}`,
				`Gateway Status: ${sessionGatewayStatus || 'unknown'}`,
				`Penyebab: ${sanitizeLogValue(errorMessage || 'UNKNOWN_ERROR', 120)}`,
				`Langkah admin: cek log server dan verifikasi pembayaran sebelum tindak lanjut manual`
			]);

			throw error;
		}

		// Notifikasi Telegram dibuat non-blocking agar order sukses tetap bisa dibalas cepat ke frontend.
		const sendOrderNotificationTask = () => sendOrderNotification(
			telegramConfig.token,
			telegramConfig.chatId,
			getTelegramTopicId(telegramConfig, 'order'),
			{
				nama: normalizedName,
				kelas: normalizedClass,
				wa: normalizedWa,
				id_transaksi: normalizedOrderId,
				waktu: resolvedPickupTime,
				waktu_pembayaran: verifiedPaymentCompletedAt,
				items: secureItems,
				calculatedTotal,
				payment_amount: resolvedPaymentAmount
			},
			resolveEnvironmentMode(c.env)
		);
		// Alert keamanan diprioritaskan lebih dulu agar urutan Telegram menunjukkan bahwa order ini sempat terdeteksi mismatch.
		const orderNotificationPromise = securityAlertPromise
			? securityAlertPromise.catch(() => undefined).then(() => sendOrderNotificationTask())
			: sendOrderNotificationTask();
		if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
			c.executionCtx.waitUntil(orderNotificationPromise);
		} else {
			void orderNotificationPromise;
		}

		if (wasRecoveredFlow) {
			const recoveryLoggedPromise = sendOperationalLog(
				telegramConfig.token,
				telegramConfig.chatId,
				getTelegramTopicId(telegramConfig, 'order'),
				{
					title: 'Log Recovery: order berhasil dicatat setelah pemulihan',
					lines: [
						`Order ID: ${normalizedOrderId}`,
						`Checkout Token: ${maskToken(normalizedCheckoutToken)}`,
						`Nama: ${normalizedName}`,
						`Gateway Status: ${sessionGatewayStatus || 'completed'}`
					]
				},
				resolveEnvironmentMode(c.env)
			);
			if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
				c.executionCtx.waitUntil(recoveryLoggedPromise);
			} else {
				void recoveryLoggedPromise;
			}
		}

		return c.json({
			success: true,
			message: 'Order created successfully',
			verification_token: verificationToken,
			pickup_time: resolvedPickupTime,
			order_summary: serverOrderSummary,
			sanitized_from_checkout_session: hasClientPayloadMismatch
		});
	} catch (error: unknown) {
		const logger = getRequestLogger(c);
		logger.error('Order creation failed', {
			error: getErrorMessage(error),
			stack: getErrorStack(error),
		});

		const errorMessage = getErrorMessage(error);
		if (errorMessage === 'PRODUCT_NOT_FOUND') {
			return c.json({ success: false, message: 'Produk tidak ditemukan di server' }, 400);
		}

		if (errorMessage === 'STOCK_NOT_ENOUGH') {
			return c.json({ success: false, message: 'Stok produk tidak mencukupi' }, 409);
		}

		if (errorMessage === 'TELEGRAM_CONFIG_MISSING') {
			return c.json({ success: false, message: 'Konfigurasi Telegram wajib diisi lengkap, termasuk chat ID dan topic order/security/admin' }, 500);
		}

		return c.json({ success: false, message: 'Terjadi kesalahan sistem internal' }, 500);
	}
}

