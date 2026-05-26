import type { Bindings } from '../types/bindings.js';
import { formatSqlTimestamp } from '../utils/format.js';
import { fetchJsonWithTimeout } from '../utils/http-json.js';
import { toIsoUtcTimestamp } from '../utils/log.js';

const PAKASIR_BASE_URL = 'https://app.pakasir.com/api';
const PAKASIR_TIMEOUT_MS = 10_000;

type GatewaySessionSnapshot = {
	order_id: string;
	amount: number;
};

export type PakasirCredentials = {
	projectSlug: string;
	apiKey: string;
};

export type PakasirGatewayResult = Awaited<ReturnType<typeof fetchJsonWithTimeout>>;

export type PakasirQrisSnapshot = {
	gatewayResponse: PakasirGatewayResult;
	paymentStartedAt: string;
	gatewayExpiresAt: string | null;
	gatewayPaymentNumber: string | null;
	gatewayTotalPayment: number;
	gatewayFee: number;
	data: any;
};

export type PaymentVerificationResult = {
	ok: boolean;
	status: number;
	message: string;
	completedAt?: string;
};

export function getPakasirCredentials(env: Bindings): PakasirCredentials {
	const projectSlug = env.PAKASIR_PROJECT_SLUG?.trim();
	const apiKey = env.PAKASIR_API_KEY?.trim();

	if (!projectSlug || !apiKey) {
		throw new Error('PAYMENT_CONFIG_MISSING');
	}

	return { projectSlug, apiKey };
}

function buildTransactionPayload(credentials: PakasirCredentials, session: GatewaySessionSnapshot) {
	return {
		project: credentials.projectSlug,
		api_key: credentials.apiKey,
		order_id: session.order_id,
		amount: session.amount
	};
}

export async function createPakasirQris(env: Bindings, session: GatewaySessionSnapshot): Promise<PakasirQrisSnapshot> {
	const credentials = getPakasirCredentials(env);
	const gatewayResponse = await fetchJsonWithTimeout(`${PAKASIR_BASE_URL}/transactioncreate/qris`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(buildTransactionPayload(credentials, session))
	}, PAKASIR_TIMEOUT_MS);
	const data: any = gatewayResponse.data || {};
	const paymentStartedAt = formatSqlTimestamp(new Date());
	const gatewayExpiresAt = String(data?.payment?.expired_at || '').trim() || null;
	const gatewayPaymentNumber = String(data?.payment?.payment_number || '').trim() || null;
	const gatewayTotalPayment = Number(data?.payment?.total_payment || data?.payment?.amount || session.amount);
	const gatewayFee = Number.isFinite(gatewayTotalPayment) ? Math.max(gatewayTotalPayment - session.amount, 0) : 0;

	return {
		gatewayResponse,
		paymentStartedAt,
		gatewayExpiresAt,
		gatewayPaymentNumber,
		gatewayTotalPayment,
		gatewayFee,
		data
	};
}

export async function getPakasirTransactionDetail(env: Bindings, session: GatewaySessionSnapshot): Promise<PakasirGatewayResult> {
	const credentials = getPakasirCredentials(env);
	const queryParams = new URLSearchParams({
		project: credentials.projectSlug,
		api_key: credentials.apiKey,
		order_id: session.order_id,
		amount: session.amount.toString()
	});

	return fetchJsonWithTimeout(`${PAKASIR_BASE_URL}/transactiondetail?${queryParams.toString()}`, {}, PAKASIR_TIMEOUT_MS);
}

export async function cancelPakasirTransaction(env: Bindings, session: GatewaySessionSnapshot): Promise<PakasirGatewayResult> {
	const credentials = getPakasirCredentials(env);
	return fetchJsonWithTimeout(`${PAKASIR_BASE_URL}/transactioncancel`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(buildTransactionPayload(credentials, session))
	}, PAKASIR_TIMEOUT_MS);
}

export async function verifyPakasirPaymentCompleted(
	env: Bindings,
	orderId: string,
	amount: number,
	expectedGatewayTotalPayment?: number | null
): Promise<PaymentVerificationResult> {
	try {
		const gatewayResponse = await getPakasirTransactionDetail(env, {
			order_id: orderId,
			amount
		});
		const { response } = gatewayResponse;
		if (gatewayResponse.parseError) {
			return {
				ok: false,
				status: 502,
				message: 'Gateway pembayaran mengembalikan format respons tidak valid',
				completedAt: ''
			};
		}
		const payload: any = gatewayResponse.data || {};

		if (!response.ok) {
			return {
				ok: false,
				status: 502,
				message: 'Gagal memverifikasi pembayaran ke gateway',
				completedAt: ''
			};
		}

		const transaction = payload?.transaction;
		const status = String(transaction?.status || '').toLowerCase();

		if (transaction?.order_id && transaction.order_id !== orderId) {
			return {
				ok: false,
				status: 400,
				message: 'Data pembayaran tidak cocok dengan transaksi',
				completedAt: ''
			};
		}

		if (status !== 'completed') {
			return {
				ok: false,
				status: 409,
				message: 'Pembayaran belum terverifikasi selesai',
				completedAt: ''
			};
		}

		const expectedGatewayTotal = Number(expectedGatewayTotalPayment);
		const expectedSubtotalAmount = Math.trunc(Number(amount));
		const gatewayTotalPaymentCandidates = [
			transaction?.total_payment,
			payload?.payment?.total_payment
		]
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value) && value >= 0)
			.map((value) => Math.trunc(value));
		const gatewaySubtotalCandidates = [
			transaction?.amount,
			payload?.payment?.amount
		]
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value) && value >= 0)
			.map((value) => Math.trunc(value));

		if (
			Number.isFinite(expectedGatewayTotal) &&
			expectedGatewayTotal > 0 &&
			gatewayTotalPaymentCandidates.length > 0 &&
			!gatewayTotalPaymentCandidates.includes(Math.trunc(expectedGatewayTotal))
		) {
			return {
				ok: false,
				status: 409,
				message: 'Nominal pembayaran gateway tidak cocok dengan snapshot checkout',
				completedAt: ''
			};
		}

		if (
			gatewayTotalPaymentCandidates.length === 0 &&
			gatewaySubtotalCandidates.length > 0 &&
			!gatewaySubtotalCandidates.includes(expectedSubtotalAmount)
		) {
			return {
				ok: false,
				status: 409,
				message: 'Nominal pembayaran gateway tidak cocok dengan snapshot checkout',
				completedAt: ''
			};
		}

		const completedAt = toIsoUtcTimestamp(transaction?.completed_at);
		return { ok: true, status: 200, message: 'OK', completedAt };
	} catch (error: any) {
		if (error?.message === 'PAYMENT_CONFIG_MISSING') {
			return {
				ok: false,
				status: 500,
				message: 'Konfigurasi gateway pembayaran belum lengkap',
				completedAt: ''
			};
		}

		return {
			ok: false,
			status: 502,
			message: 'Gagal menghubungi gateway pembayaran',
			completedAt: ''
		};
	}
}
