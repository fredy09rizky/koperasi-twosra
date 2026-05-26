import { resolveFrontendRuntime } from './shared/runtime.module.js';

const runtime = resolveFrontendRuntime(window);

// State Manager (sukses / error / loading)
const announceVerificationStatus = (message) => {
    const liveRegion = document.getElementById('verif-live-region');
    if (!liveRegion) return;
    liveRegion.textContent = '';
    requestAnimationFrame(() => {
        liveRegion.textContent = String(message || '');
    });
};

const showState = (stateId) => {
    document.querySelectorAll('.verif-state').forEach(el => {
        el.classList.remove('active');
    });
    document.getElementById(stateId).classList.add('active');

    const verificationContainer = document.querySelector('.verification-container');
    if (!verificationContainer) return;
    verificationContainer.classList.remove('verif-mode-loading', 'verif-mode-success', 'verif-mode-error');
    if (stateId === 'state-success') {
        verificationContainer.classList.add('verif-mode-success');
        return;
    }
    if (stateId === 'state-error') {
        verificationContainer.classList.add('verif-mode-error');
        return;
    }
    verificationContainer.classList.add('verif-mode-loading');
};

const showError = (message) => {
    document.getElementById('error-message').textContent = message;
    showState('state-error');
    announceVerificationStatus(`Verifikasi gagal. ${message}`);
};

// Format Tanggal (dari "2026-03-09 14:00:00" jadi yang mudah dibaca)
const formatDate = (dateString, withSeconds = false) => {
    if (!dateString) return '-';
    try {
        const dateStr = dateString.endsWith('Z') ? dateString : dateString + 'Z';
        const d = new Date(dateStr);
        const formatOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        };
        if (withSeconds) {
            formatOptions.second = '2-digit';
        }
        return d.toLocaleDateString('id-ID', formatOptions) + ' WIB';
    } catch (e) {
        return dateString;
    }
};

// Main Logic
async function initVerification() {
    // 1. Ambil token verifikasi dari URL params
    const urlParams = new URLSearchParams(window.location.search);
    const verificationToken = urlParams.get('token');

    if (!verificationToken) {
        showError("URL tidak valid: parameter token verifikasi tidak ditemukan.");
        return;
    }

    announceVerificationStatus('Memverifikasi transaksi. Mohon tunggu.');

    try {
        // 2. Tembak API Backend
        const response = await fetch(`${runtime.apiUrl}/api/orders/verify/${encodeURIComponent(verificationToken)}`);
        const data = await response.json();

        // 3. Handle jika data tidak ada / gagal
        if (!response.ok || !data.success) {
            showError(data.message || "Token verifikasi tidak valid atau sudah kedaluwarsa.");
            return;
        }

        // 4. Jika sukses, render data
        renderSuccessData(data.data);

    } catch (error) {
        runtime.logger.error("Fetch Error", error);
        showError("Gagal menghubungi server koperasi. Pastikan koneksi internet aktif.");
    }
}

