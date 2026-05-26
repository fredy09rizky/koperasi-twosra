import { withD1Retry } from '../utils/d1-retry.js';
import {
	ensureStockReservationSchema,
	getActiveReservedForProductCode,
	getAllActiveReservedByProduct,
	releaseExpiredReservations
} from '../utils/stock-reservations.js';
import { getErrorMessage } from '../utils/type-safe.js';
import {
	buildAdminError,
	getAdminRequestLogger,
	resolveAdminEnvironmentMode,
	type AdminContext
} from './admin-common.js';
import {
	buildAdminProductsWithStock,
	buildDuplicateProductError,
	deleteManagedProductImage,
	detectProductDuplicateState,
	loadProductSnapshotById,
	normalizeProductCode,
	normalizeProductInput,
	parseAllowedExternalImageDomains,
	readProductPayload,
	uploadProductImageToR2,
	validateExternalImageUrl,
	validateProductInput,
	validateProductUpdateReservationLocks,
	validateUploadedProductImage
} from './admin-products.js';

const MAX_MULTIPART_PAYLOAD = 4 * 1024 * 1024; // 4MB (3MB file + multipart overhead)

export function handleAdminImagePolicy(c: AdminContext) {
	const allowedDomains = parseAllowedExternalImageDomains(c.env);
	return c.json({
		success: true,
		data: {
			allowed_domains: allowedDomains
		}
	});
}

export async function handleAdminListProducts(c: AdminContext) {
	try {
		await ensureStockReservationSchema(c.env);
		await releaseExpiredReservations(c.env);

		const { results } = await withD1Retry(
			() => c.env.DB.prepare(
				`SELECT id, code, name, price, category, image_url, stock, created_at
				 FROM products
				 ORDER BY id DESC`
			).all(),
			{ label: 'admin.products.list', environment: resolveAdminEnvironmentMode(c.env) }
		);
		const reservedMap = await getAllActiveReservedByProduct(c.env);
		const products = buildAdminProductsWithStock(results, reservedMap);

		return c.json({ success: true, data: products });
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal memuat katalog produk admin', {
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-PROD-DB', 'Gagal memuat katalog produk.'), 500);
	}
}

export async function handleAdminCreateProduct(c: AdminContext) {
	try {
		const data = await readProductPayload(c);
		const {
			normalizedCode,
			normalizedName,
			normalizedCategory,
			normalizedImageUrl,
			parsedPrice,
			parsedStock
		} = normalizeProductInput(data);

		const validationError = validateProductInput({
			normalizedCode,
			normalizedName,
			normalizedCategory,
			normalizedImageUrl,
			parsedPrice,
			parsedStock
		});
		if (validationError) {
			return c.json(validationError, 400);
		}
		const imageUrlValidation = validateExternalImageUrl(normalizedImageUrl, c.req.url, c.env);
		if (!imageUrlValidation.ok) {
			return c.json(buildAdminError('E-PROD-IMAGE-URL-DOMAIN', imageUrlValidation.message), 400);
		}

		const { results: dupRows } = await withD1Retry(
			() => c.env.DB.prepare(
				'SELECT id, code, name FROM products WHERE UPPER(TRIM(code)) = ? OR LOWER(TRIM(name)) = ?'
			).bind(normalizedCode, normalizedName.toLowerCase()).all(),
			{ label: 'admin.products.create.check-duplicate', environment: resolveAdminEnvironmentMode(c.env) }
		);

		const { hasDupCode, hasDupName } = detectProductDuplicateState(
			Array.isArray(dupRows) ? dupRows : [],
			normalizedCode,
			normalizedName
		);
		const duplicateError = buildDuplicateProductError(hasDupCode, hasDupName);
		if (duplicateError) {
			return c.json(duplicateError, 400);
		}

		await withD1Retry(
			() => c.env.DB.prepare(
				`INSERT INTO products (code, name, price, category, image_url, stock)
	       VALUES (?, ?, ?, ?, ?, ?)`
			).bind(normalizedCode, normalizedName, parsedPrice, normalizedCategory, normalizedImageUrl, parsedStock).run(),
			{ label: 'admin.products.create.insert', environment: resolveAdminEnvironmentMode(c.env) }
		);

		return c.json({ success: true, message: 'Produk berhasil ditambahkan' });
	} catch (error: unknown) {
		const errorMessage = getErrorMessage(error);
		if (errorMessage === 'INVALID_JSON_BODY') {
			return c.json(buildAdminError('E-PROD-JSON', 'Format JSON tidak valid.'), 400);
		}
		if (errorMessage.includes('UNIQUE constraint failed')) {
			return c.json(buildAdminError('E-PROD-DUP-CODE', 'SKU sudah terdaftar.'), 400);
		}
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal menambahkan produk baru', {
			error: errorMessage,
		});
		return c.json(buildAdminError('E-PROD-DB', 'Terjadi kesalahan database.'), 500);
	}
}

