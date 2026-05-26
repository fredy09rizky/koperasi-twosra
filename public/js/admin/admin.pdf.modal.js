// Modul AdminApp (PDF Modal) — kontrol modal dan validasi kandidat ekspor
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.openPdfModal = function openPdfModal() {
    // Reset state modal (filter default + tombol download disable)
    document.getElementById('pdf-filter-date').value = 'all';
    document.getElementById('pdf-sort-order').value = 'desc';
    document.getElementById('pdf-start-date').value = '';
    document.getElementById('pdf-end-date').value = '';
    this.handlePdfDateDropdown(); // Sembunyikan input custom date

    const validationMsg = document.getElementById('pdf-validation-msg');
    validationMsg.textContent = "Klik 'Periksa Data' untuk memvalidasi transaksi...";
    validationMsg.style.color = "#64748b";
    document.getElementById('btn-download-pdf').disabled = true;
    document.getElementById('btn-download-csv').disabled = true;

    this.pdfDataCandidate = [];
    document.getElementById('pdf-modal-overlay').classList.remove('hidden');
};

AdminApp.prototype.closePdfModal = function closePdfModal() {
    document.getElementById('pdf-modal-overlay').classList.add('hidden');
};

AdminApp.prototype.handlePdfDateDropdown = function handlePdfDateDropdown() {
    const filterVal = document.getElementById('pdf-filter-date').value;
    const customDateContainer = document.getElementById('pdf-custom-date');

    // Toggle input tanggal custom sesuai pilihan filter
    if (filterVal === 'custom') {
        customDateContainer.style.display = 'flex';
    } else {
        customDateContainer.style.display = 'none';
    }

    // Reset state download button saat user ganti filter (harus cek data ulang)
    document.getElementById('btn-download-pdf').disabled = true;
    document.getElementById('btn-download-csv').disabled = true;
    this.pdfDataCandidate = [];
    const validationMsg = document.getElementById('pdf-validation-msg');
    validationMsg.textContent = "Filter diubah. Silakan klik 'Periksa Data' kembali.";
    validationMsg.style.color = "#f59e0b"; // orange/warning color
};

AdminApp.prototype.checkPdfData = async function checkPdfData() {
    const filterVal = document.getElementById('pdf-filter-date').value;
    const sortVal = document.getElementById('pdf-sort-order').value;
    const validationMsg = document.getElementById('pdf-validation-msg');
    const btnDownload = document.getElementById('btn-download-pdf');
    const btnDownloadCsv = document.getElementById('btn-download-csv');
    let customStartDateRaw = '';
    let customEndDateRaw = '';

    const now = this.getWIBDate(); // Gunakan WIB agar konsisten dengan filter lain
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let startDate = null;
    let endDate = null;

    if (filterVal === 'today') {
        startDate = startOfDay;
    } else if (filterVal === 'yesterday') {
        startDate = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
        endDate = startOfDay;
    } else if (filterVal === 'this_week') {
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        startDate = new Date(now.getFullYear(), now.getMonth(), diff);
    } else if (filterVal === 'this_month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (filterVal === 'this_year') {
        startDate = new Date(now.getFullYear(), 0, 1);
    } else if (filterVal === 'custom') {
        const sd = document.getElementById('pdf-start-date').value;
        const ed = document.getElementById('pdf-end-date').value;
        customStartDateRaw = String(sd || '').trim();
        customEndDateRaw = String(ed || '').trim();

        if (!sd && !ed) {
            validationMsg.textContent = "Mohon isi setidaknya tanggal mulai atau akhir.";
            validationMsg.style.color = "#ef4444"; // red/error color
            btnDownload.disabled = true;
            btnDownloadCsv.disabled = true;
            this.pdfDataCandidate = [];
            return;
        }

        if (sd) startDate = this.parseWIBDateInput(sd, false);
        if (ed) endDate = this.parseWIBDateInput(ed, true);
    }

    await this.fetchOrdersAnalytics({
        silent: true,
        force: !this.hasFetchedAnalytics,
        dateFilter: filterVal,
        startDate: customStartDateRaw,
        endDate: customEndDateRaw
    });
    const analyticsMeta = this.ordersAnalyticsMeta || {};
    if (analyticsMeta?.truncated) {
        validationMsg.textContent = "Data melebihi batas 5000 transaksi. Sempitkan rentang waktu lalu klik 'Periksa Data' lagi agar ekspor lengkap.";
        validationMsg.style.color = "#ef4444";
        btnDownload.disabled = true;
        btnDownloadCsv.disabled = true;
        this.pdfDataCandidate = [];
        return;
    }
    const sourceOrders = Array.isArray(this.ordersAnalytics) ? this.ordersAnalytics : [];

    // Terapkan filter (HANYA tanggal, tidak menggunakan query pencarian tabel utama)
    let candidateOrders = sourceOrders.filter(order => {
        if (startDate || endDate) {
            const orderDate = this.parseOrderDate(order);
            if (!orderDate) return false;
            if (startDate && orderDate < startDate) return false;
            if (endDate && orderDate > endDate) return false;
        }
        return true;
    });

    // Terapkan pengurutan berdasarkan waktu order
    if (sortVal === 'desc') {
        candidateOrders.sort((a, b) => {
            const bDate = this.parseOrderDate(b);
            const aDate = this.parseOrderDate(a);
            return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
        }); // Terbaru
    } else {
        candidateOrders.sort((a, b) => {
            const aDate = this.parseOrderDate(a);
            const bDate = this.parseOrderDate(b);
            return (aDate ? aDate.getTime() : 0) - (bDate ? bDate.getTime() : 0);
        }); // Terlama
    }

    this.pdfDataCandidate = candidateOrders;

    // Validasi hasil dan update UI modal
    if (this.pdfDataCandidate.length > 0) {
        validationMsg.replaceChildren();
        validationMsg.appendChild(document.createTextNode('Ditemukan '));
        const strongCount = document.createElement('b');
        strongCount.textContent = `${this.pdfDataCandidate.length} transaksi`;
        validationMsg.appendChild(strongCount);
        validationMsg.appendChild(document.createTextNode(' yang sesuai. Siap diunduh.'));
        validationMsg.style.color = "#10b981"; // green/success color
        btnDownload.disabled = false;
        btnDownloadCsv.disabled = false;
    } else {
        validationMsg.textContent = "Tidak ada transaksi pada rentang waktu/kriteria ini.";
        validationMsg.style.color = "#ef4444"; // red/error color
        btnDownload.disabled = true;
        btnDownloadCsv.disabled = true;
    }
};

