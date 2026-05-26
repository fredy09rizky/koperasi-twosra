import { formatRupiah } from '../utils/format.js';
import { createLogger, normalizeEnvironment, type AppEnvironment } from './logger.js';

// Util Telegram dipakai lintas route (`public.ts`, `payment.ts`, `admin.ts`) untuk
// menyamakan format notifikasi order, security alert, dan log operasional.

type TelegramTopicName = 'order' | 'security' | 'admin';

type TelegramTopicConfig = {
	order: number | null;
	security: number | null;
	admin: number | null;
};

type TelegramConfig = {
	token: string;
	chatId: string;
	topics: TelegramTopicConfig;
};

const TELEGRAM_TIMEOUT_MS = 5000;
const TELEGRAM_MAX_ATTEMPTS = 2; // 1 kirim awal + 1 retry

export function resolveTelegramConfig(env: {
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_CHAT_ID: string;
	TELEGRAM_TOPIC_ORDER: string;
	TELEGRAM_TOPIC_SECURITY: string;
	TELEGRAM_TOPIC_ADMIN: string;
}): TelegramConfig {
	// Semua route memanggil helper ini agar validasi env Telegram konsisten
	// dan tidak perlu mengulang parse topic id di banyak file.
	const parseThreadId = (value: unknown): number | null => {
		const parsed = Number(String(value || '').trim());
		return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
	};

	const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
	const chatId = String(env.TELEGRAM_CHAT_ID || '').trim();
	const orderTopic = parseThreadId(env.TELEGRAM_TOPIC_ORDER);
	const securityTopic = parseThreadId(env.TELEGRAM_TOPIC_SECURITY);
	const adminTopic = parseThreadId(env.TELEGRAM_TOPIC_ADMIN);
	if (!token || !chatId || !orderTopic || !securityTopic || !adminTopic) {
		throw new Error('TELEGRAM_CONFIG_MISSING');
	}
	return {
		token,
		chatId,
		topics: {
			order: orderTopic,
			security: securityTopic,
			admin: adminTopic
		}
	};
}

export function getTelegramTopicId(config: TelegramConfig, topicName: TelegramTopicName): number | null {
	return config.topics[topicName];
}

function escapeTelegramMarkdown(value: unknown): string {
	const raw = String(value ?? '');
	return raw
		.replace(/\\/g, '\\\\')
		.replace(/_/g, '\\_')
		.replace(/\*/g, '\\*')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]')
		.replace(/\(/g, '\\(')
		.replace(/\)/g, '\\)')
		.replace(/`/g, '\\`');
}

function shouldRetryHttp(status: number): boolean {
	return status === 429 || status >= 500;
}

function shouldRetryError(error: unknown): boolean {
	const err = error as { name?: string };
	return err?.name === 'AbortError' || error instanceof TypeError;
}

