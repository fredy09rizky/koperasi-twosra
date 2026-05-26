#!/usr/bin/env node

/**
 * Smoke test cepat untuk backend Koperasi.
 *
 * Default:
 * - health root
 * - /api/products
 * - /api/store-status
 * - /api/checkout/session (success)
 * - /api/checkout/session (tampering total mismatch)
 *
 * Optional (--with-gateway):
 * - /api/payment/qris dua kali, validasi replay idempotent
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

loadLocalDevVars();

const args = new Set(process.argv.slice(2));
const withGateway = args.has('--with-gateway');
const withPaymentSimulation = args.has('--simulate-payment') || process.env.SMOKE_SIMULATE_PAYMENT === '1';
const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const pakasirSimulationUrl = process.env.SMOKE_PAKASIR_SIMULATION_URL || 'https://app.pakasir.com/api/paymentsimulation';

function logStep(message) {
	process.stdout.write(`\n[SMOKE] ${message}\n`);
}

function fail(message) {
	process.stderr.write(`\n[SMOKE][FAIL] ${message}\n`);
	process.exitCode = 1;
	throw new Error(message);
}

async function request(path, options = {}) {
	const url = `${baseUrl}${path}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20_000);

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
			// biarkan null jika bukan JSON
		}

		return { res, text, json, url };
	} finally {
		clearTimeout(timeout);
	}
}

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function simulatePaymentViaPakasir({ projectSlug, apiKey, orderId, amount }) {
	const response = await fetch(pakasirSimulationUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			project: projectSlug,
			order_id: orderId,
			amount,
			api_key: apiKey,
		}),
	});

	const text = await response.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// no-op
	}

	return { response, json, text };
}

async function waitForCompletedStatus(checkoutToken) {
	for (let attempt = 1; attempt <= 8; attempt += 1) {
		const statusResp = await request(`/api/payment/status?checkout_token=${encodeURIComponent(checkoutToken)}`);
		if (statusResp.res.status === 200) {
			const gatewayStatus = String(
				statusResp.json?.gateway_status || statusResp.json?.transaction?.status || ''
			).toLowerCase();
			if (gatewayStatus === 'completed') {
				return statusResp;
			}
		}

		if (attempt < 8) {
			await sleep(1200);
		}
	}

	return null;
}

function pickCheckoutCandidate(products) {
	const list = Array.isArray(products) ? products : [];
	return list.find((p) => Number(p?.stock || 0) > 0 && Number(p?.price || 0) > 0) || null;
}

function buildCheckoutPayload(product) {
	const stock = Number(product.stock || 0);
	const price = Number(product.price || 0);
	const minQty = Math.max(1, Math.ceil(1000 / price));
	const quantity = Math.min(minQty, stock, 100);
	const total = quantity * price;

	if (!Number.isInteger(quantity) || quantity <= 0 || total < 1000) {
		return null;
	}

	return {
		items: [{ product: { code: String(product.code) }, quantity }],
		total,
	};
}

function getValidPickupSelectionWib() {
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

	const wibNow = new Date(year, month - 1, day, hour, minute, second);
	const currentTime = wibNow.getHours() + (wibNow.getMinutes() / 60);
	const cutoffFirstBreak = 9 + (15 / 60);
	const cutoffSecondBreak = 12 + (20 / 60);

	for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
		const checkDate = new Date(wibNow);
		checkDate.setDate(checkDate.getDate() + dayOffset);
		const dayOfWeek = checkDate.getDay();
		if (dayOfWeek < 1 || dayOfWeek > 5) continue;

		let slots = ['FIRST_BREAK', 'SECOND_BREAK'];
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

		const pickupDate = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
		return {
			pickupDate,
			pickupSlot: slots[0]
		};
	}

	return null;
}

async function run() {
	logStep(`Base URL: ${baseUrl}`);

	logStep('Check root health/asset');
	const root = await request('/');
	if (root.res.status !== 200) fail(`GET / expected 200, got ${root.res.status}`);
	if (!root.text || root.text.length < 20) fail('GET / returned empty/too short body');

	logStep('Check /api/health (D1 + R2 bindings)');
	const healthResp = await request('/api/health');
	if (healthResp.res.status !== 200) fail(`/api/health expected 200, got ${healthResp.res.status}`);
	if (!healthResp.json || healthResp.json.status !== 'healthy') {
		const checks = healthResp.json?.checks || {};
		const failedChecks = Object.entries(checks)
			.filter(([, v]) => v !== 'ok')
			.map(([k, v]) => `${k}=${v}`)
			.join(', ');
		fail(`/api/health tidak healthy: status=${healthResp.json?.status || '-'}, failed=[${failedChecks || 'unknown'}]`);
	}

	logStep('Check /api/products');
	const productsResp = await request('/api/products');
	if (productsResp.res.status !== 200) fail(`/api/products expected 200, got ${productsResp.res.status}`);
	if (!productsResp.json?.success || !Array.isArray(productsResp.json?.data)) {
		fail('/api/products payload tidak valid');
	}

	logStep('Check /api/store-status');
	const statusResp = await request('/api/store-status');
	if (statusResp.res.status !== 200) fail(`/api/store-status expected 200, got ${statusResp.res.status}`);
	if (!statusResp.json?.success || !statusResp.json?.data) fail('/api/store-status payload tidak valid');

	const candidate = pickCheckoutCandidate(productsResp.json.data);
	if (!candidate) fail('Tidak ada produk dengan stok > 0 untuk uji checkout');

	const checkoutPayload = buildCheckoutPayload(candidate);
	if (!checkoutPayload) {
		fail(
			`Produk kandidat (${candidate.code}) tidak memenuhi syarat minimal total checkout >= 1000 atau qty valid`
		);
	}

	logStep('Check /api/checkout/session success');
	const checkoutSuccess = await request('/api/checkout/session', {
		method: 'POST',
		body: JSON.stringify(checkoutPayload),
	});
	if (checkoutSuccess.res.status !== 200) {
		fail(`/api/checkout/session success path expected 200, got ${checkoutSuccess.res.status}`);
	}
	if (!checkoutSuccess.json?.success || !checkoutSuccess.json?.checkout_token) {
		fail('/api/checkout/session success payload tidak valid');
	}

	logStep('Check /api/checkout/session tampering mismatch');
	const tamperPayload = {
		...checkoutPayload,
		total: checkoutPayload.total + 1,
	};
	const checkoutTamper = await request('/api/checkout/session', {
		method: 'POST',
		body: JSON.stringify(tamperPayload),
	});
	if (checkoutTamper.res.status !== 400) {
		fail(`/api/checkout/session tampering expected 400, got ${checkoutTamper.res.status}`);
	}
	if (checkoutTamper.json?.code !== 'E-CHECKOUT-TAMPERING') {
		fail('Tampering checkout tidak mengembalikan code E-CHECKOUT-TAMPERING');
	}

	if (withGateway) {
		logStep('Gateway mode: check /api/payment/qris + replay');
		const checkoutToken = checkoutSuccess.json.checkout_token;

		const qrisFirst = await request('/api/payment/qris', {
			method: 'POST',
			body: JSON.stringify({ checkout_token: checkoutToken }),
		});
		if (qrisFirst.res.status !== 200) {
			fail(`/api/payment/qris first call expected 200, got ${qrisFirst.res.status}`);
		}

		const qrisSecond = await request('/api/payment/qris', {
			method: 'POST',
			body: JSON.stringify({ checkout_token: checkoutToken }),
		});
		if (qrisSecond.res.status !== 200) {
			fail(`/api/payment/qris replay expected 200, got ${qrisSecond.res.status}`);
		}
		if (qrisSecond.json?.payment?.is_replayed !== true) {
			fail('/api/payment/qris replay tidak mengembalikan payment.is_replayed=true');
		}

		if (withPaymentSimulation) {
			logStep('Gateway mode: payment simulation via Pakasir');
			const projectSlug = process.env.SMOKE_PAKASIR_PROJECT || process.env.PAKASIR_PROJECT_SLUG || '';
			const apiKey = process.env.SMOKE_PAKASIR_API_KEY || process.env.PAKASIR_API_KEY || '';
			if (!projectSlug || !apiKey) {
				fail(
					'Simulasi pembayaran butuh env SMOKE_PAKASIR_PROJECT + SMOKE_PAKASIR_API_KEY (atau fallback PAKASIR_PROJECT_SLUG + PAKASIR_API_KEY)'
				);
			}

			const orderId = String(
				qrisFirst.json?.order_id ||
				qrisFirst.json?.payment?.order_id ||
				checkoutSuccess.json?.order_id ||
				''
			).trim();
			const amount = Number(
				qrisFirst.json?.amount ||
				qrisFirst.json?.payment?.amount ||
				checkoutPayload.total ||
				0
			);
			if (!orderId || !Number.isFinite(amount) || amount <= 0) {
				fail('Gagal menentukan order_id/amount untuk payment simulation');
			}

			const simulation = await simulatePaymentViaPakasir({
				projectSlug,
				apiKey,
				orderId,
				amount: Math.trunc(amount),
			});

			if (simulation.response.status !== 200) {
				fail(`paymentsimulation expected 200, got ${simulation.response.status}`);
			}
			if (simulation.json?.success !== true) {
				fail('paymentsimulation tidak mengembalikan {"success": true}');
			}

			logStep('Gateway mode: verify status becomes completed');
			const completedStatus = await waitForCompletedStatus(checkoutToken);
			if (!completedStatus) {
				fail('Status pembayaran tidak menjadi completed setelah simulation');
			}

			logStep('Gateway mode: finalize order via /api/orders');
			const pickupSelection = getValidPickupSelectionWib();
			if (!pickupSelection) {
				fail('Gagal menentukan pickup slot valid (WIB) untuk finalize order');
			}

			const paymentAmount = Number(
				completedStatus.json?.transaction?.total_payment
				|| qrisSecond.json?.payment?.total_payment
				|| qrisFirst.json?.payment?.total_payment
				|| qrisFirst.json?.payment?.amount
				|| checkoutPayload.total
			);
			const finalizePayload = {
				checkout_token: checkoutToken,
				id_transaksi: orderId,
				nama: 'Smoke Tester',
				kelas: 'X TKJ',
				wa: '6281234567890',
				pickup_date: pickupSelection.pickupDate,
				pickup_slot: pickupSelection.pickupSlot,
				total: checkoutPayload.total,
				payment_amount: Math.trunc(Number.isFinite(paymentAmount) ? paymentAmount : checkoutPayload.total),
				waktu_pembayaran: completedStatus.json?.transaction?.completed_at || new Date().toISOString(),
				items: [{
					product: {
						code: String(candidate.code),
						name: String(candidate.name || candidate.code),
						price: Number(candidate.price || 0)
					},
					quantity: Number(checkoutPayload.items?.[0]?.quantity || 1)
				}]
			};

			const finalizeResp = await request('/api/orders', {
				method: 'POST',
				body: JSON.stringify(finalizePayload),
			});
			if (finalizeResp.res.status !== 200 || finalizeResp.json?.success !== true) {
				fail(`/api/orders finalize expected 200 success, got ${finalizeResp.res.status} payload=${finalizeResp.text}`);
			}
			if (!String(finalizeResp.json?.verification_token || '').trim()) {
				fail('/api/orders finalize sukses tapi verification_token kosong');
			}
		}
	}

	logStep('Semua smoke checks lulus');
}

run().catch((error) => {
	if (process.exitCode !== 1) {
		process.stderr.write(`\n[SMOKE][ERROR] ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
});
