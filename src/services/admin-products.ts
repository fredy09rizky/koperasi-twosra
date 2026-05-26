import type { Bindings } from '../types/bindings.js';
import { isBlockedHostname, isHostnameAllowed } from '../utils/network.js';
import { getActiveReservedForProductCode } from '../utils/stock-reservations.js';
import { createLogger, resolveEnvironmentMode } from '../utils/logger.js';
import { withD1Retry } from '../utils/d1-retry.js';

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp'
};
const PRODUCT_CODE_MIN = 4;
const PRODUCT_CODE_MAX = 10;
const PRODUCT_NAME_MAX = 40;
const PRODUCT_PRICE_MIN = 1;
const PRODUCT_PRICE_MAX = 1_000_000;
const PRODUCT_STOCK_MIN = 1;
const PRODUCT_STOCK_MAX = 1000;
const PRODUCT_CATEGORIES = new Set(['Alat Tulis', 'Seragam', 'Aksesoris', 'Makanan/Minuman', 'Lainnya']);
const DEFAULT_EXTERNAL_IMAGE_ALLOWED_DOMAINS = ['images.pexels.com'];
const MAX_PRODUCT_IMAGE_SIZE = 3 * 1024 * 1024;

const IMAGE_SIGNATURE_FORMAT_BY_EXTENSION = {
	png: 'png',
	jpg: 'jpg',
	webp: 'webp'
} as const;

type ImageSignatureFormat = 'png' | 'jpg' | 'webp';

export type AdminProductSnapshot = {
	code: string;
	name: string;
	category: string;
	price: number;
	image_url: string;
};

export type NormalizedProductInput = {
	normalizedCode: string;
	normalizedName: string;
	normalizedCategory: string;
	normalizedImageUrl: string;
	parsedPrice: number;
	parsedStock: number;
};

function buildAdminError(code: string, message: string) {
	return {
		success: false,
		code,
		message: `${code}: ${message}`
	};
}

export function normalizeProductCode(value: unknown) {
	return String(value || '').trim().toUpperCase();
}

function normalizeProductName(value: unknown) {
	return String(value || '').trim().replace(/\s+/g, ' ');
}

function containsEmoji(value: string) {
	if (!value) return false;
	try {
		return /\p{Extended_Pictographic}/u.test(value);
	} catch {
		return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(value);
	}
}

function isValidProductCode(code: string) {
	if (!code) return false;
	if (code.length < PRODUCT_CODE_MIN || code.length > PRODUCT_CODE_MAX) return false;
	if (/\s/.test(code)) return false;
	return /^[A-Z0-9_-]+$/.test(code);
}

function isValidProductName(name: string) {
	if (!name) return false;
	if (name.length > PRODUCT_NAME_MAX) return false;
	if (containsEmoji(name)) return false;
	return /^[\p{L}\p{N}\s.'()\-&,/]+$/u.test(name);
}

function parseInteger(value: unknown) {
	if (typeof value === 'number') return value;
	if (typeof value === 'string' && value.trim()) return Number(value);
	return NaN;
}

export function parseAllowedExternalImageDomains(env: Bindings): string[] {
	const raw = String(env.IMAGE_OPTIMIZE_ALLOWED_DOMAINS || '').trim();
	const parsed = raw
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);
	return parsed.length > 0 ? parsed : DEFAULT_EXTERNAL_IMAGE_ALLOWED_DOMAINS;
}

