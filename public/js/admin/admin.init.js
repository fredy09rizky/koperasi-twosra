// Bootstrap AdminApp (dibuat terpisah agar semua prototype sudah terdaftar)

import { debounce } from '../config.runtime.js';
import { AdminApp } from './admin.core.js';

function bindAdminDomEvents(app) {
    const navTabs = [];

    // Helper binding agar event handler lebih rapi
    const bindClick = (id, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', handler);
    };

    const bindChange = (id, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', handler);
    };

    const bindKeyUp = (id, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('keyup', handler);
    };

    const bindInput = (id, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', handler);
    };

    const bindSubmit = (id, handler) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('submit', handler);
    };

    const bindNavItem = (id, tabName, panelId) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!el.getAttribute('role')) {
            el.setAttribute('role', 'tab');
        }
        el.setAttribute('tabindex', el.classList.contains('active') ? '0' : '-1');
        if (panelId) {
            el.setAttribute('aria-controls', panelId);
        }
        navTabs.push({ el, tabName });
        el.addEventListener('click', () => app.switchTab(tabName));
        el.addEventListener('keydown', (event) => {
            const currentIndex = navTabs.findIndex((entry) => entry.el === el);
            const focusTabAt = (index) => {
                const normalizedIndex = (index + navTabs.length) % navTabs.length;
                const target = navTabs[normalizedIndex];
                if (!target) return;
                app.switchTab(target.tabName);
                target.el.focus();
            };

            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                app.switchTab(tabName);
                return;
            }

            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                event.preventDefault();
                focusTabAt(currentIndex + 1);
                return;
            }

            if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                event.preventDefault();
                focusTabAt(currentIndex - 1);
                return;
            }

            if (event.key === 'Home') {
                event.preventDefault();
                focusTabAt(0);
                return;
            }

            if (event.key === 'End') {
                event.preventDefault();
                focusTabAt(navTabs.length - 1);
            }
        });
    };

    // Navigasi sidebar
    bindNavItem('nav-orders', 'orders', 'tab-orders');
    bindNavItem('nav-products', 'products', 'tab-products');
    bindNavItem('nav-statistics', 'statistics', 'tab-statistics');
    bindNavItem('nav-store-status', 'store-status', 'tab-store-status');
    bindClick('btn-logout', () => app.logout());

    // Statistik (KPI + grafik)
    bindChange('stat-filter-date', () => app.calculateStatistics());
    bindChange('stat-start-date', () => app.calculateStatistics());
    bindChange('stat-end-date', () => app.calculateStatistics());
    bindChange('stat-revenue-filter-date', () => app.calculateStatistics());
    bindChange('stat-orders-filter-date', () => app.calculateStatistics());
    bindChange('stat-top-filter-date', () => app.calculateStatistics());
    bindClick('btn-refresh-dashboard', () => app.fetchDashboardData());
    bindClick('btn-refresh-store-status', () => app.fetchStoreStatus());
    bindClick('btn-toggle-store-status', () => app.toggleStoreStatus());
    bindSubmit('admin-password-form', (event) => app.handleChangePassword(event));
    document.addEventListener('click', (event) => {
        const toggleButton = event.target.closest('[data-toggle-password]');
        if (!toggleButton) return;
        event.preventDefault();
        app.togglePasswordFieldVisibility(toggleButton);
    });

    // Pesanan (filter + pagination + PDF)
    bindClick('btn-open-pdf-modal', () => app.openPdfModal());
    bindClick('btn-refresh-orders', () => app.fetchOrders());
    bindChange('sort-orders', () => app.handleSortChange());
    const onSearchOrders = typeof debounce === 'function'
        ? debounce(() => app.handleOrderFilterChange(), 250)
        : () => app.handleOrderFilterChange();
    bindKeyUp('search-orders', onSearchOrders);
    bindInput('search-orders', onSearchOrders);
    bindChange('filter-orders-date', () => app.handleOrderFilterChange());
    bindChange('filter-orders-start', () => app.handleOrderFilterChange());
    bindChange('filter-orders-end', () => app.handleOrderFilterChange());
    bindClick('btn-prev-page', () => app.prevPage());
    bindClick('btn-next-page', () => app.nextPage());

    // Produk (form + refresh + image method)
    document.querySelectorAll('input[name="pImgMethod"]').forEach((radio) => {
        radio.addEventListener('change', () => app.toggleImageInput());
    });
    bindClick('btn-cancel-edit', () => app.cancelEdit());
    bindClick('btn-refresh-products', () => app.fetchAdminProducts());
    bindClick('btn-prev-product-page', () => app.prevProductPage());
    bindClick('btn-next-product-page', () => app.nextProductPage());
    // Tombol ini muncul secara dinamis saat tabel kosong, jadi pakai delegasi event.
    document.addEventListener('click', (event) => {
        const refreshButton = event.target.closest('#btn-refresh-products-empty');
        if (!refreshButton) return;
        event.preventDefault();
        app.fetchAdminProducts();
    });

    document.addEventListener('click', (event) => {
        const pickupButton = event.target.closest('[data-action="mark-picked-up"]');
        if (!pickupButton) return;
        event.preventDefault();
        const orderId = pickupButton.getAttribute('data-order-id');
        if (!orderId) return;
        app.markOrderPickedUp(orderId);
    });

    // Modal Ekspor (validasi, PDF & CSV)
    bindClick('btn-close-pdf-modal', () => app.closePdfModal());
    bindChange('pdf-filter-date', () => app.handlePdfDateDropdown());
    bindClick('btn-check-pdf', () => app.checkPdfData());
    bindClick('btn-download-pdf', () => app.exportOrdersToPDF());
    bindClick('btn-download-csv', () => app.exportOrdersToCSV());
    bindClick('pdf-modal-overlay', (event) => {
        if (event.target && event.target.id === 'pdf-modal-overlay') {
            app.closePdfModal();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const overlay = document.getElementById('pdf-modal-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        app.closePdfModal();
    });

}

const adminApp = new AdminApp();
// Expose untuk debugging (dan kompatibilitas script lama)
window.adminApp = adminApp;
bindAdminDomEvents(adminApp);
adminApp.switchTab(adminApp.activeTab, { skipPersist: true });
adminApp.initFileAttachmentListener();
adminApp.initProductFormValidation();
