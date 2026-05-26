// Modul AdminApp (Orders Stats Charts) — builder series dan render Chart.js.
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.buildStatisticsSeries = function buildStatisticsSeries(orders, startDate, endDate, filterVal = 'all') {
    // Bangun data series untuk grafik (otomatis pilih bucket harian/mingguan/bulanan)
    const range = this.getOrderDateRange(orders);
    const rangeStart = startDate || range.minDate;
    const rangeEnd = endDate || range.maxDate;
    if (!rangeStart || !rangeEnd) {
        return { labels: [], revenueSeries: [], orderSeries: [], bucketLabel: 'hari' };
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const rangeDays = Math.ceil((rangeEnd - rangeStart) / dayMs) + 1;
    let bucket = 'day';
    if (rangeDays > 31 && rangeDays <= 180) bucket = 'week';
    if (rangeDays > 180) bucket = 'month';
    // Filter "Tahun Ini" dipaksa ke bulanan agar lebih rapi
    if (filterVal === 'this_year') bucket = 'month';

    // Map akumulasi omzet kotor (subtotal + fee) dan jumlah order per bucket
    const revenueMap = new Map();
    const orderMap = new Map();

    orders.forEach(order => {
        const orderDate = this.parseOrderDate(order);
        if (!orderDate) return;
        let bucketKey = '';
        if (bucket === 'day') {
            bucketKey = this.getWIBDateKey(orderDate);
        } else if (bucket === 'week') {
            const weekStart = this.getWeekStartDate(orderDate);
            bucketKey = weekStart ? this.getWIBDateKey(weekStart) : '';
        } else {
            bucketKey = this.getWIBMonthKey(orderDate);
        }
        if (!bucketKey) return;
        const subtotalAmount = Number(order.total_amount) || 0;
        const feeAmount = Number(order.fee) || 0;
        revenueMap.set(bucketKey, (revenueMap.get(bucketKey) || 0) + subtotalAmount + feeAmount);
        orderMap.set(bucketKey, (orderMap.get(bucketKey) || 0) + 1);
    });

    // Isi series lengkap (termasuk bucket yang kosong agar grafik tidak loncat)
    const labels = [];
    const revenueSeries = [];
    const orderSeries = [];

    if (bucket === 'day') {
        const startKey = this.getWIBDateKey(rangeStart);
        const endKey = this.getWIBDateKey(rangeEnd);
        let cursor = new Date(`${startKey}T00:00:00+07:00`);
        const endCursor = new Date(`${endKey}T00:00:00+07:00`);

        while (cursor <= endCursor) {
            const key = this.getWIBDateKey(cursor);
            labels.push(this.getWIBShortLabel(cursor));
            revenueSeries.push(revenueMap.get(key) || 0);
            orderSeries.push(orderMap.get(key) || 0);
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
    } else if (bucket === 'week') {
        const startWeek = this.getWeekStartDate(rangeStart);
        const endWeek = this.getWeekStartDate(rangeEnd);
        if (startWeek && endWeek) {
            let cursor = new Date(startWeek);
            while (cursor <= endWeek) {
                const key = this.getWIBDateKey(cursor);
                const weekEnd = new Date(cursor);
                weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
                // Clamp label agar tidak menampilkan tanggal di luar range filter
                const labelStart = rangeStart && cursor < rangeStart ? rangeStart : cursor;
                const labelEnd = rangeEnd && weekEnd > rangeEnd ? rangeEnd : weekEnd;
                labels.push(this.getWIBRangeLabel(labelStart, labelEnd));
                revenueSeries.push(revenueMap.get(key) || 0);
                orderSeries.push(orderMap.get(key) || 0);
                cursor.setUTCDate(cursor.getUTCDate() + 7);
            }
        }
    } else {
        const startMonthKey = this.getWIBMonthKey(rangeStart);
        const endMonthKey = this.getWIBMonthKey(rangeEnd);
        if (startMonthKey && endMonthKey) {
            const [startYear, startMonth] = startMonthKey.split('-').map(Number);
            const [endYear, endMonth] = endMonthKey.split('-').map(Number);
            let year = startYear;
            let month = startMonth;

            while (year < endYear || (year === endYear && month <= endMonth)) {
                const monthStr = String(month).padStart(2, '0');
                const cursor = new Date(`${year}-${monthStr}-01T00:00:00+07:00`);
                const key = this.getWIBMonthKey(cursor);
                labels.push(this.getWIBMonthLabel(cursor));
                revenueSeries.push(revenueMap.get(key) || 0);
                orderSeries.push(orderMap.get(key) || 0);

                month += 1;
                if (month > 12) {
                    month = 1;
                    year += 1;
                }
            }
        }
    }

    const bucketLabel = bucket === 'day' ? 'hari' : bucket === 'week' ? 'minggu' : 'bulan';
    return { labels, revenueSeries, orderSeries, bucketLabel };
};

AdminApp.prototype.renderStatisticsCharts = async function renderStatisticsCharts(revenueConfig, ordersConfig) {
    // Render Chart.js (line untuk omzet, bar untuk jumlah order) dengan filter masing-masing
    const revenueCanvas = document.getElementById('stat-chart-revenue');
    const ordersCanvas = document.getElementById('stat-chart-orders');
    const revenueEmpty = document.getElementById('stat-revenue-empty');
    const ordersEmpty = document.getElementById('stat-orders-empty');
    const revenueCaption = document.getElementById('stat-revenue-caption');
    const ordersCaption = document.getElementById('stat-orders-caption');
    const logger = typeof this.getAppLogger === 'function'
        ? this.getAppLogger()
        : {
            warn: () => {}
        };
    const formatCurrency = (value) => (
        typeof this.formatCurrency === 'function'
            ? this.formatCurrency(value)
            : `Rp${new Intl.NumberFormat('id-ID').format(Number.isFinite(Number(value)) ? Number(value) : 0)}`
    );

    if (!revenueCanvas || !ordersCanvas) return;

    // Hanya render dari request paling baru agar tidak balapan saat user cepat ganti filter.
    const renderRequestId = (this.statsChartRenderRequestId || 0) + 1;
    this.statsChartRenderRequestId = renderRequestId;

    let ChartLibrary = null;
    try {
        if (typeof this.ensureChartVendor === 'function') {
            ChartLibrary = await this.ensureChartVendor();
        } else if (typeof ensureChartLibrary === 'function') {
            ChartLibrary = await ensureChartLibrary();
        } else if (typeof Chart === 'function') {
            ChartLibrary = Chart;
        }
    } catch (error) {
        logger.warn('Gagal memuat Chart.js untuk statistik admin', {
            error: error?.message || String(error)
        });
    }

    if (renderRequestId !== this.statsChartRenderRequestId) {
        return;
    }

    if (typeof ChartLibrary !== 'function') {
        if (revenueEmpty) {
            revenueEmpty.style.display = 'flex';
            revenueEmpty.textContent = 'Grafik tidak tersedia (Chart.js belum dimuat).';
        }
        if (ordersEmpty) {
            ordersEmpty.style.display = 'flex';
            ordersEmpty.textContent = 'Grafik tidak tersedia (Chart.js belum dimuat).';
        }
        return;
    }

    // Hancurkan chart lama agar tidak menumpuk instance
    if (!this.statsCharts) this.statsCharts = {};
    if (this.statsCharts.revenue) this.statsCharts.revenue.destroy();
    if (this.statsCharts.orders) this.statsCharts.orders.destroy();

    const revenueOrders = Array.isArray(revenueConfig?.orders) ? revenueConfig.orders : [];
    const ordersOrders = Array.isArray(ordersConfig?.orders) ? ordersConfig.orders : [];

    if (!revenueOrders.length) {
        if (revenueEmpty) revenueEmpty.style.display = 'flex';
        if (revenueCaption) revenueCaption.textContent = 'Belum ada data pendapatan untuk filter ini.';
        this.statsCharts.revenue = null;
    } else {
        if (revenueEmpty) revenueEmpty.style.display = 'none';
        const revenueSeriesData = this.buildStatisticsSeries(
            revenueOrders,
            revenueConfig?.startDate || null,
            revenueConfig?.endDate || null,
            revenueConfig?.filterVal || 'all'
        );
        if (revenueCaption) revenueCaption.textContent = `Tren pendapatan per ${revenueSeriesData.bucketLabel}.`;
        this.statsCharts.revenue = new ChartLibrary(revenueCanvas, {
            type: 'line',
            data: {
                labels: revenueSeriesData.labels,
                datasets: [
                    {
                        label: 'Omzet',
                        data: revenueSeriesData.revenueSeries,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.12)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 2.5 // titik kecil agar grafik tetap ringan di mobile
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        // Format tooltip omzet jadi Rupiah
                        callbacks: {
                            label: (context) => `Omzet: ${formatCurrency(context.parsed.y)}`
                        }
                    }
                },
                scales: {
                    y: {
                        // Format label sumbu Y jadi Rupiah
                        ticks: {
                            callback: (value) => formatCurrency(value)
                        }
                    }
                }
            }
        });
    }

    if (!ordersOrders.length) {
        if (ordersEmpty) ordersEmpty.style.display = 'flex';
        if (ordersCaption) ordersCaption.textContent = 'Belum ada data pesanan untuk filter ini.';
        this.statsCharts.orders = null;
        return;
    }

    if (ordersEmpty) ordersEmpty.style.display = 'none';
    const ordersSeriesData = this.buildStatisticsSeries(
        ordersOrders,
        ordersConfig?.startDate || null,
        ordersConfig?.endDate || null,
        ordersConfig?.filterVal || 'all'
    );
    if (ordersCaption) ordersCaption.textContent = `Tren jumlah pesanan per ${ordersSeriesData.bucketLabel}.`;

    this.statsCharts.orders = new ChartLibrary(ordersCanvas, {
        type: 'bar',
        data: {
            labels: ordersSeriesData.labels,
            datasets: [
                {
                    label: 'Pesanan',
                    data: ordersSeriesData.orderSeries,
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderRadius: 6 // sudut rounded agar kartu terasa modern
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    // Bilangan bulat supaya tidak muncul desimal 0.5 dst
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
};
