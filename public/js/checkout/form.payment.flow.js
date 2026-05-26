// Modul CheckoutForm (Payment Flow) — submit checkout, sukses bayar, dan cancel.
// Jangan instantiate CheckoutForm di file ini.

import { playManagedAudio } from '../config.js';
import { CheckoutForm, PAYMENT_NORMAL_DURATION_SECONDS } from './form.core.js';
import { getAppInstance } from '../app.runtime.js';
import { cart } from '../cart.ui.js';

CheckoutForm.prototype.dispatchCancelPaymentSignal = function dispatchCancelPaymentSignal(payload) {
    const cancelUrl = `${this.getApiBaseUrl()}/api/payment/cancel`;
    const logger = this.getLogger();

    // Prioritas 1: sendBeacon lebih tahan saat tab ditutup/refreshed.
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const beaconBody = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            const beaconQueued = navigator.sendBeacon(cancelUrl, beaconBody);
            if (beaconQueued) return;
        }
    } catch (beaconError) {
        logger.warn('Fallback ke fetch keepalive karena sendBeacon gagal', beaconError);
    }

    // Prioritas 2: fetch keepalive sebagai fallback non-blocking.
    fetch(cancelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
    }).catch(err => logger.error("Gagal batalkan transaksi di backend", err));
};

CheckoutForm.prototype.cleanupPaymentState = function cleanupPaymentState(cartApi) {
    this.clearPendingPaymentSession();
    this.isRecoveryMode = false;
    this.recoveryRetryCount = 0;
    this.currentCheckoutToken = null;
    this.currentPaymentId = null;
    this.form.reset();
    if (cartApi && typeof cartApi.removePurchasedItems === 'function') {
        cartApi.removePurchasedItems(this.currentOrderData?.selected_product_ids || []);
    }
};