AdminApp.prototype.getPdfFilterContext = function getPdfFilterContext() {
    // Konversi filter/sort jadi label yang ramah user untuk metadata laporan.
    const dateFilterEl = document.getElementById('pdf-filter-date');
    const sortOrderEl = document.getElementById('pdf-sort-order');
    const filterVal = dateFilterEl ? dateFilterEl.value : 'all';
    const sortVal = sortOrderEl ? sortOrderEl.value : 'desc';
    const dateFilterText = dateFilterEl ? dateFilterEl.options[dateFilterEl.selectedIndex].text : 'Semua Waktu';
    const rawSortOrderText = sortOrderEl ? sortOrderEl.options[sortOrderEl.selectedIndex].text : 'Urutkan: Terbaru ke Terlama';
    const sortOrderText = String(rawSortOrderText).replace(/^Urutkan:\s*/i, '');

    let customContext = '';
    if (filterVal === 'custom') {
        const sd = document.getElementById('pdf-start-date').value || '?';
        const ed = document.getElementById('pdf-end-date').value || '?';
        customContext = ` (${sd} - ${ed})`;
    }

    const periodLabelByValue = {
        all: 'SemuaWaktu',
        today: 'HariIni',
        yesterday: 'Kemarin',
        this_week: 'MingguIni',
        this_month: 'BulanIni',
        this_year: 'TahunIni',
        custom: 'TanggalKustom'
    };
    const sortLabelByValue = {
        desc: 'Terbaru',
        asc: 'Terlama'
    };

    return {
        filterVal,
        sortVal,
        dateFilterText,
        sortOrderText,
        customContext,
        periodLabel: periodLabelByValue[filterVal] || 'SemuaWaktu',
        sortLabel: sortLabelByValue[sortVal] || 'Terbaru'
    };
};

AdminApp.prototype.buildPdfFilename = function buildPdfFilename(now, context) {
    // Detail periode dan urutan sudah tertulis di isi laporan; nama file dibuat ringkas untuk arsip.
    const dateStamp = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);

    return `Laporan_Transaksi_Koperasi_TWOSRA_${dateStamp}.pdf`;
};
