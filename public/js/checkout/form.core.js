// CheckoutForm — constructor, konstanta, dan elemen DOM
// File ini mendefinisikan class CheckoutForm, prototype-nya ditambahkan di file form.*.js lain.

// Kelas `CheckoutForm` bertugas mengurus Form Pemesanan, validasi ketat, dan pengelolaan tanggal/waktu spesifik
// Konstanta di bawah ini dipakai lintas file checkout (core, session, payment)
import { WORKER_API_URL, formatRupiah } from '../config.js';
import { forceHideGlobalLoading, hideGlobalLoading, showGlobalLoading } from '../config.runtime.js';
import { appLogger } from '../logger.js';
import { UIModal } from '../modal.js';

export const MANUAL_PAYMENT_CHECK_COOLDOWN_MS = 8000;
export const PAYMENT_SESSION_STORAGE_KEY = 'koperasi_pending_payment_session';
export const PAYMENT_NORMAL_DURATION_SECONDS = 2 * 60;
export const PAYMENT_RECOVERY_WINDOW_SECONDS = 10 * 60;
export const PAYMENT_STATUS_RETRY_FALLBACK_MS = 10000;
export const PAYMENT_RECOVERY_MAX_RETRIES = 30;
export const PAYMENT_RECOVERY_RETRY_DELAY_MS = 10000;


export class CheckoutForm {
    constructor() {
        // Ambil elemen-elemen HTML kunci
        this.form = document.getElementById('order-form');
        this.inputName = document.getElementById('namaLengkap');
        this.inputClass = document.getElementById('kelas');

        this.inputHari = document.getElementById('hariPengambilan');
        this.inputTime = document.getElementById('waktuPengambilan');
        this.inputWa = document.getElementById('noWa');

        // Elemen peringatan error berwarna merah
        this.errName = document.getElementById('err-namaLengkap');
        this.errClass = document.getElementById('err-kelas');
        this.errHari = document.getElementById('err-hariPengambilan');
        this.errTime = document.getElementById('err-waktuPengambilan');
        this.errWa = document.getElementById('err-noWa');

        // Tombol Submit pesanan dan pesan libur
        this.btnSubmit = document.getElementById('btn-submit-order');
        this.msgHariUnavailable = document.getElementById('hari-unavailable-msg');
        this.msgStoreClosed = document.getElementById('store-closed-msg');
        this.paymentStoreClosedNote = document.getElementById('payment-store-closed-note');

        // Elemen-elemen khusus Halaman Pembayaran (QRIS)
        this.btnConfirmPayment = document.getElementById('btn-confirm-payment');
        this.btnCancelPayment = document.getElementById('btn-cancel-payment');
        this.qrContainer = document.getElementById('qris-container');
        this.qrAmount = document.getElementById('qris-amount');
        this.qrFeeInfo = document.getElementById('qris-fee-info');
        this.timerDisplay = document.getElementById('payment-timer');

        // Variabel penampung timer (agar bisa dimatikan/dihapus nantinya)
        this.paymentTimerInterval = null;
        this.paymentCheckInterval = null;
        this.paymentStatusRetryTimeout = null;
        this.paymentPollingTimeout = null;
        this.serverTimeOffsetMs = 0;

        // Data transaksi yang sedang berlangsung
        this.currentCheckoutToken = null;
        this.currentPaymentId = null;
        this.currentOrderData = null;
        this.isRecoveryMode = false;
        this.recoveryRetryCount = 0;

        // Mencegah klik tombol beruntun
        this.isProcessingPayment = false;
        this.lastManualCheckTime = 0; // Anti-spam timer cek manual

        // Pasang sensor kejadian (event listener)
        this.setupEventListeners();
    }
}

CheckoutForm.prototype.getApiBaseUrl = function getApiBaseUrl() {
    return WORKER_API_URL;
};

CheckoutForm.prototype.getLogger = function getLogger() {
    return appLogger;
};

CheckoutForm.prototype.getModalApi = function getModalApi() {
    return UIModal;
};

CheckoutForm.prototype.formatCurrency = function formatCurrency(value) {
    return formatRupiah(value);
};

CheckoutForm.prototype.getLoadingApi = function getLoadingApi() {
    return {
        show: (message) => showGlobalLoading(message),
        hide: () => hideGlobalLoading(),
        forceHide: () => forceHideGlobalLoading()
    };
};

// Persiapan variabel instance checkout form untuk modul lain.
export let checkoutForm = null;

export const setCheckoutFormInstance = (instance) => {
    checkoutForm = instance || null;
    return checkoutForm;
};

export const getCheckoutFormInstance = () => checkoutForm;
