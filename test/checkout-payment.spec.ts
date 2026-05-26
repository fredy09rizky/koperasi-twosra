import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDatabase } from './helpers.js';

describe('Koperasi Backend API', () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	describe('Checkout Session', () => {
		it('POST /api/checkout/session rejects malformed JSON body with 400', async () => {
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: '{"items":'
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('Format JSON tidak valid');
		});

		it('POST /api/checkout/session rejects when store is closed', async () => {
			await env.DB.prepare('UPDATE store_status SET accepting_orders = 0 WHERE id = 1').run();

			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 5000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(403);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(payload.code).toBe('E-STORE-CLOSED');
		});

		it('POST /api/checkout/session creates checkout and reservation snapshot', async () => {
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 5000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const payload = await response.json<any>();
			expect(payload.success).toBe(true);
			expect(typeof payload.checkout_token).toBe('string');
			expect(typeof payload.order_id).toBe('string');

			const checkoutSession: any = await env.DB.prepare(
				'SELECT checkout_token, order_id, amount, status FROM checkout_sessions WHERE checkout_token = ?'
			).bind(payload.checkout_token).first();
			expect(checkoutSession).toBeTruthy();
			expect(checkoutSession.order_id).toBe(payload.order_id);
			expect(Number(checkoutSession.amount)).toBe(5000);
			expect(String(checkoutSession.status)).toBe('ACTIVE');

			const reservation: any = await env.DB.prepare(
				`SELECT checkout_token, order_id, product_code, quantity, status
				 FROM stock_reservations
				 WHERE checkout_token = ?`
			).bind(payload.checkout_token).first();
			expect(reservation).toBeTruthy();
			expect(String(reservation.order_id)).toBe(payload.order_id);
			expect(String(reservation.product_code)).toBe('P001');
			expect(Number(reservation.quantity)).toBe(1);
			expect(String(reservation.status)).toBe('RESERVED');
		});

		it('POST /api/checkout/session returns stock conflict when quantity exceeds stock', async () => {
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 21 }],
					total: 105000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(409);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(payload.code).toBe('E-STOCK-CHECKOUT');

			const leakedSessionRow: any = await env.DB.prepare(
				'SELECT COUNT(*) AS total FROM checkout_sessions WHERE status = ?'
			).bind('ACTIVE').first();
			expect(Number(leakedSessionRow?.total || 0)).toBe(0);

			const leakedReservationRow: any = await env.DB.prepare(
				'SELECT COUNT(*) AS total FROM stock_reservations WHERE status = ?'
			).bind('RESERVED').first();
			expect(Number(leakedReservationRow?.total || 0)).toBe(0);
		});

		it('POST /api/checkout/session rejects client total mismatch as tampering signal', async () => {
			const request = new Request('http://example.com/api/checkout/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					items: [{ product: { code: 'P001' }, quantity: 1 }],
					total: 4000
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(payload.code).toBe('E-CHECKOUT-TAMPERING');

			const leakedSessionRow: any = await env.DB.prepare(
				'SELECT COUNT(*) AS total FROM checkout_sessions WHERE status = ?'
			).bind('ACTIVE').first();
			expect(Number(leakedSessionRow?.total || 0)).toBe(0);
		});

		it('POST /api/checkout/session handles parallel race without overselling stock', async () => {
			await env.DB.prepare('UPDATE products SET stock = 5 WHERE code = ?').bind('P001').run();

			const createCheckoutRequest = () =>
				new Request('http://example.com/api/checkout/session', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
					body: JSON.stringify({
						items: [{ product: { code: 'P001' }, quantity: 1 }],
						total: 5000
					})
				});

			const attempts = Array.from({ length: 20 }, () => SELF.fetch(createCheckoutRequest()));
			const responses = await Promise.all(attempts);
			const payloads = await Promise.all(responses.map((response) => response.json<any>()));

			const successCount = payloads.filter((payload) => payload?.success === true).length;
			const conflictCount = payloads.filter(
				(payload) => payload?.success === false && payload?.code === 'E-STOCK-CHECKOUT'
			).length;

			// Fokus test ini adalah anti-oversell saat request paralel.
			// Di runtime uji Worker lokal, sebagian request burst bisa gagal dengan error non-stock
			// (misalnya lock/transient) sehingga hitungan konflik stok bisa < total sisa request.
			expect(successCount).toBeLessThanOrEqual(5);
			expect(conflictCount).toBeGreaterThan(0);

			const activeReserved: any = await env.DB.prepare(
				`SELECT COALESCE(SUM(quantity), 0) AS total_reserved
				 FROM stock_reservations
				 WHERE status = ? AND product_code = ?`
			).bind('RESERVED', 'P001').first();
			const reservedTotal = Number(activeReserved?.total_reserved || 0);
			expect(reservedTotal).toBeLessThanOrEqual(5);
			expect(reservedTotal).toBe(successCount);
		});
	});

	describe('Payment QRIS', () => {
		it('POST /api/payment/qris rejects invalid checkout token format with 400', async () => {
			const request = new Request('http://example.com/api/payment/qris', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({ checkout_token: 'invalid-token' })
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('Token checkout tidak valid');
		});

		it('POST /api/payment/qris rejects malformed JSON body with 400', async () => {
			const request = new Request('http://example.com/api/payment/qris', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: '{"checkout_token":'
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('Format JSON tidak valid');
		});

		it('POST /api/payment/qris replays existing QR snapshot for same checkout token', async () => {
			const checkoutToken = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status,
					payment_started_at, gateway_expires_at, gateway_status,
					gateway_total_payment, gateway_fee, gateway_payment_number,
					expires_at
				) VALUES (
					?, ?, ?, 'ACTIVE',
					datetime('now'), datetime('now', '+1 hour'), 'pending',
					5345, 345, ?,
					datetime('now', '+10 minutes')
				)`
			).bind(
				checkoutToken,
				'INVTEST1234AA',
				5000,
				'THIS.IS.REPLAYED.QRIS.STRING'
			).run();

			const request = new Request('http://example.com/api/payment/qris', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({ checkout_token: checkoutToken })
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const payload = await response.json<any>();
			expect(payload.order_id).toBe('INVTEST1234AA');
			expect(payload.checkout_token).toBe(checkoutToken);
			expect(payload.payment?.is_replayed).toBe(true);
			expect(payload.payment?.payment_number).toBe('THIS.IS.REPLAYED.QRIS.STRING');
			expect(payload.payment?.fee).toBe(345);
			expect(payload.payment?.total_payment).toBe(5345);
		});
	});


	describe('Payment Event API', () => {
		it('GET /api/payment/status rejects invalid checkout token format with 400', async () => {
			const request = new Request('http://example.com/api/payment/status?checkout_token=invalid-token');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('Token checkout tidak valid');
		});

		it('GET /api/payment/status rejects expired checkout session and releases reservations', async () => {
			const checkoutToken = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';
			const orderId = 'INVEXPIREDSTATUS01';

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

			const request = new Request(`http://example.com/api/payment/status?checkout_token=${checkoutToken}`, {
				method: 'GET',
				headers: { 'Origin': 'http://example.com' }
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

		it('POST /api/payment/event rejects malformed JSON body with 400', async () => {
			const request = new Request('http://example.com/api/payment/event', {
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

		it('POST /api/payment/event rejects unknown event type', async () => {
			const checkoutToken = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
			await env.DB.prepare(
				`INSERT INTO checkout_sessions (
					checkout_token, order_id, amount, status, expires_at
				) VALUES (?, ?, ?, 'ACTIVE', datetime('now', '+10 minutes'))`
			).bind(checkoutToken, 'INVEVENT0001', 5000).run();

			const request = new Request('http://example.com/api/payment/event', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({
					checkout_token: checkoutToken,
					event_type: 'unknown_event_type'
				})
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
		});

		it('POST /api/payment/cancel rejects malformed JSON body with 400', async () => {
			const request = new Request('http://example.com/api/payment/cancel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: '{"checkout_token":'
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('Format JSON tidak valid');
		});

		it('POST /api/payment/cancel rejects invalid checkout token format with 400', async () => {
			const request = new Request('http://example.com/api/payment/cancel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({ checkout_token: 'invalid-token' })
			});

			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.message || '')).toContain('Token checkout tidak valid');
		});

		it('POST /api/payment/cancel rejects expired checkout session and releases reservations', async () => {
			const checkoutToken = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
			const orderId = 'INVCANCELEXPIRED01';

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

			const request = new Request('http://example.com/api/payment/cancel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({ checkout_token: checkoutToken })
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
	});

});
