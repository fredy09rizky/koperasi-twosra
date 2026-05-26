import { sign, verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { Bindings, JwtPayload } from '../types/bindings.js';
import { withD1Retry } from '../utils/d1-retry.js';
import { toIsoUtcTimestamp, toWibDisplayTimestamp } from '../utils/log.js';
import { ensureAdminSessionSchema } from '../utils/admin-session-schema.js';
import { readStringProperty } from '../utils/type-safe.js';

type AdminSessionRow = {
	active_session_id?: string | null;
	session_last_login_ip?: string | null;
	session_last_login_device?: string | null;
	session_last_login_at?: string | null;
};

// Middleware/auth helper untuk seluruh area `/api/admin`.
// Dipakai hanya oleh `routes/admin.ts`.
export function resolveJwtSecret(env: Bindings): string {
	// Satu pintu validasi secret agar login dan verifikasi token memakai aturan yang sama.
	const secret = env.JWT_SECRET?.trim();
	if (!secret || secret.length < 32) {
		throw new Error('JWT_SECRET belum ada atau terlalu pendek');
	}
	return secret;
}

function normalizeSessionText(value: unknown, fallback = '-'): string {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

function extractPayloadSessionId(payload: unknown): string {
	return readStringProperty(payload, 'sid');
}

function buildSessionReplacedResponse(row: AdminSessionRow) {
	const loginAtIso = toIsoUtcTimestamp(row?.session_last_login_at);
	return {
		success: false,
		code: 'E-ADMIN-SESSION-REPLACED',
		message: 'Sesi login habis karena akun ini login di perangkat baru.',
		session_replaced_by: {
			device: normalizeSessionText(row?.session_last_login_device, 'Unknown Browser / Unknown Device'),
			ip: normalizeSessionText(row?.session_last_login_ip, 'unknown'),
			login_at: loginAtIso || null,
			login_at_wib: loginAtIso ? toWibDisplayTimestamp(loginAtIso) : '-'
		}
	};
}

async function loadAdminSessionRow(env: Bindings, username: string): Promise<AdminSessionRow | null> {
	return withD1Retry(
		() => env.DB.prepare(
			`SELECT
				active_session_id,
				session_last_login_ip,
				session_last_login_device,
				session_last_login_at
			 FROM admin_users
			 WHERE username = ?`
		).bind(username).first(),
		{ label: 'admin.auth.load-session-row' }
	) as Promise<AdminSessionRow | null>;
}

export async function verifyAdminJwtToken(token: string, secret: string): Promise<JwtPayload | null> {
	try {
		const payload = await verify(token, secret, 'HS256');
		return payload as JwtPayload;
	} catch {
		return null;
	}
}

export function generateAdminSessionId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID().replace(/-/g, '');
	}

	const randomChunk = Math.random().toString(16).slice(2, 18);
	return `${Date.now().toString(16)}${randomChunk}`;
}

/**
 * Middleware autentikasi JWT untuk route admin
 */
export function authMiddleware(): MiddlewareHandler<{ Bindings: Bindings }> {
	return async (c, next) => {
		// Middleware ini boleh dilewati hanya oleh endpoint yang memang bertugas
		// membuat atau menghapus sesi admin.
		// Endpoint login/logout harus tetap bisa diakses meski belum punya sesi admin.
		if (c.req.path === '/api/admin/login' || c.req.path === '/api/admin/logout') {
			await next();
			return;
		}

		let secret = '';
		try {
			secret = resolveJwtSecret(c.env as Bindings);
		} catch {
			return c.json({ success: false, message: 'Konfigurasi autentikasi server tidak valid' }, 500);
		}

		const authHeader = c.req.header('Authorization') || '';
		const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
		const cookieToken = getCookie(c, 'admin_token') || '';
		const token = bearerToken || cookieToken;

		if (!token) {
			return c.json({ success: false, message: 'Sesi tidak valid atau telah berakhir (Unauthorized)' }, 401);
		}

		try {
			const payload = await verify(token, secret, 'HS256');
			const username = readStringProperty(payload, 'sub');
			const sessionId = extractPayloadSessionId(payload);
			if (!username || !sessionId) {
				return c.json({ success: false, message: 'Sesi tidak valid atau telah berakhir (Unauthorized)' }, 401);
			}

			await ensureAdminSessionSchema(c.env as Bindings);
			const row = await loadAdminSessionRow(c.env as Bindings, username);
			if (!row) {
				return c.json({ success: false, message: 'Sesi tidak valid atau telah berakhir (Unauthorized)' }, 401);
			}

			const activeSessionId = String(row?.active_session_id || '').trim();
			if (!activeSessionId || activeSessionId !== sessionId) {
				return c.json(buildSessionReplacedResponse(row), 401);
			}

			c.set('jwtPayload', payload);
			await next();
		} catch {
			// Fail-closed: jika validasi sesi gagal karena error runtime/DB, akses admin tetap ditolak.
			return c.json({ success: false, message: 'Sesi tidak valid atau telah berakhir (Unauthorized)' }, 401);
		}
	};
}

/**
 * Membuat token JWT untuk sesi admin.
 */
export async function generateJwtToken(username: string, sessionId: string, secret: string): Promise<string> {
	// Token berumur 1 jam dan payload-nya sengaja kecil karena hanya dipakai
	// untuk mengidentifikasi sesi admin, bukan menyimpan profil lengkap.
	const payload: JwtPayload = {
		sub: username,
		role: 'admin',
		sid: sessionId,
		exp: Math.floor(Date.now() / 1000) + 60 * 60 // 1 jam
	};

	return sign(payload, secret);
}