function renderSuccessData(orderData) {
    // Render detail info transaksi
    document.getElementById('v-trx-id').textContent = orderData.id || '-';
    document.getElementById('v-waktu-dibuat').textContent = formatDate(orderData.created_at);
    document.getElementById('v-nama').textContent = orderData.customer_name || '-';
    document.getElementById('v-kelas').textContent = orderData.customer_class || '-';
    document.getElementById('v-jadwal').textContent = orderData.pickup_time || '-';
    document.getElementById('v-picked-up-at').textContent = orderData.picked_up_at ? formatDate(orderData.picked_up_at, true) : '-';

    // Render total harga (subtotal + fee jika ada)
    const totalAmount = Number(orderData.total_amount || 0);
    const feeAmount = Number(orderData.fee || 0);
    const finalTotal = totalAmount + feeAmount;
    document.getElementById('v-total-amount').textContent = runtime.formatRupiah(finalTotal);

    // Sistem hanya menyimpan order dengan status PAID (order dibuat setelah payment tervalidasi).
    // Branch ini dipertahankan sebagai defensive code untuk kemungkinan status lain di masa depan.
    const statusEl = document.getElementById('v-status');
    if (orderData.payment_status === 'UNPAID' || orderData.payment_status === 'CANCELLED') {
        statusEl.className = 'badge-danger';
        statusEl.textContent = orderData.payment_status === 'UNPAID' ? 'BELUM LUNAS' : 'DIBATALKAN';

        const successState = document.getElementById('state-success');
        const warnH2 = successState ? successState.querySelector('.status-header h2') : null;
        const warnSvg = successState ? successState.querySelector('.status-header svg') : null;
        const warnP = successState ? successState.querySelector('.status-header p') : null;
        if (warnH2) {
            warnH2.textContent = "TRANSAKSI BELUM LUNAS";
            warnH2.classList.add('status-text-danger');
        }
        if (warnSvg) warnSvg.classList.add('status-text-danger');
        if (warnP) {
            warnP.textContent = "Jangan serahkan barang sebelum pembayaran lunas.";
            warnP.classList.add('status-text-danger-strong');
        }
    }

    const pickupStatusEl = document.getElementById('v-pickup-status');
    const pickupStatus = String(orderData.pickup_status || 'BELUM_DIAMBIL');
    if (pickupStatus === 'SUDAH_DIAMBIL') {
        // Petugas cukup melihat halaman ini untuk tahu apakah barang sudah pernah diserahkan.
        pickupStatusEl.className = 'badge-status pickup-done';
        pickupStatusEl.textContent = 'SUDAH DIAMBIL';
    } else {
        pickupStatusEl.className = 'badge-status pickup-pending';
        pickupStatusEl.textContent = 'BELUM DIAMBIL';
    }

    // Render items
    const itemsContainer = document.getElementById('v-items');
    itemsContainer.replaceChildren();

    if (orderData.items && orderData.items.length > 0) {
        orderData.items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'item-row';
            const safeQuantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
            const safePriceAtPurchase = Number.isFinite(Number(item.price_at_purchase)) ? Number(item.price_at_purchase) : 0;
            const nameEl = document.createElement('span');
            nameEl.textContent = `${safeQuantity}x ${String(item.product_name || '')}`;
            const priceEl = document.createElement('span');
            priceEl.textContent = runtime.formatRupiah(safePriceAtPurchase * safeQuantity);
            row.appendChild(nameEl);
            row.appendChild(priceEl);
            itemsContainer.appendChild(row);
        });
    } else {
        const emptyText = document.createElement('p');
        emptyText.className = 'text-secondary';
        emptyText.textContent = 'Tidak ada data rincian barang.';
        itemsContainer.appendChild(emptyText);
    }

    // Tambahkan baris fee di paling bawah daftar item jika ada
    if (orderData.fee && orderData.fee > 0) {
        const feeRow = document.createElement('div');
        feeRow.className = 'item-row';
        const feeLabel = document.createElement('span');
        feeLabel.textContent = 'Biaya Layanan/QRIS';
        const feeAmount = document.createElement('span');
        feeAmount.textContent = runtime.formatRupiah(orderData.fee);
        feeRow.appendChild(feeLabel);
        feeRow.appendChild(feeAmount);
        itemsContainer.appendChild(feeRow);
    }

    // Pindah tampilan ke success
    showState('state-success');
    announceVerificationStatus('Transaksi sah dan data verifikasi berhasil dimuat.');
}

// Jalankan saat web selesai dimuat
function bindVerificationNav() {
    const navButtons = document.querySelectorAll('[data-nav]');
    if (navButtons.length === 0) return;

    navButtons.forEach(btn => {
        const target = btn.getAttribute('data-nav');
        if (!target) return;
        btn.addEventListener('click', () => {
            window.location.href = target;
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindVerificationNav();
    initVerification();
});

