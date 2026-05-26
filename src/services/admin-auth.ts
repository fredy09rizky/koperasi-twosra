import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as bcrypt from 'bcryptjs';
import {
	generateAdminSessionId,
	generateJwtToken,
	resolveJwtSecret,
	verifyAdminJwtToken
} from '../middleware/auth.js';
import { ensureAdminSessionSchema } from '../utils/admin-session-schema.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { toWibDisplayTimestamp } from '../utils/log.js';
import { getClientIp, summarizeUserAgent } from '../utils/request-meta.js';
import { getErrorMessage, isRecord, readStringProperty } from '../utils/type-safe.js';
import {
	buildAdminError,
	getAdminRequestLogger,
	queueAdminOperationalLog,
	resolveAdminEnvironmentMode,
	type AdminContext
} from './admin-common.js';

type AdminAuthUserRow = {
	id?: number;
	username?: string;
	password_hash?: string;
	active_session_id?: string | null;
	session_last_login_ip?: string | null;
	session_last_login_device?: string | null;
	session_last_login_at?: string | null;
	created_at?: string | null;
};

export async function handleAdminLogin(c: AdminContext) {
	try {
		await ensureAdminSessionSchema(c.env);
		const logger = getAdminRequestLogger(c);
		let loginBody: Record<string, unknown>;
		try {
			const rawBody = await c.req.json();
			loginBody = isRecord(rawBody) ? rawBody : {};
		} catch (parseError) {
			logger.warn('Admin login rejected due to invalid JSON body', {
				error: getErrorMessage(parseError),
			});
			return c.json(buildAdminError('E-ADMIN-LOGIN-JSON', 'Format JSON tidak valid.'), 400);
		}
		const username = readStringProperty(loginBody, 'username');
		const password = typeof loginBody.password === 'string' ? loginBody.password : '';
		const safeUsername = String(username || '').trim().slice(0, 80) || '-';

		if (!username || !password) {
			return c.json(buildAdminError('E-ADMIN-LOGIN-REQUIRED', 'Username dan sandi wajib diisi.'), 400);
		}

		const user = await withD1Retry(
			() => c.env.DB.prepare(
				`SELECT id, username, password_hash, active_session_id, session_last_login_ip,
				        session_last_login_device, session_last_login_at, created_at
				 FROM admin_users
				 WHERE username = ?`
			)
				.bind(username)
				.first(),
			{ label: 'admin.login.load-user', environment: resolveAdminEnvironmentMode(c.env) }
		) as AdminAuthUserRow | null;

		if (!user) {
			queueAdminOperationalLog(c, 'Log Admin: login gagal', [
				`Username: ${safeUsername}`,
				`Alasan: username tidak ditemukan`
			]);
			return c.json(buildAdminError('E-ADMIN-LOGIN-INVALID', 'Username atau sandi salah.'), 401);
		}

		const storedUsername = String(user.username || '');
		const passwordHash = String(user.password_hash || '');
		const isValid = await bcrypt.compare(password, passwordHash);

		if (!isValid) {
			queueAdminOperationalLog(c, 'Log Admin: login gagal', [
				`Username: ${safeUsername}`,
				`Alasan: sandi tidak cocok`
			]);
			return c.json(buildAdminError('E-ADMIN-LOGIN-INVALID', 'Username atau sandi salah.'), 401);
		}

		let secret = '';
		try {
			secret = resolveJwtSecret(c.env);
		} catch {
			return c.json(buildAdminError('E-ADMIN-LOGIN-CONFIG', 'Konfigurasi autentikasi server tidak valid.'), 500);
		}

		const sessionId = generateAdminSessionId();
		const loginIp = getClientIp(c.req.raw.headers);
		const loginDevice = summarizeUserAgent(c.req.raw.headers);
		await withD1Retry(
			() => c.env.DB.prepare(
				`UPDATE admin_users
				 SET active_session_id = ?,
				     session_last_login_ip = ?,
				     session_last_login_device = ?,
				     session_last_login_at = CURRENT_TIMESTAMP
				 WHERE username = ?`
			).bind(sessionId, loginIp, loginDevice, storedUsername).run(),
			{ label: 'admin.login.update-active-session', environment: resolveAdminEnvironmentMode(c.env) }
		);

		const token = await generateJwtToken(storedUsername, sessionId, secret);
		const isSecure = new URL(c.req.url).protocol === 'https:';
		setCookie(c, 'admin_token', token, {
			httpOnly: true,
			secure: isSecure,
			sameSite: 'Strict',
			path: '/',
			maxAge: 60 * 60
		});

		queueAdminOperationalLog(c, 'Log Admin: login berhasil', [
			`Username: ${String(user.username || safeUsername)}`,
			`Session Cookie: admin_token`,
			`Durasi sesi: 1 jam`,
			`Perangkat login: ${loginDevice}`,
			`IP login: ${loginIp}`,
			`Waktu login WIB: ${toWibDisplayTimestamp(new Date().toISOString())}`
		]);
		const previousSessionId = String(user?.active_session_id || '').trim();
		if (previousSessionId && previousSessionId !== sessionId) {
			queueAdminOperationalLog(c, 'Log Admin: sesi lama di-kick', [
				`Username: ${String(user.username || safeUsername)}`,
				`Perangkat login baru: ${loginDevice}`,
				`IP login baru: ${loginIp}`,
				`Waktu login baru WIB: ${toWibDisplayTimestamp(new Date().toISOString())}`
			]);
		}

		return c.json({
			success: true,
			message: 'Login admin berhasil'
		});
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Percobaan masuk (login) gagal', {
			error: getErrorMessage(error),
		});
		queueAdminOperationalLog(c, 'Log Admin: login error sistem', [
			`Username: gagal dibaca`,
			`Alasan: exception saat proses login`
		]);
		return c.json(buildAdminError('E-ADMIN-LOGIN-SYSTEM', 'Terjadi kesalahan sistem internal.'), 500);
	}
}

export async function handleAdminLogout(c: AdminContext) {
	try {
		await ensureAdminSessionSchema(c.env);
		const token = String(getCookie(c, 'admin_token') || '').trim();
		if (token) {
			let secret = '';
			try {
				secret = resolveJwtSecret(c.env);
			} catch {
				secret = '';
			}

			if (secret) {
				const payload = await verifyAdminJwtToken(token, secret);
				const username = String(payload?.sub || '').trim();
				const sessionId = String(payload?.sid || '').trim();

				if (username && sessionId) {
					const result = await withD1Retry(
						() => c.env.DB.prepare(
							`UPDATE admin_users
							 SET active_session_id = NULL
							 WHERE username = ? AND active_session_id = ?`
						).bind(username, sessionId).run(),
						{ label: 'admin.logout.clear-active-session', environment: resolveAdminEnvironmentMode(c.env) }
					);
					if (Number(result?.meta?.changes || 0) > 0) {
						queueAdminOperationalLog(c, 'Log Admin: logout manual', [
							`Username: ${username}`,
							`Perangkat logout: ${summarizeUserAgent(c.req.raw.headers)}`,
							`IP logout: ${getClientIp(c.req.raw.headers)}`
						]);
					}
				}
			}
		}
	} catch {
		// Logout tetap fail-safe: jika update sesi gagal, cookie tetap dihapus.
	}
	deleteCookie(c, 'admin_token', { path: '/' });
	return c.json({ success: true, message: 'Logout berhasil' });
}
