import { toIsoUtcTimestamp } from '../utils/log.js';
import { ensureStoreStatusSchema, getStoreStatusAdminSummary, updateStoreStatus } from '../utils/store-status.js';
import { getErrorMessage, isRecord, readStringProperty } from '../utils/type-safe.js';
import {
	buildAdminError,
	getAdminRequestLogger,
	queueAdminOperationalLog,
	type AdminContext
} from './admin-common.js';

export async function handleAdminGetStoreStatus(c: AdminContext) {
	try {
		await ensureStoreStatusSchema(c.env);
		const summary = await getStoreStatusAdminSummary(c.env);

		return c.json({
			success: true,
			data: {
				accepting_orders: summary.accepting_orders,
				updated_at: summary.updated_at ? toIsoUtcTimestamp(summary.updated_at) : null,
				updated_by: summary.updated_by,
				active_checkout_count: summary.active_checkout_count,
				active_qris_count: summary.active_qris_count
			}
		});
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal mengambil status operasional web admin', {
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-STORE-STATUS-GET', 'Gagal memuat status operasional web.'), 500);
	}
}

export async function handleAdminUpdateStoreStatus(c: AdminContext) {
	try {
		await ensureStoreStatusSchema(c.env);
		const logger = getAdminRequestLogger(c);
		let body: Record<string, unknown>;
		try {
			const rawBody = await c.req.json();
			body = isRecord(rawBody) ? rawBody : {};
		} catch (parseError) {
			logger.warn('Admin store-status update rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json(buildAdminError('E-STORE-STATUS-JSON', 'Format JSON tidak valid.'), 400);
		}
		if (typeof body.accepting_orders !== 'boolean') {
			return c.json(buildAdminError('E-STORE-STATUS-INVALID', 'Status operasional web tidak valid.'), 400);
		}

		const updatedBy = readStringProperty(c.get('jwtPayload'), 'sub').slice(0, 80);
		const nextAcceptingOrders = Boolean(body.accepting_orders);
		const updated = await updateStoreStatus(c.env, nextAcceptingOrders, updatedBy || null);
		const counts = await getStoreStatusAdminSummary(c.env);

		queueAdminOperationalLog(c, 'Log Admin: status penerimaan pesanan diperbarui', [
			`Status baru: ${nextAcceptingOrders ? 'BUKA' : 'TUTUP'}`,
			`Diubah oleh: ${updatedBy || '-'}`,
			`Checkout aktif saat perubahan: ${counts.active_checkout_count}`,
			`QRIS aktif saat perubahan: ${counts.active_qris_count}`
		]);

		return c.json({
			success: true,
			message: nextAcceptingOrders
				? 'Web kembali menerima pesanan baru.'
				: 'Web berhenti menerima pesanan baru.',
			data: {
				accepting_orders: updated.accepting_orders,
				updated_at: updated.updated_at ? toIsoUtcTimestamp(updated.updated_at) : null,
				updated_by: updated.updated_by,
				active_checkout_count: counts.active_checkout_count,
				active_qris_count: counts.active_qris_count
			}
		});
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal memperbarui status operasional web admin', {
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-STORE-STATUS-UPDATE', 'Gagal memperbarui status operasional web.'), 500);
	}
}
