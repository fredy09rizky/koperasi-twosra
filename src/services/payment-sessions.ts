import type { Bindings } from '../types/bindings.js';
import { ensureCheckoutSessionPaymentSchema } from '../utils/checkout-session-schema.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { formatSqlTimestamp } from '../utils/format.js';
import { maskToken, sanitizeLogValue } from '../utils/log.js';
import { createLogger, resolveEnvironmentMode } from '../utils/logger.js';
import {
	cleanupOldReservationRows,
	ensureStockReservationSchema,
	getActiveReservedByCodes,
	releaseExpiredReservations,
	releaseReservationsByCheckoutToken
} from '../utils/stock-reservations.js';

export const CHECKOUT_TOKEN_REGEX = /^[a-f0-9]{48}$/i;
export const CHECKOUT_SESSION_TTL_MS = 10 * 60 * 1000;

const SESSION_CLEANUP_LIGHT_INTERVAL_MS = 60_000;

export type CheckoutSessionRow = {
	checkout_token: string;
	order_id: string;
	amount: number;
	status: string;
	gateway_total_payment?: number | null;
	gateway_fee?: number | null;
	payment_started_at?: string | null;
	gateway_expires_at?: string | null;
	gateway_status?: string | null;
	gateway_payment_number?: string | null;
	expires_at: string;
};

export type CheckoutItemValidationResult = {
	quantityByCode: Map<string, number>;
	itemCodes: string[];
	placeholders: string;
};

export type CheckoutPricingResult = {
	calculatedTotal: number;
	txProductMap: Map<string, any>;
};

export type IdempotentQrisResponse = {
	payment: {
		project: string;
		order_id: string;
		amount: number;
		total_payment: number;
		fee: number;
		received: number;
		payment_method: 'qris';
		payment_number: string;
		expired_at: string | null;
		is_replayed: true;
	};
	checkout_token: string;
	order_id: string;
	amount: number;
	payment_started_at: string | null;
	gateway_expires_at: string | null;
	recovery_expires_at: string;
	expires_at: string;
};

let lastLightCleanupAt = Date.now();
let cleanupInFlight: Promise<void> | null = null;

