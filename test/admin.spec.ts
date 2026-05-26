import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDatabase } from './helpers.js';

describe('Koperasi Backend API', () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	describe('Admin Login', () => {
		const ADMIN_PASSWORD_HASH = '$2b$10$AU5VGuv2GO3XRHLxYJgiIOG0q45mS7bRNiNZqrX6lLY1vpcUAqwRi';

		async function seedAdminUser() {
			await env.DB.prepare(
				`INSERT INTO admin_users (username, password_hash)
				 VALUES (?, ?)`
			).bind('admin', ADMIN_PASSWORD_HASH).run();
		}

		function extractCookieHeader(response: Response): string {
			const setCookie = String(response.headers.get('set-cookie') || '').trim();
			if (!setCookie) return '';
			return setCookie.split(';')[0] || '';
		}

		it('POST /api/admin/login requires credentials', async () => {
			const request = new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({})
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
		});

		it('POST /api/admin/login rejects malformed JSON body with 400', async () => {
			const request = new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'CF-Connecting-IP': '198.51.100.201'
				},
				body: '{"username":'
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.code || '')).toBe('E-ADMIN-LOGIN-JSON');
		});

		it('POST /api/admin/change-password rejects malformed JSON body with 400', async () => {
			await seedAdminUser();
			const loginResponse = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'CF-Connecting-IP': '198.51.100.202'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(loginResponse.status).toBe(200);
			const adminCookie = extractCookieHeader(loginResponse);

			const request = new Request('http://example.com/api/admin/change-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': adminCookie
				},
				body: '{"current_password":'
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.code || '')).toBe('E-ADMIN-PASSWORD-JSON');
		});

		it('PUT /api/admin/store-status rejects malformed JSON body with 400', async () => {
			await seedAdminUser();
			const loginResponse = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'CF-Connecting-IP': '198.51.100.203'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(loginResponse.status).toBe(200);
			const adminCookie = extractCookieHeader(loginResponse);

			const request = new Request('http://example.com/api/admin/store-status', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': adminCookie
				},
				body: '{"accepting_orders":'
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.code || '')).toBe('E-STORE-STATUS-JSON');
		});

		it('POST /api/admin/products/upload rejects oversized multipart payload', async () => {
			await seedAdminUser();

			const loginRequest = new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			});
			const loginResponse = await SELF.fetch(loginRequest);
			expect(loginResponse.status).toBe(200);

			const adminCookie = extractCookieHeader(loginResponse);
			expect(adminCookie).toContain('admin_token=');

			const oversizedPayload = 'x'.repeat((4 * 1024 * 1024) + 64);
			const uploadRequest = new Request('http://example.com/api/admin/products/upload', {
				method: 'POST',
				headers: {
					'Origin': 'http://example.com',
					'Cookie': adminCookie,
					'Content-Type': 'multipart/form-data; boundary=----codex-test-boundary'
				},
				body: oversizedPayload
			});

			const uploadResponse = await SELF.fetch(uploadRequest);
			expect(uploadResponse.status).toBe(413);
			const payload = await uploadResponse.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.code || '')).toBe('E-PROD-UPLOAD-SIZE');
		});

		it('POST /api/admin/products/upload rejects malformed multipart payload with 400', async () => {
			await seedAdminUser();

			const loginRequest = new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Origin': 'http://example.com' },
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			});
			const loginResponse = await SELF.fetch(loginRequest);
			expect(loginResponse.status).toBe(200);

			const adminCookie = extractCookieHeader(loginResponse);
			expect(adminCookie).toContain('admin_token=');

			const uploadRequest = new Request('http://example.com/api/admin/products/upload', {
				method: 'POST',
				headers: {
					'Origin': 'http://example.com',
					'Cookie': adminCookie,
					'Content-Type': 'multipart/form-data'
				},
				body: '----malformed-multipart-body----'
			});

			const uploadResponse = await SELF.fetch(uploadRequest);
			expect(uploadResponse.status).toBe(400);
			const payload = await uploadResponse.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.code || '')).toBe('E-PROD-UPLOAD-MULTIPART');
		});

		it('POST /api/admin/products rejects malformed JSON body with 400', async () => {
			await seedAdminUser();
			const loginResponse = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'CF-Connecting-IP': '198.51.100.204'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(loginResponse.status).toBe(200);
			const adminCookie = extractCookieHeader(loginResponse);

			const request = new Request('http://example.com/api/admin/products', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': adminCookie
				},
				body: '{"code":'
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.code || '')).toBe('E-PROD-JSON');
		});

		it('PUT /api/admin/products/:id rejects malformed JSON body with 400', async () => {
			await seedAdminUser();
			const loginResponse = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'CF-Connecting-IP': '198.51.100.205'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(loginResponse.status).toBe(200);
			const adminCookie = extractCookieHeader(loginResponse);

			const insertResult: any = await env.DB.prepare(
				`INSERT INTO products (code, name, price, category, image_url, stock)
				 VALUES (?, ?, ?, ?, ?, ?)`
			).bind('PX01', 'Produk Uji', 7000, 'Alat Tulis', '/api/images/test.png', 10).run();
			const productId = Number(insertResult?.meta?.last_row_id || 0);
			expect(productId).toBeGreaterThan(0);

			const request = new Request(`http://example.com/api/admin/products/${productId}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': adminCookie
				},
				body: '{"name":'
			});
			const response = await SELF.fetch(request);
			expect(response.status).toBe(400);
			const payload = await response.json<any>();
			expect(payload.success).toBe(false);
			expect(String(payload.code || '')).toBe('E-PROD-JSON');
		});

		it('login baru menginvalidasi sesi lama dan mengembalikan metadata perangkat/IP/WIB', async () => {
			await seedAdminUser();

			const login1 = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
					'CF-Connecting-IP': '36.91.12.10'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login1.status).toBe(200);
			const cookie1 = extractCookieHeader(login1);
			expect(cookie1).toContain('admin_token=');
			expect(String(login1.headers.get('set-cookie') || '')).toContain('Max-Age=3600');

			const login2 = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
					'CF-Connecting-IP': '182.2.44.88'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login2.status).toBe(200);
			const cookie2 = extractCookieHeader(login2);
			expect(cookie2).toContain('admin_token=');

			const verifyOldSession = await SELF.fetch(new Request('http://example.com/api/admin/verify', {
				method: 'GET',
				headers: {
					'Cookie': cookie1
				}
			}));
			expect(verifyOldSession.status).toBe(401);
			const oldPayload = await verifyOldSession.json<any>();
			expect(oldPayload.success).toBe(false);
			expect(oldPayload.code).toBe('E-ADMIN-SESSION-REPLACED');
			expect(oldPayload.session_replaced_by?.ip).toBe('182.2.44.88');
			expect(String(oldPayload.session_replaced_by?.device || '')).toContain('Safari');
			expect(String(oldPayload.session_replaced_by?.device || '')).toContain('iPhone');
			expect(String(oldPayload.session_replaced_by?.login_at_wib || '')).toMatch(
				/^\d{2} [A-Za-z]{3} \d{4}, \d{2}:\d{2}:\d{2} WIB$/
			);

			const verifyNewSession = await SELF.fetch(new Request('http://example.com/api/admin/verify', {
				method: 'GET',
				headers: {
					'Cookie': cookie2
				}
			}));
			expect(verifyNewSession.status).toBe(200);
			const newPayload = await verifyNewSession.json<any>();
			expect(newPayload.success).toBe(true);
		});

		it('logout dari token lama yang sudah di-kick tidak menghapus sesi terbaru', async () => {
			await seedAdminUser();

			const login1 = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
					'CF-Connecting-IP': '36.91.12.10'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login1.status).toBe(200);
			const cookie1 = extractCookieHeader(login1);

			const login2 = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
					'CF-Connecting-IP': '182.2.44.88'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login2.status).toBe(200);
			const cookie2 = extractCookieHeader(login2);

			const rowBeforeLogout: any = await env.DB.prepare(
				'SELECT active_session_id FROM admin_users WHERE username = ?'
			).bind('admin').first();
			const activeSessionBefore = String(rowBeforeLogout?.active_session_id || '');
			expect(activeSessionBefore.length).toBeGreaterThan(0);

			const logoutFromOldSession = await SELF.fetch(new Request('http://example.com/api/admin/logout', {
				method: 'POST',
				headers: {
					'Origin': 'http://example.com',
					'Cookie': cookie1
				}
			}));
			expect(logoutFromOldSession.status).toBe(200);

			const rowAfterLogout: any = await env.DB.prepare(
				'SELECT active_session_id FROM admin_users WHERE username = ?'
			).bind('admin').first();
			const activeSessionAfter = String(rowAfterLogout?.active_session_id || '');
			expect(activeSessionAfter).toBe(activeSessionBefore);

			const verifyNewSession = await SELF.fetch(new Request('http://example.com/api/admin/verify', {
				method: 'GET',
				headers: {
					'Cookie': cookie2
				}
			}));
			expect(verifyNewSession.status).toBe(200);
		});

		it('ganti password berhasil mengakhiri semua sesi aktif dan mewajibkan login ulang', async () => {
			await seedAdminUser();

			const login = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
					'CF-Connecting-IP': '36.91.12.10'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login.status).toBe(200);
			const cookie = extractCookieHeader(login);

			const changePassword = await SELF.fetch(new Request('http://example.com/api/admin/change-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': cookie
				},
				body: JSON.stringify({
					current_password: 'admin123',
					new_password: 'Twosra#456789Ab',
					confirm_password: 'Twosra#456789Ab'
				})
			}));
			expect(changePassword.status).toBe(200);
			const changePayload = await changePassword.json<any>();
			expect(changePayload.success).toBe(true);

			const sessionRowAfterChange: any = await env.DB.prepare(
				'SELECT active_session_id FROM admin_users WHERE username = ?'
			).bind('admin').first();
			expect(String(sessionRowAfterChange?.active_session_id || '')).toBe('');

			const verifyOldSession = await SELF.fetch(new Request('http://example.com/api/admin/verify', {
				method: 'GET',
				headers: {
					'Cookie': cookie
				}
			}));
			expect(verifyOldSession.status).toBe(401);
			const verifyOldPayload = await verifyOldSession.json<any>();
			expect(verifyOldPayload.code).toBe('E-ADMIN-SESSION-REPLACED');

			const loginWithOldPassword = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(loginWithOldPassword.status).toBe(401);

			const loginWithNewPassword = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({ username: 'admin', password: 'Twosra#456789Ab' })
			}));
			expect(loginWithNewPassword.status).toBe(200);
		});

		it('ganti password ditolak jika password baru sama dengan password lama', async () => {
			await seedAdminUser();

			const login = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login.status).toBe(200);
			const cookie = extractCookieHeader(login);

			const changePassword = await SELF.fetch(new Request('http://example.com/api/admin/change-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': cookie
				},
				body: JSON.stringify({
					current_password: 'admin123',
					new_password: 'admin123',
					confirm_password: 'admin123'
				})
			}));
			expect(changePassword.status).toBe(400);
			const payload = await changePassword.json<any>();
			expect(payload.code).toBe('E-ADMIN-PASSWORD-SAME-AS-OLD');

			const verify = await SELF.fetch(new Request('http://example.com/api/admin/verify', {
				method: 'GET',
				headers: {
					'Cookie': cookie
				}
			}));
			expect(verify.status).toBe(200);
		});

		it('ganti password ditolak jika password baru tidak memenuhi policy', async () => {
			await seedAdminUser();

			const login = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login.status).toBe(200);
			const cookie = extractCookieHeader(login);

			const changePassword = await SELF.fetch(new Request('http://example.com/api/admin/change-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': cookie
				},
				body: JSON.stringify({
					current_password: 'admin123',
					new_password: 'Aa1!',
					confirm_password: 'Aa1!'
				})
			}));
			expect(changePassword.status).toBe(400);
			const payload = await changePassword.json<any>();
			expect(payload.code).toBe('E-ADMIN-PASSWORD-LENGTH');

			const verify = await SELF.fetch(new Request('http://example.com/api/admin/verify', {
				method: 'GET',
				headers: {
					'Cookie': cookie
				}
			}));
			expect(verify.status).toBe(200);
		});

		it('ganti password ditolak jika password lama salah tanpa memutus sesi aktif', async () => {
			await seedAdminUser();

			const login = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login.status).toBe(200);
			const cookie = extractCookieHeader(login);

			const changePassword = await SELF.fetch(new Request('http://example.com/api/admin/change-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'Cookie': cookie
				},
				body: JSON.stringify({
					current_password: 'Salah123!',
					new_password: 'Twosra#456789Ab',
					confirm_password: 'Twosra#456789Ab'
				})
			}));
			expect(changePassword.status).toBe(400);
			const payload = await changePassword.json<any>();
			expect(payload.code).toBe('E-ADMIN-PASSWORD-CURRENT-INVALID');

			const verify = await SELF.fetch(new Request('http://example.com/api/admin/verify', {
				method: 'GET',
				headers: {
					'Cookie': cookie
				}
			}));
			expect(verify.status).toBe(200);
		});

		it('GET /api/admin/orders/analytics menyertakan field lengkap untuk ekspor PDF/CSV', async () => {
			await seedAdminUser();

			await env.DB.prepare(
				`INSERT INTO orders (
					id, customer_name, customer_class, wa_number, pickup_time,
					total_amount, fee, payment_status, pickup_status, picked_up_at, verification_token
				) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', 'SUDAH_DIAMBIL', ?, ?)`
			).bind(
				'INVEXPORT001',
				'Siswa Export',
				'XI RPL 1',
				'6281234567000',
				'Istirahat Kedua (12.20)',
				12500,
				875,
				'2026-04-17 20:45:38',
				'tttttttttttttttttttttttttttttttttttttttttttttttt'
			).run();

			await env.DB.prepare(
				`INSERT INTO order_items (order_id, product_name, product_code_snapshot, quantity, price_at_purchase)
				 VALUES (?, ?, ?, ?, ?)`
			).bind('INVEXPORT001', 'Pulpen Uji', 'PTEST01', 2, 6250).run();

			const login = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login.status).toBe(200);
			const cookie = extractCookieHeader(login);

			const response = await SELF.fetch(new Request('http://example.com/api/admin/orders/analytics?date_filter=all&limit=5000', {
				method: 'GET',
				headers: {
					'Cookie': cookie
				}
			}));
			expect(response.status).toBe(200);
			const payload = await response.json<any>();
			expect(payload.success).toBe(true);
			expect(Array.isArray(payload.data)).toBe(true);

			const row = payload.data.find((item: any) => String(item?.id || '') === 'INVEXPORT001');
			expect(row).toBeTruthy();
			expect(String(row.customer_name || '')).toBe('Siswa Export');
			expect(String(row.customer_class || '')).toBe('XI RPL 1');
			expect(String(row.wa_number || '')).toBe('6281234567000');
			expect(String(row.pickup_time || '')).toBe('Istirahat Kedua (12.20)');
			expect(String(row.pickup_status || '')).toBe('SUDAH_DIAMBIL');
			expect(String(row.picked_up_at || '')).toBe('2026-04-17T20:45:38Z');
			expect(Number(row.total_amount || 0)).toBe(12500);
			expect(Number(row.fee || 0)).toBe(875);
			expect(Array.isArray(row.items)).toBe(true);
			expect(row.items.length).toBeGreaterThan(0);
			expect(String(row.items[0]?.product_name || '')).toBe('Pulpen Uji');
			expect(Number(row.items[0]?.quantity || 0)).toBe(2);
		});

		it('GET /api/admin/orders menyertakan total pending pickup untuk seluruh hasil filter walau halaman dipaginasi', async () => {
			await seedAdminUser();

			await env.DB.prepare(
				`INSERT INTO orders (
					id, customer_name, customer_class, wa_number, pickup_time,
					total_amount, fee, payment_status, pickup_status, verification_token
				) VALUES
					(?, ?, ?, ?, ?, ?, ?, 'PAID', 'BELUM_DIAMBIL', ?),
					(?, ?, ?, ?, ?, ?, ?, 'PAID', 'SUDAH_DIAMBIL', ?),
					(?, ?, ?, ?, ?, ?, ?, 'PAID', 'BELUM_DIAMBIL', ?)`
			).bind(
				'INVPAGE001',
				'Siswa A',
				'X RPL',
				'628111111111',
				'Istirahat Pertama (09.15)',
				5000,
				0,
				'a'.repeat(48),
				'INVPAGE002',
				'Siswa B',
				'X RPL',
				'628222222222',
				'Istirahat Pertama (09.15)',
				6000,
				0,
				'b'.repeat(48),
				'INVPAGE003',
				'Siswa C',
				'X RPL',
				'Istirahat Pertama (09.15)',
				'628333333333',
				7000,
				0,
				'c'.repeat(48)
			).run();

			const login = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com',
					'CF-Connecting-IP': '198.51.100.250'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login.status).toBe(200);
			const cookie = extractCookieHeader(login);

			const response = await SELF.fetch(new Request('http://example.com/api/admin/orders?page=1&limit=1&date_filter=all', {
				method: 'GET',
				headers: {
					'Cookie': cookie
				}
			}));
			expect(response.status).toBe(200);
			const payload = await response.json<any>();
			expect(payload.success).toBe(true);
			expect(Array.isArray(payload.data)).toBe(true);
			expect(payload.data).toHaveLength(1);
			expect(Number(payload.meta?.total || 0)).toBe(3);
			expect(Number(payload.meta?.pendingPickupTotal || 0)).toBe(2);
		});

		it('GET /api/admin/orders/analytics memuat item untuk lebih dari 100 order dengan query chunked', async () => {
			await seedAdminUser();

			for (let index = 0; index < 125; index += 1) {
				const orderId = `INVBULK${String(index).padStart(4, '0')}`;
				const verificationToken = (index + 1).toString(16).padStart(48, '0');
				await env.DB.prepare(
					`INSERT INTO orders (
						id, customer_name, customer_class, wa_number, pickup_time,
						total_amount, fee, payment_status, verification_token
					) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?)`
				).bind(
					orderId,
					`Siswa Bulk ${index}`,
					'X TKJ',
					`62812345${String(index).padStart(6, '0')}`,
					'Istirahat Pertama (09.15)',
					5000,
					345,
					verificationToken
				).run();

				await env.DB.prepare(
					`INSERT INTO order_items (order_id, product_name, product_code_snapshot, quantity, price_at_purchase)
					 VALUES (?, ?, ?, ?, ?)`
				).bind(orderId, 'Pulpen Uji', 'P001', 1, 5000).run();
			}

			const login = await SELF.fetch(new Request('http://example.com/api/admin/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Origin': 'http://example.com'
				},
				body: JSON.stringify({ username: 'admin', password: 'admin123' })
			}));
			expect(login.status).toBe(200);
			const cookie = extractCookieHeader(login);

			const response = await SELF.fetch(new Request('http://example.com/api/admin/orders/analytics?date_filter=all&limit=150', {
				method: 'GET',
				headers: {
					'Cookie': cookie
				}
			}));
			expect(response.status).toBe(200);
			const payload = await response.json<any>();
			expect(payload.success).toBe(true);
			expect(payload.data).toHaveLength(125);
			expect(payload.data.every((row: any) => Array.isArray(row.items) && row.items.length === 1)).toBe(true);
			expect(payload.meta.truncated).toBe(false);
		});
	});

});
