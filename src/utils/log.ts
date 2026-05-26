// Shared logging utilities.
// Helper ini sebelumnya terduplikasi di beberapa route file.

/**
 * Sanitasi nilai untuk log agar tidak terlalu panjang atau mengandung karakter aneh.
 */
export function sanitizeLogValue(value: unknown, maxLength = 220): string {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxLength);
}

/**
 * Format durasi window rate limit ke label yang mudah dibaca.
 */
export function formatWindowLabel(windowMs: number): string {
	const minutes = windowMs / 60000;
	return Number.isInteger(minutes) ? `${minutes} menit` : `${windowMs} ms`;
}

/**
 * Normalisasi timestamp ke ISO UTC dengan suffix `Z`.
 */
export function toIsoUtcTimestamp(value: unknown): string {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const normalized = raw.replace(' ', 'T');
	const hasTimezone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized);
	return hasTimezone ? normalized : `${normalized}Z`;
}

/**
 * Format timestamp ke WIB untuk tampilan manusia.
 * Output: 13 Apr 2026, 14:35:20 WIB
 */
export function toWibDisplayTimestamp(value: unknown): string {
	const iso = toIsoUtcTimestamp(value);
	if (!iso) return '-';

	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '-';

	const parts = new Intl.DateTimeFormat('id-ID', {
		timeZone: 'Asia/Jakarta',
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	}).formatToParts(date);

	const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '';
	const day = getPart('day');
	const month = getPart('month');
	const year = getPart('year');
	const hour = getPart('hour');
	const minute = getPart('minute');
	const second = getPart('second');

	if (!day || !month || !year || !hour || !minute || !second) return '-';
	return `${day} ${month} ${year}, ${hour}:${minute}:${second} WIB`;
}

/**
 * Masking token untuk log operasional — hanya tampilkan 12 karakter pertama + ellipsis.
 * Checkout token adalah kredensial sesi; log cukup memuat trace prefix, bukan token penuh.
 * 12 karakter (48-bit) sudah cukup untuk korelasi log tanpa bisa di-replay.
 */
export function maskToken(token: unknown): string {
	const raw = String(token ?? '').trim();
	if (!raw) return '-';
	if (raw.length <= 12) return raw;
	return `${raw.slice(0, 12)}…`;
}