function generateRandomHex(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateCheckoutToken(): string {
	return generateRandomHex(24);
}

export function generateOrderId(): string {
	const timestamp = Date.now().toString().slice(-6);
	const randomSuffix = generateRandomHex(2).toUpperCase();
	return `INV${timestamp}${randomSuffix}`;
}

export async function cleanupCheckoutSessions(
	env: Bindings,
	options?: { force?: boolean; includeHeavy?: boolean }
) {
	return maybeCleanupCheckoutSessions(env, options);
}

async function maybeCleanupCheckoutSessions(env: Bindings, options?: { force?: boolean; includeHeavy?: boolean }) {
	const now = Date.now();
	const force = Boolean(options?.force);
	const includeHeavy = Boolean(options?.includeHeavy);
	const shouldRunLight = force || (now - lastLightCleanupAt) >= SESSION_CLEANUP_LIGHT_INTERVAL_MS;
	const shouldRunHeavy = force || includeHeavy;

	if (!shouldRunLight && !shouldRunHeavy) return;

	if (!cleanupInFlight) {
		cleanupInFlight = (async () => {
			await ensureStockReservationSchema(env);
			await releaseExpiredReservations(env);
			await withD1Retry(
				() => env.DB.prepare(
					'DELETE FROM checkout_sessions WHERE expires_at < CURRENT_TIMESTAMP'
				).run(),
				{ label: 'payment.cleanup.expired-sessions', environment: resolveEnvironmentMode(env) }
			);

			if (shouldRunHeavy) {
				await cleanupOldReservationRows(env);
				await withD1Retry(
					() => env.DB.prepare(
						`DELETE FROM checkout_sessions
						 WHERE status != 'ACTIVE' AND created_at < datetime('now', '-1 day')`
					).run(),
					{ label: 'payment.cleanup.stale-non-active-sessions', environment: resolveEnvironmentMode(env) }
				);
			}
			lastLightCleanupAt = now;
		})().finally(() => {
			cleanupInFlight = null;
		});
	}

	await cleanupInFlight;
}

export async function getCheckoutSession(env: Bindings, checkoutToken: string): Promise<CheckoutSessionRow | null> {
	if (!CHECKOUT_TOKEN_REGEX.test(checkoutToken)) {
		return null;
	}

	await ensureCheckoutSessionPaymentSchema(env);
	await maybeCleanupCheckoutSessions(env, { includeHeavy: false });

	const session: any = await withD1Retry(
		() => env.DB.prepare(
			`SELECT checkout_token, order_id, amount, status, gateway_total_payment, gateway_fee, payment_started_at, gateway_expires_at, gateway_status, gateway_payment_number, expires_at
			 FROM checkout_sessions
			 WHERE checkout_token = ?`
		).bind(checkoutToken).first(),
		{ label: 'payment.get-checkout-session', environment: resolveEnvironmentMode(env) }
	);

	if (!session) {
		return null;
	}

	if (String(session.expires_at) <= formatSqlTimestamp(new Date())) {
		await withD1Retry(
			() => env.DB.prepare(
				'UPDATE checkout_sessions SET status = ? WHERE checkout_token = ? AND status = ?'
			).bind('CANCELLED', checkoutToken, 'ACTIVE').run(),
			{ label: 'payment.expired-session-cancel', environment: resolveEnvironmentMode(env) }
		);
		await releaseReservationsByCheckoutToken(env, checkoutToken, 'EXPIRED');
		return null;
	}

	return {
		checkout_token: String(session.checkout_token),
		order_id: String(session.order_id),
		amount: Number(session.amount),
		status: String(session.status),
		gateway_total_payment: session.gateway_total_payment == null ? null : Number(session.gateway_total_payment),
		gateway_fee: session.gateway_fee == null ? null : Number(session.gateway_fee),
		payment_started_at: session.payment_started_at ? String(session.payment_started_at) : null,
		gateway_expires_at: session.gateway_expires_at ? String(session.gateway_expires_at) : null,
		gateway_status: session.gateway_status ? String(session.gateway_status) : null,
		gateway_payment_number: session.gateway_payment_number ? String(session.gateway_payment_number) : null,
		expires_at: String(session.expires_at)
	};
}

export function buildIdempotentQrisResponse(
	session: CheckoutSessionRow,
	projectSlug: string
): IdempotentQrisResponse | null {
	const paymentNumber = String(session.gateway_payment_number || '').trim();
	if (!paymentNumber) return null;

	const gatewayTotalPayment = Number(session.gateway_total_payment);
	const gatewayFee = Number(session.gateway_fee);
	const totalPayment = Number.isFinite(gatewayTotalPayment) && gatewayTotalPayment > 0
		? Math.trunc(gatewayTotalPayment)
		: Math.trunc(session.amount + Math.max(0, Number.isFinite(gatewayFee) ? gatewayFee : 0));
	const fee = Number.isFinite(gatewayFee)
		? Math.max(0, Math.trunc(gatewayFee))
		: Math.max(0, totalPayment - Math.trunc(session.amount));

	return {
		payment: {
			project: projectSlug,
			order_id: session.order_id,
			amount: Math.trunc(session.amount),
			total_payment: Math.max(Math.trunc(session.amount), totalPayment),
			fee,
			received: Math.trunc(session.amount),
			payment_method: 'qris',
			payment_number: paymentNumber,
			expired_at: session.gateway_expires_at || null,
			is_replayed: true
		},
		checkout_token: session.checkout_token,
		order_id: session.order_id,
		amount: session.amount,
		payment_started_at: session.payment_started_at || null,
		gateway_expires_at: session.gateway_expires_at || null,
		recovery_expires_at: session.expires_at,
		expires_at: session.expires_at
	};
}

export function buildCheckoutItemValidation(items: any[]): CheckoutItemValidationResult {
	const quantityByCode = new Map<string, number>();

	for (const item of items) {
		const productCode = String(item?.product?.code || '').trim();
		const quantity = Number(item?.quantity);

		if (!productCode) {
			throw new Error('INVALID_PRODUCT_CODE');
		}

		if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
			const quantityError: any = new Error('INVALID_PRODUCT_QUANTITY');
			quantityError.productCode = productCode;
			throw quantityError;
		}

		quantityByCode.set(productCode, (quantityByCode.get(productCode) || 0) + quantity);
	}

	if (quantityByCode.size > 5) {
		throw new Error('TOO_MANY_PRODUCT_TYPES');
	}

	const itemCodes = Array.from(quantityByCode.keys());
	return {
		quantityByCode,
		itemCodes,
		placeholders: itemCodes.map(() => '?').join(',')
	};
}

function buildStockConflictLabel(product: any, code: string, availableStock: number, reservedQty: number, stockValue: number): string {
	const safeName = sanitizeLogValue(product?.name || code, 60);
	if (availableStock <= 0 && reservedQty > 0 && stockValue > 0) {
		return `${safeName} (sedang direservasi pelanggan lain)`;
	}
	if (availableStock <= 0) {
		return `${safeName} (stok habis)`;
	}
	return `${safeName} (tersisa ${availableStock})`;
}

