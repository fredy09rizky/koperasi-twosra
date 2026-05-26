import { Hono } from 'hono';
import type { Bindings } from '../types/bindings.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRateLimitMiddleware } from '../middleware/rate-limit.js';
import { formatWindowLabel, toIsoUtcTimestamp } from '../utils/log.js';
import { ensureOrderItemSchema } from '../utils/order-item-schema.js';
import { ensureOrderPickupSchema } from '../utils/order-pickup-schema.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { getErrorMessage, isRecord, readStringProperty } from '../utils/type-safe.js';
import { loadAdminOrderItemsByOrderIds } from '../services/admin-order-items.js';
import { hydrateAdminOrders, parsePositiveInt, resolveAdminOrdersDateRange } from '../services/admin-orders.js';
import {
	buildAdminError,
	getAdminRequestLogger,
	queueAdminOperationalLog as queueOperationalLog,
	resolveAdminEnvironmentMode as resolveEnvironmentMode
} from '../services/admin-common.js';
import { handleAdminLogin, handleAdminLogout } from '../services/admin-auth.js';
import { handleAdminChangePassword } from '../services/admin-password.js';
import { handleAdminMarkOrderPickedUp } from '../services/admin-pickup.js';
import {
	handleAdminCreateProduct,
	handleAdminDeleteProduct,
	handleAdminImagePolicy,
	handleAdminListProducts,
	handleAdminUpdateProduct,
	handleAdminUploadProductImage
} from '../services/admin-product-handlers.js';
import { handleAdminGetStoreStatus, handleAdminUpdateStoreStatus } from '../services/admin-store-status.js';

