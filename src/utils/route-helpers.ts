import { createLogger, resolveEnvironmentMode } from './logger.js';

// Helper bersama untuk route handler backend.
// Dipakai oleh public.ts, payment.ts, dan public-order-finalization.ts.
//
// Catatan desain:
// - `getRequestLogger` identik di ketiga file sehingga diekstrak ke sini.
// - `queueOperationalLog` TIDAK diekstrak karena routing topic Telegram-nya berbeda
//   per domain: public.ts memakai `createOperationalLogPromise` (topic ditentukan
//   otomatis dari judul), sedangkan payment.ts memakai `getPaymentTelegramTopic`
//   yang memisahkan 'order' vs 'security' berdasarkan prefix judul yang berbeda.
//   Menyatukan keduanya akan menyembunyikan perbedaan routing yang disengaja itu.

/**
 * Mengambil logger dari request context jika tersedia (dipasang oleh requestLogger middleware),
 * atau membuat logger baru dengan service dan environment dari env binding.
 *
 * Selalu gunakan fungsi ini di route handler — jangan buat `createLogger` langsung
 * agar request ID dari middleware ikut terbawa ke setiap log entry.
 */
export function getRequestLogger(c: { get?: (key: string) => any; env: { ENVIRONMENT?: unknown } }) {
	const loggerFromContext = c.get?.('logger');
	if (loggerFromContext) return loggerFromContext;
	return createLogger({
		service: 'koperasi-backend',
		environment: resolveEnvironmentMode(c.env),
	});
}
