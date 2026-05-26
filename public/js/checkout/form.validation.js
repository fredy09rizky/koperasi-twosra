// Modul CheckoutForm — validasi form dan logika hari/waktu pengambilan
// Jangan instantiate CheckoutForm di file ini.

import { storeStatusState, fetchStoreStatus } from '../data.js';
import { CheckoutForm } from './form.core.js';
import { CUSTOMER_NAME_MAX_LENGTH } from './form.constraints.js';

CheckoutForm.prototype.setupEventListeners = function setupEventListeners() {
    this.inputName.addEventListener('input', () => this.validateName());
    this.inputClass.addEventListener('input', () => this.validateClass());
    this.inputWa.addEventListener('input', () => this.validateWa());

    // Saat hari berubah, opsi waktu harus menyesuaikan ulang (cascading selection)
    this.inputHari.addEventListener('change', () => {
        this.validateHari();
        this.updateTimeOptions();
    });

    this.inputTime.addEventListener('change', () => this.validateTime());

    // Mencegah reload halaman saat form disubmit
    this.form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleOrderSubmission();
    });

    if (this.btnConfirmPayment) {
        this.btnConfirmPayment.addEventListener('click', () => {
            this.checkPaymentStatus(true); // true = pengecekan manual dari tombol
        });
    }

    if (this.btnCancelPayment) {
        this.btnCancelPayment.addEventListener('click', async () => {
            const modal = this.getModalApi();
            const isConfirmed = await modal.confirm("Yakin ingin membatalkan pesanan ini?", "Batal Order", "warning");
            if (isConfirmed) {
                this.cancelPayment(
                    "Pesanan dibatalkan oleh pengguna.",
                    {
                        source: 'user_manual',
                        note: 'User menekan tombol batalkan di halaman QRIS.'
                    }
                );
            }
        });
    }
};

CheckoutForm.prototype.formatDateStr = function formatDateStr(date) {
    return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    });
};

