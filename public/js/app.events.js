import { App } from './app.core.js';
import './app.receipt.js';
import { setAppInstance } from './app.runtime.js';

// Inisialisasi aplikasi ke variabel global agar bisa dipakai file lain.
export const app = new App();
setAppInstance(app);
if (typeof window !== 'undefined') {
    window.app = app;
}

function bindPublicDomEvents(appInstance) {
    if (window.__publicDomBound) return;
    window.__publicDomBound = true;

    // Navigasi antar view (home/cart/checkout/summary)
    const navButtons = document.querySelectorAll('[data-nav]');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetView = btn.getAttribute('data-nav');
            if (targetView) {
                appInstance.navigate(targetView);
            }
        });
    });

    // Filter kategori produk
    const categoryButtons = document.querySelectorAll('[data-category]');
    categoryButtons.forEach(btn => {
        const category = btn.getAttribute('data-category');
        if (!category) return;
        btn.addEventListener('click', () => appInstance.filterProducts(category));
    });

    // Sortir produk
    const sortSelect = document.getElementById('products-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', (event) => {
            const target = event.target;
            appInstance.setSort(target ? target.value : 'newest');
        });
    }

    // Pencarian produk
    const searchInput = document.getElementById('products-search');
    if (searchInput) {
        const handleSearch = (event) => {
            const target = event.target;
            appInstance.setSearchTerm(target ? target.value : '');
        };
        searchInput.addEventListener('input', handleSearch);
        searchInput.addEventListener('search', handleSearch);
    }

    // Clear semua item di keranjang
    const clearCartButton = document.getElementById('btn-clear-cart');
    const cartApi = appInstance.getCart();
    if (clearCartButton && cartApi) {
        clearCartButton.addEventListener('click', () => cartApi.confirmClearAll());
    }

    // Unduh bukti pembayaran PDF
    const downloadButton = document.querySelector('[data-action="download-receipt"]');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => appInstance.downloadReceipt(downloadButton));
    }

    // Reset alur (kembali ke home + bersihkan state)
    const resetButtons = document.querySelectorAll('.js-reset-flow');
    resetButtons.forEach(btn => {
        btn.addEventListener('click', () => appInstance.resetFlow());
    });
}

bindPublicDomEvents(app);

/**
 * Global error handler untuk menangkap error JavaScript yang tidak tertangani.
 * Mencegah halaman blank tanpa feedback saat terjadi error kritis.
 */
window.addEventListener('error', (e) => {
    const logger = app.getLogger();
    logger.error('Global JS error', {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno
    });
});

window.addEventListener('unhandledrejection', (e) => {
    const logger = app.getLogger();
    logger.error('Unhandled promise rejection', {
        reason: String(e.reason).slice(0, 200)
    });
});
