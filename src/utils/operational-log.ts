import { resolveTelegramConfig, sendOperationalLog, getTelegramTopicId } from './telegram.js';
import { getRequestMetaLines } from './request-meta.js';

// Operasional log utilities untuk route public.
// Route payment dan admin punya queueOperationalLog sendiri karena routing topic Telegram berbeda.

/**
 * Tentukan topic Telegram untuk log publik (order vs security).
 */
function getPublicTelegramTopic(c: any, title: string): number | null {
	try {
		const config = resolveTelegramConfig(c.env);
		if (title.startsWith('Security Alert:') || title.startsWith('Incident:') || title.startsWith('Rate Limit:')) {
			return getTelegramTopicId(config, 'security');
		}
		return getTelegramTopicId(config, 'order');
	} catch {
		return null;
	}
}

/**
 * Buat promise log operasional yang non-blocking.
 * Dipakai oleh route public.ts untuk order dan security log.
 */
export function createOperationalLogPromise(
	c: any,
	title: string,
	lines: string[]
): Promise<void> | null {
	try {
		const { token, chatId } = resolveTelegramConfig(c.env);
		const logPromise = sendOperationalLog(token, chatId, getPublicTelegramTopic(c, title), {
			title,
			lines: [...lines, ...getRequestMetaLines(c.req.raw.headers)]
		}, c.env?.ENVIRONMENT);
		if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
			c.executionCtx.waitUntil(logPromise);
		} else {
			void logPromise;
		}
		return logPromise;
	} catch {
		return null;
	}
}