export function validateExternalImageUrl(imageUrl: string, requestUrl: string, env: Bindings): { ok: true } | { ok: false; message: string } {
	const value = String(imageUrl || '').trim();
	if (!value) {
		return { ok: true };
	}

	if (value.startsWith('/api/images/')) {
		return { ok: true };
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(value, requestUrl);
	} catch {
		return { ok: false, message: 'URL gambar tidak valid.' };
	}

	if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
		return { ok: false, message: 'URL gambar harus memakai http/https.' };
	}
	if (isBlockedHostname(parsedUrl.hostname)) {
		return { ok: false, message: 'Hostname URL gambar tidak diizinkan.' };
	}

	const requestOrigin = new URL(requestUrl).origin;
	if (parsedUrl.origin === requestOrigin) {
		if (parsedUrl.pathname.startsWith('/api/images/')) {
			return { ok: true };
		}
		return { ok: false, message: 'URL gambar dari origin sendiri harus memakai path /api/images/ yang dikelola server.' };
	}

	const allowedDomains = parseAllowedExternalImageDomains(env);
	if (!isHostnameAllowed(parsedUrl.hostname, allowedDomains)) {
		const allowedListText = allowedDomains.join(', ');
		return {
			ok: false,
			message: `Domain URL gambar tidak diizinkan. Domain yang diperbolehkan: ${allowedListText}.`
		};
	}

	return { ok: true };
}

export async function readProductPayload(c: any) {
	const contentType = c.req.header('Content-Type') || '';
	if (contentType.includes('multipart/form-data')) {
		const formData = await c.req.parseBody();
		return {
			code: formData.code,
			name: formData.name,
			price: formData.price ? parseInt(formData.price as string, 10) : 0,
			category: formData.category,
			image_url: formData.image_url,
			stock: formData.stock ? parseInt(formData.stock as string, 10) : 100
		};
	}

	try {
		return await c.req.json();
	} catch (parseError) {
		const error = new Error('INVALID_JSON_BODY');
		(error as any).cause = parseError;
		throw error;
	}
}

export function normalizeProductInput(data: any): NormalizedProductInput {
	return {
		normalizedCode: normalizeProductCode(data.code),
		normalizedName: normalizeProductName(data.name),
		normalizedCategory: String(data.category || '').trim(),
		normalizedImageUrl: String(data.image_url || '').trim(),
		parsedPrice: parseInteger(data.price),
		parsedStock: parseInteger(data.stock)
	};
}

export function validateProductInput(input: NormalizedProductInput) {
	if (!input.normalizedCode || !input.normalizedName || !input.normalizedCategory) {
		return buildAdminError('E-PROD-REQUIRED', 'Field wajib belum lengkap.');
	}

	if (!isValidProductCode(input.normalizedCode)) {
		return buildAdminError('E-PROD-CODE', 'Format SKU tidak valid.');
	}

	if (!isValidProductName(input.normalizedName)) {
		return buildAdminError('E-PROD-NAME', 'Nama produk tidak valid.');
	}

	if (!Number.isInteger(input.parsedPrice) || input.parsedPrice < PRODUCT_PRICE_MIN || input.parsedPrice > PRODUCT_PRICE_MAX) {
		return buildAdminError('E-PROD-PRICE', 'Harga harus angka bulat 1-1.000.000.');
	}

	if (!Number.isInteger(input.parsedStock) || input.parsedStock < PRODUCT_STOCK_MIN || input.parsedStock > PRODUCT_STOCK_MAX) {
		return buildAdminError('E-PROD-STOCK', 'Stok harus angka bulat 1-1000.');
	}

	if (!PRODUCT_CATEGORIES.has(input.normalizedCategory)) {
		return buildAdminError('E-PROD-CATEGORY', 'Kategori tidak valid.');
	}

	return null;
}

export function buildDuplicateProductError(hasDupCode: boolean, hasDupName: boolean) {
	if (hasDupCode && hasDupName) {
		return buildAdminError('E-PROD-DUP-BOTH', 'SKU dan nama produk sudah terdaftar.');
	}
	if (hasDupCode) {
		return buildAdminError('E-PROD-DUP-CODE', 'SKU sudah terdaftar.');
	}
	if (hasDupName) {
		return buildAdminError('E-PROD-DUP-NAME', 'Nama produk sudah terdaftar.');
	}
	return null;
}