CheckoutForm.prototype.handleOrderSubmission = async function handleOrderSubmission() {
    const modal = this.getModalApi();
    const logger = this.getLogger();
    const loading = this.getLoadingApi();
    const apiBaseUrl = this.getApiBaseUrl();
    const appInstance = getAppInstance();
    const cartApi = cart;

    if (!appInstance || typeof appInstance.navigate !== 'function' || typeof appInstance.showToast !== 'function') {
        logger.error('Aplikasi publik belum siap untuk memproses checkout.');
        await modal.alert('Aplikasi belum siap. Silakan muat ulang halaman.', 'Inisialisasi Belum Siap', 'error');
        return;
    }

    if (!cartApi || typeof cartApi.getCheckoutSnapshot !== 'function') {
        logger.error('API keranjang belum siap untuk checkout.');
        await modal.alert('Keranjang belum siap. Silakan muat ulang halaman.', 'Keranjang Belum Siap', 'error');
        return;
    }

    const latestStoreStatus = await this.refreshStoreStatus({ silent: true });
    if (latestStoreStatus?.known === false) {
        await modal.alert(
            'Status operasional koperasi belum dapat dipastikan. Periksa koneksi internet lalu coba lagi.',
            'Status Belum Tersedia',
            'warning'
        );
        return;
    }

    if (!latestStoreStatus.accepting_orders) {
        await this.showStoreClosedAlert();
        return;
    }

    if (!this.validateAll()) return;
    if (this.isProcessingPayment) return;

    const selectedHari = this.inputHari.value;
    const selectedTime = this.inputTime.value;
    const selectedHariOption = this.inputHari.options[this.inputHari.selectedIndex];
    const selectedTimeOption = this.inputTime.options[this.inputTime.selectedIndex];
    const pickupLabel = selectedHariOption?.dataset?.label || '-';
    const pickupSlotLabel = selectedTimeOption?.text || '-';
    const checkoutSnapshot = cartApi.getCheckoutSnapshot();

    if (checkoutSnapshot.totalTypes <= 0) {
        await modal.alert('Pilih minimal satu produk untuk checkout.', 'Keranjang Belum Dipilih', 'warning');
        appInstance.navigate('cart');
        return;
    }

    if (checkoutSnapshot.totalTypes > 5) {
        await modal.alert('Maks. 5 jenis barang berbeda per pesanan. Silakan kurangi pilihan Anda.', 'Batas Jenis Barang', 'warning');
        appInstance.navigate('cart');
        return;
    }

    if (checkoutSnapshot.total < 1000) {
        await modal.alert('Minimal total pesanan adalah Rp1.000 untuk dapat diproses.', 'Minimal Pesanan', 'warning');
        appInstance.navigate('cart');
        return;
    }

    // Kunci tombol agar tidak di-klik 2 kali beruntun (spam)
    this.isProcessingPayment = true;
    const oText = this.btnSubmit.textContent;
    this.btnSubmit.textContent = "Memproses Pesanan...";
    this.btnSubmit.disabled = true;

    // 1. Kumpulkan rekap seluruh data pesanan untuk digunakan nanti setelah sukses bayar
    this.currentOrderData = {
        nama: this.inputName.value.trim(),
        kelas: this.inputClass.value.trim().toUpperCase(),
        wa: this.inputWa.value.trim(),
        pickup_date: selectedHari,
        pickup_slot: selectedTime,
        waktu: `${pickupLabel} - ${pickupSlotLabel}`,
        selected_product_ids: checkoutSnapshot.selectedProductIds,
        items: checkoutSnapshot.items.map(item => ({
            product: { ...item.product },
            quantity: item.quantity
        })),
        total: checkoutSnapshot.total
    };

    try {
        // 2. Buat checkout session (server hitung ulang total + buat token)
        loading.show('Menyiapkan pembayaran...');
        const sessionResponse = await fetch(`${apiBaseUrl}/api/checkout/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: this.currentOrderData.items,
                total: this.currentOrderData.total
            })
        });
        this.updateServerTimeOffset(sessionResponse);

        const sessionJson = await sessionResponse.json();
        if (!sessionResponse.ok || !sessionJson.success || !sessionJson.checkout_token || !sessionJson.order_id) {
            const sessionError = new Error(sessionJson.message || "Gagal menyiapkan sesi checkout.");
            sessionError.apiCode = String(sessionJson.code || '');
            sessionError.apiDetails = Array.isArray(sessionJson.conflicted_products)
                ? sessionJson.conflicted_products
                : [];
            throw sessionError;
        }

        this.currentCheckoutToken = sessionJson.checkout_token;

        // 3. Buat QRIS dari checkout_token
        loading.show('Menyiapkan QRIS...');
        const response = await fetch(`${apiBaseUrl}/api/payment/qris`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                checkout_token: this.currentCheckoutToken
            })
        });
        this.updateServerTimeOffset(response);

        const resJson = await response.json();
        if (!response.ok) {
            const qrisError = new Error(resJson.message || "Gagal mengambil respon dari server pembayaran.");
            qrisError.apiCode = String(resJson.code || '');
            qrisError.apiDetails = Array.isArray(resJson.conflicted_products)
                ? resJson.conflicted_products
                : [];
            throw qrisError;
        }
        const data = resJson.payment;

        // Di Pakasir respondnya ada di dalam "payment" : {"payment_number": "...", "total_payment": ...}
        if (data && data.payment_number) {
            // Berhasil mendapatkan QRIS
            this.currentPaymentId = resJson.order_id || sessionJson.order_id;
            this.isRecoveryMode = false;
            this.recoveryRetryCount = 0;
            this.currentOrderData.payment_amount = data.total_payment || data.amount || this.currentOrderData.total;
            this.currentOrderData.payment_number = data.payment_number;
            this.currentOrderData.id_transaksi = this.currentPaymentId;
            this.currentOrderData.checkout_token = this.currentCheckoutToken;
            this.currentOrderData.checkout_expires_at = resJson.recovery_expires_at || resJson.expires_at || sessionJson.recovery_expires_at || sessionJson.expires_at || null;
            this.currentOrderData.payment_started_at = resJson.payment_started_at || null;
            this.currentOrderData.gateway_expires_at = data.expired_at || resJson.gateway_expires_at || null;

            await this.renderPaymentGateway(data.payment_number);
            this.setPaymentModeUI('normal');
            this.savePendingPaymentSession();

            // Mulai timer hitung mundur dan interval pengecekan background
            const normalDeadlineMs = this.getNormalDeadlineMs();
            const remainingSeconds = normalDeadlineMs
                ? Math.max(1, Math.ceil((normalDeadlineMs - this.getNowMs()) / 1000))
                : PAYMENT_NORMAL_DURATION_SECONDS;
            this.startPaymentTimer(remainingSeconds); // 2 menit flow normal user
            this.startBackgroundPoller();

            // Alihkan layar hp siswa ke halaman QRIS
            appInstance.navigate('payment');

            // Paksa tutup loading overlay — counter bisa tidak seimbang
            // karena showGlobalLoading dipanggil beberapa kali dalam flow ini
            loading.forceHide();
        } else {
            throw new Error(resJson.message || "Format balasan API tidak valid.");
        }
    } catch (error) {
        logger.error("Payment API Error", error);
        this.resetPaymentState(true);
        const fallbackMessage = "Terjadi kesalahan saat menghubungi server pembayaran. Silakan coba lagi.";
        const rawMessage = error && typeof error.message === 'string' ? error.message.trim() : '';
        const rawCode = error && typeof error.apiCode === 'string' ? error.apiCode.trim() : '';
        const rawDetails = error && Array.isArray(error.apiDetails) ? error.apiDetails : [];
        const isCheckoutTampering = rawCode === 'E-CHECKOUT-TAMPERING';
        const isStoreClosed = rawCode === 'E-STORE-CLOSED';
        const isStockConflict = rawCode === 'E-STOCK-CHECKOUT' || /stok/i.test(rawMessage);

        if (isCheckoutTampering) {
            await playManagedAudio('audio-failed', 0.5);
            appInstance.navigate('tampering');
            return;
        }

        if (isStoreClosed) {
            await this.refreshStoreStatus({ silent: true });
            await this.showStoreClosedAlert();
            return;
        }

        if (isStockConflict) {
            const normalizedDetails = rawDetails
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .slice(0, 6);
            const isCompactViewport = typeof window !== 'undefined'
                && typeof window.matchMedia === 'function'
                && window.matchMedia('(max-width: 640px)').matches;
            const maxVisibleDetails = isCompactViewport ? 2 : 4;
            const visibleDetails = normalizedDetails.slice(0, maxVisibleDetails);
            const hiddenCount = Math.max(0, normalizedDetails.length - visibleDetails.length);
            const detailSummary = visibleDetails.length > 0
                ? `${visibleDetails.join(', ')}${hiddenCount > 0 ? ` (+${hiddenCount} produk lain)` : ''}`
                : '';
            const dialogMessage = detailSummary
                ? `Stok beberapa produk sudah berubah atau habis.\n\nProduk: ${detailSummary}\n\nSilakan sesuaikan pesanan Anda, lalu coba lagi.`
                : `${rawMessage || 'Stok produk berubah.'}\n\nSilakan sesuaikan pesanan Anda, lalu coba lagi.`;
            const shouldGoToCart = await modal.confirm(dialogMessage, "Stok Berubah", "warning");
            if (shouldGoToCart) {
                cartApi.validate();
                cartApi.updateUI();
                appInstance.navigate('cart');
            }
            return;
        }

        appInstance.showToast(rawMessage || fallbackMessage);
    } finally {
        // Kembalikan tombol ke keadaan semula (jika error atau selesai memproses)
        this.isProcessingPayment = false;
        this.btnSubmit.textContent = oText;
        this.btnSubmit.disabled = false;
        loading.hide();
    }
};

CheckoutForm.prototype.handlePaymentSuccess = async function handlePaymentSuccess() {
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getLogger();
    const appInstance = getAppInstance();
    const cartApi = cart;
    // 1. Hentikan seluruh fungsi timer interval agar berhenti mengecek
    clearInterval(this.paymentTimerInterval);
    clearInterval(this.paymentCheckInterval);
    clearTimeout(this.paymentStatusRetryTimeout);

    // 2. Tambahkan cap stempel Waktu Pembayaran Sukses ke dalam Nota (WIB)
    const d = this.getWIBDate();
    this.currentOrderData.waktu_pembayaran = d.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID') + ' WIB';

    // Kirim data pesanan yang sudah dibayar ke Backend (Cloudflare Worker)
    try {
        const response = await fetch(`${apiBaseUrl}/api/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...this.currentOrderData,
                checkout_token: this.currentCheckoutToken
            })
        });
        const resData = await response.json();

        if (!resData.success) {
            logger.error("Gagal simpan ke DB", resData.message);
            this.sendPaymentEventLog('order_save_fallback', {
                note: `Backend menolak pencatatan otomatis setelah pembayaran sukses: ${resData.message || 'tanpa pesan'}`,
                mode: this.isRecoveryMode ? 'recovery' : 'normal',
                retryCount: this.recoveryRetryCount
            });

            this.renderPaymentReview({
                id_transaksi: this.currentOrderData?.id_transaksi || this.currentPaymentId || '-',
                waktu_pembayaran: this.currentOrderData?.waktu_pembayaran || '-',
                payment_amount: this.currentOrderData?.payment_amount || this.currentOrderData?.total || 0,
                total: this.currentOrderData?.total || 0,
                message: resData.message || "Pembayaran berhasil, tetapi pesanan belum tercatat otomatis."
            });
            if (appInstance && typeof appInstance.navigate === 'function') {
                appInstance.navigate('payment-review');
            }
            this.cleanupPaymentState(cartApi);
            return;
        } else {
            if (resData.order_summary) {
                this.currentOrderData = {
                    ...this.currentOrderData,
                    ...resData.order_summary
                };
            }
            if (resData.pickup_time) {
                this.currentOrderData.waktu = resData.pickup_time;
            }
            if (resData.verification_token) {
                this.currentOrderData.verification_token = resData.verification_token;
            }
        }
    } catch (error) {
        logger.error("Error kirim data order ke backend", error);
        this.sendPaymentEventLog('order_save_fallback', {
            note: 'Frontend gagal mengirim order ke backend setelah pembayaran sukses.',
            mode: this.isRecoveryMode ? 'recovery' : 'normal',
            retryCount: this.recoveryRetryCount
        });

        this.renderPaymentReview({
            id_transaksi: this.currentOrderData?.id_transaksi || this.currentPaymentId || '-',
            waktu_pembayaran: this.currentOrderData?.waktu_pembayaran || '-',
            payment_amount: this.currentOrderData?.payment_amount || this.currentOrderData?.total || 0,
            total: this.currentOrderData?.total || 0,
            message: "Pembayaran berhasil, tetapi pesanan belum bisa dicatat otomatis. Simpan bukti bayar dan hubungi admin."
        });
        if (appInstance && typeof appInstance.navigate === 'function') {
            appInstance.navigate('payment-review');
        }
        this.cleanupPaymentState(cartApi);
        return;
    }
    // -----------------------------------------------------

    // Summary dirender dulu baru state payment dibersihkan, supaya data tetap tersedia untuk bukti PDF di halaman sukses.
    // Simpan snapshot data order sebelum cleanup agar PDF download tetap bisa mengakses data.
    const orderDataSnapshot = { ...this.currentOrderData };

    // 3. Tampilkan Nota rincian pembayaran ke Layar Browser
    this.renderSummary(orderDataSnapshot);
    if (appInstance && typeof appInstance.navigate === 'function') {
        appInstance.navigate('summary');
    }

    // Putar Efek Suara Sukses (Volume Maksimal)
    await playManagedAudio('audio-success', 1.0);

    // Bersihkan state payment setelah summary dirender dan audio selesai.
    // currentOrderData di-null-kan di sini, tapi snapshot sudah tersimpan di orderDataSnapshot
    // yang dipakai oleh renderSummary di atas. PDF download mengakses checkout.currentOrderData
    // yang sudah null — ini aman karena data sudah dirender ke DOM.
    this.cleanupPaymentState(cartApi);
};