CheckoutForm.prototype.formatDateKey = function formatDateKey(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

CheckoutForm.prototype.getWIBDate = function getWIBDate() {
    // Membaca waktu saat ini dalam timezone WIB (Asia/Jakarta) menggunakan Intl.DateTimeFormat.
    // Hasilnya disimpan sebagai UTC-floating (Date.UTC) agar konsisten di semua timezone perangkat
    // pengguna — nilai jam/menit/detik yang terbaca adalah WIB, bukan local time browser.
    //
    // Dipakai untuk: menentukan slot hari pengambilan yang masih tersedia, dan menambahkan
    // cap waktu pembayaran WIB ke data order sebelum dikirim ke backend.
    //
    // Catatan: ada implementasi serupa di admin.utils.js (AdminApp.prototype.getWIBDate) untuk
    // kebutuhan admin (timestamp laporan). Keduanya sengaja dipisah karena konteks pemanggilnya
    // berbeda — tidak ada shared state yang perlu disinkronkan.
    const d = new Date();
    const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(d);

    let year, month, day, hour, minute, second;
    parts.forEach(p => {
        if (p.type === 'year') year = parseInt(p.value);
        if (p.type === 'month') month = parseInt(p.value);
        if (p.type === 'day') day = parseInt(p.value);
        if (p.type === 'hour') hour = parseInt(p.value);
        if (p.type === 'minute') minute = parseInt(p.value);
        if (p.type === 'second') second = parseInt(p.value);
    });

    // Simpan komponen WIB sebagai UTC-floating agar konsisten di semua timezone perangkat
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
};

CheckoutForm.prototype.getStoreStatusState = function getStoreStatusState() {
    if (typeof storeStatusState === 'object' && storeStatusState) {
        return storeStatusState;
    }
    return {
        accepting_orders: null,
        updated_at: null,
        updated_by: null,
        known: false,
        last_error: null
    };
};

CheckoutForm.prototype.isStoreStatusKnown = function isStoreStatusKnown() {
    return Boolean(this.getStoreStatusState().known);
};

CheckoutForm.prototype.isStoreClosedForNewOrders = function isStoreClosedForNewOrders() {
    const status = this.getStoreStatusState();
    return Boolean(status.known) && status.accepting_orders === false;
};

CheckoutForm.prototype.applyStoreStatusUi = function applyStoreStatusUi() {
    const storeStatus = this.getStoreStatusState();
    const isKnown = Boolean(storeStatus.known);
    const isClosed = this.isStoreClosedForNewOrders();
    const closedMessage = 'Koperasi sedang tidak menerima pesanan. Silakan coba lagi nanti.';
    const unknownMessage = 'Status operasional koperasi belum dapat dipastikan. Periksa koneksi internet lalu coba lagi.';

    if (this.msgStoreClosed) {
        this.msgStoreClosed.textContent = isKnown ? closedMessage : unknownMessage;
        this.msgStoreClosed.classList.toggle('hidden', isKnown ? !isClosed : false);
    }

    if (this.paymentStoreClosedNote) {
        const shouldShowPaymentNote = isClosed && Boolean(this.currentCheckoutToken);
        this.paymentStoreClosedNote.textContent = 'Koperasi sedang tidak menerima pesanan baru, tetapi transaksi Anda yang sudah dimulai tetap kami proses.';
        this.paymentStoreClosedNote.classList.toggle('hidden', !shouldShowPaymentNote);
    }

    if (this.btnSubmit) {
        if (!isKnown || isClosed) {
            this.btnSubmit.disabled = true;
        } else if (this.inputHari && !this.inputHari.classList.contains('hidden')) {
            this.btnSubmit.disabled = false;
        }
    }
};

CheckoutForm.prototype.refreshStoreStatus = async function refreshStoreStatus(options = {}) {
    await fetchStoreStatus(options);
    this.applyStoreStatusUi();
    return this.getStoreStatusState();
};

CheckoutForm.prototype.showStoreClosedAlert = async function showStoreClosedAlert() {
    const modal = this.getModalApi();
    await modal.alert(
        'Koperasi sedang tidak menerima pesanan. Silakan coba lagi nanti.',
        'Pemesanan Ditutup',
        'warning'
    );
};

CheckoutForm.prototype.resetSelectWithPlaceholder = function resetSelectWithPlaceholder(selectEl, placeholderText) {
    if (!selectEl) return;
    selectEl.replaceChildren();
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.disabled = true;
    placeholderOption.selected = true;
    placeholderOption.textContent = placeholderText;
    selectEl.appendChild(placeholderOption);
};

CheckoutForm.prototype.appendSelectOption = function appendSelectOption(selectEl, optionConfig) {
    if (!selectEl || !optionConfig) return;
    const option = document.createElement('option');
    option.value = optionConfig.value;
    option.textContent = optionConfig.text;
    if (optionConfig.dataType) {
        option.dataset.type = optionConfig.dataType;
    }
    if (optionConfig.dataLabel) {
        option.dataset.label = optionConfig.dataLabel;
    }
    selectEl.appendChild(option);
};

CheckoutForm.prototype.updateDayOptions = function updateDayOptions() {
    // Gunakan WIB, bukan jam lokal browser, agar slot hari yang tersedia konsisten untuk semua user
    const wibNow = this.getWIBDate();
    const currentHour = wibNow.getUTCHours();
    const currentMinute = wibNow.getUTCMinutes();
    const currentTime = currentHour + (currentMinute / 60);

    const time1220 = 12 + (20 / 60); // batas akhir slot hari ini (12:20 WIB)

    this.resetSelectWithPlaceholder(this.inputHari, 'Pilih hari pengambilan...');
    this.resetSelectWithPlaceholder(this.inputTime, 'Pilih hari terlebih dahulu...');
    this.inputTime.disabled = true;
    this.inputHari.classList.remove('hidden');
    this.msgHariUnavailable.classList.add('hidden');
    // L-01: Hanya enable tombol jika toko sedang buka, mencegah race condition dgn applyStoreStatusUi
    const storeStatus = this.getStoreStatusState();
    const storeOpen = Boolean(storeStatus.known) && Boolean(storeStatus.accepting_orders);
    this.btnSubmit.disabled = !storeOpen;

    let optionsAdded = 0;
    let dayOffset = 0;

    // Cari 3 hari operasional (Senin–Jumat) ke depan yang masih bisa dipilih
    while (optionsAdded < 3 && dayOffset < 14) { // cap 14 hari sebagai pengaman loop
        const checkDate = new Date(wibNow);
        checkDate.setUTCDate(checkDate.getUTCDate() + dayOffset);

        const dayOfWeek = checkDate.getUTCDay();

        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            // Hari ini hanya tersedia jika belum melewati 12:20 WIB
            if (dayOffset === 0 && currentTime > time1220) {
                dayOffset++;
                continue;
            }

            // Label ditentukan dari dayOffset (jarak hari kalender) agar tetap akurat
            // meskipun "Hari Ini" diskip karena sudah lewat jam 12:20
            let labelText = '';
            if (dayOffset === 0) {
                labelText = `Hari Ini (${this.formatDateStr(checkDate)})`;
            } else if (dayOffset === 1) {
                labelText = `Besok (${this.formatDateStr(checkDate)})`;
            } else if (dayOffset === 2) {
                labelText = `Lusa (${this.formatDateStr(checkDate)})`;
            } else {
                labelText = `${this.formatDateStr(checkDate)}`;
            }

            // 'hari_ini' punya slot waktu terbatas; 'future' menampilkan semua slot
            const dataType = (dayOffset === 0) ? 'hari_ini' : 'future';
            const dateKey = this.formatDateKey(checkDate);
            this.appendSelectOption(this.inputHari, {
                value: dateKey,
                text: labelText.split(' (')[0],
                dataType,
                dataLabel: labelText
            });
            optionsAdded++;
        }

        dayOffset++;
    }

    // Tidak ada hari tersedia — koperasi libur panjang
    if (optionsAdded === 0) {
        this.inputHari.classList.add('hidden');
        this.msgHariUnavailable.classList.remove('hidden');
        this.msgHariUnavailable.textContent = "Koperasi sedang libur. Silakan kembali di hari kerja (Senin - Jumat).";
        this.btnSubmit.disabled = true;
    }

    this.applyStoreStatusUi();
};

