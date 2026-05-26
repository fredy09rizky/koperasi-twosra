import { env, SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRateLimitMiddleware } from '../src/middleware/rate-limit.js';
import {
	buildAdminProductsWithStock,
	buildDuplicateProductError,
	normalizeProductInput,
	parseAllowedExternalImageDomains,
	validateExternalImageUrl,
	validateProductInput,
	validateUploadedProductImage
} from '../src/services/admin-products.js';
import { cleanupCheckoutSessions } from '../src/services/payment-sessions.js';
import { verifyPakasirPaymentCompleted } from '../src/services/pakasir-gateway.js';
import { queueAdminOperationalLog } from '../src/services/admin-common.js';
import { CUSTOMER_NAME_MAX_LENGTH as BACKEND_CUSTOMER_NAME_MAX_LENGTH, buildSecureOrderItems, detectClientPayloadMismatch, ensureExistingOrderVerificationToken, persistPaidOrder, resolveServerPaymentSnapshot } from '../src/services/public-order-finalization.js';
import { resolvePickupTime } from '../src/services/public-pickup.js';
import { buildPublicProductsResponse } from '../src/services/public-products.js';
import { sendOperationalLog } from '../src/utils/telegram.js';
import { resetTestDatabase } from './helpers.js';
import { CUSTOMER_NAME_MAX_LENGTH as FRONTEND_CUSTOMER_NAME_MAX_LENGTH } from '../public/js/checkout/form.constraints.js';

