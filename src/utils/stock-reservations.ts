import type { Bindings } from '../types/bindings.js';
import { withD1Retry } from './d1-retry.js';
import { ensureSchemaOnce, ensureTableColumns, createIndexIfNotExists, type SchemaColumn } from './d1-schema-helpers.js';

const RESERVED_STATUS = 'RESERVED';
const RELEASED_STATUS = 'RELEASED';
const CONSUMED_STATUS = 'CONSUMED';

const STOCK_RESERVATION_COLUMNS: SchemaColumn[] = [
	{
		name: 'product_id',
		ddl: 'product_id INTEGER'
	}
];

export type ActiveReservationRow = {
	product_code: string;
	quantity: number;
};

function getChangesCount(result: any): number {
	const changes = Number(result?.meta?.changes);
	return Number.isFinite(changes) ? changes : 0;
}

export async function ensureStockReservationSchema(env: Bindings) {
	await ensureSchemaOnce('stock-reservations', async () => {
		await withD1Retry(
			() => env.DB.prepare(
				`CREATE TABLE IF NOT EXISTS stock_reservations (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					checkout_token TEXT NOT NULL,
					order_id TEXT NOT NULL,
					product_id INTEGER,
					product_code TEXT NOT NULL,
					quantity INTEGER NOT NULL CHECK (quantity > 0),
					status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RELEASED', 'CONSUMED')),
					expires_at TIMESTAMP NOT NULL,
					release_reason TEXT,
					released_at TIMESTAMP,
					consumed_at TIMESTAMP,
					created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					FOREIGN KEY (checkout_token) REFERENCES checkout_sessions(checkout_token) ON DELETE CASCADE ON UPDATE CASCADE,
					FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL ON UPDATE CASCADE
				)`
			).run(),
			{ label: 'schema.stock-reservations.create-table' }
		);

		await ensureTableColumns(env, 'stock_reservations', STOCK_RESERVATION_COLUMNS, 'schema.stock-reservations');

		await createIndexIfNotExists(env,
			'idx_stock_reservations_checkout_product',
			'CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_reservations_checkout_product ON stock_reservations(checkout_token, product_code)',
			'schema.stock-reservations.index.checkout-product'
		);
		await createIndexIfNotExists(env,
			'idx_stock_reservations_product_status_expires',
			'CREATE INDEX IF NOT EXISTS idx_stock_reservations_product_status_expires ON stock_reservations(product_code, status, expires_at)',
			'schema.stock-reservations.index.product-status-expires'
		);
		await createIndexIfNotExists(env,
			'idx_stock_reservations_checkout_status',
			'CREATE INDEX IF NOT EXISTS idx_stock_reservations_checkout_status ON stock_reservations(checkout_token, status)',
			'schema.stock-reservations.index.checkout-status'
		);
		await createIndexIfNotExists(env,
			'idx_stock_reservations_checkout_order_status_expires',
			'CREATE INDEX IF NOT EXISTS idx_stock_reservations_checkout_order_status_expires ON stock_reservations(checkout_token, order_id, status, expires_at)',
			'schema.stock-reservations.index.checkout-order-status-expires'
		);
		await createIndexIfNotExists(env,
			'idx_stock_reservations_status_expires_product',
			'CREATE INDEX IF NOT EXISTS idx_stock_reservations_status_expires_product ON stock_reservations(status, expires_at, product_code)',
			'schema.stock-reservations.index.status-expires-product'
		);
	});
}

export async function releaseExpiredReservations(env: Bindings) {
	// Dipanggil sangat sering sebelum baca stok/session untuk memastikan stok publik
	// segera kembali ketika checkout kedaluwarsa.
	await ensureStockReservationSchema(env);
	await env.DB.prepare(
		`UPDATE stock_reservations
		 SET status = ?, released_at = COALESCE(released_at, CURRENT_TIMESTAMP), release_reason = COALESCE(release_reason, ?)
		 WHERE status = ? AND expires_at <= CURRENT_TIMESTAMP`
	).bind(RELEASED_STATUS, 'EXPIRED', RESERVED_STATUS).run();
}

