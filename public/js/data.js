import { WORKER_API_URL } from './config.js';
import { hideGlobalLoading, showGlobalLoading } from './config.runtime.js';
import { appLogger } from './logger.js';
import { getCheckoutFormInstance } from './checkout/form.core.js';

// Data array berisi katalog dagangan Koperasi Sekolah
// Diisi secara dinamis oleh fungsi fetchProducts() dari Cloudflare Worker
export let productsList = [];
export let productFetchState = {
    status: 'idle',
    message: ''
};
export let storeStatusState = {
    accepting_orders: null,
    updated_at: null,
    updated_by: null,
    known: false,
    last_error: null
};

const getDataApiBaseUrl = () => {
    return WORKER_API_URL;
};

const getDataLogger = () => {
    return appLogger;
};

const showDataLoading = (message) => {
    showGlobalLoading(message);
};

const hideDataLoading = () => {
    hideGlobalLoading();
};

export function applyFooterStoreStatusUi() {
    const statusEl = document.getElementById('footer-store-status');
    if (!statusEl) return;

    if (!storeStatusState.known) {
        statusEl.textContent = storeStatusState.last_error
            ? 'Status layanan: Tidak dapat dimuat'
            : 'Status layanan: Memuat...';
        return;
    }

    if (storeStatusState.accepting_orders) {
        statusEl.textContent = 'Status layanan: Sedang menerima pesanan';
        return;
    }

    statusEl.textContent = 'Status layanan: Sementara ditutup';
}

export function setStoreStatusState(data) {
    storeStatusState = {
        accepting_orders: Boolean(data?.accepting_orders ?? true),
        updated_at: data?.updated_at || null,
        updated_by: data?.updated_by || null,
        known: true,
        last_error: null
    };

    applyFooterStoreStatusUi();

    const activeCheckoutForm = getCheckoutFormInstance();
    if (activeCheckoutForm && typeof activeCheckoutForm.applyStoreStatusUi === 'function') {
        activeCheckoutForm.applyStoreStatusUi();
    }

    return storeStatusState;
}

// Fungsi untuk mengambil data produk dari Cloudflare D1 via Worker API
// Dengan caching 5 menit untuk mengurangi request berulang
const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000;
let productCache = null;
let productCacheTime = 0;

export async function fetchProducts(forceRefresh = false) {
    const now = Date.now();
    const apiBaseUrl = getDataApiBaseUrl();
    const logger = getDataLogger();
    productFetchState = { status: 'loading', message: '' };

    // Gunakan cache jika masih valid
    if (!forceRefresh && productCache && (now - productCacheTime) < PRODUCT_CACHE_TTL_MS) {
        productsList = productCache;
        productFetchState = { status: 'success', message: '' };
        return;
    }

    try {
        if (!productCache) {
            showDataLoading('Memuat katalog produk...');
        }
        const response = await fetch(`${apiBaseUrl}/api/products`);
        if (!response.ok) throw new Error(`Gagal mengambil data produk dari API (HTTP ${response.status})`);
        const json = await response.json();

        // Simpan data produk ke state global dan cache
        if (json.success && json.data) {
            productsList = json.data;
            productCache = json.data;
            productCacheTime = now;
            productFetchState = { status: 'success', message: '' };
        } else {
            logger.error("Format data API salah");
            productsList = [];
            productFetchState = {
                status: 'error',
                message: 'Format data katalog dari server tidak valid.'
            };
        }
    } catch (error) {
        logger.error("Gagal terhubung ke Worker API", error);
        productsList = [];
        productFetchState = {
            status: 'error',
            message: error instanceof Error ? error.message : 'Gagal memuat katalog produk.'
        };
    } finally {
        hideDataLoading();
    }
}

export async function fetchStoreStatus(options = {}) {
    const { silent = true } = options;
    const apiBaseUrl = getDataApiBaseUrl();
    const logger = getDataLogger();
    try {
        if (!silent) {
            showDataLoading('Memeriksa status operasional web...');
        }

        const response = await fetch(`${apiBaseUrl}/api/store-status`);
        if (!response.ok) throw new Error('Gagal mengambil status operasional web');

        const json = await response.json();
        if (json.success && json.data) {
            return setStoreStatusState(json.data);
        }

        storeStatusState = {
            ...storeStatusState,
            known: false,
            last_error: 'Format status operasional dari server tidak valid.'
        };
        applyFooterStoreStatusUi();
    } catch (error) {
        logger.error('Gagal memuat status operasional web', error);
        storeStatusState = {
            ...storeStatusState,
            known: Boolean(storeStatusState.known),
            last_error: error instanceof Error ? error.message : 'Gagal memuat status operasional web.'
        };
        applyFooterStoreStatusUi();
    } finally {
        if (!silent) {
            hideDataLoading();
        }
    }

    return storeStatusState;
}

applyFooterStoreStatusUi();
