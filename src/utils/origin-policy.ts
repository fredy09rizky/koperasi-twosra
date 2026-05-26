import type { Bindings } from '../types/bindings.js';

export function getAllowedOrigins(requestUrl: string, env: Pick<Bindings, 'CORS_ALLOWED_ORIGINS'>): Set<string> {
	const allowedOrigins = new Set<string>();
	const workerOrigin = new URL(requestUrl).origin;
	allowedOrigins.add(workerOrigin);

	const envOrigins = String(env.CORS_ALLOWED_ORIGINS || '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);

	envOrigins.forEach((origin) => allowedOrigins.add(origin));
	return allowedOrigins;
}