CheckoutForm.prototype.cancelPayment = async function cancelPayment(reasonMsg, cancelMeta = {}) {
    const modal = this.getModalApi();
    const logger = this.getLogger();
    const appInstance = getAppInstance();
    clearInterval(this.paymentTimerInterval);
    clearInterval(this.paymentCheckInterval);
    clearTimeout(this.paymentStatusRetryTimeout);

    // Kirim notifikasi pembatalan ke backend Pakasir
    if (this.currentCheckoutToken && this.currentPaymentId && this.currentOrderData) {
        try {
            this.dispatchCancelPaymentSignal({
                checkout_token: this.currentCheckoutToken,
                cancel_reason: cancelMeta.note || reasonMsg || '',
                cancel_source: cancelMeta.source || 'frontend'
            });
        } catch (err) {
            logger.warn('dispatchCancelPaymentSignal gagal saat pembatalan', err);
        }
    }
    // Selesai blok pembatalan

    this.clearPendingPaymentSession();
    this.isRecoveryMode = false;
    this.recoveryRetryCount = 0;
    this.currentCheckoutToken = null;
    this.currentPaymentId = null;
    this.currentOrderData = null;

    if (reasonMsg) {
        await modal.alert(reasonMsg, "Pembayaran Ditolak", "error");
    }
    if (appInstance && typeof appInstance.navigate === 'function') {
        appInstance.navigate('cart'); // Arahkan kembali pengguna ke halaman keranjang
    }
};