CheckoutForm.prototype.updateTimeOptions = function updateTimeOptions() {
    const selectedOption = this.inputHari.options[this.inputHari.selectedIndex];
    if (!selectedOption || !selectedOption.dataset) return;

    const type = selectedOption.dataset.type; // 'hari_ini' atau 'future'

    this.inputTime.disabled = false;
    this.resetSelectWithPlaceholder(this.inputTime, 'Pilih waktu pengambilan...');

    if (type === 'hari_ini') {
        // Hari ini: hanya tampilkan slot yang belum lewat
        const wibNow = this.getWIBDate();
        const currentTime = wibNow.getUTCHours() + (wibNow.getUTCMinutes() / 60);

        const time0915 = 9 + (15 / 60);
        const time1220 = 12 + (20 / 60);

        if (currentTime < time0915) {
            this.appendSelectOption(this.inputTime, { value: 'FIRST_BREAK', text: 'Istirahat Pertama (09.15)' });
            this.appendSelectOption(this.inputTime, { value: 'SECOND_BREAK', text: 'Istirahat Kedua (11.45)' });
        } else if (currentTime >= time0915 && currentTime <= time1220) {
            this.appendSelectOption(this.inputTime, { value: 'SECOND_BREAK', text: 'Istirahat Kedua (11.45)' });
        }
    } else if (type === 'future') {
        // Hari lain: tampilkan semua slot
        this.appendSelectOption(this.inputTime, { value: 'FIRST_BREAK', text: 'Istirahat Pertama (09.15)' });
        this.appendSelectOption(this.inputTime, { value: 'SECOND_BREAK', text: 'Istirahat Kedua (11.45)' });
    }

    this.errTime.textContent = '';
    this.inputTime.classList.remove('invalid');
};