// Route admin hanya merangkai middleware dan handler domain; logic auth,
// status toko, pickup, dan produk berada di `src/services/admin-*`.
const adminRoutes = new Hono<{ Bindings: Bindings }>();
type CountRow = { total?: number };
const adminLoginRateLimit = createRateLimitMiddleware({
	namespace: 'admin-login',
	windowMs: 15 * 60 * 1000,
	max: 10,
	message: 'Terlalu banyak percobaan login admin. Tunggu beberapa menit lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: login admin', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const adminChangePasswordRateLimit = createRateLimitMiddleware({
	namespace: 'admin-change-password',
	windowMs: 15 * 60 * 1000,
	max: 5,
	message: 'Terlalu banyak percobaan ganti password admin. Tunggu beberapa menit lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: ganti password admin', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
const adminUploadImageRateLimit = createRateLimitMiddleware({
	namespace: 'admin-upload-image',
	windowMs: 60 * 1000,
	max: 20,
	message: 'Terlalu banyak percobaan upload gambar. Tunggu sebentar lalu coba lagi.',
	onLimit: (c, info) => {
		queueOperationalLog(c, 'Rate Limit: upload gambar admin', [
			`Method: ${c.req.method}`,
			`Path: ${c.req.path}`,
			`Client ID: ${info.clientId}`,
			`Batas: ${info.max} request / ${formatWindowLabel(info.windowMs)}`,
			`Percobaan saat diblokir: ${info.currentCount}`,
			`Retry After: ${info.retryAfterSeconds} detik`
		]);
	}
});
// Seluruh route admin, selain login/logout yang dikecualikan di middleware, wajib lolos autentikasi.
adminRoutes.use('/*', authMiddleware());

/**
 * Login admin dan membuat cookie sesi.
 */
adminRoutes.post('/login', adminLoginRateLimit, handleAdminLogin);

/**
 * Logout admin dengan menghapus cookie sesi.
 */
adminRoutes.post('/logout', handleAdminLogout);

/**
 * Mengganti password admin dan menginvalidasi seluruh sesi aktif.
 */
adminRoutes.post('/change-password', adminChangePasswordRateLimit, handleAdminChangePassword);

/**
 * Memverifikasi apakah sesi admin pada cookie masih aktif.
 */
adminRoutes.get('/verify', async (c) => {
	const payload = c.get('jwtPayload');
	return c.json({ success: true, message: 'Sesi admin masih valid', user: payload });
});

/**
 * Memberi policy domain URL gambar eksternal untuk form admin.
 */
adminRoutes.get('/image-policy', handleAdminImagePolicy);

/**
 * Mengambil status operasional web + ringkasan checkout aktif untuk dashboard admin.
 */
adminRoutes.get('/store-status', handleAdminGetStoreStatus);

/**
 * Memperbarui status operasional web dari dashboard admin.
 */
adminRoutes.put('/store-status', handleAdminUpdateStoreStatus);

/**
 * Mengambil daftar order beserta itemnya dengan pagination.
 */
adminRoutes.get('/orders', async (c) => {
	try {
		await ensureOrderPickupSchema(c.env);
		await ensureOrderItemSchema(c.env);

		const page = parsePositiveInt(c.req.query('page'), 1, 1, 5000);
		const limit = parsePositiveInt(c.req.query('limit'), 20, 1, 100);
		const offset = (page - 1) * limit;
		const sortRaw = String(c.req.query('sort') || 'desc').toLowerCase();
		const sort = sortRaw === 'asc' ? 'asc' : 'desc';
		const sortSql = sort === 'asc' ? 'ASC' : 'DESC';
		const searchQuery = String(c.req.query('search') || '').trim().toLowerCase();
		const dateFilter = String(c.req.query('date_filter') || 'all').trim().toLowerCase();
		const customStartDate = String(c.req.query('start_date') || '').trim();
		const customEndDate = String(c.req.query('end_date') || '').trim();
		const includeItems = String(c.req.query('include_items') || '1') !== '0';
		const whereClauses: string[] = [];
		const whereBindings: Array<string> = [];

		if (searchQuery) {
			whereClauses.push('(LOWER(id) LIKE ? OR LOWER(customer_name) LIKE ? OR LOWER(wa_number) LIKE ?)');
			const searchLike = `%${searchQuery}%`;
			whereBindings.push(searchLike, searchLike, searchLike);
		}

		const { startWib, endWibExclusive } = resolveAdminOrdersDateRange(dateFilter, customStartDate, customEndDate);
		if (startWib) {
			whereClauses.push("datetime(created_at, '+7 hours') >= ?");
			whereBindings.push(startWib);
		}
		if (endWibExclusive) {
			whereClauses.push("datetime(created_at, '+7 hours') < ?");
			whereBindings.push(endWibExclusive);
		}

		const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

		const totalsRow = await withD1Retry(
			() => c.env.DB.prepare(
				`SELECT
					COUNT(*) AS total,
					SUM(CASE WHEN pickup_status != 'SUDAH_DIAMBIL' THEN 1 ELSE 0 END) AS pending_pickup_total
				FROM orders
				${whereSql}`
			)
				.bind(...whereBindings)
				.first(),
			{ label: 'admin.orders.total', environment: resolveEnvironmentMode(c.env) }
		) as CountRow | null;
		const total = Number(totalsRow?.total || 0);
		const pendingPickupTotal = Number((totalsRow as Record<string, unknown> | null)?.pending_pickup_total || 0);
		const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

		const { results: ordersRows } = await withD1Retry(
			() => c.env.DB.prepare(
				`SELECT
					id,
					customer_name,
					customer_class,
					wa_number,
					pickup_time,
					total_amount,
					fee,
					payment_status,
					pickup_status,
					picked_up_at,
					created_at
				FROM orders
				${whereSql}
				ORDER BY created_at ${sortSql}
				LIMIT ? OFFSET ?`
			).bind(...whereBindings, limit, offset).all(),
			{ label: 'admin.orders.page', environment: resolveEnvironmentMode(c.env) }
		);

		if (!ordersRows || ordersRows.length === 0) {
			return c.json({
				success: true,
				data: [],
				meta: {
					page,
					limit,
					total,
					pendingPickupTotal,
					totalPages,
					sort,
					search: searchQuery,
					date_filter: dateFilter,
					hasMore: false
				}
			});
		}

		let itemsRows: unknown[] = [];
		if (includeItems) {
			const orderIds = ordersRows.map((order) => readStringProperty(order, 'id')).filter(Boolean);
			itemsRows = await loadAdminOrderItemsByOrderIds({
				env: c.env,
				orderIds,
				includePriceAtPurchase: true,
				label: 'admin.orders.items',
				environment: resolveEnvironmentMode(c.env)
			});
		}

		const orders = hydrateAdminOrders(ordersRows, itemsRows);

		return c.json({
			success: true,
			data: orders,
			meta: {
				page,
				limit,
				total,
				pendingPickupTotal,
				totalPages,
				sort,
				search: searchQuery,
				date_filter: dateFilter,
				include_items: includeItems,
				hasMore: page * limit < total
			}
		});
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal mengambil daftar pesanan admin', {
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-ADMIN-ORDERS-DB', 'Gagal memuat data pesanan.'), 500);
	}
});

/**
 * Mengambil dataset analytics order dalam satu request (tanpa loop pagination di frontend).
 * Dataset ini dipakai khusus untuk tab statistik admin.
 */
adminRoutes.get('/orders/analytics', async (c) => {
	try {
		await ensureOrderPickupSchema(c.env);
		await ensureOrderItemSchema(c.env);

		const limit = parsePositiveInt(c.req.query('limit'), 5000, 1, 10000);
		const dateFilter = String(c.req.query('date_filter') || 'all').trim().toLowerCase();
		const customStartDate = String(c.req.query('start_date') || '').trim();
		const customEndDate = String(c.req.query('end_date') || '').trim();

		const whereClauses: string[] = [];
		const whereBindings: Array<string> = [];
		const { startWib, endWibExclusive } = resolveAdminOrdersDateRange(dateFilter, customStartDate, customEndDate);
		if (startWib) {
			whereClauses.push("datetime(created_at, '+7 hours') >= ?");
			whereBindings.push(startWib);
		}
		if (endWibExclusive) {
			whereClauses.push("datetime(created_at, '+7 hours') < ?");
			whereBindings.push(endWibExclusive);
		}
		const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

		const totalRow = await withD1Retry(
			() => c.env.DB.prepare(`SELECT COUNT(*) AS total FROM orders ${whereSql}`)
				.bind(...whereBindings)
				.first(),
			{ label: 'admin.orders.analytics.total', environment: resolveEnvironmentMode(c.env) }
		) as CountRow | null;
		const total = Number(totalRow?.total || 0);
		const { results: ordersRows } = await withD1Retry(
			() => c.env.DB.prepare(
				`SELECT
					id,
					customer_name,
					customer_class,
					wa_number,
					pickup_time,
					total_amount,
					fee,
					pickup_status,
					picked_up_at,
					created_at
				FROM orders
				${whereSql}
				ORDER BY created_at DESC
				LIMIT ?`
			).bind(...whereBindings, limit).all(),
			{ label: 'admin.orders.analytics.orders', environment: resolveEnvironmentMode(c.env) }
		);
		const orderIds = (Array.isArray(ordersRows) ? ordersRows : [])
			.map((row) => readStringProperty(row, 'id'))
			.filter(Boolean);
		const itemsByOrderId = new Map<string, Array<{ product_name: string; product_code_snapshot: string; quantity: number }>>();

		if (orderIds.length > 0) {
			const itemsRows = await loadAdminOrderItemsByOrderIds({
				env: c.env,
				orderIds,
				label: 'admin.orders.analytics.items',
				environment: resolveEnvironmentMode(c.env)
			});
			for (const rawItem of itemsRows) {
				if (!isRecord(rawItem)) continue;
				const orderId = readStringProperty(rawItem, 'order_id');
				if (!orderId) continue;
				const list = itemsByOrderId.get(orderId) || [];
				list.push({
					product_name: readStringProperty(rawItem, 'product_name'),
					product_code_snapshot: readStringProperty(rawItem, 'product_code_snapshot'),
					quantity: Number(rawItem.quantity || 0)
				});
				itemsByOrderId.set(orderId, list);
			}
		}

		const rows = Array.isArray(ordersRows) ? ordersRows : [];
		const data = rows.map((row) => {
			const orderId = readStringProperty(row, 'id');
			const rowRecord: Record<string, unknown> = isRecord(row) ? row : {};
			return {
				id: orderId,
				customer_name: readStringProperty(row, 'customer_name'),
				customer_class: readStringProperty(row, 'customer_class'),
				wa_number: readStringProperty(row, 'wa_number'),
				pickup_time: readStringProperty(row, 'pickup_time'),
				total_amount: Number(rowRecord.total_amount || 0),
				fee: Number(rowRecord.fee || 0),
				pickup_status: readStringProperty(row, 'pickup_status') || 'BELUM_DIAMBIL',
				picked_up_at: rowRecord.picked_up_at ? toIsoUtcTimestamp(rowRecord.picked_up_at) : null,
				created_at: readStringProperty(row, 'created_at') || null,
				items: itemsByOrderId.get(orderId) || []
			};
		});
		return c.json({
			success: true,
			data,
			meta: {
				date_filter: dateFilter,
				start_date: customStartDate || null,
				end_date: customEndDate || null,
				total,
				limit,
				truncated: total > data.length
			}
		});
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal mengambil analytics pesanan admin', {
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-ADMIN-ANALYTICS-DB', 'Gagal memuat data statistik pesanan.'), 500);
	}
});

/**
 * Menandai status pengambilan order sebagai sudah diambil secara final.
 */
adminRoutes.post('/orders/:id/pickup', handleAdminMarkOrderPickedUp);

/**
 * Mengambil daftar produk beserta metrik stok asli, reservasi aktif, dan stok tersedia.
 */
adminRoutes.get('/products', handleAdminListProducts);

/**
 * Menambahkan produk baru ke katalog.
 */
adminRoutes.post('/products', handleAdminCreateProduct);

/**
 * Memperbarui data produk yang sudah ada.
 */
adminRoutes.put('/products/:id', handleAdminUpdateProduct);

/**
 * Menghapus produk yang sudah tidak dipakai.
 */
adminRoutes.delete('/products/:id', handleAdminDeleteProduct);

/**
 * Mengunggah gambar produk ke R2.
 */
adminRoutes.post('/products/upload', adminUploadImageRateLimit, handleAdminUploadProductImage);

export default adminRoutes;
