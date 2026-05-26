import type { MiddlewareHandler } from 'hono';
import { createLogger } from '../utils/logger.js';

declare module 'hono' {
	interface ContextVariableMap {
		logger: ReturnType<typeof createLogger>;
		requestId: string;
	}
}

export const requestLogger: MiddlewareHandler = async (c, next) => {
	const requestId = crypto.randomUUID();
	c.set('requestId', requestId);

	const ip = c.req.raw.headers.get('cf-connecting-ip') 
		|| c.req.raw.headers.get('x-forwarded-for') 
		|| 'unknown';

	const userAgent = c.req.raw.headers.get('user-agent') || 'unknown';

	const logger = createLogger({
		service: 'koperasi-backend',
		environment: (c.env?.ENVIRONMENT as 'development' | 'production') || 'development',
		defaultContext: {
			requestId,
			path: c.req.path,
			method: c.req.method,
			ip,
			userAgent,
		},
	});

	c.set('logger', logger);

	const startAt = Date.now();
	await next();
	const durationMs = Math.max(0, Date.now() - startAt);

	const env = (c.env?.ENVIRONMENT as 'development' | 'production') || 'development';
	if (env === 'development') {
		const status = c.res.status;

		logger.debug(`Request completed`, {
			status,
			duration_ms: durationMs
		});
	}
};
