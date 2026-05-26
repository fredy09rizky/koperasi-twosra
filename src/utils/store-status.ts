import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from './d1-retry.js';
import { ensureSchemaOnce, ensureTableColumns, type SchemaColumn } from './d1-schema-helpers.js';

const STORE_STATUS_COLUMNS: SchemaColumn[] = [
	{
		name: 'accepting_orders',
		ddl: 'accepting_orders INTEGER NOT NULL DEFAULT 1'
	},
	{
		name: 'updated_at',
		ddl: 'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
	},
	{
		name: 'updated_by',
		ddl: 'updated_by TEXT'
	}
];

export type StoreStatusRecord = {
	accepting_orders: boolean;
	updated_at: string;
	updated_by: string | null;
};

export type StoreStatusAdminSummary = StoreStatusRecord & {
	active_checkout_count: number;
	active_qris_count: number;
};

export async function ensureStoreStatusSchema(env: Bindings) {
	await ensureSchemaOnce('store-status', async () => {
		await withD1Retry(
			() => env.DB.prepare(
				`CREATE TABLE IF NOT EXISTS store_status (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					accepting_orders INTEGER NOT NULL DEFAULT 1,
					updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_by TEXT
				)`
			).run(),
			{ label: 'schema.store-status.create-table' }
		);

		await ensureTableColumns(env, 'store_status', STORE_STATUS_COLUMNS, 'schema.store-status');

		await withD1Retry(
			() => env.DB.prepare(
				`INSERT OR IGNORE INTO store_status (id, accepting_orders, updated_at, updated_by)
				 VALUES (1, 1, CURRENT_TIMESTAMP, NULL)`
			).run(),
			{ label: 'schema.store-status.seed-row' }
		);
	});
}

export async function getStoreStatus(env: Bindings): Promise<StoreStatusRecord> {
	await ensureStoreStatusSchema(env);
	const row: any = await env.DB.prepare(
		'SELECT accepting_orders, updated_at, updated_by FROM store_status WHERE id = 1'
	).first();

	return {
		accepting_orders: Number(row?.accepting_orders ?? 1) === 1,
		updated_at: String(row?.updated_at || ''),
		updated_by: row?.updated_by ? String(row.updated_by) : null
	};
}

export async function getActiveCheckoutCounts(env: Bindings): Promise<{
	active_checkout_count: number;
	active_qris_count: number;
}> {
	const row: any = await env.DB.prepare(
		`SELECT
			COUNT(*) AS active_checkout_count,
			SUM(CASE WHEN payment_started_at IS NOT NULL THEN 1 ELSE 0 END) AS active_qris_count
		 FROM checkout_sessions
		 WHERE status = 'ACTIVE'
		   AND expires_at > CURRENT_TIMESTAMP`
	).first();

	return {
		active_checkout_count: Number(row?.active_checkout_count || 0),
		active_qris_count: Number(row?.active_qris_count || 0)
	};
}

export async function getStoreStatusAdminSummary(env: Bindings): Promise<StoreStatusAdminSummary> {
	const [status, counts] = await Promise.all([getStoreStatus(env), getActiveCheckoutCounts(env)]);
	return {
		...status,
		...counts
	};
}

export async function updateStoreStatus(
	env: Bindings,
	acceptingOrders: boolean,
	updatedBy: string | null
): Promise<StoreStatusRecord> {
	await ensureStoreStatusSchema(env);
	await env.DB.prepare(
		`UPDATE store_status
		 SET accepting_orders = ?,
		     updated_at = CURRENT_TIMESTAMP,
		     updated_by = ?
		 WHERE id = 1`
	).bind(acceptingOrders ? 1 : 0, updatedBy || null).run();

	return getStoreStatus(env);
}
