import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from './d1-retry.js';
import { ensureSchemaOnce, ensureTableColumns, createIndexIfNotExists, type SchemaColumn } from './d1-schema-helpers.js';

const ADMIN_SESSION_COLUMNS: SchemaColumn[] = [
	{
		name: 'active_session_id',
		ddl: 'active_session_id TEXT'
	},
	{
		name: 'session_last_login_ip',
		ddl: 'session_last_login_ip TEXT'
	},
	{
		name: 'session_last_login_device',
		ddl: 'session_last_login_device TEXT'
	},
	{
		name: 'session_last_login_at',
		ddl: 'session_last_login_at TIMESTAMP'
	}
];

export async function ensureAdminSessionSchema(env: Bindings) {
	await ensureSchemaOnce('admin-session', async () => {
		const { results } = await withD1Retry(
			() => env.DB.prepare("PRAGMA table_info('admin_users')").all(),
			{ label: 'schema.admin-users.session-columns' }
		);
		const existingColumns = new Set(
			(Array.isArray(results) ? results : [])
				.map((row: any) => String(row?.name || '').trim().toLowerCase())
				.filter(Boolean)
		);

		if (existingColumns.size === 0) return;

		await ensureTableColumns(env, 'admin_users', ADMIN_SESSION_COLUMNS, 'schema.admin-users');

		await createIndexIfNotExists(env,
			'idx_admin_users_active_session_id',
			'CREATE INDEX IF NOT EXISTS idx_admin_users_active_session_id ON admin_users(active_session_id)',
			'schema.admin-users.index.active-session-id'
		);
	});
}
