// Modul AdminApp (Orders Shared) — helper tanggal/WIB dan pickup final
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.parseOrderDate = function parseOrderDate(order) {
    // Normalisasi created_at agar pasti bisa diparse (pakai Z/UTC jika belum ada timezone)
    const orderCreated = String(order?.created_at || '').trim();
    if (!orderCreated) return null;
    const dateStr = this.normalizeOrderTimestamp(orderCreated);
    const dateObj = new Date(dateStr);
    if (Number.isNaN(dateObj.getTime())) return null;
    return dateObj;
};

AdminApp.prototype.parsePickupDate = function parsePickupDate(order) {
    const pickupRaw = String(order?.picked_up_at || '').trim();
    if (!pickupRaw) return null;
    const normalized = this.normalizeOrderTimestamp(pickupRaw);
    const dateObj = new Date(normalized);
    if (Number.isNaN(dateObj.getTime())) return null;
    return dateObj;
};

AdminApp.prototype.formatAdminDateTime = function formatAdminDateTime(dateObj, options = {}) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '-';
    const {
        withSeconds = false,
        month = 'short'
    } = options;
    const formatOptions = {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month,
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    if (withSeconds) {
        formatOptions.second = '2-digit';
    }
    return `${new Intl.DateTimeFormat('id-ID', formatOptions).format(dateObj).replace(/\./g, ':')} WIB`;
};

AdminApp.prototype.getPickupStatusMeta = function getPickupStatusMeta(order) {
    const pickupStatus = String(order?.pickup_status || 'BELUM_DIAMBIL');
    if (pickupStatus === 'SUDAH_DIAMBIL') {
        return {
            label: 'SUDAH DIAMBIL',
            className: 'badge-pickup-done',
            isFinal: true
        };
    }
    return {
        label: 'BELUM DIAMBIL',
        className: 'badge-pickup-pending',
        isFinal: false
    };
};

AdminApp.prototype.markOrderPickedUp = async function markOrderPickedUp(orderId) {
    const normalizedOrderId = String(orderId || '').trim();
    if (!normalizedOrderId) return;
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    const modal = this.getModalApi();

    // Konfirmasi dibuat tegas karena aksi ini final dan sengaja tidak punya rollback di UI biasa.
    const confirmed = await modal.confirm(
        'Yakin pesanan ini sudah benar-benar diserahkan ke siswa? Status pengambilan bersifat final dan tidak dapat diubah kembali.',
        'Konfirmasi Pengambilan Final',
        'warning'
    );
    if (!confirmed) return;

    try {
        await this.withGlobalLoading(async () => {
            const response = await fetch(`${apiBaseUrl}/api/admin/orders/${encodeURIComponent(normalizedOrderId)}/pickup`, {
                method: 'POST',
                credentials: 'include'
            });

            if (await this.handleApiError(response)) return;

            const payload = await this.parseJsonSafe(response);

            if (!response.ok || !payload?.success) {
                if (typeof this.showAdminError === 'function') {
                    this.showAdminError(payload, 'Gagal memperbarui status pengambilan.');
                } else {
                    await modal.alert(payload?.message || 'Gagal memperbarui status pengambilan.', 'Gagal', 'error');
                }
                return;
            }

            const updatedPickupStatus = String(payload?.data?.pickup_status || 'SUDAH_DIAMBIL');
            const updatedPickedUpAt = payload?.data?.picked_up_at || null;

            // Sinkronkan state lokal halaman aktif agar badge/tombol langsung berubah.
            this.orders = (Array.isArray(this.orders) ? this.orders : []).map((order) => {
                if (String(order?.id || '') !== normalizedOrderId) return order;
                return {
                    ...order,
                    pickup_status: updatedPickupStatus,
                    picked_up_at: updatedPickedUpAt
                };
            });
            this.filteredOrders = this.orders;
            this.renderOrders();
            this.hasFetchedAnalytics = false;
            void this.fetchOrdersAnalytics({ silent: true, force: true }).then(() => this.calculateStatistics());
            await modal.alert('Status pengambilan berhasil ditandai final.', 'Berhasil', 'success');
        }, { message: 'Menyimpan status pengambilan final...' });
    } catch (error) {
        logger.error('Gagal memperbarui status pickup pesanan', error);
        await modal.alert('Terjadi kesalahan saat memperbarui status pengambilan.', 'Gagal', 'error');
    }
};

AdminApp.prototype.normalizeOrderTimestamp = function normalizeOrderTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    let normalized = raw.replace(' ', 'T');
    const hasTimezone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized);
    if (!hasTimezone) {
        // created_at dari D1 CURRENT_TIMESTAMP disimpan sebagai UTC tanpa suffix timezone.
        normalized += 'Z';
    }
    return normalized;
};

AdminApp.prototype.getWIBDateKey = function getWIBDateKey(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(dateObj);
};

AdminApp.prototype.getWIBMonthKey = function getWIBMonthKey(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit'
    }).format(dateObj);
};

AdminApp.prototype.getWIBShortLabel = function getWIBShortLabel(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short'
    }).format(dateObj);
};

AdminApp.prototype.getWIBMonthLabel = function getWIBMonthLabel(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        month: 'short',
        year: 'numeric'
    }).format(dateObj);
};

AdminApp.prototype.getWIBDayNumber = function getWIBDayNumber(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit'
    }).format(dateObj);
};

AdminApp.prototype.getWIBMonthShort = function getWIBMonthShort(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        month: 'short'
    }).format(dateObj);
};

AdminApp.prototype.getWIBRangeLabel = function getWIBRangeLabel(startDate, endDate) {
    if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return '-';
    if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return this.getWIBShortLabel(startDate);
    const startMonthKey = this.getWIBMonthKey(startDate);
    const endMonthKey = this.getWIBMonthKey(endDate);
    if (startMonthKey && startMonthKey === endMonthKey) {
        const startDay = this.getWIBDayNumber(startDate);
        const endDay = this.getWIBDayNumber(endDate);
        const monthShort = this.getWIBMonthShort(startDate);
        return `${startDay}–${endDay} ${monthShort}`;
    }
    return `${this.getWIBShortLabel(startDate)}–${this.getWIBShortLabel(endDate)}`;
};

AdminApp.prototype.getWeekStartDate = function getWeekStartDate(dateObj) {
    const key = this.getWIBDateKey(dateObj);
    if (!key) return null;
    const baseDate = new Date(`${key}T00:00:00+07:00`);
    const dayOfWeek = baseDate.getUTCDay(); // 0 = Minggu
    const diff = (dayOfWeek + 6) % 7; // Geser agar Senin = 0
    baseDate.setUTCDate(baseDate.getUTCDate() - diff);
    return baseDate;
};

AdminApp.prototype.getOrderDateRange = function getOrderDateRange(orders) {
    let minDate = null;
    let maxDate = null;
    orders.forEach(order => {
        const orderDate = this.parseOrderDate(order);
        if (!orderDate) return;
        if (!minDate || orderDate < minDate) minDate = orderDate;
        if (!maxDate || orderDate > maxDate) maxDate = orderDate;
    });
    return { minDate, maxDate };
};
