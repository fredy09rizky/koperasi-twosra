import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from './d1-retry.js';
import { ensureSchemaOnce, ensureTableColumns, createIndexIfNotExists, type SchemaColumn } from './d1-schema-helpers.js';

const ORDER_ITEM_COLUMNS: SchemaColumn[] = [
	{
		name: 'product_code_snapshot',
		ddl: "product_code_snapshot TEXT NOT NULL DEFAULT ''"
	}
];

export async function ensureOrderItemSchema(env: Bindings) {
	await ensureSchemaOnce('order-item', async () => {
		await withD1Retry(
			() => env.DB.prepare(
				`CREATE TABLE IF NOT EXISTS order_items (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					order_id TEXT NOT NULL,
					product_name TEXT NOT NULL,
					product_code_snapshot TEXT NOT NULL CHECK (length(trim(product_code_snapshot)) > 0),
					quantity INTEGER NOT NULL CHECK (quantity > 0),
					price_at_purchase INTEGER NOT NULL CHECK (price_at_purchase >= 0),
					FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
				)`
			).run(),
			{ label: 'schema.order-items.create-table' }
		);

		const { results } = await withD1Retry(
			() => env.DB.prepare("PRAGMA table_info('order_items')").all(),
			{ label: 'schema.order-items.columns' }
		);
		const existingColumns = new Set(
			(Array.isArray(results) ? results : [])
				.map((row: any) => String(row?.name || '').trim().toLowerCase())
				.filter(Boolean)
		);

		if (existingColumns.size === 0) return;

		await ensureTableColumns(env, 'order_items', ORDER_ITEM_COLUMNS, 'schema.order-items');

		await createIndexIfNotExists(env,
			'idx_order_items_order',
			'CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)',
			'schema.order-items.index.order-id'
		);
	});
}
