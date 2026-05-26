import { deleteCookie } from 'hono/cookie';
import * as bcrypt from 'bcryptjs';
import { ensureAdminSessionSchema } from '../utils/admin-session-schema.js';
import { toWibDisplayTimestamp } from '../utils/log.js';
import { getClientIp, summarizeUserAgent } from '../utils/request-meta.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { getErrorMessage, isRecord, readStringProperty } from '../utils/type-safe.js';
import {
	buildAdminError,
	getAdminRequestLogger,
	queueAdminOperationalLog,
	resolveAdminEnvironmentMode,
	type AdminContext
} from './admin-common.js';

const ADMIN_PASSWORD_MIN = 12;

type AdminPasswordUserRow = {
	username?: string;
	password_hash?: string;
};

function validateAdminNewPassword(username: string, nextPasswordRaw: unknown) {
	const nextPassword = String(nextPasswordRaw || '');
	if (!nextPassword) {
		return buildAdminError('E-ADMIN-PASSWORD-NEW-REQUIRED', 'Password baru wajib diisi.');
	}
	if (/\s/.test(nextPassword)) {
		return buildAdminError('E-ADMIN-PASSWORD-WHITESPACE', 'Password baru tidak boleh mengandung spasi.');
	}
	if (nextPassword.length < ADMIN_PASSWORD_MIN) {
		return buildAdminError(
			'E-ADMIN-PASSWORD-LENGTH',
			`Password baru minimal ${ADMIN_PASSWORD_MIN} karakter.`
		);
	}
	if (!/[A-Z]/.test(nextPassword)) {
		return buildAdminError('E-ADMIN-PASSWORD-UPPER', 'Password baru wajib mengandung huruf besar.');
	}
	if (!/[a-z]/.test(nextPassword)) {
		return buildAdminError('E-ADMIN-PASSWORD-LOWER', 'Password baru wajib mengandung huruf kecil.');
	}
	if (!/[0-9]/.test(nextPassword)) {
		return buildAdminError('E-ADMIN-PASSWORD-DIGIT', 'Password baru wajib mengandung angka.');
	}
	if (!/[^A-Za-z0-9]/.test(nextPassword)) {
		return buildAdminError('E-ADMIN-PASSWORD-SYMBOL', 'Password baru wajib mengandung simbol.');
	}
	if (username && nextPassword.toLowerCase().includes(username.toLowerCase())) {
		return buildAdminError('E-ADMIN-PASSWORD-USERNAME', 'Password baru tidak boleh mengandung username.');
	}
	return null;
}

export async function handleAdminChangePassword(c: AdminContext) {
	try {
		await ensureAdminSessionSchema(c.env);
		const logger = getAdminRequestLogger(c);

		const username = readStringProperty(c.get('jwtPayload'), 'sub');
		if (!username) {
			return c.json({ success: false, message: 'Sesi tidak valid atau telah berakhir (Unauthorized)' }, 401);
		}

		let body: Record<string, unknown>;
		try {
			const rawBody = await c.req.json();
			body = isRecord(rawBody) ? rawBody : {};
		} catch (parseError) {
			logger.warn('Admin change-password rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json(buildAdminError('E-ADMIN-PASSWORD-JSON', 'Format JSON tidak valid.'), 400);
		}
		const currentPassword = typeof body.current_password === 'string' ? body.current_password : String(body.current_password || '');
		const newPassword = typeof body.new_password === 'string' ? body.new_password : String(body.new_password || '');
		const confirmPassword = typeof body.confirm_password === 'string' ? body.confirm_password : String(body.confirm_password || '');

		if (!currentPassword) {
			return c.json(buildAdminError('E-ADMIN-PASSWORD-CURRENT-REQUIRED', 'Password lama wajib diisi.'), 400);
		}
		if (!newPassword) {
			return c.json(buildAdminError('E-ADMIN-PASSWORD-NEW-REQUIRED', 'Password baru wajib diisi.'), 400);
		}
		if (!confirmPassword) {
			return c.json(buildAdminError('E-ADMIN-PASSWORD-CONFIRM-REQUIRED', 'Konfirmasi password baru wajib diisi.'), 400);
		}
		if (newPassword !== confirmPassword) {
			return c.json(buildAdminError('E-ADMIN-PASSWORD-CONFIRM-MISMATCH', 'Konfirmasi password baru tidak cocok.'), 400);
		}
		if (newPassword === currentPassword) {
			return c.json(buildAdminError('E-ADMIN-PASSWORD-SAME-AS-OLD', 'Password baru tidak boleh sama dengan password lama.'), 400);
		}

		const policyError = validateAdminNewPassword(username, newPassword);
		if (policyError) {
			return c.json(policyError, 400);
		}

		const user = await withD1Retry(
			() => c.env.DB.prepare(
				'SELECT username, password_hash FROM admin_users WHERE username = ?'
			).bind(username).first(),
			{ label: 'admin.change-password.load-user', environment: resolveAdminEnvironmentMode(c.env) }
		) as AdminPasswordUserRow | null;
		if (!user) {
			return c.json({ success: false, message: 'Sesi tidak valid atau telah berakhir (Unauthorized)' }, 401);
		}

		const currentMatches = await bcrypt.compare(currentPassword, String(user.password_hash || ''));
		if (!currentMatches) {
			queueAdminOperationalLog(c, 'Log Admin: ganti password gagal', [
				`Username: ${username}`,
				`Alasan: password lama tidak cocok`,
			]);
			return c.json(buildAdminError('E-ADMIN-PASSWORD-CURRENT-INVALID', 'Password lama tidak cocok.'), 400);
		}

		const nextMatchesCurrentHash = await bcrypt.compare(newPassword, String(user.password_hash || ''));
		if (nextMatchesCurrentHash) {
			return c.json(buildAdminError('E-ADMIN-PASSWORD-SAME-AS-OLD', 'Password baru tidak boleh sama dengan password lama.'), 400);
		}

		const nextPasswordHash = await bcrypt.hash(newPassword, 10);
		await withD1Retry(
			() => c.env.DB.prepare(
				`UPDATE admin_users
				 SET password_hash = ?,
				     active_session_id = NULL
				 WHERE username = ?`
			).bind(nextPasswordHash, username).run(),
			{ label: 'admin.change-password.update-password', environment: resolveAdminEnvironmentMode(c.env) }
		);

		queueAdminOperationalLog(c, 'Log Admin: password berhasil diubah', [
			`Username: ${username}`,
			`Perangkat aksi: ${summarizeUserAgent(c.req.raw.headers)}`,
			`IP aksi: ${getClientIp(c.req.raw.headers)}`,
			`Aksi sistem: semua sesi admin aktif diinvalidasi`,
			`Waktu perubahan WIB: ${toWibDisplayTimestamp(new Date().toISOString())}`
		]);

		deleteCookie(c, 'admin_token', { path: '/' });
		return c.json({
			success: true,
			message: 'Password berhasil diubah. Silakan login ulang.'
		});
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal mengubah password admin', {
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-ADMIN-PASSWORD-UPDATE', 'Gagal mengubah password admin.'), 500);
	}
}