export async function releaseReservationsByCheckoutToken(
	env: Bindings,
	checkoutToken: string,
	reason = 'CANCELLED'
) {
	// Dipakai saat checkout batal, session expired, atau gateway gagal,
	// sehingga stok kembali ke katalog publik.
	await ensureStockReservationSchema(env);
	if (!checkoutToken) return 0;
	const result: any = await env.DB.prepare(
		`UPDATE stock_reservations
		 SET status = ?, released_at = COALESCE(released_at, CURRENT_TIMESTAMP), release_reason = COALESCE(release_reason, ?)
		 WHERE checkout_token = ? AND status = ?`
	).bind(RELEASED_STATUS, reason, checkoutToken, RESERVED_STATUS).run();
	return getChangesCount(result);
}

export async function consumeReservationsByCheckoutToken(
	env: Bindings,
	checkoutToken: string,
	orderId?: string
) {
	// Dipakai oleh `public.ts` setelah order final sukses, agar reservasi tidak lagi
	// dihitung sebagai stok aktif dan berubah status menjadi jejak audit.
	await ensureStockReservationSchema(env);
	if (!checkoutToken) return 0;

	if (orderId) {
		const result: any = await env.DB.prepare(
			`UPDATE stock_reservations
			 SET status = ?, consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
			 WHERE checkout_token = ? AND order_id = ? AND status = ? AND expires_at > CURRENT_TIMESTAMP`
		).bind(CONSUMED_STATUS, checkoutToken, orderId, RESERVED_STATUS).run();
		return getChangesCount(result);
	}

	const result: any = await env.DB.prepare(
		`UPDATE stock_reservations
		 SET status = ?, consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
		 WHERE checkout_token = ? AND status = ? AND expires_at > CURRENT_TIMESTAMP`
	).bind(CONSUMED_STATUS, checkoutToken, RESERVED_STATUS).run();
	return getChangesCount(result);
}

export async function fetchActiveReservationsByCheckoutToken(
	env: Bindings,
	checkoutToken: string,
	orderId?: string
): Promise<ActiveReservationRow[]> {
	// Helper penting untuk `/api/orders`: item final dibangun dari reservasi aktif,
	// bukan dari daftar item yang dikirim browser.
	await ensureStockReservationSchema(env);
	if (!checkoutToken) return [];

	if (orderId) {
		// Hanya reservasi yang masih aktif dan belum lewat waktu kedaluwarsa yang boleh ikut membentuk order final.
		const { results } = await env.DB.prepare(
			`SELECT product_code, quantity
			 FROM stock_reservations
			 WHERE checkout_token = ? AND order_id = ? AND status = ? AND expires_at > CURRENT_TIMESTAMP`
		).bind(checkoutToken, orderId, RESERVED_STATUS).all();

		return Array.isArray(results)
			? results.map((row: any) => ({
				product_code: String(row?.product_code || '').trim(),
				quantity: Number(row?.quantity || 0)
			})).filter((row) => row.product_code && Number.isInteger(row.quantity) && row.quantity > 0)
			: [];
	}

	const { results } = await env.DB.prepare(
		`SELECT product_code, quantity
		 FROM stock_reservations
		 WHERE checkout_token = ? AND status = ? AND expires_at > CURRENT_TIMESTAMP`
	).bind(checkoutToken, RESERVED_STATUS).all();

	return Array.isArray(results)
		? results.map((row: any) => ({
			product_code: String(row?.product_code || '').trim(),
			quantity: Number(row?.quantity || 0)
		})).filter((row) => row.product_code && Number.isInteger(row.quantity) && row.quantity > 0)
		: [];
}

