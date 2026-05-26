#!/usr/bin/env node

/**
 * Reservation Race Test
 *
 * Tujuan:
 * - Simulasi beberapa user checkout hampir bersamaan
 * - Verifikasi proteksi reservasi stok (tidak oversell) pada produk hot
 * - Mendukung skenario mixed (user agresif + user normal + item tambahan)
 * - Output terminal detail per user (order_id/token/amount/timestamp ms)
 *
 * Contoh:
 * - npm run race:reservation
 * - npm run race:reservation -- --users=10 --scenario=mixed --heavy-users=5 --stagger-ms=5
 * - npm run race:reservation -- --code=L003 --qty=2 --base-url=https://your-worker.workers.dev
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
	const num = Number(value);
	return Number.isInteger(num) ? num : fallback;
}

function clampInt(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function parseScenario(value) {
	return String(value || 'single').trim().toLowerCase() === 'mixed' ? 'mixed' : 'single';
}

function logStep(message) {
	process.stdout.write(`\n[RACE] ${message}\n`);
}

function fail(message) {
	process.stderr.write(`\n[RACE][FAIL] ${message}\n`);
	process.exitCode = 1;
	throw new Error(message);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatIsoMs(timestampMs) {
	if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '-';
	return new Date(timestampMs).toISOString();
}

function safeTrim(value, max = 96) {
	return String(value || '').trim().slice(0, max);
}

function computeRandomDelays(users, staggerMs) {
	if (staggerMs <= 0) {
		return Array.from({ length: users }, () => 0);
	}
	const maxDelay = staggerMs * Math.max(1, users - 1);
	return Array.from({ length: users }, () => Math.floor(Math.random() * (maxDelay + 1)));
}

function classifyResult(row) {
	if (row.status === 200 && row.body?.success === true) return 'success';
	if (row.status === 409 && row.body?.success === false && row.body?.code === 'E-STOCK-CHECKOUT') return 'stockConflict';
	if (row.status === 400 && row.body?.success === false && row.body?.code === 'E-CHECKOUT-TAMPERING') return 'tamper';
	return 'other';
}

function printDetailedUserResults(rows) {
	const byFinishOrder = [...rows].sort((a, b) => {
		const left = Number(a.finishedAtMs || 0);
		const right = Number(b.finishedAtMs || 0);
		if (left !== right) return left - right;
		return Number(a.index) - Number(b.index);
	});

	process.stdout.write('\n[RACE] Detail per user (urutan selesai request):\n');
	for (let i = 0; i < byFinishOrder.length; i += 1) {
		const row = byFinishOrder[i];
		const label = classifyResult(row);
		const orderId = safeTrim(row.body?.order_id || '');
		const checkoutToken = safeTrim(row.body?.checkout_token || '');
		const amount = Number(row.body?.amount);
		const infoBody = safeTrim(
			row.body?.message || row.body?.code || row.raw || '-',
			140
		);

		process.stdout.write(
			`  ${String(i + 1).padStart(2, '0')}. user#${row.index} [${row.plan.profile}] => ${label} (status=${row.status})\n`
		);
		process.stdout.write(
			`      delay_ms=${row.scheduledDelayMs}, started_at=${formatIsoMs(row.startedAtMs)}, finished_at=${formatIsoMs(row.finishedAtMs)}, duration_ms=${row.durationMs}\n`
		);
		process.stdout.write(
			`      order_id=${orderId || '-'}, checkout_token=${checkoutToken || '-'}, amount=${Number.isFinite(amount) ? amount : '-'}\n`
		);
		if (label !== 'success') {
			process.stdout.write(`      reason=${infoBody}\n`);
		}
	}
}

async function request(baseUrl, path, options = {}) {
	const url = `${baseUrl}${path}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);

	try {
		const res = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: {
				'Content-Type': 'application/json',
				'Origin': baseUrl, // Diperlukan untuk CSRF protection
				...(options.headers || {}),
			},
		});
		const text = await res.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			// ignore parse error
		}
		return { url, res, text, json };
	} finally {
		clearTimeout(timeout);
	}
}

function pickCandidateProduct(products, preferredCode) {
	const list = Array.isArray(products) ? products : [];
	if (preferredCode) {
		return list.find((p) => String(p?.code || '').trim() === preferredCode) || null;
	}

	// Pilih produk dengan stok positif paling kecil agar konflik lebih mudah terlihat.
	const available = list
		.filter((p) => Number(p?.stock || 0) > 0 && Number(p?.price || 0) > 0)
		.sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0));
	return available[0] || null;
}

function pickNormalProducts(products, hotspotCode) {
	const list = Array.isArray(products) ? products : [];
	return list
		.filter((p) => {
			const code = String(p?.code || '').trim();
			return code && code !== hotspotCode && Number(p?.stock || 0) > 0 && Number(p?.price || 0) > 0;
		})
		.sort((a, b) => {
			const stockDiff = Number(b?.stock || 0) - Number(a?.stock || 0);
			if (stockDiff !== 0) return stockDiff;
			return Number(b?.price || 0) - Number(a?.price || 0);
		});
}

function allocateNormalItemPerUser(normalProducts, users) {
	const remainingByCode = new Map(
		normalProducts.map((product) => [String(product.code), Number(product.stock || 0)])
	);
	const allocations = Array.from({ length: users }, () => null);

	for (let index = 0; index < users; index += 1) {
		const chosen = normalProducts.find((product) => {
			const code = String(product.code);
			return (remainingByCode.get(code) || 0) > 0;
		});
		if (!chosen) break;

		const code = String(chosen.code);
		remainingByCode.set(code, (remainingByCode.get(code) || 0) - 1);
		allocations[index] = {
			code,
			name: String(chosen.name || code),
			price: Number(chosen.price || 0),
			quantity: 1
		};
	}

	return allocations;
}

function resolveQuantity(stock, price, requestedQty) {
	if (Number.isInteger(requestedQty) && requestedQty > 0) {
		return requestedQty;
	}

	// Default qty dirancang agar contention terjadi:
	// - minimal tetap menghasilkan total >= 1000
	// - biasanya membuat max success <= 2-3 untuk stok menengah
	const minQtyByTotal = Math.max(1, Math.ceil(1000 / price));
	const raceQty = Math.max(minQtyByTotal, Math.floor(stock / 2) || 1);
	return Math.min(raceQty, stock, 100);
}

function resolveNormalHotspotQty(price, requestedQty) {
	if (Number.isInteger(requestedQty) && requestedQty > 0) {
		return requestedQty;
	}
	const minQtyByTotal = Math.max(1, Math.ceil(1000 / price));
	return Math.min(minQtyByTotal, 100);
}

function buildCheckoutPayloadFromPlan(plan) {
	const items = plan.items.map((item) => ({
		product: { code: item.code },
		quantity: item.quantity
	}));
	return {
		items,
		total: plan.total
	};
}

function createSingleScenarioPlans(params) {
	const { users, hotspot, requestedQty } = params;
	const stockBefore = Number(hotspot.stock || 0);
	const price = Number(hotspot.price || 0);
	const qty = resolveQuantity(stockBefore, price, requestedQty);
	const total = qty * price;

	if (!Number.isInteger(qty) || qty <= 0 || total < 1000) {
		throw new Error(`Qty/total tidak valid untuk checkout. qty=${qty}, total=${total}`);
	}

	const plans = Array.from({ length: users }, (_, i) => ({
		userIndex: i + 1,
		profile: 'single',
		hotspotQty: qty,
		items: [{ code: String(hotspot.code), quantity: qty, price }],
		total
	}));

	return {
		plans,
		hotspotMode: `uniform qty=${qty}`,
		hotspotRequestedTotalQty: qty * users
	};
}

function createMixedScenarioPlans(params) {
	const {
		users,
		heavyUsers,
		hotspot,
		normalItems,
		requestedQty
	} = params;
	const stockBefore = Number(hotspot.stock || 0);
	const hotspotPrice = Number(hotspot.price || 0);
	const allQty = clampInt(Math.max(1, stockBefore), 1, 100);
	const halfQty = clampInt(Math.max(1, Math.floor(stockBefore / 2)), 1, 100);
	const normalQty = clampInt(resolveNormalHotspotQty(hotspotPrice, requestedQty), 1, 100);

	const plans = [];
	for (let i = 0; i < users; i += 1) {
		const isHeavy = i < heavyUsers;
		const hotspotQty = isHeavy
			? (i % 2 === 0 ? allQty : halfQty)
			: normalQty;
		const extra = normalItems[i];

		const items = [
			{
				code: String(hotspot.code),
				quantity: hotspotQty,
				price: hotspotPrice
			}
		];
		if (extra) {
			items.push({
				code: String(extra.code),
				quantity: clampInt(extra.quantity, 1, 100),
				price: Number(extra.price || 0)
			});
		}

		let total = items.reduce(
			(sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)),
			0
		);

		if (total < 1000 && extra && extra.price > 0) {
			const need = Math.ceil((1000 - total) / extra.price);
			const newQty = items[1].quantity + need;
			if (newQty <= 100) {
				items[1].quantity = newQty;
				total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
			}
		}

		if (total < 1000 && hotspotPrice > 0) {
			const need = Math.ceil((1000 - total) / hotspotPrice);
			const newQty = items[0].quantity + need;
			if (newQty <= 100) {
				items[0].quantity = newQty;
				total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
			}
		}

		if (total < 1000) {
			throw new Error(
				`Total user#${i + 1} < 1000 dan tidak bisa dinaikkan aman (total=${total})`
			);
		}

		plans.push({
			userIndex: i + 1,
			profile: isHeavy ? 'heavy' : 'normal',
			hotspotQty: items[0].quantity,
			items,
			total
		});
	}

	const hotspotRequestedTotalQty = plans.reduce((sum, plan) => sum + plan.hotspotQty, 0);
	return {
		plans,
		hotspotMode: `heavy(all=${allQty},half=${halfQty}) + normal(qty=${normalQty})`,
		hotspotRequestedTotalQty
	};
}

function sumReservedByCode(plans) {
	const map = new Map();
	for (const plan of plans) {
		for (const item of plan.items) {
			map.set(item.code, (map.get(item.code) || 0) + Number(item.quantity || 0));
		}
	}
	return map;
}

function formatCodes(map) {
	const entries = Array.from(map.entries()).map(([code, qty]) => `${code}:${qty}`);
	return entries.length > 0 ? entries.join(', ') : '-';
}

async function run() {
	loadLocalDevVars();

	const args = parseArgs(process.argv.slice(2));
	const baseUrl = String(
		args['base-url']
		|| process.env.RACE_BASE_URL
		|| process.env.SMOKE_BASE_URL
		|| 'http://127.0.0.1:8787'
	).replace(/\/+$/, '');
	const users = Math.max(1, asInt(args.users, 5));
	const staggerMs = Math.max(0, asInt(args['stagger-ms'], 0));
	const preferredCode = String(args.code || '').trim();
	const requestedQty = asInt(args.qty, NaN);
	const scenario = parseScenario(args.scenario);
	const heavyUsers = clampInt(
		asInt(args['heavy-users'], Math.min(3, users)),
		0,
		users
	);

	logStep(`Base URL: ${baseUrl}`);
	logStep(
		`Config: scenario=${scenario}, users=${users}, heavyUsers=${heavyUsers}, staggerMs=${staggerMs}, code=${preferredCode || '-auto-'}, qty=${Number.isInteger(requestedQty) ? requestedQty : '-auto-'}`
	);

	const health = await request(baseUrl, '/');
	if (health.res.status !== 200) fail(`GET / expected 200, got ${health.res.status}`);

	const productsResp = await request(baseUrl, '/api/products');
	if (productsResp.res.status !== 200 || !productsResp.json?.success) {
		fail(`/api/products tidak siap. status=${productsResp.res.status}`);
	}

	const candidate = pickCandidateProduct(productsResp.json?.data, preferredCode);
	if (!candidate) {
		fail('Tidak ada produk valid dengan stok > 0 untuk race test');
	}

	const code = String(candidate.code);
	const name = String(candidate.name || code);
	const stockBefore = Number(candidate.stock || 0);
	const price = Number(candidate.price || 0);
	const normalProducts = pickNormalProducts(productsResp.json?.data, code);
	const normalAllocations = allocateNormalItemPerUser(normalProducts, users);

	let scenarioBuild;
	try {
		scenarioBuild = scenario === 'mixed'
			? createMixedScenarioPlans({
				users,
				heavyUsers,
				hotspot: candidate,
				normalItems: normalAllocations,
				requestedQty
			})
			: createSingleScenarioPlans({
				users,
				hotspot: candidate,
				requestedQty
			});
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
		return;
	}

	const userPlans = scenarioBuild.plans;
	const hotspotRequestedTotalQty = Number(scenarioBuild.hotspotRequestedTotalQty || 0);
	const theoreticalMaxSuccessSingleMode = scenario === 'single'
		? Math.floor(stockBefore / (userPlans[0]?.hotspotQty || 1))
		: null;

	const randomDelays = computeRandomDelays(userPlans.length, staggerMs);
	const averageDelay = randomDelays.length > 0
		? (randomDelays.reduce((sum, value) => sum + value, 0) / randomDelays.length).toFixed(2)
		: '0.00';

	logStep(
		`Target hotspot: ${code} (${name}), stockBefore=${stockBefore}, price=${price}, mode=${scenarioBuild.hotspotMode}`
	);
	logStep(
		`Hotspot requested qty total=${hotspotRequestedTotalQty} vs stock=${stockBefore}`
	);
	logStep(
		`Delay mode: random per user (max≈${staggerMs * Math.max(1, users - 1)}ms, avg=${averageDelay}ms)`
	);

	if (scenario === 'mixed') {
		const previewPlans = userPlans
			.slice(0, Math.min(5, userPlans.length))
			.map((plan) => {
				const detail = plan.items.map((item) => `${item.code}x${item.quantity}`).join(' + ');
				return `u${plan.userIndex}[${plan.profile}]: ${detail} (total=${plan.total})`;
			})
			.join(' | ');
		logStep(`Preview payload: ${previewPlans}`);
	}
	logStep('Mengirim request checkout paralel...');

	const startedAt = Date.now();
	const tasks = userPlans.map((plan, index) => (async () => {
		const scheduledDelayMs = randomDelays[index] || 0;
		if (scheduledDelayMs > 0) {
			await sleep(scheduledDelayMs);
		}
		const payload = buildCheckoutPayloadFromPlan(plan);
		const requestStartedAtMs = Date.now();
		try {
			const resp = await request(baseUrl, '/api/checkout/session', {
				method: 'POST',
				body: JSON.stringify(payload),
			});
			const requestFinishedAtMs = Date.now();
			return {
				index: plan.userIndex,
				plan,
				scheduledDelayMs,
				startedAtMs: requestStartedAtMs,
				finishedAtMs: requestFinishedAtMs,
				durationMs: requestFinishedAtMs - requestStartedAtMs,
				status: resp.res.status,
				body: resp.json,
				raw: resp.text,
			};
		} catch (error) {
			const requestFinishedAtMs = Date.now();
			return {
				index: plan.userIndex,
				plan,
				scheduledDelayMs,
				startedAtMs: requestStartedAtMs,
				finishedAtMs: requestFinishedAtMs,
				durationMs: requestFinishedAtMs - requestStartedAtMs,
				status: -1,
				body: { success: false, code: 'E-RACE-REQUEST-ERROR' },
				raw: error instanceof Error ? error.message : String(error),
			};
		}
	})());

	const results = await Promise.all(tasks);
	const elapsedMs = Date.now() - startedAt;

	const successRows = results.filter((r) => classifyResult(r) === 'success');
	const stockConflictRows = results.filter((r) => classifyResult(r) === 'stockConflict');
	const tamperRows = results.filter((r) => classifyResult(r) === 'tamper');
	const otherRows = results.filter((r) => classifyResult(r) === 'other');

	const uniqueTokens = new Set(successRows.map((r) => String(r.body?.checkout_token || '')));
	const uniqueOrderIds = new Set(successRows.map((r) => String(r.body?.order_id || '')));

	logStep(`Selesai dalam ${elapsedMs} ms`);
	process.stdout.write(
		`[RACE] Summary: success=${successRows.length}, stockConflict=${stockConflictRows.length}, tamper=${tamperRows.length}, other=${otherRows.length}\n`
	);

	printDetailedUserResults(results);

	if (scenario === 'single' && theoreticalMaxSuccessSingleMode != null) {
		process.stdout.write(
			`[RACE] Invariant(single): success <= floor(stock/qty) => ${successRows.length} <= ${theoreticalMaxSuccessSingleMode}\n`
		);
		if (successRows.length > theoreticalMaxSuccessSingleMode) {
			fail(
				`Oversell terdeteksi: success=${successRows.length}, max=${theoreticalMaxSuccessSingleMode}`
			);
		}
	}

	if (uniqueTokens.size !== successRows.length) {
		fail('Checkout token duplikat terdeteksi pada hasil sukses');
	}
	if (uniqueOrderIds.size !== successRows.length) {
		fail('Order ID duplikat terdeteksi pada hasil sukses');
	}

	const successPlans = successRows.map((row) => row.plan);
	const reservedByCode = sumReservedByCode(successPlans);
	const requestedByCode = sumReservedByCode(userPlans);
	const hotspotReservedQty = successPlans.reduce(
		(sum, plan) => sum + Number(plan.hotspotQty || 0),
		0
	);

	process.stdout.write(
		`[RACE] Hotspot reserved by success: ${hotspotReservedQty} <= stockBefore(${stockBefore})\n`
	);
	process.stdout.write(
		`[RACE] Requested by code: ${formatCodes(requestedByCode)}\n`
	);
	process.stdout.write(
		`[RACE] Reserved by success: ${formatCodes(reservedByCode)}\n`
	);

	if (hotspotReservedQty > stockBefore) {
		fail(
			`Oversell hotspot terdeteksi: reserved=${hotspotReservedQty}, stockBefore=${stockBefore}`
		);
	}

	const allProducts = Array.isArray(productsResp.json?.data) ? productsResp.json.data : [];
	const stockBeforeByCode = new Map(
		allProducts.map((product) => [String(product.code), Number(product.stock || 0)])
	);
	for (const [productCode, reservedQty] of reservedByCode.entries()) {
		const before = Number(stockBeforeByCode.get(productCode) || 0);
		if (reservedQty > before) {
			fail(
				`Oversell produk ${productCode}: reserved=${reservedQty}, stockBefore=${before}`
			);
		}
	}

	const productsAfterResp = await request(baseUrl, '/api/products');
	if (productsAfterResp.res.status === 200 && productsAfterResp.json?.success) {
		const afterByCode = new Map(
			(productsAfterResp.json?.data || []).map((product) => [
				String(product.code),
				Number(product.stock || 0)
			])
		);
		const touchedCodes = Array.from(requestedByCode.keys());
		for (const productCode of touchedCodes) {
			const before = Number(stockBeforeByCode.get(productCode) || 0);
			const reserved = Number(reservedByCode.get(productCode) || 0);
			const expectedAfter = Math.max(0, before - reserved);
			const actualAfter = Number(afterByCode.get(productCode) || 0);
			process.stdout.write(
				`[RACE] Stock ${productCode}: before=${before}, reserved=${reserved}, afterActual=${actualAfter}, expected~=${expectedAfter}\n`
			);
		}
	}

	if (otherRows.length > 0) {
		process.stdout.write('[RACE] Detail unexpected responses terdeteksi (lihat detail per user di atas).\n');
	}

	process.stdout.write(
		'\n[RACE] PASS: Reservasi tidak oversell pada simulasi paralel ini.\n'
	);
	process.stdout.write(
		'[RACE] Catatan: checkout sukses akan menahan stok sampai finalisasi order atau session expired.\n'
	);
}

run().catch((error) => {
	if (process.exitCode !== 1) {
		process.stderr.write(`\n[RACE][ERROR] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
});