export async function handleAdminUpdateProduct(c: AdminContext) {
	try {
		const id = String(c.req.param('id') || '').trim();
		const data = await readProductPayload(c);
		const {
			normalizedCode,
			normalizedName,
			normalizedCategory,
			normalizedImageUrl,
			parsedPrice,
			parsedStock
		} = normalizeProductInput(data);

		const validationError = validateProductInput({
			normalizedCode,
			normalizedName,
			normalizedCategory,
			normalizedImageUrl,
			parsedPrice,
			parsedStock
		});
		if (validationError) {
			return c.json(validationError, 400);
		}
		const imageUrlValidation = validateExternalImageUrl(normalizedImageUrl, c.req.url, c.env);
		if (!imageUrlValidation.ok) {
			return c.json(buildAdminError('E-PROD-IMAGE-URL-DOMAIN', imageUrlValidation.message), 400);
		}

		const { results: dupRows } = await withD1Retry(
			() => c.env.DB.prepare(
				'SELECT id, code, name FROM products WHERE id <> ? AND (UPPER(TRIM(code)) = ? OR LOWER(TRIM(name)) = ?)'
			).bind(id, normalizedCode, normalizedName.toLowerCase()).all(),
			{ label: 'admin.products.update.check-duplicate', environment: resolveAdminEnvironmentMode(c.env) }
		);

		const { hasDupCode, hasDupName } = detectProductDuplicateState(
			Array.isArray(dupRows) ? dupRows : [],
			normalizedCode,
			normalizedName
		);

		const duplicateError = buildDuplicateProductError(hasDupCode, hasDupName);
		if (duplicateError) {
			return c.json(duplicateError, 400);
		}

		await releaseExpiredReservations(c.env);

		const oldProduct = await loadProductSnapshotById(c.env, id);
		if (!oldProduct) {
			return c.json(buildAdminError('E-PROD-NOTFOUND', 'Produk tidak ditemukan.'), 404);
		}

		const reservationLockResult = await validateProductUpdateReservationLocks(
			c.env,
			oldProduct,
			normalizedCode,
			normalizedName,
			normalizedCategory,
			parsedPrice,
			parsedStock
		);
		if (reservationLockResult.error) {
			return c.json(reservationLockResult.error, reservationLockResult.status);
		}

		const finalImageUrl = normalizedImageUrl || '';
		if (oldProduct.image_url && oldProduct.image_url !== finalImageUrl) {
			await deleteManagedProductImage(
				c.env,
				oldProduct.image_url,
				(key) => `Gagal menghapus gambar lama ${key} dari R2:`
			);
		}

		await withD1Retry(
			() => c.env.DB.prepare(
				`UPDATE products
	       SET code = ?, name = ?, price = ?, category = ?, image_url = ?, stock = ?
	       WHERE id = ?`
			).bind(normalizedCode, normalizedName, parsedPrice, normalizedCategory, finalImageUrl, parsedStock, id).run(),
			{ label: 'admin.products.update.save', environment: resolveAdminEnvironmentMode(c.env) }
		);

		return c.json({ success: true, message: 'Produk berhasil diperbarui' });
	} catch (error: unknown) {
		const errorMessage = getErrorMessage(error);
		if (errorMessage === 'INVALID_JSON_BODY') {
			return c.json(buildAdminError('E-PROD-JSON', 'Format JSON tidak valid.'), 400);
		}
		if (errorMessage.includes('UNIQUE constraint failed')) {
			return c.json(buildAdminError('E-PROD-DUP-CODE', 'SKU sudah terdaftar.'), 400);
		}
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal memperbarui produk', {
			productId: String(c.req.param('id') || '').trim(),
			error: errorMessage,
		});
		return c.json(buildAdminError('E-PROD-DB', 'Terjadi kesalahan database.'), 500);
	}
}

