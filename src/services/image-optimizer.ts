import type { Bindings } from '../types/bindings.js';
import { isBlockedHostname, isHostnameAllowed } from '../utils/network.js';

const IMAGE_OPTIMIZE_MAX_WIDTH = 2000;
const IMAGE_OPTIMIZE_MAX_HEIGHT = 2000;
const IMAGE_OPTIMIZE_MIN_WIDTH = 64;
const IMAGE_OPTIMIZE_MIN_HEIGHT = 64;
const IMAGE_OPTIMIZE_DEFAULT_WIDTH = 720;
const IMAGE_OPTIMIZE_DEFAULT_HEIGHT = 480;
const IMAGE_OPTIMIZE_DEFAULT_QUALITY = 72;
const IMAGE_OPTIMIZE_MIN_QUALITY = 35;
const IMAGE_OPTIMIZE_MAX_QUALITY = 90;
const IMAGE_OPTIMIZE_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const IMAGE_OPTIMIZE_ALLOWED_FITS = new Set(['cover', 'contain', 'scale-down']);
const IMAGE_OPTIMIZE_DEFAULT_ALLOWED_DOMAINS = ['images.pexels.com', 'i.ibb.co'];

type ImageOptimizeParams = {
	env: Bindings;
	requestUrl: string;
	rawUrl: string;
	widthRaw?: string;
	heightRaw?: string;
	qualityRaw?: string;
	fitRaw?: string;
};

type ImageOptimizeResult =
	| { ok: true; response: Response; sourceUrl: string; width: number; height: number; quality: number }
	| { ok: false; response: Response; sourceUrl?: string; width?: number; height?: number; quality?: number };

function parseAllowedImageOptimizeDomains(env: Bindings, requestUrl: string): string[] {
	const currentHostname = new URL(requestUrl).hostname.toLowerCase();
	const raw = String(env.IMAGE_OPTIMIZE_ALLOWED_DOMAINS || '').trim();
	const parsedDomains = raw
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);
	const allowed = parsedDomains.length > 0 ? parsedDomains : IMAGE_OPTIMIZE_DEFAULT_ALLOWED_DOMAINS;
	const uniq = new Set<string>([...allowed, currentHostname]);
	return Array.from(uniq);
}

function clampInteger(rawValue: string | undefined, minValue: number, maxValue: number, fallbackValue: number): number {
	const parsed = Number(rawValue);
	if (!Number.isFinite(parsed)) return fallbackValue;
	const normalized = Math.trunc(parsed);
	return Math.min(maxValue, Math.max(minValue, normalized));
}

function resolveImageOptimizeSourceUrl(rawUrl: string, requestUrl: string): URL | null {
	try {
		const sourceUrl = new URL(rawUrl, requestUrl);
		if (sourceUrl.protocol !== 'https:' && sourceUrl.protocol !== 'http:') {
			return null;
		}
		if (isBlockedHostname(sourceUrl.hostname)) {
			return null;
		}
		const currentUrl = new URL(requestUrl);
		if (sourceUrl.origin === currentUrl.origin && sourceUrl.pathname.startsWith('/api/image-optimize')) {
			return null;
		}
		return sourceUrl;
	} catch {
		return null;
	}
}

function isImageContentType(contentTypeRaw: string | null): boolean {
	const contentType = String(contentTypeRaw || '').trim().toLowerCase();
	return contentType.startsWith('image/');
}

function isSameOriginR2Image(sourceUrl: URL, requestUrl: string): boolean {
	const currentUrl = new URL(requestUrl);
	return sourceUrl.origin === currentUrl.origin && sourceUrl.pathname.startsWith('/api/images/');
}

