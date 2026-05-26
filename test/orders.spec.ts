import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getValidPickupSelection, resetTestDatabase } from './helpers.js';

describe('Koperasi Backend API', () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	describe('Orders API Idempotency', () => {
		it('POST /api/orders rejects malformed JSON body with 400', async () => {
			const request = new Request('http://example.com/api/orders', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: '{"checkout_token":'
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('Format JSON tidak valid');
		});

		it('POST /api/orders rejects expired checkout session and releases reservations', async () => {
			const checkoutToken = 'efefefefefefefefefefefefefefefefefefefefefefefef';
			const orderId = 'INVEXPIREDORDER01';
			const { pickupDate, pickupSlot } = getValidPickupSelection();

			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status, gateway_status,
					gateway_total_payment, gateway_fee, payment_started_at, expires_at
				) VALUES (?, ?, ?, 'ACTIVE', 'pending', ?, ?, datetime('now', '-5 minutes'), datetime('now', '-1 minute'))`
			).bind(
				checkoutToken,
				orderId,
				5000,
				5345,
				345
			).run();

			await env.DB.prepare(
				`INSERT INTO stock_reservations (
					checkout_token, order_id, product_code, quantity, status, expires_at
				) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`
			).bind(checkoutToken, orderId, 'P001', 1, 'RESERVED').run();

			const request = new Request('http://example.com/api/orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					checkout_token: checkoutToken,
					id_transaksi: orderId,
					nama: 'Siswa Uji',
					kelas: 'X TKJ',
					wa: '6281234567890',
					pickup_date: pickupDate,
					pickup_slot: pickupSlot,
					total: 5000,
					payment_amount: 5345,
					items: [{ product: { code: 'P001', price: 5000 }, quantity: 1 }]
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(404);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('kedaluwarsa');

			const sessionRow: any = await env.DB.prepare(
				'SELECT status FROM checkout_sessions WHERE checkout_token = ?'
			).bind(checkoutToken).first();
			expect(String(sessionRow?.status || '')).toBe('CANCELLED');

			const reservationRow: any = await env.DB.prepare(
				'SELECT status, release_reason FROM stock_reservations WHERE checkout_token = ?'
			).bind(checkoutToken).first();
			expect(String(reservationRow?.status || '')).toBe('RELEASED');
			expect(String(reservationRow?.release_reason || '')).toBe('EXPIRED');
		});

		it('POST /api/orders returns idempotent success immediately when order already exists', async () => {
			const checkoutToken = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
			const orderId = 'INVORDERIDEM01';
			const { pickupDate, pickupSlot } = getValidPickupSelection();

			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status, gateway_status,
					gateway_total_payment, gateway_fee, payment_started_at, expires_at
				) VALUES (?, ?, ?, 'ACTIVE', 'completed', ?, ?, datetime('now'), datetime('now', '+10 minutes'))`
			).bind(
				checkoutToken,
				orderId,
				5000,
				5345,
				345
			).run();

			await env.DB.prepare(
				`INSERT INTO orders (
					id, customer_name, customer_class, wa_number, pickup_time,
					total_amount, fee, payment_status, verification_token
				) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?)`
			).bind(
				orderId,
				'Siswa Uji',
				'X TKJ',
				'6281234567890',
				'Istirahat Pertama (09.15)',
				5000,
				345,
				'cccccccccccccccccccccccccccccccccccccccccccccccc'
			).run();

			await env.DB.prepare(
				`INSERT INTO order_items (order_id, product_name, product_code_snapshot, quantity, price_at_purchase)
				 VALUES (?, ?, ?, ?, ?)`
			).bind(orderId, 'Pulpen Uji', 'PTEST01', 1, 5000).run();

			const request = new Request('http://example.com/api/orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					checkout_token: checkoutToken,
					id_transaksi: orderId,
					nama: 'Siswa Uji',
					kelas: 'X TKJ',
					wa: '6281234567890',
					pickup_date: pickupDate,
					pickup_slot: pickupSlot,
					total: 5000,
					payment_amount: 5345,
					waktu_pembayaran: '2026-04-07T13:00:00.000Z',
					items: []
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const payload = await response.json<any>();
			expect(payload.success).toBe(true);
			expect(payload.message).toBe('Order already recorded');
			expect(payload.verification_token).toBe('cccccccccccccccccccccccccccccccccccccccccccccccc');

			const sessionRow: any = await env.DB.prepare(
				'SELECT status FROM checkout_sessions WHERE checkout_token = ?'
			).bind(checkoutToken).first();
			expect(String(sessionRow?.status)).toBe('COMPLETED');
		});

		it('POST /api/orders rejects mismatched order id against checkout session', async () => {
			const checkoutToken = 'dddddddddddddddddddddddddddddddddddddddddddddddd';
			const { pickupDate, pickupSlot } = getValidPickupSelection();

			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status, gateway_status,
					gateway_total_payment, gateway_fee, payment_started_at, expires_at
				) VALUES (?, ?, ?, 'ACTIVE', 'completed', ?, ?, datetime('now'), datetime('now', '+10 minutes'))`
			).bind(
				checkoutToken,
				'INVREALORDER01',
				5000,
				5345,
				345
			).run();

			const request = new Request('http://example.com/api/orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					checkout_token: checkoutToken,
					id_transaksi: 'INVFAKEORDER99',
					nama: 'Siswa Uji',
					kelas: 'X TKJ',
					wa: '6281234567890',
					pickup_date: pickupDate,
					pickup_slot: pickupSlot,
					total: 5000,
					payment_amount: 5345,
					waktu_pembayaran: '2026-04-07T13:00:00.000Z',
					items: []
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(payload.message).toContain('ID transaksi tidak cocok');
		});

		it('POST /api/orders rejects when gateway nominal mismatches checkout snapshot', async () => {
			const checkoutToken = 'abababababababababababababababababababababababab';
			const orderId = 'INVGATEWAYMISMATCH01';
			const { pickupDate, pickupSlot } = getValidPickupSelection();

			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status, gateway_status,
					gateway_total_payment, gateway_fee, payment_started_at, expires_at
				) VALUES (?, ?, ?, 'ACTIVE', 'completed', ?, ?, datetime('now'), datetime('now', '+10 minutes'))`
			).bind(
				checkoutToken,
				orderId,
				5000,
				5345,
				345
			).run();

			await env.DB.prepare(
				`INSERT INTO stock_reservations (
					checkout_token, order_id, product_code, quantity, status, expires_at
				) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`
			).bind(checkoutToken, orderId, 'P001', 1, 'RESERVED').run();

			const originalFetch = globalThis.fetch;
			vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

				if (url.startsWith('https://app.pakasir.com/api/transactiondetail')) {
					return new Response(JSON.stringify({
						transaction: {
							status: 'completed',
							order_id: orderId,
							total_payment: 9999,
							completed_at: '2026-04-07T13:00:00.000Z'
						}
					}), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				return originalFetch(input, init);
			}) as typeof fetch);

			try {
				const request = new Request('http://example.com/api/orders', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
					body: JSON.stringify({
						checkout_token: checkoutToken,
						id_transaksi: orderId,
						nama: 'Siswa Uji',
						kelas: 'X TKJ',
						wa: '6281234567890',
						pickup_date: pickupDate,
						pickup_slot: pickupSlot,
						total: 5000,
						payment_amount: 5345,
						items: [{ product: { code: 'P001', price: 5000 }, quantity: 1 }]
					})
				});

				const response = await SELF.fetch(request);
				expect(response.status).toBe(409);
				const payload = await response.json<any>();
				expect(payload.success).toBe(false);
				expect(String(payload.message || '')).toContain('Nominal pembayaran gateway tidak cocok');

				const orderRow: any = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(orderId).first();
				expect(orderRow).toBeNull();
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('POST /api/orders accepts gateway amount-only detail when subtotal matches checkout amount', async () => {
			const checkoutToken = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
			const orderId = 'INVGATEWAYAMOUNTONLY01';
			const { pickupDate, pickupSlot } = getValidPickupSelection();

			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status, gateway_status,
					gateway_total_payment, gateway_fee, payment_started_at, expires_at
				) VALUES (?, ?, ?, 'ACTIVE', 'completed', ?, ?, datetime('now'), datetime('now', '+10 minutes'))`
			).bind(
				checkoutToken,
				orderId,
				5000,
				5345,
				345
			).run();

			await env.DB.prepare(
				`INSERT INTO stock_reservations (
					checkout_token, order_id, product_code, quantity, status, expires_at
				) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`
			).bind(checkoutToken, orderId, 'P001', 1, 'RESERVED').run();

			const originalFetch = globalThis.fetch;
			vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

				if (url.startsWith('https://app.pakasir.com/api/transactiondetail')) {
					return new Response(JSON.stringify({
						transaction: {
							status: 'completed',
							order_id: orderId,
							amount: 5000,
							completed_at: '2026-04-07T13:00:00.000Z'
						}
					}), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				return originalFetch(input, init);
			}) as typeof fetch);

			try {
				const request = new Request('http://example.com/api/orders', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
					body: JSON.stringify({
						checkout_token: checkoutToken,
						id_transaksi: orderId,
						nama: 'Siswa Uji',
						kelas: 'X TKJ',
						wa: '6281234567890',
						pickup_date: pickupDate,
						pickup_slot: pickupSlot,
						total: 5000,
						payment_amount: 5345,
						items: [{ product: { code: 'P001', price: 5000 }, quantity: 1 }]
					})
				});

				const response = await SELF.fetch(request);
				expect(response.status).toBe(200);
				const payload = await response.json<any>();
				expect(payload.success).toBe(true);

				const orderRow: any = await env.DB.prepare('SELECT id FROM orders WHERE id = ?').bind(orderId).first();
				expect(orderRow?.id).toBe(orderId);
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('POST /api/orders handles parallel double-submit without creating duplicate orders', async () => {
			const checkoutToken = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
			const orderId = 'INVPARALLELDOUBLE01';
			const { pickupDate, pickupSlot } = getValidPickupSelection();

			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status, gateway_status,
					gateway_total_payment, gateway_fee, payment_started_at, expires_at
				) VALUES (?, ?, ?, 'ACTIVE', 'completed', ?, ?, datetime('now'), datetime('now', '+10 minutes'))`
			).bind(
				checkoutToken,
				orderId,
				5000,
				5345,
				345
			).run();

			await env.DB.prepare(
				`INSERT INTO stock_reservations (
					checkout_token, order_id, product_code, quantity, status, expires_at
				) VALUES (?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`
			).bind(checkoutToken, orderId, 'P001', 1, 'RESERVED').run();

			const originalFetch = globalThis.fetch;
			vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

				if (url.startsWith('https://app.pakasir.com/api/transactiondetail')) {
					return new Response(JSON.stringify({
						transaction: {
							status: 'completed',
							order_id: orderId,
							total_payment: 5345,
							completed_at: '2026-04-07T13:00:00.000Z'
						}
					}), {
						status: 200,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				return originalFetch(input, init);
			}) as typeof fetch);

			const requestInit: RequestInit = {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					checkout_token: checkoutToken,
					id_transaksi: orderId,
					nama: 'Siswa Uji',
					kelas: 'X TKJ',
					wa: '6281234567890',
					pickup_date: pickupDate,
					pickup_slot: pickupSlot,
					total: 5000,
					payment_amount: 5345,
					items: [{ product: { code: 'P001', price: 5000 }, quantity: 1 }]
				})
			};

			try {
				const [responseA, responseB] = await Promise.all([
					SELF.fetch(new Request('http://example.com/api/orders', requestInit)),
					SELF.fetch(new Request('http://example.com/api/orders', requestInit))
				]);

				const statuses = [responseA.status, responseB.status];
				expect(statuses.some((status) => status === 200)).toBe(true);
				expect(statuses.every((status) => status < 500)).toBe(true);

				const orderCountRow: any = await env.DB.prepare(
					'SELECT COUNT(*) AS total FROM orders WHERE id = ?'
				).bind(orderId).first();
				expect(Number(orderCountRow?.total || 0)).toBe(1);

				const sessionRow: any = await env.DB.prepare(
					'SELECT status FROM checkout_sessions WHERE checkout_token = ?'
				).bind(checkoutToken).first();
				expect(String(sessionRow?.status || '')).toBe('COMPLETED');

				const reservedCountRow: any = await env.DB.prepare(
					'SELECT COUNT(*) AS total FROM stock_reservations WHERE checkout_token = ? AND status = ?'
				).bind(checkoutToken, 'RESERVED').first();
				expect(Number(reservedCountRow?.total || 0)).toBe(0);
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});

});
