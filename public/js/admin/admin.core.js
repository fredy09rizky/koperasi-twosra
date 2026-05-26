// AdminApp core (constructor + constants)
// File ini sengaja dipisah untuk merapikan kode dan memudahkan maintain.

// Konstanta validasi upload produk (dipakai di modul admin.products.*)
export const ALLOWED_PRODUCT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_PRODUCT_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB

export class AdminApp {
    constructor() {
        this.products = [];
        this.orders = []; // Data pesanan untuk halaman tabel saat ini (server-side paginated)
        this.ordersAnalytics = []; // Dataset agregasi/statistik (diambil terpisah saat dibutuhkan)
        this.ordersAnalyticsMeta = null;
        this.ordersAnalyticsCacheKey = null;
        this.filteredOrders = []; // Halaman pesanan saat ini (alias untuk this.orders, dipertahankan untuk kompatibilitas)
        this.pdfDataCandidate = []; // Data pesanan khusus untuk PDF export
        this.currentPage = 1;
        this.itemsPerPage = 10; // Jumlah pesanan per halaman
        this.totalOrderPages = 0;
        this.totalOrderRows = 0;
        this.totalPendingPickupRows = 0;
        this.currentProductPage = 1;
        this.productsPerPage = 8; // Jumlah produk per halaman katalog admin
        this.sortOrder = 'desc'; // desc = terbaru, asc = terlama
        this.editingProductId = null;
        this.storeStatusData = null;
        this.ordersFilters = {
            search: '',
            dateFilter: 'all',
            startDate: '',
            endDate: ''
        };
        this.hasFetchedAnalytics = false;
        this.init();
    }
}

if (typeof window !== 'undefined') {
    window.AdminApp = AdminApp;
}