export async function calculateCheckoutPricing(
	env: Bindings,
	itemCodes: string[],
	placeholders: string,
	quantityByCode: Map<string, number>
): Promise<CheckoutPricingResult> {
	const { results: txProducts } = await withD1Retry(
		() => env.DB.prepare(
			`SELECT code, name, price, stock FROM products WHERE code IN (${placeholders})`
		).bind(...itemCodes).all(),
		{ label: 'payment.checkout-pricing-products', environment: resolveEnvironmentMode(env) }
	);
	if (!txProducts || txProducts.length !== itemCodes.length) {
		throw new Error('PRODUCT_NOT_FOUND');
	}

	const txProductMap = new Map<string, any>(txProducts.map((product: any) => [String(product.code), product]));
	const reservedMap = await getActiveReservedByCodes(env, itemCodes);
	let calculatedTotal = 0;
	const stockConflictDetails: string[] = [];

	for (const [code, quantity] of quantityByCode.entries()) {
		const product = txProductMap.get(code);
		if (!product) {
			throw new Error('PRODUCT_NOT_FOUND');
		}

		const stockValue = Number(product.stock || 0);
		const reservedQty = reservedMap.get(code) || 0;
		const availableStock = Math.max(0, stockValue - reservedQty);

		if (quantity > availableStock) {
			stockConflictDetails.push(buildStockConflictLabel(product, code, availableStock, reservedQty, stockValue));
			continue;
		}

		calculatedTotal += Number(product.price) * quantity;
	}

	if (stockConflictDetails.length > 0) {
		const stockError: any = new Error('STOCK_NOT_ENOUGH');
		stockError.details = stockConflictDetails;
		throw stockError;
	}

	return { calculatedTotal, txProductMap };
}

async function reserveCheckoutSessionStock(params: {
	env: Bindings;
	checkoutToken: string;
	orderId: string;
	expiresAt: string;
	quantityByCode: Map<string, number>;
	txProductMap: Map<string, any>;
}): Promise<void> {
	const stockConflictAfterReserve: string[] = [];

	for (const [code, quantity] of params.quantityByCode.entries()) {
		const reserveResult: any = await params.env.DB.prepare(
			`INSERT INTO stock_reservations (checkout_token, order_id, product_id, product_code, quantity, status, expires_at)
			 SELECT ?, ?, p.id, ?, ?, ?, ?
			 FROM products p
			 WHERE p.code = ?
			 	AND (
			 		p.stock - COALESCE(
			 			(
			 				SELECT SUM(sr.quantity)
			 				FROM stock_reservations sr
			 				WHERE sr.product_code = p.code
			 					AND sr.status = ?
			 					AND sr.expires_at > CURRENT_TIMESTAMP
			 			),
			 			0
			 		)
			 	) >= ?`
		).bind(
			params.checkoutToken,
			params.orderId,
			code,
			quantity,
			'RESERVED',
			params.expiresAt,
			code,
			'RESERVED',
			quantity
		).run();

		const reserveChanges = Number(reserveResult?.meta?.changes || 0);
		if (reserveChanges === 1) {
			continue;
		}

		const product = params.txProductMap.get(code);
		const reservedMapLatest = await getActiveReservedByCodes(params.env, [code]);
		const stockValue = Number(product?.stock || 0);
		const reservedQty = reservedMapLatest.get(code) || 0;
		const availableStock = Math.max(0, stockValue - reservedQty);
		stockConflictAfterReserve.push(buildStockConflictLabel(product, code, availableStock, reservedQty, stockValue));
		break;
	}

	if (stockConflictAfterReserve.length > 0) {
		const stockError: any = new Error('STOCK_NOT_ENOUGH');
		stockError.details = stockConflictAfterReserve;
		throw stockError;
	}
}

export async function createCheckoutSessionWithReservations(params: {
	env: Bindings;
	checkoutToken: string;
	orderId: string;
	calculatedTotal: number;
	expiresAt: string;
	quantityByCode: Map<string, number>;
	txProductMap: Map<string, any>;
}): Promise<void> {
	try {
		await params.env.DB.prepare(
			`INSERT INTO checkout_sessions (checkout_token, order_id, amount, status, expires_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(
			params.checkoutToken,
			params.orderId,
			params.calculatedTotal,
			'ACTIVE',
			params.expiresAt
		).run();

		await reserveCheckoutSessionStock({
			env: params.env,
			checkoutToken: params.checkoutToken,
			orderId: params.orderId,
			expiresAt: params.expiresAt,
			quantityByCode: params.quantityByCode,
			txProductMap: params.txProductMap
		});
	} catch (error) {
		await cleanupFailedCheckoutSession(params.env, params.checkoutToken);
		throw error;
	}
}

async function cleanupFailedCheckoutSession(env: Bindings, checkoutToken: string): Promise<void> {
	try {
		await releaseReservationsByCheckoutToken(env, checkoutToken, 'CHECKOUT_FAILED');
		await env.DB.prepare(
			'UPDATE checkout_sessions SET status = ? WHERE checkout_token = ? AND status = ?'
		).bind('CANCELLED', checkoutToken, 'ACTIVE').run();
	} catch (cleanupError) {
		const logger = createLogger({
			service: 'koperasi-backend',
			environment: resolveEnvironmentMode(env),
		});
		logger.error('Cleanup checkout session gagal', {
			checkoutToken: maskToken(checkoutToken),
			error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
		});
	}
}