export async function getActiveReservedByCodes(env: Bindings, productCodes: string[]) {
	// Dipakai saat checkout untuk menghitung stok tersedia per kode produk yang sedang dicek.
	await ensureStockReservationSchema(env);
	const reservedMap = new Map<string, number>();
	if (!Array.isArray(productCodes) || productCodes.length === 0) {
		return reservedMap;
	}

	const normalizedCodes = Array.from(new Set(
		productCodes
			.map((code) => String(code || '').trim())
			.filter(Boolean)
	));
	if (normalizedCodes.length === 0) {
		return reservedMap;
	}

	const placeholders = normalizedCodes.map(() => '?').join(',');
	const { results } = await env.DB.prepare(
		`SELECT product_code, SUM(quantity) AS reserved_qty
		 FROM stock_reservations
		 WHERE status = ? AND expires_at > CURRENT_TIMESTAMP AND product_code IN (${placeholders})
		 GROUP BY product_code`
	).bind(RESERVED_STATUS, ...normalizedCodes).all();

	(results || []).forEach((row: any) => {
		const code = String(row?.product_code || '').trim();
		const qty = Number(row?.reserved_qty || 0);
		if (!code || !Number.isFinite(qty)) return;
		reservedMap.set(code, Math.max(0, Math.trunc(qty)));
	});

	return reservedMap;
}

export async function getAllActiveReservedByProduct(env: Bindings) {
	// Dipakai saat render katalog publik/admin untuk menurunkan stok fisik menjadi stok publik.
	await ensureStockReservationSchema(env);
	const reservedMap = new Map<string, number>();
	const { results } = await env.DB.prepare(
		`SELECT product_code, SUM(quantity) AS reserved_qty
		 FROM stock_reservations
		 WHERE status = ? AND expires_at > CURRENT_TIMESTAMP
		 GROUP BY product_code`
	).bind(RESERVED_STATUS).all();

	(results || []).forEach((row: any) => {
		const code = String(row?.product_code || '').trim();
		const qty = Number(row?.reserved_qty || 0);
		if (!code || !Number.isFinite(qty)) return;
		reservedMap.set(code, Math.max(0, Math.trunc(qty)));
	});

	return reservedMap;
}

export async function getActiveReservedForProductCode(env: Bindings, productCode: string) {
	// Dipakai admin saat update/delete produk agar perubahan tidak memutus checkout aktif.
	await ensureStockReservationSchema(env);
	const normalizedCode = String(productCode || '').trim();
	if (!normalizedCode) return 0;

	const row: any = await env.DB.prepare(
		`SELECT COALESCE(SUM(quantity), 0) AS reserved_qty
		 FROM stock_reservations
		 WHERE status = ? AND expires_at > CURRENT_TIMESTAMP AND product_code = ?`
	).bind(RESERVED_STATUS, normalizedCode).first();

	const qty = Number(row?.reserved_qty || 0);
	return Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : 0;
}

export async function cleanupOldReservationRows(env: Bindings) {
	// Berbeda dari releaseExpiredReservations: helper ini benar-benar menghapus riwayat lama
	// agar tabel reservasi tidak terus membengkak.
	await ensureStockReservationSchema(env);

	// Hapus dengan batching (LIMIT 500) agar tidak mengunci tabel terlalu lama
	// saat ada banyak row yang perlu dibersihkan.
	// MAX_DELETE = batas atas absolut untuk satu pemanggilan; setiap iterasi menghapus
	// hingga BATCH_LIMIT row, dan loop berhenti ketika tidak ada lagi row yang memenuhi syarat
	// atau total yang dihapus sudah mencapai MAX_DELETE.
	const BATCH_LIMIT = 500;
	const MAX_DELETE = 5000;
	let deletedTotal = 0;

	while (deletedTotal < MAX_DELETE) {
		const result: any = await env.DB.prepare(
			`DELETE FROM stock_reservations
			 WHERE id IN (
			 	SELECT id FROM stock_reservations
			 	WHERE (
			 		status = ? AND expires_at <= datetime('now', '-1 day')
			 	) OR (
			 		status IN (?, ?)
			 		AND COALESCE(released_at, consumed_at, created_at) <= datetime('now', '-7 day')
			 	)
			 	LIMIT ?
			 )`
		).bind(RESERVED_STATUS, RELEASED_STATUS, CONSUMED_STATUS, BATCH_LIMIT).run();
		const changes = Number(result?.meta?.changes || 0);

		deletedTotal += changes;

		// Jika changes < BATCH_LIMIT, berarti tidak ada lagi row yang memenuhi kriteria.
		// Tidak perlu iterasi berikutnya.
		if (changes < BATCH_LIMIT) break;
	}
}
