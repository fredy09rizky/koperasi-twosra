import type { ContentfulStatusCode } from 'hono/utils/http-status';

const CONTENTFUL_STATUS_CODES = new Set<number>([
	200, 201, 202, 203, 206, 207, 208, 226,
	300, 301, 302, 303, 305, 306, 307, 308,
	400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
	500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function readStringProperty(value: unknown, key: string): string {
	if (!isRecord(value)) return '';
	return String(value[key] || '').trim();
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (isRecord(error) && typeof error.message === 'string') return error.message;
	return String(error || '');
}

export function getErrorStack(error: unknown): string | undefined {
	return error instanceof Error ? error.stack : undefined;
}

export function normalizeContentfulStatusCode(
	value: unknown,
	fallback: ContentfulStatusCode = 500
): ContentfulStatusCode {
	const status = Number(value);
	return CONTENTFUL_STATUS_CODES.has(status) ? status as ContentfulStatusCode : fallback;
}