CheckoutForm.prototype.validateName = function validateName() {
    const val = this.inputName.value;
    // Regex Unicode-aware: mendukung huruf dari berbagai bahasa (Latin, Arab, Tionghoa, dll)
    // plus karakter umum dalam nama: spasi, tanda hubung, apostrof, titik, kurung
    const regex = /^[\p{L}\s.'\-()]+$/u;

    let isValid = true;
    let errMsg = '';

    if (!val.trim()) {
        isValid = false;
        errMsg = 'Nama lengkap wajib diisi.';
    } else if (val.length > CUSTOMER_NAME_MAX_LENGTH) {
        isValid = false;
        errMsg = `Nama lengkap maksimal ${CUSTOMER_NAME_MAX_LENGTH} karakter.`;
    } else if (!regex.test(val)) {
        isValid = false;
        errMsg = 'Hanya boleh berisi huruf dan karakter umum nama (spasi, tanda hubung, apostrof).';
    }

    this.handleValidationUI(this.inputName, this.errName, isValid, errMsg);
    return isValid;
};

CheckoutForm.prototype.validateClass = function validateClass() {
    let text = this.inputClass.value.toUpperCase();

    // Auto-correct: ubah awalan angka 10/11/12 ke romawi X/XI/XII
    text = text.replace(/^10/, 'X');
    text = text.replace(/^11/, 'XI');
    text = text.replace(/^12/, 'XII');

    // Auto-correct: sisipkan spasi jika kelas dan jurusan ditulis nyambung (misal "XTKJ" → "X TKJ")
    text = text.replace(/^(X|XI|XII)(TP|TKR|TKP|DPIB|TITL|TKJ)$/, '$1 $2');

    if (this.inputClass.value !== text) {
        this.inputClass.value = text;
    }

    const checkVal = text.trim();
    let isValid = true;
    let errMsg = '';

    const classRegex = /^(X|XI|XII)\s+(TP|TKR|TKP|DPIB|TITL|TKJ)$/;

    if (!checkVal) {
        isValid = false;
        errMsg = 'Silakan pilih atau ketik kelas Anda.';
    } else if (!classRegex.test(checkVal)) {
        isValid = false;
        errMsg = 'Format kelas tidak valid (Contoh: X TP, XI TKR).';
    }

    this.handleValidationUI(this.inputClass, this.errClass, isValid, errMsg);
    return isValid;
};

CheckoutForm.prototype.validateWa = function validateWa() {
    const val = this.inputWa.value.trim();
    const regex = /^62[0-9]{8,15}$/;
    let isValid = true;
    let errMsg = '';

    if (!val) {
        isValid = false;
        errMsg = 'Nomor WhatsApp wajib diisi.';
    } else if (!val.startsWith('62')) {
        isValid = false;
        errMsg = 'Nomor WhatsApp harus diawali dengan 62 (contoh: 62812xxx).';
    } else if (!regex.test(val)) {
        isValid = false;
        errMsg = 'Nomor WhatsApp tidak valid. Pastikan hanya berisi angka setelah awalan 62.';
    }

    this.handleValidationUI(this.inputWa, this.errWa, isValid, errMsg);
    return isValid;
};

CheckoutForm.prototype.validateHari = function validateHari() {
    const isValid = this.inputHari.value !== "";
    this.handleValidationUI(this.inputHari, this.errHari, isValid, 'Silakan pilih hari pengambilan.');
    return isValid;
};

CheckoutForm.prototype.validateTime = function validateTime() {
    const isValid = this.inputTime.value !== "";
    this.handleValidationUI(this.inputTime, this.errTime, isValid, 'Silakan pilih waktu pengambilan.');
    return isValid;
};

CheckoutForm.prototype.handleValidationUI = function handleValidationUI(element, errElement, isValid, errMsg) {
    if (isValid) {
        element.classList.remove('invalid');
        errElement.textContent = '';
    } else {
        element.classList.add('invalid');
        errElement.textContent = errMsg;
    }
};

CheckoutForm.prototype.validateAll = function validateAll() {
    // Panggil semua validator sekaligus agar semua field error muncul bersamaan
    const isNameValid = this.validateName();
    const isClassValid = this.validateClass();
    const isWaValid = this.validateWa();
    const isHariValid = this.validateHari();
    const isTimeValid = this.validateTime();

    // Blokir jika tombol submit sedang disabled (misal toko tutup atau hari tidak tersedia)
    if (this.btnSubmit.disabled) return false;

    return isNameValid && isClassValid && isWaValid && isHariValid && isTimeValid;
};

