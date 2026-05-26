import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from './d1-retry.js';
import { ensureSchemaOnce, ensureTableColumns, createIndexIfNotExists, type SchemaColumn } from './d1-schema-helpers.js';

const ORDER_PICKUP_COLUMNS: SchemaColumn[] = [
	{
		name: 'pickup_status',
		ddl: "pickup_status TEXT NOT NULL DEFAULT 'BELUM_DIAMBIL'"
	},
	{
		name: 'picked_up_at',
		ddl: 'picked_up_at TIMESTAMP'
	}
];

export async function ensureOrderPickupSchema(env: Bindings) {
	await ensureSchemaOnce('order-pickup', async () => {
		const { results } = await withD1Retry(
			() => env.DB.prepare("PRAGMA table_info('orders')").all(),
			{ label: 'schema.orders.pickup-columns' }
		);
		const existingColumns = new Set(
			(Array.isArray(results) ? results : [])
				.map((row: any) => String(row?.name || '').trim().toLowerCase())
				.filter(Boolean)
		);

		if (existingColumns.size === 0) return;

		await ensureTableColumns(env, 'orders', ORDER_PICKUP_COLUMNS, 'schema.orders');

		await createIndexIfNotExists(env,
			'idx_orders_pickup_status',
			'CREATE INDEX IF NOT EXISTS idx_orders_pickup_status ON orders(pickup_status)',
			'schema.orders.index-pickup-status'
		);

		await createIndexIfNotExists(env,
			'idx_orders_created_wib',
			"CREATE INDEX IF NOT EXISTS idx_orders_created_wib ON orders(datetime(created_at, '+7 hours'))",
			'schema.orders.index-created-wib'
		);
	});
}
