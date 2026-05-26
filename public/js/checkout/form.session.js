// Modul CheckoutForm — sesi pembayaran, recovery, dan timer
// Jangan instantiate CheckoutForm di file ini.

import { ensureQrCodeLibrary } from '../config.js';
import {
    CheckoutForm,
    PAYMENT_SESSION_STORAGE_KEY,
    PAYMENT_NORMAL_DURATION_SECONDS,
    PAYMENT_RECOVERY_WINDOW_SECONDS,
    PAYMENT_RECOVERY_MAX_RETRIES
} from './form.core.js';
import { getAppInstance } from '../app.runtime.js';

CheckoutForm.prototype.parseServerUtcTimestamp = function parseServerUtcTimestamp(timestamp) {
    // Normalisasi timestamp server agar konsisten (UTC)
    if (!timestamp || typeof timestamp !== 'string') return null;
    const normalized = timestamp.includes('T')
        ? timestamp
        : timestamp.replace(' ', 'T') + 'Z';
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

CheckoutForm.prototype.updateServerTimeOffset = function updateServerTimeOffset(response) {
    // Ambil waktu dari header Date server untuk koreksi jam perangkat user
    const dateHeader = response?.headers?.get('Date');
    if (!dateHeader) return;
    const serverMs = Date.parse(dateHeader);
    if (!Number.isFinite(serverMs)) return;
    this.serverTimeOffsetMs = serverMs - Date.now();
};

CheckoutForm.prototype.getNowMs = function getNowMs() {
    // Gunakan offset server jika tersedia agar akurat walau jam device salah
    const offset = Number(this.serverTimeOffsetMs);
    if (Number.isFinite(offset)) {
        return Date.now() + offset;
    }
    return Date.now();
};

CheckoutForm.prototype.getPendingPaymentPayload = function getPendingPaymentPayload() {
    if (!this.currentCheckoutToken || !this.currentPaymentId || !this.currentOrderData?.payment_number) {
        return null;
    }

    // Snapshot minimum ini dipakai untuk memulihkan flow payment yang sama setelah refresh/close browser.
    return {
        checkout_token: this.currentCheckoutToken,
        order_id: this.currentPaymentId,
        order_data: this.currentOrderData,
        recovery_mode: this.isRecoveryMode,
        recovery_retry_count: this.recoveryRetryCount
    };
};

CheckoutForm.prototype.savePendingPaymentSession = function savePendingPaymentSession() {
    const payload = this.getPendingPaymentPayload();
    if (!payload) return;
    const logger = this.getLogger();

    try {
        localStorage.setItem(PAYMENT_SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        logger.warn('Gagal menyimpan sesi pembayaran sementara', error);
    }
};

CheckoutForm.prototype.loadPendingPaymentSession = function loadPendingPaymentSession() {
    const logger = this.getLogger();
    try {
        const raw = localStorage.getItem(PAYMENT_SESSION_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (error) {
        logger.warn('Gagal membaca sesi pembayaran sementara', error);
        return null;
    }
};

CheckoutForm.prototype.clearPendingPaymentSession = function clearPendingPaymentSession() {
    const logger = this.getLogger();
    try {
        localStorage.removeItem(PAYMENT_SESSION_STORAGE_KEY);
    } catch (error) {
        logger.warn('Gagal menghapus sesi pembayaran sementara', error);
    }
};

CheckoutForm.prototype.sendPaymentEventLog = function sendPaymentEventLog(eventType, details = {}) {
    if (!this.currentCheckoutToken) return;
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getLogger();

    // Event frontend dikirim ke backend agar kasus recovery yang hanya terlihat di browser tetap masuk log Telegram.
    const payload = {
        checkout_token: this.currentCheckoutToken,
        event_type: eventType,
        note: typeof details.note === 'string' ? details.note : '',
        mode: typeof details.mode === 'string' ? details.mode : (this.isRecoveryMode ? 'recovery' : 'normal'),
        retry_count: Number.isInteger(details.retryCount) ? details.retryCount : this.recoveryRetryCount
    };

    fetch(`${apiBaseUrl}/api/payment/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
    }).catch((error) => {
        logger.warn('Gagal mengirim event log pembayaran', error);
    });
};

CheckoutForm.prototype.getNormalDeadlineMs = function getNormalDeadlineMs() {
    // Hitung deadline timer normal 2 menit dari waktu QRIS dibuat
    const paymentStartedAtMs = this.parseServerUtcTimestamp(this.currentOrderData?.payment_started_at);
    if (Number.isFinite(paymentStartedAtMs)) {
        return paymentStartedAtMs + (PAYMENT_NORMAL_DURATION_SECONDS * 1000);
    }

    const recoveryDeadlineMs = this.parseServerUtcTimestamp(this.currentOrderData?.checkout_expires_at);
    if (!Number.isFinite(recoveryDeadlineMs)) return null;

    // Kalau browser hanya punya recovery deadline, titik awal timer normal diturunkan kembali dari window recovery 10 menit.
    const derivedPaymentStartedAtMs = recoveryDeadlineMs - (PAYMENT_RECOVERY_WINDOW_SECONDS * 1000);
    if (!Number.isFinite(derivedPaymentStartedAtMs)) return null;

    this.currentOrderData.payment_started_at = new Date(derivedPaymentStartedAtMs).toISOString();
    this.savePendingPaymentSession();
    return derivedPaymentStartedAtMs + (PAYMENT_NORMAL_DURATION_SECONDS * 1000);
};

CheckoutForm.prototype.getRecoveryDeadlineMs = function getRecoveryDeadlineMs() {
    // Hitung batas recovery 10 menit (dipakai untuk mode pemulihan)
    const recoveryDeadlineMs = this.parseServerUtcTimestamp(this.currentOrderData?.checkout_expires_at);
    if (Number.isFinite(recoveryDeadlineMs)) {
        return recoveryDeadlineMs;
    }

    const paymentStartedAtMs = this.parseServerUtcTimestamp(this.currentOrderData?.payment_started_at);
    if (!Number.isFinite(paymentStartedAtMs)) return null;

    const derivedRecoveryDeadlineMs = paymentStartedAtMs + (PAYMENT_RECOVERY_WINDOW_SECONDS * 1000);
    this.currentOrderData.checkout_expires_at = new Date(derivedRecoveryDeadlineMs).toISOString();
    this.savePendingPaymentSession();
    return derivedRecoveryDeadlineMs;
};

CheckoutForm.prototype.isWithinRecoveryWindow = function isWithinRecoveryWindow() {
    // Cek apakah masih di dalam window pemulihan
    const recoveryDeadlineMs = this.getRecoveryDeadlineMs();
    return Number.isFinite(recoveryDeadlineMs) && this.getNowMs() <= recoveryDeadlineMs;
};

CheckoutForm.prototype.resetPaymentState = function resetPaymentState(clearSessionStorage = false) {
    clearInterval(this.paymentTimerInterval);
    clearInterval(this.paymentCheckInterval);
    clearTimeout(this.paymentStatusRetryTimeout);
    clearTimeout(this.paymentPollingTimeout);

    this.isRecoveryMode = false;
    this.recoveryRetryCount = 0;
    this.currentCheckoutToken = null;
    this.currentPaymentId = null;
    this.currentOrderData = null;
    // Reset flag finalisasi agar state baru bersih dari guard idempoten lama.
    this.isFinalizingOrder = false;

    if (clearSessionStorage) {
        this.clearPendingPaymentSession();
    }
};

CheckoutForm.prototype.enterRecoveryMode = function enterRecoveryMode() {
    this.isRecoveryMode = true;
    this.savePendingPaymentSession();
};

CheckoutForm.prototype.renderRecoveryState = function renderRecoveryState(label = 'MEMULIHKAN...') {
    // UI khusus recovery: timer diganti label status
    clearInterval(this.paymentTimerInterval);
    if (this.timerDisplay) {
        this.timerDisplay.textContent = label;
    }
    this.setPaymentModeUI('recovery');
    this.applyStoreStatusUi();
};

CheckoutForm.prototype.renderPaymentGateway = async function renderPaymentGateway(paymentNumber) {
    // Render QRIS + info nominal + fee
    const QRCodeLibrary = await ensureQrCodeLibrary();

    this.qrAmount.textContent = this.formatCurrency(this.currentOrderData?.payment_amount || this.currentOrderData?.total || 0);
    const orderIdElement = document.getElementById('payment-order-id');
    if (orderIdElement) {
        orderIdElement.textContent = this.currentPaymentId || this.currentOrderData?.id_transaksi || '-';
    }

    if (this.currentOrderData?.payment_amount && this.currentOrderData.payment_amount > this.currentOrderData.total) {
        const fee = this.currentOrderData.payment_amount - this.currentOrderData.total;
        this.qrFeeInfo.textContent = `*Termasuk biaya admin Rp${fee.toLocaleString('id-ID')}`;
        this.qrFeeInfo.style.display = 'block';
    } else {
        this.qrFeeInfo.style.display = 'none';
    }

    this.qrContainer.replaceChildren();
    new QRCodeLibrary(this.qrContainer, {
        text: paymentNumber,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCodeLibrary.CorrectLevel.H
    });
    this.applyStoreStatusUi();
};

CheckoutForm.prototype.getRecoveryWindowRemainingMinutes = function getRecoveryWindowRemainingMinutes() {
    const recoveryDeadlineMs = this.getRecoveryDeadlineMs();
    if (!Number.isFinite(recoveryDeadlineMs)) return 0;
    return Math.max(0, Math.ceil((recoveryDeadlineMs - this.getNowMs()) / 60000));
};

function renderPaymentWarningList(listEl, items) {
    listEl.replaceChildren();
    items.forEach((item) => {
        const normalized = typeof item === 'string' ? { text: item } : item;
        const li = document.createElement('li');
        if (normalized?.className) {
            li.className = normalized.className;
        }
        li.textContent = String(normalized?.text || '');
        listEl.appendChild(li);
    });
}

CheckoutForm.prototype.setPaymentModeUI = function setPaymentModeUI(mode, options = {}) {
    const badge = document.getElementById('payment-mode-badge');
    const title = document.getElementById('payment-mode-title');
    const desc = document.getElementById('payment-mode-desc');
    const note = document.getElementById('payment-recovery-note');
    const timerLabel = document.getElementById('payment-timer-label');
    const warningTitle = document.getElementById('payment-warning-title');
    const warningList = document.getElementById('payment-warning-list');
    const confirmButton = this.btnConfirmPayment;
    const orderIdLabel = document.getElementById('payment-order-id-label');
    if (!badge || !title || !desc || !note || !timerLabel || !warningTitle || !warningList || !confirmButton || !orderIdLabel) return;

    const recoveryMinutes = this.getRecoveryWindowRemainingMinutes();

    if (mode === 'recovery') {
        badge.textContent = 'Mode Pemulihan';
        badge.classList.remove('badge-mode-normal');
        badge.classList.add('badge-mode-recovery');
        title.textContent = options.title || 'Pembayaran sedang dicek ulang';
        desc.textContent = options.desc || 'Jika Anda sudah membayar, jangan scan atau bayar ulang. Jika Anda memang sebelumnya belum membayar, Anda masih bisa melanjutkan pembayaran menggunakan QR yang sama di bawah ini.';
        note.textContent = options.note || (recoveryMinutes > 0
            ? `Pemulihan otomatis masih tersedia sekitar ${recoveryMinutes} menit lagi sejak QRIS dibuat.`
            : 'Sistem sedang mencoba memastikan status transaksi terakhir Anda.');
        timerLabel.textContent = options.timerLabel || 'Status Pemulihan:';
        warningTitle.textContent = options.warningTitle || 'Perhatian mode pemulihan:';
        orderIdLabel.textContent = 'ID Transaksi Aktif';
        renderPaymentWarningList(warningList, options.warningItems || [
            'Jika saldo sudah terpotong, jangan scan atau bayar ulang.',
            'Jika Anda memang sebelumnya belum membayar, Anda masih dapat melanjutkan pembayaran untuk pesanan ini.',
            'Gunakan tombol cek manual hanya bila perlu; sistem sudah mencoba memulihkan otomatis.',
            'QR tetap ditampilkan sebagai referensi transaksi yang sama, bukan untuk memulai transaksi baru.',
            'Jika Anda berubah pikiran dan tidak ingin melanjutkan, segera klik Batalkan Pesanan.',
            'Jika pemulihan habis, simpan bukti pembayaran lalu hubungi admin.'
        ]);
        confirmButton.textContent = options.confirmText || 'Cek Status Lagi';
        confirmButton.classList.remove('btn-primary');
        confirmButton.classList.add('btn-secondary', 'btn-recovery-mode');
        return;
    }

    badge.textContent = 'Mode Normal';
    badge.classList.remove('badge-mode-recovery');
    badge.classList.add('badge-mode-normal');
    title.textContent = options.title || 'Selesaikan pembayaran dalam 2 menit';
    desc.textContent = options.desc || 'Silakan scan QRIS di bawah ini menggunakan aplikasi M-Banking atau E-Wallet Anda.';
    note.textContent = options.note || 'Jika halaman tertutup atau ter-refresh, sistem masih bisa mencoba memulihkan status pembayaran hingga 10 menit sejak QRIS dibuat.';
    timerLabel.textContent = 'Sisa Waktu Pembayaran Normal:';
    warningTitle.textContent = 'Perhatian:';
    orderIdLabel.textContent = 'ID Transaksi';
    renderPaymentWarningList(warningList, [
        'Cukup bayar satu kali per QRIS.',
        'Verifikasi otomatis butuh 10-60 detik.',
        { text: 'Tetap di halaman ini sampai pembayaran terverifikasi.', className: 'warning-li-critical' },
        'Klik "Konfirmasi Pembayaran" jika status tidak berubah.',
        'Jika Anda berubah pikiran, segera klik Batalkan Pesanan agar transaksi ini tidak tetap aktif.'
    ]);
    confirmButton.textContent = 'Konfirmasi Pembayaran';
    confirmButton.classList.remove('btn-secondary', 'btn-recovery-mode');
    confirmButton.classList.add('btn-primary');
};

CheckoutForm.prototype.restorePendingPaymentSession = async function restorePendingPaymentSession() {
    const savedSession = this.loadPendingPaymentSession();
    if (!savedSession?.checkout_token || !savedSession?.order_id || !savedSession?.order_data?.payment_number) {
        this.clearPendingPaymentSession();
        return false;
    }

    this.currentCheckoutToken = savedSession.checkout_token;
    this.currentPaymentId = savedSession.order_id;
    this.currentOrderData = savedSession.order_data;
    this.isRecoveryMode = true;
    this.recoveryRetryCount = Number(savedSession.recovery_retry_count || 0);

    const recoveryDeadlineMs = this.getRecoveryDeadlineMs();
    if (!Number.isFinite(recoveryDeadlineMs) || this.getNowMs() > recoveryDeadlineMs) {
        this.resetPaymentState(true);
        return false;
    }

    await this.renderPaymentGateway(this.currentOrderData.payment_number);
    const appInstance = getAppInstance();
    if (appInstance && typeof appInstance.navigate === 'function') {
        appInstance.navigate('payment');
    }
    this.applyStoreStatusUi();

    const normalDeadlineMs = this.getNormalDeadlineMs();
    const remainingNormalSeconds = normalDeadlineMs
        ? Math.ceil((normalDeadlineMs - this.getNowMs()) / 1000)
        : 0;

    // Recovery tidak selalu berarti user sudah kehabisan timer normal; kalau masih ada sisa waktu, QR tetap bisa dipakai.
    if (remainingNormalSeconds > 0) {
        this.setPaymentModeUI('recovery', {
            title: 'Sesi pembayaran dipulihkan',
            desc: 'QRIS yang sama berhasil dipulihkan. Jika belum membayar, Anda masih bisa melanjutkan memakai QR ini. Jika saldo sudah terpotong, jangan bayar ulang.',
            note: 'Sistem sedang memantau transaksi yang dipulihkan. Jika status belum berubah, pemulihan otomatis masih tersedia hingga 10 menit sejak QRIS dibuat.',
            timerLabel: 'Sisa Waktu Normal / Status Pemulihan:',
            warningItems: [
                'Jika saldo sudah terpotong, jangan scan atau bayar ulang.',
                'Jika belum membayar, Anda masih bisa memakai QR yang sama.',
                'Sistem akan tetap mencoba memulihkan status transaksi secara otomatis.',
                'Simpan bukti pembayaran jika aplikasi bank Anda sudah menyatakan sukses.'
            ]
        });
        this.startPaymentTimer(remainingNormalSeconds);
    } else {
        this.renderRecoveryState();
    }

    this.startBackgroundPoller();
    if (appInstance && typeof appInstance.showToast === 'function') {
        appInstance.showToast("Sesi pembayaran sebelumnya dipulihkan. Sistem sedang memeriksa status transaksi.");
    }
    this.sendPaymentEventLog('recovery_restored', {
        note: remainingNormalSeconds > 0
            ? 'Sesi pembayaran dipulihkan saat timer normal masih berjalan.'
            : 'Sesi pembayaran dipulihkan setelah masuk window recovery.',
        mode: 'recovery',
        retryCount: this.recoveryRetryCount
    });
    await this.checkPaymentStatus(false, remainingNormalSeconds <= 0);

    return true;
};