export async function handleAdminDeleteProduct(c: AdminContext) {
	const id = String(c.req.param('id') || '').trim();
	try {
		await releaseExpiredReservations(c.env);

		const product = await loadProductSnapshotById(c.env, id);
		if (!product) {
			return c.json(buildAdminError('E-PROD-NOTFOUND', 'Produk tidak ditemukan.'), 404);
		}

		const productCode = normalizeProductCode(product.code);
		const activeReservedQty = productCode ? await getActiveReservedForProductCode(c.env, productCode) : 0;
		if (activeReservedQty > 0) {
			return c.json(
				buildAdminError(
					'E-PROD-DELETE-LOCKED',
					`Produk belum bisa dihapus karena ada ${activeReservedQty} unit stok yang sedang di-reservasi checkout.`
				),
				409
			);
		}

		await deleteManagedProductImage(
			c.env,
			product.image_url,
			(key) => `Gagal menghapus gambar ${key} dari R2:`
		);

		await withD1Retry(
			() => c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run(),
			{ label: 'admin.products.delete', environment: resolveAdminEnvironmentMode(c.env) }
		);

		return c.json({ success: true, message: 'Produk berhasil dihapus' });
	} catch (error) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal menghapus produk', {
			productId: id,
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-PROD-DELETE', 'Gagal menghapus produk.'), 500);
	}
}

export async function handleAdminUploadProductImage(c: AdminContext) {
	try {
		const logger = getAdminRequestLogger(c);
		const contentLengthHeader = c.req.header('Content-Length') || c.req.header('content-length') || '';
		const contentLength = Number(contentLengthHeader);
		if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_PAYLOAD) {
			return c.json(buildAdminError('E-PROD-UPLOAD-SIZE', 'Ukuran payload upload melebihi batas aman.'), 413);
		}

		let body: Record<string, unknown>;
		try {
			body = await c.req.parseBody();
		} catch (parseError) {
			logger.warn('Admin upload rejected due to invalid multipart body', {
				error: getErrorMessage(parseError),
			});
			return c.json(buildAdminError('E-PROD-UPLOAD-MULTIPART', 'Format multipart upload tidak valid.'), 400);
		}
		const image = body['image'];

		if (!image || typeof image === 'string') {
			return c.json(buildAdminError('E-PROD-UPLOAD-NOFILE', 'File gambar tidak ditemukan.'), 400);
		}

		const file = image as File;
		const imageValidation = await validateUploadedProductImage(file);
		if (!imageValidation.ok) {
			return c.json(imageValidation.error, imageValidation.status);
		}

		const publicUrl = await uploadProductImageToR2(
			c.env,
			file,
			imageValidation.safeExtension,
			imageValidation.normalizedContentType
		);

		return c.json({
			success: true,
			message: 'Gambar berhasil diunggah',
			image_url: publicUrl
		});
	} catch (error: unknown) {
		const logger = getAdminRequestLogger(c);
		logger.error('Gagal mengunggah gambar ke R2', {
			error: getErrorMessage(error),
		});
		return c.json(buildAdminError('E-PROD-UPLOAD-FAILED', 'Gagal mengunggah gambar.'), 500);
	}
}