export function detectProductDuplicateState(dupRows: unknown[], normalizedCode: string, normalizedName: string) {
	const normalizedNameLower = normalizedName.toLowerCase();
	const rows = Array.isArray(dupRows) ? dupRows : [];
	const hasDupCode = rows.some((row: any) => normalizeProductCode(row?.code) === normalizedCode);
	const hasDupName = rows.some((row: any) => normalizeProductName(row?.name).toLowerCase() === normalizedNameLower);
	return { hasDupCode, hasDupName };
}

export async function loadProductSnapshotById(env: Bindings, id: string): Promise<AdminProductSnapshot | null> {
	const product: any = await withD1Retry(
		() => env.DB.prepare(
			'SELECT code, name, category, price, image_url FROM products WHERE id = ?'
		).bind(id).first(),
		{ label: 'admin.products.snapshot-by-id', environment: resolveEnvironmentMode(env) }
	);

	if (!product) return null;

	return {
		code: String(product?.code || ''),
		name: String(product?.name || ''),
		category: String(product?.category || ''),
		price: Number(product?.price || 0),
		image_url: String(product?.image_url || '')
	};
}

export async function validateProductUpdateReservationLocks(
	env: Bindings,
	oldProduct: AdminProductSnapshot,
	normalizedCode: string,
	normalizedName: string,
	normalizedCategory: string,
	parsedPrice: number,
	parsedStock: number
) {
	const oldCode = normalizeProductCode(oldProduct.code);
	const activeReservedOldCode = oldCode ? await getActiveReservedForProductCode(env, oldCode) : 0;
	const isCodeChanging = oldCode !== normalizedCode;
	if (isCodeChanging && activeReservedOldCode > 0) {
		return {
			error: buildAdminError(
				'E-PROD-CODE-LOCKED',
				`SKU tidak bisa diubah karena ada ${activeReservedOldCode} unit stok yang sedang di-reservasi checkout.`
			),
			status: 409 as const
		};
	}

	const activeReservedTargetCode = isCodeChanging
		? await getActiveReservedForProductCode(env, normalizedCode)
		: activeReservedOldCode;
	const oldPrice = Number(oldProduct.price || 0);
	const isPriceChanging = parsedPrice !== oldPrice;
	if (isPriceChanging && activeReservedOldCode > 0) {
		return {
			error: buildAdminError(
				'E-PROD-PRICE-LOCKED',
				`Harga tidak bisa diubah karena ada ${activeReservedOldCode} unit stok yang sedang di-reservasi checkout.`
			),
			status: 409 as const
		};
	}

	const oldName = normalizeProductName(oldProduct.name);
	const isNameChanging = normalizedName !== oldName;
	if (isNameChanging && activeReservedOldCode > 0) {
		return {
			error: buildAdminError(
				'E-PROD-NAME-LOCKED',
				`Nama produk tidak bisa diubah karena ada ${activeReservedOldCode} unit stok yang sedang di-reservasi checkout.`
			),
			status: 409 as const
		};
	}

	const oldCategory = String(oldProduct.category || '').trim();
	const isCategoryChanging = normalizedCategory !== oldCategory;
	if (isCategoryChanging && activeReservedOldCode > 0) {
		return {
			error: buildAdminError(
				'E-PROD-CATEGORY-LOCKED',
				`Kategori produk tidak bisa diubah karena ada ${activeReservedOldCode} unit stok yang sedang di-reservasi checkout.`
			),
			status: 409 as const
		};
	}

	if (parsedStock < activeReservedTargetCode) {
		return {
			error: buildAdminError(
				'E-PROD-STOCK-BELOW-RESERVED',
				`Stok tidak boleh lebih kecil dari stok reservasi aktif (${activeReservedTargetCode}).`
			),
			status: 409 as const
		};
	}

	return { error: null, status: null };
}

