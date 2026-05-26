// Modul CheckoutForm (Payment Polling) — timer, retry, recovery, status check.
// Jangan instantiate CheckoutForm di file ini.

import {
    CheckoutForm,
    MANUAL_PAYMENT_CHECK_COOLDOWN_MS,
    PAYMENT_STATUS_RETRY_FALLBACK_MS,
    PAYMENT_RECOVERY_RETRY_DELAY_MS,
    PAYMENT_RECOVERY_MAX_RETRIES
} from './form.core.js';
import { getAppInstance } from '../app.runtime.js';

const showAppToast = (message) => {
    const appInstance = getAppInstance();
    if (appInstance && typeof appInstance.showToast === 'function') {
        appInstance.showToast(message);
    }
};
const navigateApp = (viewId) => {
    const appInstance = getAppInstance();
    if (appInstance && typeof appInstance.navigate === 'function') {
        appInstance.navigate(viewId);
    }
};

CheckoutForm.prototype.startPaymentTimer = function startPaymentTimer(durationSeconds) {
    // Timer normal 2 menit (UI countdown)
    clearInterval(this.paymentTimerInterval);
    clearTimeout(this.paymentStatusRetryTimeout);

    let timer = durationSeconds;
    const display = this.timerDisplay;

    this.paymentTimerInterval = setInterval(() => {
        let minutes = parseInt(timer / 60, 10);
        let seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        if (display) {
            display.textContent = minutes + ":" + seconds;
        }

        if (--timer < 0) {
            clearInterval(this.paymentTimerInterval);
            if (display) {
                display.textContent = "MENGECEK...";
            }
            // Lakukan pengecekan terakhir kali untuk memastikan status gagal/sukses
            this.checkPaymentStatus(false, true);
        }
    }, 1000);
};

CheckoutForm.prototype.startBackgroundPoller = function startBackgroundPoller() {
    // Polling adaptif: lebih sering di awal, berkurang seiring waktu
    // untuk menghemat resource server dan baterai device
    clearInterval(this.paymentCheckInterval);
    clearTimeout(this.paymentPollingTimeout);

    const pollSequence = [5000, 10000, 15000, 20000, 30000]; // 5s, 10s, 15s, 20s, 30s
    let pollIndex = 0;

    const scheduleNextPoll = () => {
        const delay = pollSequence[Math.min(pollIndex, pollSequence.length - 1)];
        pollIndex++;

        this.paymentPollingTimeout = setTimeout(() => {
            if (!this.currentCheckoutToken || !this.currentPaymentId) return;
            this.checkPaymentStatus(false);
            scheduleNextPoll(); // Jadwalkan polling berikutnya
        }, delay);
    };

    // Mulai polling pertama
    scheduleNextPoll();
};

CheckoutForm.prototype.getRetryDelayMs = function getRetryDelayMs(response) {
    const retryAfterHeader = response?.headers?.get('Retry-After');
    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(Math.max(retryAfterSeconds * 1000, 5000), 60000);
    }
    return PAYMENT_STATUS_RETRY_FALLBACK_MS;
};

CheckoutForm.prototype.schedulePaymentStatusRetry = function schedulePaymentStatusRetry(delayMs, isFinalCheck) {
    // Jadwalkan retry status saat response ambiguous/rate-limit
    clearTimeout(this.paymentStatusRetryTimeout);
    this.paymentStatusRetryTimeout = setTimeout(() => {
        if (!this.currentCheckoutToken || !this.currentPaymentId) return;
        if (this.timerDisplay && (isFinalCheck || this.isRecoveryMode)) {
            this.timerDisplay.textContent = "MENGECEK...";
        }
        this.checkPaymentStatus(false, isFinalCheck);
    }, delayMs);
};

CheckoutForm.prototype.handleAmbiguousPaymentState = function handleAmbiguousPaymentState(message, delayMs = PAYMENT_RECOVERY_RETRY_DELAY_MS, isFinalCheck = false) {
    // Mode recovery: jangan langsung cancel, beri waktu cek ulang otomatis
    if (!this.isWithinRecoveryWindow()) {
        this.sendPaymentEventLog('recovery_window_expired', {
            note: message || 'Window pemulihan habis sebelum status pembayaran dapat dipastikan.',
            mode: 'recovery',
            retryCount: this.recoveryRetryCount
        });
        this.clearPendingPaymentSession();
        this.resetPaymentState(false);
        showAppToast("Sesi pemulihan pembayaran sudah habis. Jika saldo terpotong, hubungi admin dan tunjukkan bukti pembayaran.");
        navigateApp('cart');
        return true;
    }

    if (this.recoveryRetryCount >= PAYMENT_RECOVERY_MAX_RETRIES) {
        this.sendPaymentEventLog('recovery_retry_exhausted', {
            note: message || 'Retry pemulihan mencapai batas maksimum tanpa status pasti.',
            mode: 'recovery',
            retryCount: this.recoveryRetryCount
        });
        this.clearPendingPaymentSession();
        this.resetPaymentState(false);
        showAppToast("Status pembayaran belum bisa dipastikan otomatis. Jika saldo terpotong, hubungi admin dan tunjukkan bukti pembayaran.");
        navigateApp('cart');
        return true;
    }

    this.recoveryRetryCount += 1;
    clearInterval(this.paymentCheckInterval);
    this.enterRecoveryMode();
    this.renderRecoveryState('MENUNGGU...');
    // Begitu status masuk area abu-abu, frontend tidak auto-cancel; ia berpindah ke mode recovery dan mencoba lagi bertahap.
    this.schedulePaymentStatusRetry(delayMs, isFinalCheck);
    if (this.recoveryRetryCount === 1) {
        this.sendPaymentEventLog('recovery_started', {
            note: message || 'Frontend masuk mode pemulihan karena status pembayaran ambigu.',
            mode: 'recovery',
            retryCount: this.recoveryRetryCount
        });
        showAppToast(message);
    }
    return true;
};