async function waitBeforeRetry(attempt: number): Promise<void> {
	const delayMs = 300 * attempt;
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function sendTelegramMessage(
	telegramToken: string,
	chatId: string,
	text: string,
	messageThreadId?: number | null,
	environment: AppEnvironment = 'development'
): Promise<void> {
	// Satu wrapper kirim Telegram untuk seluruh aplikasi.
	// Retry ringan ditaruh di sini agar route pemanggil tidak perlu tahu detail jaringan Telegram.
	for (let attempt = 1; attempt <= TELEGRAM_MAX_ATTEMPTS; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

		try {
			const payload: Record<string, unknown> = {
				chat_id: chatId,
				text,
				parse_mode: 'Markdown'
			};
			if (Number.isInteger(messageThreadId) && Number(messageThreadId) > 0) {
				payload.message_thread_id = messageThreadId;
			}

			const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: controller.signal
			});
			clearTimeout(timeout);

			if (response.ok) {
				return;
			}

			const responseText = await response.text();
			const retryable = shouldRetryHttp(response.status);
			const canRetry = retryable && attempt < TELEGRAM_MAX_ATTEMPTS;

			const logger = createLogger({
				service: 'koperasi-backend',
				environment: normalizeEnvironment(environment),
			});

			if (canRetry) {
				logger.warn('Telegram API gagal, akan retry', {
					httpStatus: response.status,
					attempt: attempt,
					maxAttempts: TELEGRAM_MAX_ATTEMPTS,
				});
				await waitBeforeRetry(attempt);
				continue;
			}

			logger.error('Gagal kirim pesan telegram (HTTP)', {
				httpStatus: response.status,
				response: responseText.slice(0, 200),
			});
			return;
		} catch (error) {
			clearTimeout(timeout);
			const retryable = shouldRetryError(error);
			const canRetry = retryable && attempt < TELEGRAM_MAX_ATTEMPTS;

			const logger = createLogger({
				service: 'koperasi-backend',
				environment: normalizeEnvironment(environment),
			});

			if (canRetry) {
				logger.warn('Telegram API timeout/network error, akan retry', {
					attempt: attempt,
					maxAttempts: TELEGRAM_MAX_ATTEMPTS,
					error: error instanceof Error ? error.message : String(error),
				});
				await waitBeforeRetry(attempt);
				continue;
			}

			logger.error('Gagal kirim pesan telegram', {
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}
	}
}

function formatOperationalSectionTitle(sectionTitle: string): string {
	switch (sectionTitle) {
		case 'Actor':
			return 'Aktor / Pemesan';
		case 'Order':
			return 'Ringkasan Transaksi';
		case 'Session':
			return 'Sesi Checkout';
		case 'Status':
			return 'Status dan Tindakan';
		case 'Request Meta':
			return 'Asal Request';
		default:
			return 'Lainnya';
	}
}

function formatOperationalLine(line: string): string {
	const readableLabels: Array<[string, string]> = [
		['Order ID:', 'ID Transaksi:'],
		['Amount:', 'Subtotal Barang:'],
		['Session Amount:', 'Subtotal Saat Checkout:'],
		['Client Total:', 'Total dari Browser:'],
		['Server Total:', 'Total dari Server:'],
		['Client Payment Amount:', 'Nominal Bayar dari Browser:'],
		['Server Payment Amount:', 'Nominal Bayar Final Server:'],
		['Client Fee:', 'Fee dari Browser:'],
		['Server Fee:', 'Fee Final Server:'],
		['Total Dibayar:', 'Nominal Bayar Final:'],
		['Fee Gateway:', 'Fee Gateway:'],
		['Recovery window sampai:', 'Batas Recovery:'],
		['Payment Started At:', 'Mulai Menunggu Pembayaran:'],
		['Gateway Expired At:', 'Batas Waktu Gateway:'],
		['Gateway Status:', 'Status Gateway:'],
		['Gateway Status Terakhir:', 'Status Gateway Terakhir:'],
		['Gateway Status Session:', 'Status Gateway pada Session:'],
		['Gateway Status Sebelumnya:', 'Status Gateway Sebelumnya:'],
		['Status sebelumnya:', 'Status Sebelumnya:'],
		['Completed At:', 'Pembayaran Terkonfirmasi Pada:'],
		['HTTP Status Gateway:', 'HTTP Status Gateway:'],
		['HTTP Status Internal:', 'HTTP Status Internal:'],
		['Payload Gateway:', 'Payload Gateway:'],
		['Alasan:', 'Penyebab:'],
		['Pesan Gateway:', 'Pesan Gateway:'],
		['Pesan:', 'Pesan:'],
		['Status baru:', 'Status Baru:'],
		['Checkout aktif saat perubahan:', 'Checkout Aktif Saat Perubahan:'],
		['QRIS aktif saat perubahan:', 'QRIS Aktif Saat Perubahan:'],
		['Aksi sistem:', 'Aksi Sistem:'],
		['Penyebab:', 'Penyebab Teknis:'],
		['Langkah admin:', 'Tindak Lanjut Admin:']
	];

	for (const [prefix, replacement] of readableLabels) {
		if (line.startsWith(prefix)) {
			return `${replacement}${line.slice(prefix.length)}`;
		}
	}

	return line;
}

function buildOperationalSections(lines: string[]): Array<{ title: string; lines: string[] }> {
	// Helper ini mengubah daftar line mentah dari route menjadi blok log yang konsisten.
	// Efeknya, format Telegram tetap enak dipindai walau pengirimnya route yang berbeda-beda.
	const sections = new Map<string, string[]>();
	const orderedSections = ['Actor', 'Order', 'Session', 'Status', 'Request Meta', 'Lainnya'];

	const ensureSection = (sectionTitle: string): string[] => {
		if (!sections.has(sectionTitle)) {
			sections.set(sectionTitle, []);
		}
		return sections.get(sectionTitle)!;
	};

	const resolveSectionTitle = (line: string): string => {
		// Pengelompokan berbasis prefix membuat format log tetap stabil walau detail yang dikirim tiap route bisa berbeda-beda.
		if (
			line.startsWith('Username:') ||
			line.startsWith('Nama:') ||
			line.startsWith('Kelas:') ||
			line.startsWith('No. WA:') ||
			line.startsWith('Diubah oleh:')
		) {
			return 'Actor';
		}

		if (
				line.startsWith('Order ID:') ||
				line.startsWith('Amount:') ||
				line.startsWith('Session Amount:') ||
				line.startsWith('Client Total:') ||
				line.startsWith('Server Total:') ||
				line.startsWith('Client Payment Amount:') ||
				line.startsWith('Server Payment Amount:') ||
				line.startsWith('Client Fee:') ||
				line.startsWith('Server Fee:') ||
				line.startsWith('Total Dibayar:') ||
				line.startsWith('Fee Gateway:') ||
				line.startsWith('Selisih Total:') ||
				line.startsWith('Selisih Payment Amount:') ||
				line.startsWith('Jumlah unit client:') ||
				line.startsWith('Jumlah unit server:') ||
				line.startsWith('Jenis barang:') ||
				line.startsWith('Ringkasan item:') ||
				line.startsWith('Ringkasan item server:') ||
				line.startsWith('Ringkasan item client:') ||
				line.startsWith('Selisih qty:') ||
				line.startsWith('Selisih harga:')
		) {
			return 'Order';
		}

		if (
			line.startsWith('Checkout Token:') ||
			line.startsWith('Status Sesi:') ||
			line.startsWith('Recovery window sampai:') ||
			line.startsWith('Payment Started At:') ||
			line.startsWith('Gateway Expired At:') ||
			line.startsWith('Gateway Status:') ||
			line.startsWith('Gateway Status Terakhir:') ||
			line.startsWith('Gateway Status Session:') ||
			line.startsWith('Gateway Status Sebelumnya:') ||
			line.startsWith('Status sebelumnya:')
		) {
			return 'Session';
		}

		if (
			line.startsWith('Method:') ||
			line.startsWith('Path:') ||
			line.startsWith('Client ID:') ||
			line.startsWith('IP:') ||
			line.startsWith('IP login:') ||
			line.startsWith('IP login baru:') ||
			line.startsWith('IP logout:') ||
			line.startsWith('IP aksi:') ||
			line.startsWith('Device:') ||
			line.startsWith('Perangkat login:') ||
			line.startsWith('Perangkat login baru:') ||
			line.startsWith('Perangkat logout:') ||
			line.startsWith('Perangkat aksi:') ||
			line.startsWith('User-Agent:')
		) {
			return 'Request Meta';
		}

		if (
			line.startsWith('Retry After:') ||
			line.startsWith('Percobaan saat diblokir:') ||
			line.startsWith('Batas:') ||
			line.startsWith('HTTP Status Gateway:') ||
				line.startsWith('HTTP Status Internal:') ||
				line.startsWith('Payload Gateway:') ||
				line.startsWith('Pesan Gateway:') ||
				line.startsWith('Pesan:') ||
				line.startsWith('Completed At:') ||
				line.startsWith('Mode Frontend:') ||
				line.startsWith('Retry Count:') ||
				line.startsWith('Catatan:') ||
				line.startsWith('Alasan:') ||
				line.startsWith('Session Cookie:') ||
				line.startsWith('Durasi sesi:') ||
				line.startsWith('Waktu login WIB:') ||
				line.startsWith('Waktu login baru WIB:') ||
				line.startsWith('Waktu perubahan WIB:') ||
				line.startsWith('Status baru:') ||
				line.startsWith('Checkout aktif saat perubahan:') ||
				line.startsWith('QRIS aktif saat perubahan:') ||
				line.startsWith('Sumber Cancel:') ||
				line.startsWith('Alasan Cancel:') ||
				line.startsWith('Aksi sistem:') ||
				line.startsWith('Penyebab:') ||
				line.startsWith('Keputusan:') ||
				line.startsWith('Langkah admin:')
		) {
			return 'Status';
		}

		return 'Lainnya';
	};

	for (const rawLine of lines) {
		const line = String(rawLine || '').trim();
		if (!line) continue;
		ensureSection(resolveSectionTitle(line)).push(line);
	}

	return orderedSections
		.filter((title) => sections.has(title))
		.map((title) => ({ title, lines: sections.get(title)! }));
}

/**
 * Mengirim notifikasi Telegram untuk pesanan baru.
 */
export async function sendOrderNotification(
	telegramToken: string,
	chatId: string,
	messageThreadId: number | null | undefined,
	data: {
		nama: string;
		kelas: string;
		wa: string;
		id_transaksi: string;
		waktu: string;
		waktu_pembayaran?: string;
		items: Array<{ secure_name: string; quantity: number }>;
		calculatedTotal: number;
		payment_amount?: number;
	},
	environment: AppEnvironment = 'development'
): Promise<void> {
	// Dipanggil oleh `public.ts` setelah order final berhasil dicatat.
	const itemsList = data.items
		.map((item) => `- ${item.quantity}x ${escapeTelegramMarkdown(item.secure_name)}`)
		.join('\n');
	const paymentSummary = data.payment_amount && data.payment_amount > data.calculatedTotal
		? formatRupiah(data.payment_amount)
		: formatRupiah(data.calculatedTotal);

	const messageText =
		`*Pesanan Baru Koperasi (LUNAS QRIS)*\n\n` +
		`*Pemesan*\n` +
		`- Nama: ${escapeTelegramMarkdown(data.nama)}\n` +
		`- Kelas: ${escapeTelegramMarkdown(data.kelas)}\n` +
		`- No. WA: ${escapeTelegramMarkdown(data.wa)}\n\n` +
		`*Transaksi*\n` +
		`- ID Transaksi: \`${escapeTelegramMarkdown(data.id_transaksi)}\`\n` +
		`- Waktu Pembayaran: ${escapeTelegramMarkdown(data.waktu_pembayaran || '-')}\n` +
		`- Jadwal Pengambilan: ${escapeTelegramMarkdown(data.waktu)}\n\n` +
		`*Rincian Barang*\n${itemsList}\n\n` +
		`*Pembayaran*\n` +
		`- Total Barang: ${formatRupiah(data.calculatedTotal)}\n` +
		`- Total Dibayar: ${paymentSummary}\n`;

	await sendTelegramMessage(telegramToken, chatId, messageText, messageThreadId, environment);
}

/**
 * Mengirim log operasional singkat untuk event yang sensitif pada alur payment atau recovery.
 */
export async function sendOperationalLog(
	telegramToken: string,
	chatId: string,
	messageThreadId: number | null | undefined,
	data: {
		title: string;
		lines: string[];
	},
	environment: AppEnvironment = 'development'
): Promise<void> {
	// Ini adalah util Telegram yang paling sering dipakai oleh route payment/public/admin
	// untuk incident, recovery log, rate limit, dan audit permintaan sensitif.
	// Semua event operasional dirender ke struktur bagian tetap agar admin dan developer lebih cepat memindai saat incident.
	const sections = buildOperationalSections(data.lines);
	const details = sections.length > 0
		? sections
			.map((section) => {
				const sectionLines = section.lines
					.map((line) => `- ${escapeTelegramMarkdown(formatOperationalLine(line))}`)
					.join('\n');
				return `*${escapeTelegramMarkdown(formatOperationalSectionTitle(section.title))}*\n${sectionLines}`;
			})
			.join('\n\n')
		: '- Tidak ada detail tambahan';

	const messageText =
		`*${escapeTelegramMarkdown(data.title)}*\n\n` +
		details;

	await sendTelegramMessage(telegramToken, chatId, messageText, messageThreadId, environment);
}
