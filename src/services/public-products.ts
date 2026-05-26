import type { Bindings } from '../types/bindings.js';
import {
	ensureStockReservationSchema,
	getAllActiveReservedByProduct,
	releaseExpiredReservations
} from '../utils/stock-reservations.js';

const PUBLIC_PRODUCTS_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=240';

async function createWeakEtagFromText(rawValue: string): Promise<string> {
	const encoder = new TextEncoder();
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(rawValue));
	const bytes = Array.from(new Uint8Array(digest)).slice(0, 16);
	const shortHash = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `W/"${shortHash}"`;
}

function buildPublicProducts(results: unknown[], reservedMap: Map<string, number>) {
	const rows = Array.isArray(results) ? results : [];
	return rows.map((row: any) => {
		const stockOriginal = Number(row?.stock || 0);
		const stockReserved = reservedMap.get(String(row?.code || '').trim()) || 0;
		const stockAvailable = Math.max(0, stockOriginal - stockReserved);
		return {
			...row,
			stock: stockAvailable
		};
	});
}

function buildProductHeaders(etag: string) {
	return {
		'Cache-Control': PUBLIC_PRODUCTS_CACHE_CONTROL,
		ETag: etag,
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'strict-origin-when-cross-origin'
	};
}

export async function buildPublicProductsResponse(env: Bindings, ifNoneMatchRaw: string): Promise<Response> {
	await ensureStockReservationSchema(env);
	await releaseExpiredReservations(env);

	const { results } = await env.DB.prepare(
		`SELECT id, code, name, price, category, image_url, stock, created_at
		 FROM products
		 ORDER BY id DESC`
	).all();
	const reservedMap = await getAllActiveReservedByProduct(env);
	const hydratedProducts = buildPublicProducts(results, reservedMap);
	const responsePayload = { success: true, data: hydratedProducts };
	const responseBody = JSON.stringify(responsePayload);
	const etag = await createWeakEtagFromText(responseBody);
	const ifNoneMatch = String(ifNoneMatchRaw || '').trim();

	if (ifNoneMatch && ifNoneMatch === etag) {
		return new Response(null, {
			status: 304,
			headers: buildProductHeaders(etag)
		});
	}

	return new Response(responseBody, {
		status: 200,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			...buildProductHeaders(etag)
		}
	});
}