describe('Koperasi Backend API', () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	describe('Service regressions', () => {
		it('admin products service normalizes and validates product input', () => {
			const input = normalizeProductInput({
				code: ' p-01 ',
				name: '  Pulpen   Biru  ',
				category: 'Alat Tulis',
				price: '5000',
				stock: '12',
				image_url: ' https://images.pexels.com/item.png '
			});

			expect(input).toMatchObject({
				normalizedCode: 'P-01',
				normalizedName: 'Pulpen Biru',
				normalizedCategory: 'Alat Tulis',
				parsedPrice: 5000,
				parsedStock: 12
			});
			expect(validateProductInput(input)).toBeNull();

			const invalid = validateProductInput(normalizeProductInput({
				code: 'A 1',
				name: 'Produk 😀',
				category: 'Tidak Ada',
				price: 0,
				stock: 0
			}));
			expect(invalid?.code).toBe('E-PROD-CODE');
		});

		it('admin products service validates external image allowlist and blocked hosts', () => {
			expect(parseAllowedExternalImageDomains({ IMAGE_OPTIMIZE_ALLOWED_DOMAINS: '*.example.com,cdn.test' } as any))
				.toEqual(['*.example.com', 'cdn.test']);

			expect(validateExternalImageUrl(
				'https://images.pexels.com/photo.png',
				'https://koperasi.example/admin',
				{} as any
			).ok).toBe(true);

			expect(validateExternalImageUrl(
				'https://img.example.com/photo.png',
				'https://koperasi.example/admin',
				{ IMAGE_OPTIMIZE_ALLOWED_DOMAINS: '*.example.com' } as any
			).ok).toBe(true);

			expect(validateExternalImageUrl(
				'http://127.0.0.1/image.png',
				'https://koperasi.example/admin',
				{} as any
			).ok).toBe(false);

			expect(validateExternalImageUrl(
				'https://koperasi.example/admin.html',
				'https://koperasi.example/admin',
				{} as any
			).ok).toBe(false);

			expect(validateExternalImageUrl(
				'https://koperasi.example/api/images/product_1.jpg',
				'https://koperasi.example/admin',
				{} as any
			).ok).toBe(true);
		});

		it('admin products service validates duplicate error and stock hydration helpers', () => {
			expect(buildDuplicateProductError(true, false)?.code).toBe('E-PROD-DUP-CODE');
			expect(buildDuplicateProductError(false, true)?.code).toBe('E-PROD-DUP-NAME');
			expect(buildDuplicateProductError(true, true)?.code).toBe('E-PROD-DUP-BOTH');

			const hydrated = buildAdminProductsWithStock(
				[{ code: 'P001', stock: 10, name: 'Pulpen' }],
				new Map([['P001', 4]])
			);
			expect(hydrated[0].stock_original).toBe(10);
			expect(hydrated[0].stock_reserved).toBe(4);
			expect(hydrated[0].stock_available).toBe(6);
			expect(hydrated[0].stock).toBe(6);
		});

		it('admin products service validates uploaded image MIME and signature', async () => {
			const pngFile = new File([
				new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			], 'image.png', { type: 'image/png' });
			const valid = await validateUploadedProductImage(pngFile);
			expect(valid.ok).toBe(true);
			if (valid.ok) {
				expect(valid.safeExtension).toBe('png');
				expect(valid.normalizedContentType).toBe('image/png');
			}

			const spoofed = new File([
				new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			], 'image.jpg', { type: 'image/jpeg' });
			const invalid = await validateUploadedProductImage(spoofed);
			expect(invalid.ok).toBe(false);
			if (!invalid.ok) {
				expect(invalid.error.code).toBe('E-PROD-UPLOAD-SIGNATURE');
			}
		});

		it('public pickup service enforces WIB pickup slot boundaries', () => {
			const pickupDate = '2026-04-15';
			const beforeFirstBreak = new Date('2026-04-15T01:00:00.000Z'); // 08.00 WIB
			const betweenBreaks = new Date('2026-04-15T03:00:00.000Z'); // 10.00 WIB
			const afterSecondBreak = new Date('2026-04-15T06:00:00.000Z'); // 13.00 WIB

			expect(resolvePickupTime(pickupDate, 'FIRST_BREAK', { now: beforeFirstBreak }).ok).toBe(true);
			expect(resolvePickupTime(pickupDate, 'SECOND_BREAK', { now: beforeFirstBreak }).ok).toBe(true);

			expect(resolvePickupTime(pickupDate, 'FIRST_BREAK', { now: betweenBreaks }).ok).toBe(false);
			expect(resolvePickupTime(pickupDate, 'SECOND_BREAK', { now: betweenBreaks }).ok).toBe(true);

			expect(resolvePickupTime(pickupDate, 'SECOND_BREAK', { now: afterSecondBreak }).ok).toBe(false);
		});

		it('public products service subtracts active reservations and supports ETag replay', async () => {
			await env.DB.prepare(
				`INSERT INTO stock_reservations (checkout_token, order_id, product_code, quantity, status, expires_at)
				 VALUES (?, ?, ?, ?, ?, datetime('now', '+5 minutes'))`
			).bind('a'.repeat(48), 'INV-SERVICE-ETAG', 'P001', 3, 'RESERVED').run();

			const firstResponse = await buildPublicProductsResponse(env, '');
			expect(firstResponse.status).toBe(200);
			const firstPayload = await firstResponse.json<any>();
			expect(firstPayload.data[0].code).toBe('P001');
			expect(firstPayload.data[0].stock).toBe(17);

			const etag = firstResponse.headers.get('etag') || '';
			expect(etag).toMatch(/^W\//);
			const replayResponse = await buildPublicProductsResponse(env, etag);
			expect(replayResponse.status).toBe(304);
		});

		it('public products health check should not mark storage as fully ok based only on binding presence', async () => {
			const response = await SELF.fetch('http://example.com/api/health');
			expect(response.status).toBe(200);
			const payload = await response.json<any>();
			expect(payload.checks.storage.status).toBe('binding_present');
		});

		it('checkout frontend name validation stays aligned with backend max length', async () => {
			expect(FRONTEND_CUSTOMER_NAME_MAX_LENGTH).toBe(22);
			expect(BACKEND_CUSTOMER_NAME_MAX_LENGTH).toBe(22);
			expect(FRONTEND_CUSTOMER_NAME_MAX_LENGTH).toBe(BACKEND_CUSTOMER_NAME_MAX_LENGTH);
		});

		it('order finalization service reconstructs items from server product data', () => {
			const reservedQuantityByCode = new Map([['P001', 2]]);
			const clientPriceByCode = new Map([['P001', 1]]);
			const { secureItems, calculatedTotal } = buildSecureOrderItems(
				reservedQuantityByCode,
				[{ code: 'P001', name: 'Pulpen Server', price: 5000 }],
				clientPriceByCode
			);

			expect(calculatedTotal).toBe(10000);
			expect(secureItems[0].secure_name).toBe('Pulpen Server');
			expect(secureItems[0].secure_price).toBe(5000);
			expect(secureItems[0].product.price).toBe(1);
		});

		it('order finalization service flags post-checkout client payload mismatch', () => {
			const secureItems = [{
				product: { code: 'P001', price: 1 },
				quantity: 2,
				secure_price: 5000,
				secure_name: 'Pulpen Server'
			}];
			const mismatch = detectClientPayloadMismatch({
				clientTotal: 1,
				calculatedTotal: 10000,
				clientQuantityByCode: new Map([['P001', 1]]),
				serverQuantityByCode: new Map([['P001', 2]]),
				clientPriceByCode: new Map([['P001', 1]]),
				secureItems,
				hasClientPaymentAmountMismatch: true,
				rawItems: [{ product: { code: 'P001', price: 1 }, quantity: 1 }]
			});

			expect(mismatch.hasClientPayloadMismatch).toBe(true);
			expect(mismatch.quantityDiffLines.length).toBeGreaterThan(0);
			expect(mismatch.priceDiffLines.length).toBeGreaterThan(0);
		});

		it('order finalization service resolves payment amount from gateway snapshot', () => {
			const snapshot = resolveServerPaymentSnapshot({
				clientTotal: 10000,
				paymentAmount: 1,
				hasGatewayPaymentSnapshot: true,
				sessionGatewayFee: 250,
				sessionGatewayTotalPayment: 10250,
				sessionAmount: 10000
			});

			expect(snapshot.fee).toBe(250);
			expect(snapshot.resolvedPaymentAmount).toBe(10250);
			expect(snapshot.hasClientPaymentAmountMismatch).toBe(true);
		});

		it('order finalization service creates missing verification token for existing order', async () => {
			await env.DB.prepare(
				`INSERT INTO orders (id, customer_name, customer_class, wa_number, pickup_time, total_amount, fee, payment_status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			).bind('INV-EXISTING-TOKEN', 'Budi', 'X TKJ', '6281234567890', 'Hari Ini - Istirahat Pertama (09.15)', 5000, 0, 'PAID').run();

			const token = await ensureExistingOrderVerificationToken(env, 'INV-EXISTING-TOKEN', null);
			expect(token).toMatch(/^[a-f0-9]{48}$/i);

			const order: any = await env.DB.prepare('SELECT verification_token FROM orders WHERE id = ?')
				.bind('INV-EXISTING-TOKEN')
				.first();
			expect(order.verification_token).toBe(token);

			const replayToken = await ensureExistingOrderVerificationToken(env, 'INV-EXISTING-TOKEN', token);
			expect(replayToken).toBe(token);
		});

		it('order finalization service rolls back cleanly on stock conflict', async () => {
			await env.DB.prepare('UPDATE products SET stock = ? WHERE code = ?').bind(1, 'P001').run();
			await env.DB.prepare(
				`INSERT INTO checkout_sessions (checkout_token, order_id, amount, status, expires_at)
				 VALUES (?, ?, ?, ?, datetime('now', '+5 minutes'))`
			).bind('b'.repeat(48), 'INV-STOCK-CONFLICT', 10000, 'ACTIVE').run();

			await expect(persistPaidOrder({
				env,
				checkoutToken: 'b'.repeat(48),
				orderId: 'INV-STOCK-CONFLICT',
				customerName: 'Budi',
				customerClass: 'X TKJ',
				waNumber: '6281234567890',
				pickupTime: 'Hari Ini - Istirahat Pertama (09.15)',
				subtotal: 10000,
				fee: 0,
				verificationToken: 'c'.repeat(48),
				secureItems: [{
					product: { code: 'P001', price: 5000 },
					quantity: 2,
					secure_price: 5000,
					secure_name: 'Pulpen Uji'
				}]
			})).rejects.toThrow('STOCK_CONFLICT');

			const order: any = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind('INV-STOCK-CONFLICT').first();
			const itemCount: any = await env.DB.prepare('SELECT COUNT(*) AS total FROM order_items WHERE order_id = ?').bind('INV-STOCK-CONFLICT').first();
			const product: any = await env.DB.prepare('SELECT stock FROM products WHERE code = ?').bind('P001').first();
			const session: any = await env.DB.prepare('SELECT status FROM checkout_sessions WHERE checkout_token = ?').bind('b'.repeat(48)).first();

			expect(order).toBeNull();
			expect(Number(itemCount.total)).toBe(0);
			expect(Number(product.stock)).toBe(1);
			expect(session.status).toBe('ACTIVE');
		});

		it('order finalization service rolls back cleanly on reservation conflict', async () => {
			await env.DB.prepare(
				`INSERT INTO checkout_sessions (checkout_token, order_id, amount, status, expires_at)
				 VALUES (?, ?, ?, ?, datetime('now', '+5 minutes'))`
			).bind('d'.repeat(48), 'INV-RESERVATION-CONFLICT', 5000, 'ACTIVE').run();

			await expect(persistPaidOrder({
				env,
				checkoutToken: 'd'.repeat(48),
				orderId: 'INV-RESERVATION-CONFLICT',
				customerName: 'Budi',
				customerClass: 'X TKJ',
				waNumber: '6281234567890',
				pickupTime: 'Hari Ini - Istirahat Pertama (09.15)',
				subtotal: 5000,
				fee: 0,
				verificationToken: 'e'.repeat(48),
				secureItems: [{
					product: { code: 'P001', price: 5000 },
					quantity: 1,
					secure_price: 5000,
					secure_name: 'Pulpen Uji'
				}]
			})).rejects.toThrow('RESERVATION_CONFLICT');

			const order: any = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind('INV-RESERVATION-CONFLICT').first();
			const itemCount: any = await env.DB.prepare('SELECT COUNT(*) AS total FROM order_items WHERE order_id = ?').bind('INV-RESERVATION-CONFLICT').first();
			const product: any = await env.DB.prepare('SELECT stock FROM products WHERE code = ?').bind('P001').first();
			const session: any = await env.DB.prepare('SELECT status FROM checkout_sessions WHERE checkout_token = ?').bind('d'.repeat(48)).first();

			expect(order).toBeNull();
			expect(Number(itemCount.total)).toBe(0);
			expect(Number(product.stock)).toBe(20);
			expect(session.status).toBe('ACTIVE');
		});

		it('payment session cleanup deletes expired checkout sessions and stale non-active rows', async () => {
			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status,
					payment_started_at, gateway_status, created_at, expires_at
				) VALUES
					(?, ?, ?, 'ACTIVE', datetime('now', '-1 day'), 'pending', datetime('now', '-1 day'), datetime('now', '-1 day')),
					(?, ?, ?, 'CANCELLED', datetime('now', '-2 day'), 'expired', datetime('now', '-2 day'), datetime('now', '-2 day'))`
			).bind(
				'f'.repeat(48),
				'INV-EXPIRED-ACTIVE',
				5000,
				'9'.repeat(48),
				'INV-STALE-CANCELLED',
				5000
			).run();

			await cleanupCheckoutSessions(env, { force: true, includeHeavy: true });

			const expiredActiveRow: any = await env.DB.prepare(
				'SELECT order_id FROM checkout_sessions WHERE checkout_token = ?'
			).bind('f'.repeat(48)).first();
			const staleRow: any = await env.DB.prepare(
				'SELECT order_id FROM checkout_sessions WHERE checkout_token = ?'
			).bind('9'.repeat(48)).first();

			expect(expiredActiveRow).toBeNull();
			expect(staleRow).toBeNull();
		});

		it('rate limit middleware only emits one limit log per client within the same window', async () => {
			const onLimit = vi.fn();
			const app = new Hono();
			app.use('/limited', createRateLimitMiddleware({
				namespace: 'test-rate-limit-dedupe',
				windowMs: 60_000,
				max: 1,
				message: 'blocked',
				onLimit
			}));
			app.get('/limited', (c) => c.json({ success: true }));

			const createRequest = () => new Request('http://example.com/limited', {
				headers: {
					'CF-Connecting-IP': '198.51.100.90',
					'User-Agent': 'Vitest Agent'
				}
			});

			expect((await app.request(createRequest())).status).toBe(200);
			expect((await app.request(createRequest())).status).toBe(429);
			expect((await app.request(createRequest())).status).toBe(429);
			expect(onLimit).toHaveBeenCalledTimes(1);
		});

		it('admin operational rate limit logs go to security topic', async () => {
			const originalFetch = globalThis.fetch;
			const capturedBodies: Array<Record<string, unknown>> = [];
			vi.stubGlobal('fetch', (async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedBodies.push(JSON.parse(String(init?.body || '{}')));
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}) as typeof fetch);

			try {
				const pending: Array<Promise<void>> = [];
				queueAdminOperationalLog({
					env: {
						TELEGRAM_BOT_TOKEN: 'token',
						TELEGRAM_CHAT_ID: '-100123',
						TELEGRAM_TOPIC_ORDER: '3',
						TELEGRAM_TOPIC_SECURITY: '4',
						TELEGRAM_TOPIC_ADMIN: '5',
						ENVIRONMENT: 'development'
					},
					req: {
						raw: new Request('http://example.com/api/admin/login', {
							method: 'POST',
							headers: {
								'CF-Connecting-IP': '198.51.100.91',
								'User-Agent': 'Mozilla/5.0 Test Browser'
							}
						})
					},
					executionCtx: {
						waitUntil(promise: Promise<void>) {
							pending.push(promise);
						}
					}
				} as any, 'Rate Limit: login admin', [
					'Method: POST',
					'Path: /api/admin/login'
				]);

				await Promise.all(pending);
				expect(capturedBodies).toHaveLength(1);
				expect(capturedBodies[0]?.message_thread_id).toBe(4);
			} finally {
				vi.stubGlobal('fetch', originalFetch);
			}
		});

		it('telegram operational log groups actor, status, and request metadata into readable sections', async () => {
			const originalFetch = globalThis.fetch;
			const capturedBodies: Array<Record<string, unknown>> = [];
			vi.stubGlobal('fetch', (async (_input: RequestInfo | URL, init?: RequestInit) => {
				capturedBodies.push(JSON.parse(String(init?.body || '{}')));
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}) as typeof fetch);

			try {
				await sendOperationalLog('token', '-100123', 5, {
					title: 'Log Admin: login gagal',
					lines: [
						'Username: admin',
						'Alasan: sandi tidak cocok',
						'Perangkat login: Chrome / Windows',
						'IP login: 198.51.100.92'
					]
				}, 'development');

				expect(capturedBodies).toHaveLength(1);
				const text = String(capturedBodies[0]?.text || '');
				expect(text).toContain('*Aktor / Pemesan*');
				expect(text).toContain('- Username: admin');
				expect(text).toContain('*Status dan Tindakan*');
				expect(text).toContain('- Penyebab: sandi tidak cocok');
				expect(text).toContain('*Asal Request*');
				expect(text).toContain('- Perangkat login: Chrome / Windows');
				expect(text).toContain('- IP login: 198.51.100.92');
			} finally {
				vi.stubGlobal('fetch', originalFetch);
			}
		});

		it('payment event route sends only abnormal frontend events to telegram', async () => {
			const originalFetch = globalThis.fetch;
			const telegramRequests: Array<Record<string, unknown>> = [];
			vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('api.telegram.org')) {
					telegramRequests.push(JSON.parse(String(init?.body || '{}')));
					return new Response(JSON.stringify({ ok: true }), { status: 200 });
				}
				return originalFetch(input, init);
			}) as typeof fetch);

			try {
				const checkoutToken = 'e'.repeat(48);
				await env.DB.prepare(
					`INSERT INTO checkout_sessions (
						checkout_token, order_id, amount, status,
						payment_started_at, gateway_expires_at, gateway_status, expires_at
					) VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now', '+10 minutes'), 'pending', datetime('now', '+10 minutes'))`
				).bind(checkoutToken, 'INV-PAYMENT-EVENT', 5000).run();

				const normalResponse = await SELF.fetch(new Request('http://example.com/api/payment/event', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Origin': 'http://example.com'
					},
					body: JSON.stringify({
						checkout_token: checkoutToken,
						event_type: 'recovery_started',
						mode: 'auto',
						note: 'user re-opened page'
					})
				}));
				expect(normalResponse.status).toBe(200);
				expect(telegramRequests).toHaveLength(0);

				const abnormalResponse = await SELF.fetch(new Request('http://example.com/api/payment/event', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Origin': 'http://example.com'
					},
					body: JSON.stringify({
						checkout_token: checkoutToken,
						event_type: 'order_save_fallback',
						mode: 'auto',
						note: 'frontend fallback triggered'
					})
				}));
				expect(abnormalResponse.status).toBe(200);
				expect(telegramRequests).toHaveLength(1);
				expect(String(telegramRequests[0]?.text || '')).toContain('pencatatan order fallback');
			} finally {
				vi.stubGlobal('fetch', originalFetch);
			}
		});

		it('Pakasir gateway service verifies completed transaction and rejects total mismatch', async () => {
			const originalFetch = globalThis.fetch;
			vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
				transaction: {
					order_id: 'INV-SERVICE-GATEWAY',
					status: 'completed',
					total_payment: 10250,
					amount: 10000,
					completed_at: '2026-04-17T01:00:00.000Z'
				}
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})) as typeof fetch);

			try {
				const okResult = await verifyPakasirPaymentCompleted(
					{ ...env, PAKASIR_PROJECT_SLUG: 'koperasi', PAKASIR_API_KEY: 'secret' } as any,
					'INV-SERVICE-GATEWAY',
					10000,
					10250
				);
				expect(okResult.ok).toBe(true);

				const mismatchResult = await verifyPakasirPaymentCompleted(
					{ ...env, PAKASIR_PROJECT_SLUG: 'koperasi', PAKASIR_API_KEY: 'secret' } as any,
					'INV-SERVICE-GATEWAY',
					10000,
					10000
				);
				expect(mismatchResult.ok).toBe(false);
				expect(mismatchResult.status).toBe(409);
			} finally {
				vi.stubGlobal('fetch', originalFetch);
			}
		});
	});

});
