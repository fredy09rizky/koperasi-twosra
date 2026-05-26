// Modul AdminApp (Orders Stats KPI) — kalkulasi KPI, filter tanggal, top produk, stok kritis.
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

function createStatListItem(label, value) {
    const li = document.createElement('li');
    li.className = 'stat-list-item';
    const labelEl = document.createElement('div');
    labelEl.textContent = String(label || '');
    const valueEl = document.createElement('span');
    valueEl.textContent = String(value || '');
    li.appendChild(labelEl);
    li.appendChild(valueEl);
    return li;
}

AdminApp.prototype.calculateStatistics = function calculateStatistics() {
    if (!this.tabStatistics) return;

    // ====== FILTER KPI ======
    const filterEl = document.getElementById('stat-filter-date');
    const filterVal = filterEl ? filterEl.value : 'all';
    const customDateContainer = document.getElementById('stat-custom-date');

    if (customDateContainer && filterVal === 'custom') {
        customDateContainer.style.display = 'flex';
    } else if (customDateContainer) {
        customDateContainer.style.display = 'none';
    }

    let { startDate, endDate } = this.getStatisticsPresetRange(filterVal);
    if (filterVal === 'custom') {
        const sd = document.getElementById('stat-start-date').value;
        const ed = document.getElementById('stat-end-date').value;
        if (sd) startDate = this.parseWIBDateInput(sd, false);
        if (ed) endDate = this.parseWIBDateInput(ed, true);
        if (startDate && endDate && startDate > endDate) {
            const tmp = startDate;
            startDate = endDate;
            endDate = tmp;
        }
    }

    // Data KPI
    const allOrders = Array.isArray(this.ordersAnalytics) ? this.ordersAnalytics : [];
    const kpiOrders = this.filterOrdersByDateRange(allOrders, startDate, endDate);

    // ====== KPI UTAMA ======
    let totalGrossRevenue = 0; // total dibayar pembeli (subtotal + fee)
    let totalNetRevenue = 0; // total bersih yang masuk ke koperasi
    let totalFee = 0; // fee QRIS yang ditanggung pembeli
    const totalOrders = kpiOrders.length;
    let totalItemsSold = 0; // total qty item terjual
    kpiOrders.forEach(order => {
        const subtotalAmount = Number(order.total_amount) || 0;
        const feeAmount = Number(order.fee) || 0;
        totalNetRevenue += subtotalAmount;
        totalFee += feeAmount;
        totalGrossRevenue += subtotalAmount + feeAmount;
        const items = Array.isArray(order.items) ? order.items : [];
        items.forEach(item => {
            totalItemsSold += Number(item?.quantity) || 0;
        });
    });

    const averageOrderValue = totalOrders > 0 ? totalGrossRevenue / totalOrders : 0;

    const statGrossEl = document.getElementById('stat-gross');
    const statFeeEl = document.getElementById('stat-fee');
    const statNetEl = document.getElementById('stat-net');
    const statOrdersEl = document.getElementById('stat-orders');
    const statItemsSoldEl = document.getElementById('stat-items-sold');
    const statAovEl = document.getElementById('stat-aov');

    if (statGrossEl) statGrossEl.textContent = this.formatCurrency(totalGrossRevenue);
    if (statFeeEl) statFeeEl.textContent = this.formatCurrency(totalFee);
    if (statNetEl) statNetEl.textContent = this.formatCurrency(totalNetRevenue);
    if (statOrdersEl) statOrdersEl.textContent = totalOrders;
    if (statItemsSoldEl) statItemsSoldEl.textContent = totalItemsSold;
    if (statAovEl) statAovEl.textContent = this.formatCurrency(averageOrderValue);

    // ====== GRAFIK (FILTER PER GRAFIK) ======
    const revenueFilterEl = document.getElementById('stat-revenue-filter-date');
    const revenueFilterVal = revenueFilterEl ? revenueFilterEl.value : 'this_month';
    const revenueRange = this.getStatisticsPresetRange(revenueFilterVal);
    const revenueOrders = this.filterOrdersByDateRange(allOrders, revenueRange.startDate, revenueRange.endDate);

    const ordersFilterEl = document.getElementById('stat-orders-filter-date');
    const ordersFilterVal = ordersFilterEl ? ordersFilterEl.value : 'this_month';
    const ordersRange = this.getStatisticsPresetRange(ordersFilterVal);
    const ordersChartOrders = this.filterOrdersByDateRange(allOrders, ordersRange.startDate, ordersRange.endDate);

    void this.renderStatisticsCharts(
        { orders: revenueOrders, startDate: revenueRange.startDate, endDate: revenueRange.endDate, filterVal: revenueFilterVal },
        { orders: ordersChartOrders, startDate: ordersRange.startDate, endDate: ordersRange.endDate, filterVal: ordersFilterVal }
    );

    // ====== TOP PRODUK (FILTER SENDIRI) ======
    const topFilterEl = document.getElementById('stat-top-filter-date');
    const topFilterVal = topFilterEl ? topFilterEl.value : 'this_month';
    const topRange = this.getStatisticsPresetRange(topFilterVal);
    const topOrders = this.filterOrdersByDateRange(allOrders, topRange.startDate, topRange.endDate);
    this.renderTopProductsStats(topOrders);

    // ====== INSIGHT STOK ======
    this.renderLowStockStats();
};

