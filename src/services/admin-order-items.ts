import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from '../utils/d1-retry.js';
import type { AppEnvironment } from '../utils/logger.js';
import { isRecord, readStringProperty } from '../utils/type-safe.js';

const D1_BIND_PARAMETER_SAFE_CHUNK_SIZE = 90;

export type AdminOrderItemRow = {
	order_id: string;
	product_name: string;
	product_code_snapshot: string;
	quantity: number;
	price_at_purchase?: number;
};

type LoadAdminOrderItemsOptions = {
	env: Bindings;
	orderIds: string[];
	includePriceAtPurchase?: boolean;
	label: string;
	environment: AppEnvironment;
};

export async function loadAdminOrderItemsByOrderIds(options: LoadAdminOrderItemsOptions): Promise<AdminOrderItemRow[]> {
	const normalizedOrderIds = options.orderIds
		.map((orderId) => String(orderId || '').trim())
		.filter(Boolean);
	if (normalizedOrderIds.length === 0) return [];

	const rows: AdminOrderItemRow[] = [];
	for (let index = 0; index < normalizedOrderIds.length; index += D1_BIND_PARAMETER_SAFE_CHUNK_SIZE) {
		const chunk = normalizedOrderIds.slice(index, index + D1_BIND_PARAMETER_SAFE_CHUNK_SIZE);
		const placeholders = chunk.map(() => '?').join(', ');
		const priceColumn = options.includePriceAtPurchase ? ', price_at_purchase' : '';
		const itemsResult = await withD1Retry(
			() => options.env.DB.prepare(
				`SELECT
					order_id,
					product_name,
					product_code_snapshot,
					quantity
					${priceColumn}
				FROM order_items
				WHERE order_id IN (${placeholders})
				ORDER BY id ASC`
			).bind(...chunk).all(),
			{
				label: `${options.label}.chunk-${Math.floor(index / D1_BIND_PARAMETER_SAFE_CHUNK_SIZE) + 1}`,
				environment: options.environment
			}
		);

		const chunkRows = Array.isArray(itemsResult?.results) ? itemsResult.results : [];
		for (const rawItem of chunkRows) {
			if (!isRecord(rawItem)) continue;
			const item: AdminOrderItemRow = {
				order_id: readStringProperty(rawItem, 'order_id'),
				product_name: readStringProperty(rawItem, 'product_name'),
				product_code_snapshot: readStringProperty(rawItem, 'product_code_snapshot'),
				quantity: Number(rawItem.quantity || 0)
			};
			if (options.includePriceAtPurchase) {
				item.price_at_purchase = Number(rawItem.price_at_purchase || 0);
			}
			rows.push(item);
		}
	}

	return rows;
}
