// Modul AdminApp (Orders List) — daftar pesanan, filter, pagination, analytics fetch
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.fetchOrders = async function fetchOrders(options = {}) {
    const { silent = false, message = 'Memuat data pesanan...' } = options;
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    const modal = this.getModalApi();
    try {
        await this.withGlobalLoading(async () => {
            const query = new URLSearchParams();
            query.set('page', String(this.currentPage));
            query.set('limit', String(this.itemsPerPage));
            query.set('sort', this.sortOrder === 'asc' ? 'asc' : 'desc');
            query.set('search', String(this.ordersFilters?.search || '').trim());
            query.set('date_filter', String(this.ordersFilters?.dateFilter || 'all'));
            if (String(this.ordersFilters?.startDate || '').trim()) {
                query.set('start_date', String(this.ordersFilters.startDate).trim());
            }
            if (String(this.ordersFilters?.endDate || '').trim()) {
                query.set('end_date', String(this.ordersFilters.endDate).trim());
            }
            query.set('include_items', '1');

            const res = await fetch(`${apiBaseUrl}/api/admin/orders?${query.toString()}`, {
                credentials: 'include'
            });

            if (await this.handleApiError(res)) return;
            if (!res.ok) {
                const errorPayload = await this.parseJsonSafe(res);
                if (typeof this.showAdminError === 'function') {
                    this.showAdminError(errorPayload, 'Gagal memuat data pesanan.');
                } else {
                    modal.alert('Gagal memuat data pesanan.');
                }
                return;
            }

            const payload = await res.json();
            const data = Array.isArray(payload?.data) ? payload.data : [];
            const meta = payload?.meta || {};

            this.orders = data;
            this.filteredOrders = data;
            this.totalOrderRows = Number(meta?.total || 0);
            this.totalPendingPickupRows = Number(meta?.pendingPickupTotal || 0);
            this.totalOrderPages = Number(meta?.totalPages || 0);
            this.currentPage = Number(meta?.page || this.currentPage);
            this.renderOrders();
        }, { silent, message });
    } catch (error) {
        logger.error('Gagal memuat daftar pesanan admin', error);
        modal.alert("Gagal memuat pesanan.");
    }
};

AdminApp.prototype.renderOrdersQuickSummary = function renderOrdersQuickSummary() {
    const totalEl = document.getElementById('orders-summary-total');
    const pendingEl = document.getElementById('orders-summary-pending');
    const pageValueEl = document.getElementById('orders-summary-page-value');
    const storeStatusEl = document.getElementById('orders-summary-store-status');
    if (!totalEl && !pendingEl && !pageValueEl && !storeStatusEl) return;

    const orders = Array.isArray(this.filteredOrders) ? this.filteredOrders : [];
    const totalRows = Number.isFinite(Number(this.totalOrderRows)) ? Number(this.totalOrderRows) : orders.length;
    const pendingPickup = Number.isFinite(Number(this.totalPendingPickupRows))
        ? Number(this.totalPendingPickupRows)
        : orders.filter(order => String(order?.pickup_status || 'BELUM_DIAMBIL') !== 'SUDAH_DIAMBIL').length;
    const pageValue = orders.reduce((sum, order) => {
        const subtotal = Number.isFinite(Number(order?.total_amount)) ? Number(order.total_amount) : 0;
        const fee = Number.isFinite(Number(order?.fee)) ? Number(order.fee) : 0;
        return sum + subtotal + fee;
    }, 0);
    const storeStatus = this.storeStatusData
        ? (this.storeStatusData.accepting_orders ? 'Buka' : 'Tutup')
        : 'Memuat';

    if (totalEl) totalEl.textContent = String(totalRows);
    if (pendingEl) pendingEl.textContent = String(pendingPickup);
    if (pageValueEl) pageValueEl.textContent = this.formatCurrency(pageValue);
    if (storeStatusEl) storeStatusEl.textContent = storeStatus;
};

AdminApp.prototype.handleOrderFilterChange = function handleOrderFilterChange() {
    const searchInput = document.getElementById('search-orders');
    const filterSelect = document.getElementById('filter-orders-date');
    const customDateContainer = document.getElementById('filter-orders-custom-date');
    const startDateInput = document.getElementById('filter-orders-start');
    const endDateInput = document.getElementById('filter-orders-end');
    const nextDateFilter = filterSelect ? String(filterSelect.value || 'all') : 'all';

    if (customDateContainer) {
        customDateContainer.style.display = nextDateFilter === 'custom' ? 'flex' : 'none';
    }

    this.ordersFilters = {
        search: searchInput ? String(searchInput.value || '').trim() : '',
        dateFilter: nextDateFilter,
        startDate: startDateInput ? String(startDateInput.value || '').trim() : '',
        endDate: endDateInput ? String(endDateInput.value || '').trim() : ''
    };

    this.currentPage = 1;
    this.fetchOrders();
};