AdminApp.prototype.getStatisticsPresetRange = function getStatisticsPresetRange(filterVal) {
    const normalized = String(filterVal || 'all');
    const wibNow = this.getWIBDate();
    const startOfDay = new Date(wibNow.getFullYear(), wibNow.getMonth(), wibNow.getDate());
    const nowWib = new Date(wibNow);

    let startDate = null;
    let endDate = null;

    if (normalized === 'today') {
        startDate = startOfDay;
        endDate = nowWib;
    } else if (normalized === 'yesterday') {
        startDate = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
        endDate = new Date(startOfDay.getTime() - 1);
    } else if (normalized === 'this_week') {
        const dayOfWeek = wibNow.getDay(); // 0 = Minggu
        const diff = wibNow.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Senin awal minggu
        startDate = new Date(wibNow.getFullYear(), wibNow.getMonth(), diff);
        endDate = nowWib;
    } else if (normalized === 'this_month') {
        startDate = new Date(wibNow.getFullYear(), wibNow.getMonth(), 1);
        endDate = nowWib;
    } else if (normalized === 'this_year') {
        startDate = new Date(wibNow.getFullYear(), 0, 1);
        endDate = nowWib;
    }

    return { startDate, endDate };
};

AdminApp.prototype.filterOrdersByDateRange = function filterOrdersByDateRange(orders, startDate, endDate) {
    const source = Array.isArray(orders) ? orders : [];
    if (!startDate && !endDate) return source;

    return source.filter((order) => {
        const orderDate = this.parseOrderDate(order);
        if (!orderDate) return false;
        if (startDate && orderDate < startDate) return false;
        if (endDate && orderDate > endDate) return false;
        return true;
    });
};

AdminApp.prototype.renderTopProductsStats = function renderTopProductsStats(orders) {
    // Agregasi top 5 produk terlaris berdasarkan jumlah item
    const listEl = document.getElementById('stat-top-products');
    const summaryEl = document.getElementById('stat-top-summary');
    if (!listEl) return;

    const quantityByName = new Map();
    let totalItems = 0;

    orders.forEach(order => {
        const items = Array.isArray(order.items) ? order.items : [];
        items.forEach(item => {
            const name = String(item?.product_name || '').trim();
            if (!name) return;
            const qty = Number(item?.quantity) || 0;
            if (!qty) return;
            quantityByName.set(name, (quantityByName.get(name) || 0) + qty);
            totalItems += qty;
        });
    });

    const topItems = Array.from(quantityByName.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    listEl.replaceChildren();
    if (topItems.length === 0) {
        listEl.appendChild(createStatListItem('Belum ada data penjualan.', '0'));
    } else {
        topItems.forEach(([name, qty]) => {
            listEl.appendChild(createStatListItem(name, `${qty} pcs`));
        });
    }

    if (summaryEl) summaryEl.textContent = `${totalItems} item terjual`;
};

AdminApp.prototype.renderLowStockStats = function renderLowStockStats() {
    // Tampilkan stok kritis (<= 5) agar admin cepat bertindak
    const listEl = document.getElementById('stat-low-stock');
    if (!listEl) return;

    const products = Array.isArray(this.products) ? this.products : [];
    const lowStock = products
        .filter((product) => Number(product?.stock_available ?? product?.stock) <= 5)
        .sort((a, b) => (Number(a?.stock_available ?? a?.stock) || 0) - (Number(b?.stock_available ?? b?.stock) || 0))
        .slice(0, 5);

    listEl.replaceChildren();
    if (lowStock.length === 0) {
        listEl.appendChild(createStatListItem('Stok aman.', 'OK'));
        return;
    }

    lowStock.forEach(product => {
        const stockValue = Number.isFinite(Number(product?.stock_available))
            ? Number(product.stock_available)
            : Number(product?.stock || 0);
        listEl.appendChild(createStatListItem(product?.name, `${stockValue} pcs`));
    });
};