CheckoutForm.prototype.checkPaymentStatus = async function checkPaymentStatus(isManualClick, isFinalCheck = false) {
    if (!this.currentPaymentId || !this.currentCheckoutToken) return;
    const apiBaseUrl = this.getApiBaseUrl();
    const modal = this.getModalApi();
    const logger = this.getLogger();
    void this.refreshStoreStatus({ silent: true });

    // Kunci sementara tombol konfirmasi manual agar tidak diserbu klik berulang (anti-spam 5 detik)
    if (isManualClick) {
        const now = Date.now();
        if (this.lastManualCheckTime && (now - this.lastManualCheckTime < MANUAL_PAYMENT_CHECK_COOLDOWN_MS)) {
            showAppToast("Tunggu beberapa saat sebelum mengecek lagi.");
            return;
        }
        this.lastManualCheckTime = now;
    }

    if (this.btnConfirmPayment) {
        this.btnConfirmPayment.disabled = true;
        this.btnConfirmPayment.textContent = "Mengecek...";
    }

    try {
        const response = await fetch(`${apiBaseUrl}/api/payment/status?checkout_token=${encodeURIComponent(this.currentCheckoutToken || '')}`);
        this.updateServerTimeOffset(response);
        const resJson = await response.json();
        const responseMessage = String(resJson?.message || '').toLowerCase();

        if (response.status === 429) {
            // Rate limit: tunda & coba lagi (recovery)
            const retryDelayMs = this.getRetryDelayMs(response);
            const retryDelaySeconds = Math.ceil(retryDelayMs / 1000);

            if (isFinalCheck || this.isRecoveryMode) {
                this.handleAmbiguousPaymentState(
                    `Server sedang membatasi pengecekan. Sistem akan mencoba lagi dalam ${retryDelaySeconds} detik.`,
                    retryDelayMs,
                    true
                );
                return;
            }

            if (isManualClick) {
                showAppToast(`Terlalu banyak pengecekan. Coba lagi dalam ${retryDelaySeconds} detik.`);
            }
            return;
        }

        if (response.status === 404 || responseMessage.includes('tidak ditemukan')) {
            // Transaction not found: perlakukan sebagai status ambigu
            if (isFinalCheck || this.isRecoveryMode) {
                this.handleAmbiguousPaymentState(
                    "Transaksi belum bisa ditemukan. Sistem akan mencoba lagi otomatis.",
                    PAYMENT_RECOVERY_RETRY_DELAY_MS,
                    true
                );
                return;
            }

            if (isManualClick) {
                showAppToast("Transaksi belum ditemukan di gateway. Coba lagi beberapa saat.");
            }
            return;
        }

        if (!response.ok) {
            throw new Error(resJson.message || 'Gagal memeriksa status pembayaran.');
        }
        const status = String(resJson.transaction?.status || 'unknown').toLowerCase();

        if (status === 'completed') {
            // BERHASIL DIBAYARKAN
            this.handlePaymentSuccess();
        } else if (status === 'pending' || status === 'unpaid') {
            // MASIH BELUM DIBAYAR...
            if (isFinalCheck) {
                if (this.isRecoveryMode) {
                    this.handleAmbiguousPaymentState(
                        "Pembayaran belum terkonfirmasi. Sistem akan mencoba cek ulang otomatis.",
                        PAYMENT_RECOVERY_RETRY_DELAY_MS,
                        true
                    );
                } else {
                    this.cancelPayment(
                        "Waktu pembayaran telah habis dan transaksi belum diselesaikan. Silakan pesan ulang.",
                        {
                            source: 'normal_timeout',
                            note: 'Timer normal 2 menit habis dan status masih pending/unpaid.'
                        }
                    );
                }
            } else if (isManualClick) {
                modal.alert("Pembayaran belum selesai. Pastikan saldo sudah terpotong di aplikasi Anda.", "Pembayaran Tertunda", "warning");
            }
        } else if (status === 'canceled' || status === 'cancelled' || status === 'failed' || status === 'expired') {
            this.cancelPayment(
                `Status Transaksi: ${status}. Silakan pesan ulang.`,
                {
                    source: 'gateway_status',
                    note: `Gateway mengembalikan status ${status}.`
                }
            );
        } else {
            if (isFinalCheck || this.isRecoveryMode) {
                this.handleAmbiguousPaymentState(
                    "Status transaksi belum bisa dipastikan. Sistem akan mencoba lagi otomatis.",
                    PAYMENT_RECOVERY_RETRY_DELAY_MS,
                    true
                );
            } else if (isManualClick) {
                showAppToast(`Status transaksi belum bisa dipastikan (${status}). Coba lagi beberapa saat.`);
            }
        }
    } catch (error) {
        logger.error("Check Status Error", error);
        if (isFinalCheck || this.isRecoveryMode) {
            this.handleAmbiguousPaymentState(
                "Gagal memeriksa status pembayaran. Sistem akan mencoba lagi otomatis.",
                PAYMENT_RECOVERY_RETRY_DELAY_MS,
                true
            );
        } else if (isManualClick) {
            showAppToast("Gagal memeriksa status. Sinyal internet mungkin tidak stabil.");
        }
    } finally {
        if (this.btnConfirmPayment) {
            this.btnConfirmPayment.disabled = false;
            this.btnConfirmPayment.textContent = this.isRecoveryMode ? "Cek Status Lagi" : "Konfirmasi Pembayaran";
        }
    }
};