AdminApp.prototype.fetchOrdersAnalytics = async function fetchOrdersAnalytics(options = {}) {
    const {
        silent = true,
        force = false,
        dateFilter = 'all',
        startDate = '',
        endDate = ''
    } = options;
    const normalizedDateFilter = String(dateFilter || 'all').trim() || 'all';
    const normalizedStartDate = String(startDate || '').trim();
    const normalizedEndDate = String(endDate || '').trim();
    const analyticsCacheKey = `${normalizedDateFilter}|${normalizedStartDate}|${normalizedEndDate}`;
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();

    if (!force && this.hasFetchedAnalytics && this.ordersAnalyticsCacheKey === analyticsCacheKey) {
        return this.ordersAnalytics;
    }

    try {
        return await this.withGlobalLoading(async () => {
            const query = new URLSearchParams();
            query.set('date_filter', normalizedDateFilter);
            if (normalizedStartDate) {
                query.set('start_date', normalizedStartDate);
            }
            if (normalizedEndDate) {
                query.set('end_date', normalizedEndDate);
            }
            query.set('limit', '5000');

            const response = await fetch(`${apiBaseUrl}/api/admin/orders/analytics?${query.toString()}`, {
                credentials: 'include'
            });
            if (await this.handleApiError(response)) return [];
            if (!response.ok) return [];

            const payload = await response.json();
            const rows = Array.isArray(payload?.data) ? payload.data : [];
            const meta = payload?.meta || {};
            if (payload?.meta?.truncated) {
                logger.warn('Dataset analytics admin dipotong oleh limit server', payload?.meta);
            }

            this.ordersAnalytics = rows;
            this.ordersAnalyticsMeta = meta;
            this.ordersAnalyticsCacheKey = analyticsCacheKey;
            this.hasFetchedAnalytics = true;
            return rows;
        }, { silent, message: 'Memuat data statistik pesanan...' });
    } catch (error) {
        logger.error('Gagal memuat dataset statistik pesanan', error);
        return [];
    }
};

AdminApp.prototype.sortOrders = function sortOrders() {
    this.currentPage = 1;
    this.fetchOrders();
};

AdminApp.prototype.handleSortChange = function handleSortChange() {
    const select = document.getElementById('sort-orders');
    this.sortOrder = select.value;
    this.sortOrders();
};

AdminApp.prototype.prevPage = function prevPage() {
    if (this.currentPage > 1) {
        this.currentPage--;
        this.fetchOrders();
    }
};

AdminApp.prototype.nextPage = function nextPage() {
    if (this.currentPage < this.totalOrderPages) {
        this.currentPage++;
        this.fetchOrders();
    }
};

