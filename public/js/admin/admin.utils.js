// Modul AdminApp — helper XSS, validasi gambar, formatting, dan WIB date
// Jangan instantiate AdminApp di file ini.

import { WORKER_API_URL, escapeHtml, formatRupiah, optimizeImageUrl, sanitizeImageUrl } from '../config.js';
import { hideGlobalLoading, showGlobalLoading } from '../config.runtime.js';
import { appLogger } from '../logger.js';
import { UIModal } from '../modal.js';
import { ALLOWED_PRODUCT_IMAGE_TYPES, MAX_PRODUCT_IMAGE_SIZE, AdminApp } from './admin.core.js';

AdminApp.prototype.safeText = function safeText(value) {
    // Escape string untuk mencegah XSS dari data backend
    return escapeHtml(value);
};

AdminApp.prototype.safeImage = function safeImage(value, options = {}) {
    // Sanitasi URL gambar, fallback ke placeholder jika tidak valid
    return optimizeImageUrl(value, options) || sanitizeImageUrl(value) || 'profile-img.png';
};

AdminApp.prototype.validateProductImageFile = function validateProductImageFile(file) {
    // Validasi tipe & ukuran gambar sebelum upload
    if (!file) {
        return 'File gambar tidak ditemukan.';
    }

    const normalizedType = String(file.type || '').toLowerCase();
    if (!ALLOWED_PRODUCT_IMAGE_TYPES.includes(normalizedType)) {
        return 'Format gambar tidak didukung. Gunakan PNG, JPG/JPEG, atau WebP.';
    }

    if (file.size > MAX_PRODUCT_IMAGE_SIZE) {
        return 'Ukuran file gambar melebihi 3MB. Silakan pilih gambar yang lebih kecil.';
    }

    return '';
};

AdminApp.prototype.getWIBDate = function getWIBDate() {
    // Membaca waktu saat ini dalam timezone WIB (Asia/Jakarta) menggunakan Intl.DateTimeFormat.
    // Hasilnya dikembalikan sebagai Date lokal (new Date(year, month-1, ...)) karena dipakai
    // untuk membentuk timestamp yang ditampilkan di UI admin — bukan untuk kalkulasi UTC.
    //
    // Dipakai untuk: menambahkan cap waktu WIB ke log audit admin (login, ganti password, dll).
    //
    // Catatan: ada implementasi serupa di form.validation.js (CheckoutForm.prototype.getWIBDate)
    // untuk kebutuhan checkout publik. Keduanya sengaja dipisah karena konteks pemanggilnya
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

    return new Date(year, month - 1, day, hour, minute, second);
};

AdminApp.prototype.parseWIBDateInput = function parseWIBDateInput(dateValue, endOfDay = false) {
    // Input tanggal dianggap tanggal WIB penuh (awal/akhir hari)
    if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;

    const [year, month, day] = dateValue.split('-').map(Number);
    const hour = endOfDay ? 23 : 0;
    const minute = endOfDay ? 59 : 0;
    const second = endOfDay ? 59 : 0;
    const millisecond = endOfDay ? 999 : 0;

    // Input tanggal admin diperlakukan sebagai tanggal WIB penuh, bukan timezone lokal browser admin.
    return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second, millisecond));
};

AdminApp.prototype.formatAdminError = function formatAdminError(data, fallbackMessage = 'Terjadi kesalahan.') {
    // Konsistenkan format error: "CODE: pesan"
    if (!data || typeof data !== 'object') return fallbackMessage;
    const rawCode = typeof data.code === 'string' ? data.code.trim() : '';
    const rawMessage = typeof data.message === 'string' ? data.message.trim() : '';

    if (rawCode && rawMessage) {
        if (rawMessage.startsWith(rawCode)) return rawMessage;
        return `${rawCode}: ${rawMessage}`;
    }

    if (rawMessage) return rawMessage;
    return fallbackMessage;
};

AdminApp.prototype.showAdminError = function showAdminError(data, fallbackMessage) {
    // Wrapper agar semua error admin tampil konsisten
    const message = this.formatAdminError(data, fallbackMessage);
    const modal = this.getModalApi();
    modal.alert(message);
};

AdminApp.prototype.parseJsonSafe = async function parseJsonSafe(response) {
    if (!response || typeof response.clone !== 'function') return null;
    try {
        return await response.clone().json();
    } catch (_error) {
        return null;
    }
};

AdminApp.prototype.withGlobalLoading = async function withGlobalLoading(task, options = {}) {
    const { silent = false, message = 'Memproses...' } = options;
    try {
        if (!silent) showGlobalLoading(message);
        return await task();
    } finally {
        if (!silent) hideGlobalLoading();
    }
};

AdminApp.prototype.getApiBaseUrl = function getApiBaseUrl() {
    return WORKER_API_URL;
};

AdminApp.prototype.getAppLogger = function getAppLogger() {
    return appLogger;
};

AdminApp.prototype.formatCurrency = function formatCurrency(value) {
    return formatRupiah(value);
};

AdminApp.prototype.getModalApi = function getModalApi() {
    return UIModal;
};