export async function deleteManagedProductImage(
	env: Bindings,
	imageUrl: string,
	errorMessage: (key: string) => string
) {
	if (!imageUrl || !imageUrl.startsWith('/api/images/')) {
		return;
	}

	const key = imageUrl.replace('/api/images/', '');
	try {
		await env.IMG_BUCKET.delete(key);
	} catch (r2Error) {
		const logger = createLogger({
			service: 'koperasi-backend',
			environment: resolveEnvironmentMode(env),
		});
		logger.error(errorMessage(key), {
			imageKey: key,
			error: r2Error instanceof Error ? r2Error.message : String(r2Error),
		});
	}
}

export function buildAdminProductsWithStock(results: unknown[], reservedMap: Map<string, number>) {
	const rows = Array.isArray(results) ? results : [];

	return rows.map((row: any) => {
		const stockOriginal = Number(row?.stock || 0);
		const stockReserved = reservedMap.get(String(row?.code || '').trim()) || 0;
		const stockAvailable = Math.max(0, stockOriginal - stockReserved);
		return {
			...row,
			stock_original: stockOriginal,
			stock_reserved: stockReserved,
			stock_available: stockAvailable,
			stock: stockAvailable
		};
	});
}

export async function uploadProductImageToR2(env: Bindings, file: File, safeExtension: string, normalizedContentType: string) {
	const uniqueFilename = `product_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${safeExtension}`;

	await env.IMG_BUCKET.put(uniqueFilename, file.stream(), {
		httpMetadata: {
			contentType: normalizedContentType
		}
	});

	return `/api/images/${uniqueFilename}`;
}

function detectImageSignatureFormat(bytes: Uint8Array): ImageSignatureFormat | null {
	const isPng = bytes.length >= 8
		&& bytes[0] === 0x89
		&& bytes[1] === 0x50
		&& bytes[2] === 0x4e
		&& bytes[3] === 0x47
		&& bytes[4] === 0x0d
		&& bytes[5] === 0x0a
		&& bytes[6] === 0x1a
		&& bytes[7] === 0x0a;
	if (isPng) return 'png';

	const isJpg = bytes.length >= 3
		&& bytes[0] === 0xff
		&& bytes[1] === 0xd8
		&& bytes[2] === 0xff;
	if (isJpg) return 'jpg';

	const isWebp = bytes.length >= 12
		&& bytes[0] === 0x52
		&& bytes[1] === 0x49
		&& bytes[2] === 0x46
		&& bytes[3] === 0x46
		&& bytes[8] === 0x57
		&& bytes[9] === 0x45
		&& bytes[10] === 0x42
		&& bytes[11] === 0x50;
	if (isWebp) return 'webp';

	return null;
}

async function readUploadedImageSignature(file: File): Promise<ImageSignatureFormat | null> {
	const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	return detectImageSignatureFormat(head);
}

export async function validateUploadedProductImage(file: File) {
	const normalizedContentType = String(file.type || '').toLowerCase();
	const safeExtension = ALLOWED_IMAGE_TYPES[normalizedContentType];
	if (!safeExtension) {
		return {
			ok: false as const,
			status: 400 as const,
			error: buildAdminError('E-PROD-UPLOAD-TYPE', 'Tipe gambar harus PNG, JPG/JPEG, atau WebP.')
		};
	}

	if (file.size > MAX_PRODUCT_IMAGE_SIZE) {
		return {
			ok: false as const,
			status: 400 as const,
			error: buildAdminError('E-PROD-UPLOAD-SIZE', 'Ukuran gambar maksimal adalah 3MB.')
		};
	}

	const detectedFormat = await readUploadedImageSignature(file);
	const expectedFormat = IMAGE_SIGNATURE_FORMAT_BY_EXTENSION[safeExtension as keyof typeof IMAGE_SIGNATURE_FORMAT_BY_EXTENSION];
	if (!detectedFormat || detectedFormat !== expectedFormat) {
		return {
			ok: false as const,
			status: 400 as const,
			error: buildAdminError('E-PROD-UPLOAD-SIGNATURE', 'Isi file gambar tidak sesuai dengan tipe MIME yang dikirim.')
		};
	}

	return {
		ok: true as const,
		safeExtension,
		normalizedContentType
	};
}