AdminApp.prototype.renderOrders = function renderOrders() {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;
    tbody.replaceChildren();

    if (!this.filteredOrders || this.filteredOrders.length === 0) {
        // Empty state ketika filter tidak menemukan data
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 5;
        emptyCell.className = 'table-empty';
        emptyCell.textContent = 'Tidak ada pesanan yang sesuai kriteria.';
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        this.updatePagination(0);
        this.renderOrdersQuickSummary();
        return;
    }

    const currentOrders = this.filteredOrders;

    currentOrders.forEach(order => {
        const tr = document.createElement('tr');
        const orderItems = Array.isArray(order.items) ? order.items : [];
        const pickupMeta = this.getPickupStatusMeta(order);
        const pickedUpAtDate = this.parsePickupDate(order);
        const pickedUpAtLabel = pickedUpAtDate
            ? this.formatAdminDateTime(pickedUpAtDate, { withSeconds: true })
            : '-';

        // Format tanggal dipaksa ke Zona Waktu Indonesia Barat (WIB) / Asia/Jakarta
        const dateObj = this.parseOrderDate(order);
        const shortDate = this.formatAdminDateTime(dateObj, { withSeconds: false, month: 'short' });
        const orderId = String(order.id || '');
        const customerName = String(order.customer_name || '');
        const customerClass = String(order.customer_class || '');
        const waNumber = String(order.wa_number || '');
        const pickupDay = String((order.pickup_time || '').split(' - ')[0] || order.pickup_time || '-');

        const createTextDiv = (className, text) => {
            const div = document.createElement('div');
            div.className = className;
            div.textContent = String(text ?? '');
            return div;
        };

        const dateCell = document.createElement('td');
        dateCell.className = 'col-waktu';
        dateCell.dataset.label = 'Waktu';
        dateCell.appendChild(createTextDiv('order-date-text', shortDate));

        const idCell = document.createElement('td');
        idCell.className = 'col-id';
        idCell.dataset.label = 'ID Transaksi';
        idCell.appendChild(createTextDiv('order-id-text', orderId));

        const customerCell = document.createElement('td');
        customerCell.className = 'col-pelanggan';
        customerCell.dataset.label = 'Pembeli';
        customerCell.appendChild(createTextDiv('customer-name-text', customerName));
        customerCell.appendChild(createTextDiv('customer-meta-text customer-class-text', customerClass));
        customerCell.appendChild(createTextDiv('customer-meta-text', waNumber));

        // Menyusun daftar pesanan menjadi lebih ringkas untuk tabel
        const itemsCell = document.createElement('td');
        itemsCell.className = 'col-belanja';
        itemsCell.dataset.label = 'Daftar Belanja';
        const itemsList = document.createElement('ul');
        itemsList.className = 'items-list';
        orderItems.forEach(item => {
            const safeQuantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
            const li = document.createElement('li');
            const qty = document.createElement('b');
            qty.textContent = `${safeQuantity}x`;
            const name = document.createElement('span');
            name.className = 'order-item-name';
            name.textContent = String(item.product_name || '');
            li.appendChild(qty);
            li.appendChild(document.createTextNode(' '));
            li.appendChild(name);
            itemsList.appendChild(li);
        });
        itemsCell.appendChild(itemsList);

        const totalCell = document.createElement('td');
        totalCell.className = 'col-total';
        totalCell.dataset.label = 'Total & Status';
        totalCell.appendChild(createTextDiv('order-total-text', this.formatCurrency(order.total_amount)));
        totalCell.appendChild(createTextDiv('pickup-day-text', `Ambil: ${pickupDay}`));

        const pickupStatusGroup = document.createElement('div');
        pickupStatusGroup.className = 'pickup-status-group';
        const paidBadge = document.createElement('span');
        paidBadge.className = 'badge-paid';
        paidBadge.textContent = 'LUNAS';
        const pickupBadge = document.createElement('span');
        pickupBadge.className = pickupMeta.className;
        pickupBadge.textContent = pickupMeta.label;
        pickupStatusGroup.appendChild(paidBadge);
        pickupStatusGroup.appendChild(pickupBadge);
        totalCell.appendChild(pickupStatusGroup);

        if (pickupMeta.isFinal) {
            totalCell.appendChild(createTextDiv('pickup-meta', `Diambil: ${pickedUpAtLabel}`));
        } else {
            const pickupButton = document.createElement('button');
            pickupButton.type = 'button';
            pickupButton.className = 'btn btn-primary pickup-action-btn';
            pickupButton.dataset.action = 'mark-picked-up';
            pickupButton.dataset.orderId = orderId;
            pickupButton.textContent = 'Tandai Sudah Diambil';
            totalCell.appendChild(pickupButton);
        }

        tr.appendChild(dateCell);
        tr.appendChild(idCell);
        tr.appendChild(customerCell);
        tr.appendChild(itemsCell);
        tr.appendChild(totalCell);
        tbody.appendChild(tr);
    });

    this.updatePagination(this.totalOrderPages);
    this.renderOrdersQuickSummary();
};

AdminApp.prototype.updatePagination = function updatePagination(totalPages) {
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');
    const pageInfo = document.getElementById('page-info');

    if (!btnPrev || !btnNext || !pageInfo) return;

    if (totalPages === 0) {
        pageInfo.textContent = `Menampilkan 0 data`;
        btnPrev.disabled = true;
        btnNext.disabled = true;
        return;
    }

    const totalRows = Number.isFinite(Number(this.totalOrderRows)) ? Number(this.totalOrderRows) : 0;
    pageInfo.textContent = `Halaman ${this.currentPage} dari ${totalPages} (${totalRows} pesanan)`;
    btnPrev.disabled = this.currentPage === 1;
    btnNext.disabled = this.currentPage === totalPages;
};
