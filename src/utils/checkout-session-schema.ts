import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from './d1-retry.js';
import { ensureSchemaOnce, ensureTableColumns, type SchemaColumn } from './d1-schema-helpers.js';

const CHECKOUT_SESSION_PAYMENT_COLUMNS: SchemaColumn[] = [
	{
		name: 'gateway_total_payment',
		ddl: 'gateway_total_payment INTEGER'
	},
	{
		name: 'gateway_fee',
		ddl: 'gateway_fee INTEGER DEFAULT 0'
	},
	{
		name: 'gateway_payment_number',
		ddl: 'gateway_payment_number TEXT'
	}
];

export async function ensureCheckoutSessionPaymentSchema(env: Bindings) {
	await ensureSchemaOnce('checkout-session-payment', async () => {
		const { results } = await withD1Retry(
			() => env.DB.prepare("PRAGMA table_info('checkout_sessions')").all(),
			{ label: 'schema.checkout-session.payment-columns' }
		);
		const existingColumns = new Set(
			(Array.isArray(results) ? results : [])
				.map((row: any) => String(row?.name || '').trim().toLowerCase())
				.filter(Boolean)
		);

		if (existingColumns.size === 0) return;

		await ensureTableColumns(env, 'checkout_sessions', CHECKOUT_SESSION_PAYMENT_COLUMNS, 'schema.checkout-session');
	});
}
