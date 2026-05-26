import { ensureOrderPickupSchema } from '../utils/order-pickup-schema.js';
import { toIsoUtcTimestamp } from '../utils/log.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { getErrorMessage } from '../utils/type-safe.js';
import {
	buildAdminError,
	getAdminRequestLogger,
	resolveAdminEnvironmentMode,
	type AdminContext
} from './admin-common.js';

type PickupOrderRow = {
	id?: string;
	pickup_status?: string | null;
	picked_up_at?: string | null;
};

export async function handleAdminMarkOrderPickedUp(c: AdminContext) {
	try {
		await ensureOrderPickupSchema(c.env);

		const orderId = String(c.req.param('id') || '').trim();
		if (!orderId) {
			return c.json(buildAdminError('E-ORDER-ID-REQUIRED', 'ID transaksi wajib diisi.'), 400);
		}

		const order = await withD1Retry(
			() => c.env.DB.prepare(
				'SELECT id, pickup_status, picked_up_at FROM orders WHERE id = ?'
			).bind(orderId).first(),
			{ label: 'admin.pickup.load-order', environment: resolveAdminEnvironmentMode(c.env) }
		) as PickupOrderRow | null;

		if (!order) {
			return c.json(buildAdminError('E-ORDER-NOT-FOUND', 'Pesanan tidak ditemukan.'), 404);
		}

		if (String(order?.pickup_status || 'BELUM_DIAMBIL') === 'SUDAH_DIAMBIL') {
			return c.json(
				buildAdminError(
					'E-ORDER-PICKUP-FINAL',
					'Status pengambilan sudah final dan tidak dapat dikembalikan.'
				),
				409
			);
		}

		const updateResult = await withD1Retry(
			() => c.env.DB.prepare(
				`UPDATE orders
				 SET pickup_status = 'SUDAH_DIAMBIL',
				     picked_up_at = CURRENT_TIMESTAMP
				 WHERE id = ?
				   AND pickup_status = 'BELUM_DIAMBIL'`
			).bind(orderId).run(),
			{ label: 'admin.pickup.update-order', environment: resolveAdminEnvironmentMode(c.env) }
		);

		if (!Number(updateResult.meta?.changes || 0)) {
			return c.json(
				buildAdminError(
					'E-ORDER-PICKUP-FINAL',
					'Status pengambilan sudah final dan tidak dapat dikembalikan.'
				),
				409
			);
		}

		const updatedOrder = await withD1Retry(
			() => c.env.DB.prepare(
				'SELECT id, pickup_status, picked_up_at FROM orders WHERE id = ?'
			).bind(orderId).first(),
			{ label: 'admin.pickup.load-updated-order', environment: resolveAdminEnvironmentMode(c.env) }
		) as PickupOrderRow | null;

		return c.json({
			success: true,
			message: 'Status pengambilan berhasil ditandai final.',
			data: {
				id: String(updatedOrder?.id || orderId),
				pickup_status: String(updatedOrder?.pickup_status || 'SUDAH_DIAMBIL'),
				picked_up_at: updatedOrder?.picked_up_at ? toIsoUtcTimestamp(updatedOrder?.picked_up_at) : null
			}
		});
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal memperbarui status pengambilan order', {
			orderId: String(c.req.param('id') || '').trim(),
			error: getErrorMessage(error),
		});
		return c.json(
			buildAdminError('E-ORDER-PICKUP-UPDATE', 'Gagal memperbarui status pengambilan pesanan.'),
			500
		);
	}
}
