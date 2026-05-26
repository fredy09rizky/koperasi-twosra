import type { Context } from 'hono';
import type { Bindings } from '../types/bindings.js';
import { createLogger, resolveEnvironmentMode } from '../utils/logger.js';
import { getRequestMetaLines } from '../utils/request-meta.js';
import { getTelegramTopicId, resolveTelegramConfig, sendOperationalLog } from '../utils/telegram.js';

export type AdminContext = Context<{ Bindings: Bindings }>;

export { resolveEnvironmentMode as resolveAdminEnvironmentMode };

export function getAdminRequestLogger(c: AdminContext) {
	const loggerFromContext = c.get?.('logger');
	if (loggerFromContext) return loggerFromContext;
	return createLogger({
		service: 'koperasi-backend',
		environment: resolveEnvironmentMode(c.env),
	});
}

export function buildAdminError(code: string, message: string) {
	return {
		success: false,
		code,
		message: `${code}: ${message}`
	};
}

export function queueAdminOperationalLog(
	c: AdminContext,
	title: string,
	lines: string[]
) {
	try {
		const config = resolveTelegramConfig(c.env);
		const topicName = (
			title.startsWith('Security Alert:')
			|| title.startsWith('Incident:')
			|| title.startsWith('Rate Limit:')
		) ? 'security' : 'admin';
		const logPromise = sendOperationalLog(config.token, config.chatId, getTelegramTopicId(config, topicName), {
			title,
			lines: [...lines, ...getRequestMetaLines(c.req.raw.headers)]
		}, resolveEnvironmentMode(c.env));
		if (c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
			c.executionCtx.waitUntil(logPromise);
		} else {
			void logPromise;
		}
	} catch {
		// Log admin tidak boleh menggagalkan operasi utama.
	}
}
