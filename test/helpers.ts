import { env } from 'cloudflare:test';
import { resetRateLimitStateForTests } from '../src/middleware/rate-limit.js';

export function getValidPickupSelection() {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Jakarta',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		hour12: false
	});
	const nowParts = formatter.formatToParts(new Date());
	let year = 0;
	let month = 0;
	let day = 0;
	let hour = 0;
	let minute = 0;
	let second = 0;

	for (const part of nowParts) {
		if (part.type === 'year') year = Number(part.value);
		if (part.type === 'month') month = Number(part.value);
		if (part.type === 'day') day = Number(part.value);
		if (part.type === 'hour') hour = Number(part.value);
		if (part.type === 'minute') minute = Number(part.value);
		if (part.type === 'second') second = Number(part.value);
	}

	const wibNow = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
	const currentTime = wibNow.getUTCHours() + (wibNow.getUTCMinutes() / 60);
	const cutoffFirstBreak = 9 + (15 / 60);
	const cutoffSecondBreak = 12 + (20 / 60);

	for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
		const checkDate = new Date(wibNow);
		checkDate.setUTCDate(checkDate.getUTCDate() + dayOffset);
		const dayOfWeek = checkDate.getUTCDay();
		if (dayOfWeek < 1 || dayOfWeek > 5) continue;

		let slots: string[] = ['FIRST_BREAK', 'SECOND_BREAK'];
		if (dayOffset === 0) {
			if (currentTime < cutoffFirstBreak) {
				slots = ['FIRST_BREAK', 'SECOND_BREAK'];
			} else if (currentTime <= cutoffSecondBreak) {
				slots = ['SECOND_BREAK'];
			} else {
				slots = [];
			}
		}

		if (slots.length === 0) continue;
		const pickupDate = `${checkDate.getUTCFullYear()}-${String(checkDate.getUTCMonth() + 1).padStart(2, '0')}-${String(checkDate.getUTCDate()).padStart(2, '0')}`;
		return { pickupDate, pickupSlot: slots[0] as 'FIRST_BREAK' | 'SECOND_BREAK' };
	}

	return { pickupDate: '2099-01-01', pickupSlot: 'FIRST_BREAK' as const };
}

export async function resetTestDatabase() {
	resetRateLimitStateForTests();

	const statements = [
		'DROP TABLE IF EXISTS order_items',
		'DROP TABLE IF EXISTS stock_reservations',
		'DROP TABLE IF EXISTS checkout_sessions',
		'DROP TABLE IF EXISTS orders',
		'DROP TABLE IF EXISTS store_status',
		'DROP TABLE IF EXISTS products',
		'DROP TABLE IF EXISTS admin_users',
		`CREATE TABLE products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			price INTEGER NOT NULL,
			category TEXT NOT NULL,
			image_url TEXT,
			stock INTEGER DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE admin_users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			active_session_id TEXT,
			session_last_login_ip TEXT,
			session_last_login_device TEXT,
			session_last_login_at TIMESTAMP,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE checkout_sessions (
			checkout_token TEXT PRIMARY KEY,
			order_id TEXT NOT NULL UNIQUE,
			amount INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'ACTIVE',
			payment_started_at TIMESTAMP,
			gateway_expires_at TIMESTAMP,
			gateway_status TEXT,
			gateway_total_payment INTEGER,
			gateway_fee INTEGER DEFAULT 0,
			gateway_payment_number TEXT,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			expires_at TIMESTAMP NOT NULL
		)`,
		`CREATE TABLE orders (
			id TEXT PRIMARY KEY,
			customer_name TEXT NOT NULL,
			customer_class TEXT NOT NULL,
			wa_number TEXT NOT NULL,
			pickup_time TEXT NOT NULL,
			total_amount INTEGER NOT NULL,
			fee INTEGER DEFAULT 0,
			payment_status TEXT DEFAULT 'PAID',
			pickup_status TEXT NOT NULL DEFAULT 'BELUM_DIAMBIL',
			picked_up_at TIMESTAMP,
			verification_token TEXT UNIQUE,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE order_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			order_id TEXT NOT NULL,
			product_name TEXT NOT NULL,
			product_code_snapshot TEXT NOT NULL DEFAULT '',
			quantity INTEGER NOT NULL,
			price_at_purchase INTEGER NOT NULL
		)`,
		`CREATE TABLE stock_reservations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			checkout_token TEXT NOT NULL,
			order_id TEXT NOT NULL,
			product_id INTEGER,
			product_code TEXT NOT NULL,
			quantity INTEGER NOT NULL CHECK (quantity > 0),
			status TEXT NOT NULL DEFAULT 'RESERVED',
			expires_at TIMESTAMP NOT NULL,
			release_reason TEXT,
			released_at TIMESTAMP,
			consumed_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE store_status (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			accepting_orders INTEGER NOT NULL DEFAULT 1,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_by TEXT
		)`,
	];

	for (const sql of statements) {
		await env.DB.prepare(sql).run();
	}

	await env.DB.prepare(
		`INSERT INTO products (code, name, price, category, image_url, stock)
		 VALUES (?, ?, ?, ?, ?, ?)`
	)
		.bind('P001', 'Pulpen Uji', 5000, 'Alat Tulis', '/api/images/test.png', 20)
		.run();

	await env.DB.prepare(
		`INSERT INTO store_status (id, accepting_orders, updated_at, updated_by)
		 VALUES (1, 1, CURRENT_TIMESTAMP, NULL)`
	).run();
}
