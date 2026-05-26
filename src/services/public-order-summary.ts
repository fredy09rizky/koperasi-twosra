import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { toIsoUtcTimestamp } from '../utils/log.js';
import { resolveEnvironmentMode } from '../utils/logger.js';
import { isRecord, readStringProperty } from '../utils/type-safe.js';

export type SecureOrderItem = {
	product: {
		code: string;
		price: number;
	};
	quantity: number;
	secure_price: number;
	secure_name: string;
};

export type StoredOrderRow = Record<string, unknown>;

export function buildServerOrderSummary(
	orderId: string,
	customerName: string,
	customerClass: string,
	pickupTime: string,
	paidAt: string,
	items: SecureOrderItem[],
	subtotal: number,
	fee: number
) {
	return {
		id_transaksi: orderId,
		nama: customerName,
		kelas: customerClass,
		waktu: pickupTime,
		waktu_pembayaran: paidAt,
		items: items.map((item) => ({
			product: {
				code: item.product.code,
				name: item.secure_name,
				price: item.secure_price
			},
			quantity: item.quantity
		})),
		total: subtotal,
		fee,
		payment_amount: subtotal + fee
	};
}

export async function buildStoredOrderSummary(env: Bindings, order: StoredOrderRow) {
	const { results: itemRows } = await withD1Retry(
		() => env.DB.prepare(
			`SELECT product_name, product_code_snapshot, quantity, price_at_purchase
			 FROM order_items
			 WHERE order_id = ?`
		).bind(order.id).all(),
		{ label: 'public.orders.stored-summary-items', environment: resolveEnvironmentMode(env) }
	);

	const subtotal = Number(order?.total_amount || 0);
	const fee = Number(order?.fee || 0);
	const items = Array.isArray(itemRows) ? itemRows : [];
	return {
		id_transaksi: readStringProperty(order, 'id'),
		nama: readStringProperty(order, 'customer_name'),
		kelas: readStringProperty(order, 'customer_class'),
		waktu: readStringProperty(order, 'pickup_time'),
		waktu_pembayaran: toIsoUtcTimestamp(order?.created_at),
		items: items.map((item) => {
			const itemRecord: Record<string, unknown> = isRecord(item) ? item : {};
			return {
				product: {
					code: readStringProperty(itemRecord, 'product_code_snapshot'),
					name: readStringProperty(itemRecord, 'product_name'),
					price: Number(itemRecord.price_at_purchase || 0)
				},
				quantity: Number(itemRecord.quantity || 0)
			};
		}),
		total: subtotal,
		fee,
		payment_amount: subtotal + fee
	};
}

export function buildItemSummaryLines(items: SecureOrderItem[]): string[] {
	return items.map((item) => `${item.quantity}x ${item.secure_name} (${item.product.code})`);
}
