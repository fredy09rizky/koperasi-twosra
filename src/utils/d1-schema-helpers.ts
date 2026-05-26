import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from './d1-retry.js';

export type SchemaColumn = {
	name: string;
	ddl: string;
};

export function isIgnorableAlterError(message: string): boolean {
	return message.includes('duplicate column name') || message.includes('already exists');
}

export async function ensureTableColumns(
	env: Bindings,
	tableName: string,
	columns: SchemaColumn[],
	labelPrefix: string
): Promise<Set<string>> {
	const { results } = await withD1Retry(
		() => env.DB.prepare(`PRAGMA table_info('${tableName}')`).all(),
		{ label: `${labelPrefix}.columns` }
	);
	const existingColumns = new Set(
		(Array.isArray(results) ? results : [])
			.map((row: any) => String(row?.name || '').trim().toLowerCase())
			.filter(Boolean)
	);

	for (const column of columns) {
		if (existingColumns.has(column.name)) continue;

		try {
			await withD1Retry(
				() => env.DB.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${column.ddl}`).run(),
				{ label: `${labelPrefix}.alter.${column.name}` }
			);
			existingColumns.add(column.name);
		} catch (error: any) {
			const message = String(error?.message || '').toLowerCase();
			if (isIgnorableAlterError(message)) {
				existingColumns.add(column.name);
				continue;
			}
			throw error;
		}
	}

	return existingColumns;
}

export async function createIndexIfNotExists(
	env: Bindings,
	indexName: string,
	createStatement: string,
	label: string
): Promise<void> {
	try {
		await withD1Retry(
			() => env.DB.prepare(createStatement).run(),
			{ label }
		);
	} catch (error: any) {
		const message = String(error?.message || '').toLowerCase();
		if (!isIgnorableAlterError(message)) {
			throw error;
		}
	}
}

type SchemaGuardState = {
	ensured: boolean;
	ensuring: Promise<void> | null;
};

const guardStates = new Map<string, SchemaGuardState>();

export async function ensureSchemaOnce(
	key: string,
	factory: () => Promise<void>
): Promise<void> {
	let state = guardStates.get(key);
	if (!state) {
		state = { ensured: false, ensuring: null };
		guardStates.set(key, state);
	}

	if (state.ensured) return;
	if (state.ensuring) {
		await state.ensuring;
		return;
	}

	state.ensuring = (async () => {
		await factory();
		state!.ensured = true;
	})();

	try {
		await state.ensuring;
	} finally {
		state.ensuring = null;
	}
}