async function buildBoundedImageBody(response: Response, allowUnboundedStream: boolean): Promise<BodyInit | null> {
	const contentLength = Number(response.headers.get('content-length') || 0);
	if (Number.isFinite(contentLength) && contentLength > IMAGE_OPTIMIZE_MAX_SOURCE_BYTES) {
		return null;
	}
	if ((Number.isFinite(contentLength) && contentLength > 0) || allowUnboundedStream) {
		return response.body;
	}
	if (!response.body) {
		return new Uint8Array();
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			totalBytes += value.byteLength;
			if (totalBytes > IMAGE_OPTIMIZE_MAX_SOURCE_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const output = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

export async function optimizeImageRequest(params: ImageOptimizeParams): Promise<ImageOptimizeResult> {
	const rawUrl = String(params.rawUrl || '').trim();
	if (!rawUrl) {
		return { ok: false, response: new Response('URL gambar wajib diisi', { status: 400 }) };
	}

	const sourceUrl = resolveImageOptimizeSourceUrl(rawUrl, params.requestUrl);
	if (!sourceUrl) {
		return { ok: false, response: new Response('URL gambar tidak valid', { status: 400 }) };
	}

	const allowedDomains = parseAllowedImageOptimizeDomains(params.env, params.requestUrl);
	if (!isHostnameAllowed(sourceUrl.hostname, allowedDomains)) {
		return { ok: false, sourceUrl: sourceUrl.toString(), response: new Response('Domain sumber gambar tidak diizinkan', { status: 403 }) };
	}

	const width = clampInteger(params.widthRaw, IMAGE_OPTIMIZE_MIN_WIDTH, IMAGE_OPTIMIZE_MAX_WIDTH, IMAGE_OPTIMIZE_DEFAULT_WIDTH);
	const height = clampInteger(params.heightRaw, IMAGE_OPTIMIZE_MIN_HEIGHT, IMAGE_OPTIMIZE_MAX_HEIGHT, IMAGE_OPTIMIZE_DEFAULT_HEIGHT);
	const quality = clampInteger(params.qualityRaw, IMAGE_OPTIMIZE_MIN_QUALITY, IMAGE_OPTIMIZE_MAX_QUALITY, IMAGE_OPTIMIZE_DEFAULT_QUALITY);
	const fitRaw = String(params.fitRaw || '').trim().toLowerCase();
	const fit = IMAGE_OPTIMIZE_ALLOWED_FITS.has(fitRaw) ? fitRaw : 'cover';

	let response: Response;
	try {
		const requestInitWithImage = {
			redirect: 'manual',
			cf: {
				image: {
					width,
					height,
					fit,
					quality,
					format: 'auto',
					metadata: 'none'
				},
				cacheEverything: true,
				cacheTtl: 60 * 60 * 24
			}
		} as unknown as RequestInit;
		response = await fetch(sourceUrl.toString(), {
			...requestInitWithImage
		});

		if (response.status >= 300 && response.status < 400) {
			return { ok: false, sourceUrl: sourceUrl.toString(), width, height, quality, response: new Response('Redirect tidak diizinkan untuk optimasi gambar', { status: 400 }) };
		}
	} catch {
		response = await fetch(sourceUrl.toString(), { redirect: 'manual' });
		if (response.status >= 300 && response.status < 400) {
			return { ok: false, sourceUrl: sourceUrl.toString(), width, height, quality, response: new Response('Redirect tidak diizinkan untuk optimasi gambar', { status: 400 }) };
		}
	}

	if (!response.ok) {
		return { ok: false, sourceUrl: sourceUrl.toString(), width, height, quality, response: new Response('Gagal mengambil gambar sumber', { status: 502 }) };
	}
	if (!isImageContentType(response.headers.get('content-type'))) {
		return { ok: false, sourceUrl: sourceUrl.toString(), width, height, quality, response: new Response('Sumber URL bukan file gambar', { status: 415 }) };
	}

	const body = await buildBoundedImageBody(response, isSameOriginR2Image(sourceUrl, params.requestUrl));
	if (body === null) {
		return { ok: false, sourceUrl: sourceUrl.toString(), width, height, quality, response: new Response('Ukuran gambar sumber melebihi batas aman', { status: 413 }) };
	}

	const headers = new Headers(response.headers);
	headers.delete('set-cookie');
	if (!(Number(response.headers.get('content-length') || 0) > 0)) {
		headers.delete('content-length');
	}
	headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
	headers.set('X-Image-Optimized', '1');
	headers.set('Vary', 'Accept');

	return {
		ok: true,
		sourceUrl: sourceUrl.toString(),
		width,
		height,
		quality,
		response: new Response(body, {
			status: response.status,
			headers
		})
	};
}
