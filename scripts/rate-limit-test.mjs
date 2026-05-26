#!/usr/bin/env node

/**
 * Rate Limit Stress Test
 *
 * Tujuan:
 * - Uji endpoint checkout/session dan admin/login terhadap spam request.
 * - Fokus utama: memastikan respon 429 muncul saat limit terlewati.
 *
 * Contoh:
 * - npm run test:rate-limit -- --base-url=https://koperasi-twosra.fredy09rizky.workers.dev --mode=both --requests=120 --concurrency=20
 * - npm run test:rate-limit -- --base-url=https://koperasi-twosra.fredy09rizky.workers.dev --mode=checkout --strict
 * - npm run test:rate-limit -- --base-url=https://koperasi-twosra.fredy09rizky.workers.dev --mode=admin-login --admin-user=admin --admin-pass=salah
 *
 * Opsi --strict: script exit 1 jika 429 tidak terdeteksi (berguna untuk CI).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadLocalDevVars() {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const devVarsPath = resolve(currentDir, '../.dev.vars');
	let raw = '';
	try {
		raw = readFileSync(devVarsPath, 'utf8');
	} catch {
		return;
	}

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const separatorIndex = trimmed.indexOf('=');
		if (separatorIndex <= 0) continue;
		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed.slice(separatorIndex + 1).trim();
		if (!key || process.env[key] !== undefined) continue;
		process.env[key] = value;
	}
}

function parseArgs(argv) {
	const parsed = {};
	for (const token of argv) {
		if (!token.startsWith('--')) continue;
		const eqIndex = token.indexOf('=');
		if (eqIndex < 0) {
			parsed[token.slice(2)] = 'true';
		} else {
			parsed[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
		}
	}
	return parsed;
}

function asInt(value, fallback) {
	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : fallback;
}

function clampInt(value, minValue, maxValue) {
	return Math.max(minValue, Math.min(maxValue, value));
}

function normalizeMode(value) {
	const mode = String(value || 'both').trim().toLowerCase();
	if (mode === 'checkout' || mode === 'admin-login' || mode === 'both') return mode;
	return 'both';
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}

function logStep(message) {
	process.stdout.write(`\n[RATE] ${message}\n`);
}

function toStatusKey(status) {
	return Number.isInteger(status) ? String(status) : 'ERR';
}

function summarizeStatuses(rows) {
	const map = new Map();
	for (const row of rows) {
		const key = toStatusKey(row.status);
		map.set(key, (map.get(key) || 0) + 1);
	}
	return map;
}

function formatStatusSummary(map) {
	const entries = Array.from(map.entries()).sort((a, b) => {
		const left = Number(a[0]);
		const right = Number(b[0]);
		if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
		return a[0].localeCompare(b[0]);
	});
	return entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

async function requestJson(url, options = {}) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20_000);
	try {
		const origin = new URL(url).origin; // Extract origin yang benar (https://domain.com)
		const res = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: {
				'Content-Type': 'application/json',
				'Origin': origin, // Diperlukan untuk CSRF protection
				...(options.headers || {}),
			},
		});
		const text = await res.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			// ignore parse failure
		}
		return { status: res.status, json, text };
	} finally {
		clearTimeout(timeout);
	}
}

async function runWithConcurrency(total, concurrency, workerFn) {
	const results = [];
	let next = 0;
	const workers = Array.from({ length: concurrency }, async () => {
		while (true) {
			const index = next;
			next += 1;
			if (index >= total) return;
			results[index] = await workerFn(index + 1);
		}
	});
	await Promise.all(workers);
	return results;
}

function pickCheckoutProduct(products) {
	const list = Array.isArray(products) ? products : [];
	const candidates = list
		.filter((item) => Number(item?.stock || 0) > 0 && Number(item?.price || 0) > 0)
		.sort((a, b) => Number(a?.price || 0) - Number(b?.price || 0));
	return candidates[0] || null;
}

function buildCheckoutPayload(productCode, productPrice) {
	const minQty = Math.max(1, Math.ceil(1000 / productPrice));
	return {
		items: [
			{
				product: { code: productCode },
				quantity: minQty
			}
		],
		total: minQty * productPrice
	};
}

async function buildCheckoutBody(baseUrl) {
	const productsResp = await requestJson(`${baseUrl}/api/products`);
	if (productsResp.status !== 200 || !productsResp.json?.success) {
		throw new Error(`GET /api/products gagal (status ${productsResp.status})`);
	}
	const product = pickCheckoutProduct(productsResp.json?.data);
	if (!product) {
		throw new Error('Tidak ada produk valid untuk test checkout/session');
	}
	const code = String(product.code || '').trim();
	const price = Number(product.price || 0);
	if (!code || !Number.isFinite(price) || price <= 0) {
		throw new Error('Produk kandidat checkout tidak valid');
	}
	return {
		productCode: code,
		productPrice: price,
		body: buildCheckoutPayload(code, price)
	};
}

async function runCheckoutRateTest(config) {
	logStep(`Mulai test checkout/session (${config.requests} req, concurrency ${config.concurrency})`);
	const checkoutInit = await buildCheckoutBody(config.baseUrl);
	logStep(`Payload checkout pakai produk ${checkoutInit.productCode} (harga ${checkoutInit.productPrice})`);

	const endpoint = `${config.baseUrl}/api/checkout/session`;
	const startedAt = Date.now();
	const rows = await runWithConcurrency(config.requests, config.concurrency, async (seq) => {
		try {
			const resp = await requestJson(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(checkoutInit.body)
			});
			return {
				seq,
				status: resp.status,
				code: String(resp.json?.code || ''),
				message: String(resp.json?.message || resp.text || '').slice(0, 160)
			};
		} catch (error) {
			return {
				seq,
				status: null,
				code: 'ERR',
				message: classifyError(error)
			};
		}
	});
	const elapsedMs = Date.now() - startedAt;
	const statusSummary = summarizeStatuses(rows);
	const hits429 = rows.filter((row) => row.status === 429).length;

	process.stdout.write(`[RATE][checkout] done in ${elapsedMs} ms\n`);
	process.stdout.write(`[RATE][checkout] status summary: ${formatStatusSummary(statusSummary)}\n`);
	process.stdout.write(`[RATE][checkout] 429 count: ${hits429}/${rows.length}\n`);

	if (hits429 === 0) {
		process.stdout.write('[RATE][checkout] WARNING: belum terlihat 429. Naikkan --requests/--concurrency atau ulangi lebih cepat.\n');
		if (config.strict) {
			process.stdout.write('[RATE][checkout] FAIL (--strict): rate limit tidak terpicu.\n');
			process.exitCode = 1;
		}
	} else {
		process.stdout.write('[RATE][checkout] PASS indikasi rate limit terpicu.\n');
	}

	return rows;
}

async function runAdminLoginRateTest(config) {
	logStep(`Mulai test admin/login (${config.requests} req, concurrency ${config.concurrency})`);
	const endpoint = `${config.baseUrl}/api/admin/login`;
	const payload = {
		username: config.adminUser,
		password: config.adminPass
	};
	const startedAt = Date.now();
	const rows = await runWithConcurrency(config.requests, config.concurrency, async (seq) => {
		try {
			const resp = await requestJson(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			return {
				seq,
				status: resp.status,
				code: String(resp.json?.code || ''),
				message: String(resp.json?.message || resp.text || '').slice(0, 160)
			};
		} catch (error) {
			return {
				seq,
				status: null,
				code: 'ERR',
				message: classifyError(error)
			};
		}
	});
	const elapsedMs = Date.now() - startedAt;
	const statusSummary = summarizeStatuses(rows);
	const hits429 = rows.filter((row) => row.status === 429).length;

	process.stdout.write(`[RATE][admin-login] done in ${elapsedMs} ms\n`);
	process.stdout.write(`[RATE][admin-login] status summary: ${formatStatusSummary(statusSummary)}\n`);
	process.stdout.write(`[RATE][admin-login] 429 count: ${hits429}/${rows.length}\n`);

	if (hits429 === 0) {
		process.stdout.write('[RATE][admin-login] WARNING: belum terlihat 429. Naikkan --requests/--concurrency atau ulangi lebih cepat.\n');
		if (config.strict) {
			process.stdout.write('[RATE][admin-login] FAIL (--strict): rate limit tidak terpicu.\n');
			process.exitCode = 1;
		}
	} else {
		process.stdout.write('[RATE][admin-login] PASS indikasi rate limit terpicu.\n');
	}

	return rows;
}

async function run() {
	loadLocalDevVars();
	const args = parseArgs(process.argv.slice(2));
	const baseUrl = String(
		args['base-url']
		|| process.env.RATE_BASE_URL
		|| process.env.SMOKE_BASE_URL
		|| 'http://127.0.0.1:8787'
	).replace(/\/+$/, '');
	const mode = normalizeMode(args.mode);
	const requests = clampInt(asInt(args.requests, 120), 1, 2000);
	const concurrency = clampInt(asInt(args.concurrency, 20), 1, 200);
	const adminUser = String(args['admin-user'] || process.env.RATE_ADMIN_USER || 'admin');
	const adminPass = String(args['admin-pass'] || process.env.RATE_ADMIN_PASS || 'salah-password');
	const pauseMs = clampInt(asInt(args['pause-ms'], 500), 0, 10_000);
	const strict = args.strict === 'true';

	logStep(`Base URL: ${baseUrl}`);
	logStep(`Mode: ${mode}, requests=${requests}, concurrency=${concurrency}${strict ? ', STRICT' : ''}`);
	logStep(`Admin credential untuk test login: user=${adminUser}, pass=${adminPass}`);
	logStep('Gunakan hanya pada environment milik sendiri/staging untuk menghindari gangguan pengguna nyata.');

	const health = await requestJson(`${baseUrl}/`);
	if (health.status !== 200) {
		throw new Error(`Target tidak sehat. GET / status=${health.status}`);
	}

	if (mode === 'checkout' || mode === 'both') {
		await runCheckoutRateTest({
			baseUrl,
			requests,
			concurrency,
			strict
		});
	}

	if (mode === 'both' && pauseMs > 0) {
		logStep(`Jeda ${pauseMs}ms sebelum lanjut test admin/login...`);
		await sleep(pauseMs);
	}

	if (mode === 'admin-login' || mode === 'both') {
		await runAdminLoginRateTest({
			baseUrl,
			requests,
			concurrency,
			adminUser,
			adminPass,
			strict
		});
	}
}

run().catch((error) => {
	process.stderr.write(`\n[RATE][ERROR] ${classifyError(error)}\n`);
	process.exitCode = 1;
});

