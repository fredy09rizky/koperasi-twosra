// Modul AdminApp (Products Form Helpers) - validasi realtime field + upload gambar
// Jangan instantiate AdminApp di file ini.

import { sanitizeImageUrl } from '../config.js';
import { AdminApp } from './admin.core.js';
import { containsEmoji } from './admin.products.form.js';

AdminApp.prototype.setFieldError = function setFieldError(fieldId, message) {
    const errorEl = document.getElementById(`${fieldId}Error`);
    if (!errorEl) return;
    if (message) {
        errorEl.textContent = message;
        errorEl.classList.remove('form-error-hidden');
    } else {
        errorEl.textContent = '';
        errorEl.classList.add('form-error-hidden');
    }
};

AdminApp.prototype.initProductFormValidation = function initProductFormValidation() {
    const codeInput = document.getElementById('pCode');
    const nameInput = document.getElementById('pName');
    const priceInput = document.getElementById('pPrice');
    const stockInput = document.getElementById('pStock');
    const imgInput = document.getElementById('pImg');
    const imgMethodRadios = document.querySelectorAll('input[name="pImgMethod"]');

    const validateSku = () => {
        if (!codeInput) return;
        const value = String(codeInput.value || '').trim().toUpperCase();
        if (!value) return this.setFieldError('pCode', '');
        if (value.length < 4) return this.setFieldError('pCode', 'Minimal 4 karakter.');
        if (value.length > 10) return this.setFieldError('pCode', 'Maksimal 10 karakter.');
        if (/\s/.test(value)) return this.setFieldError('pCode', 'Tidak boleh ada spasi.');
        if (!/^[A-Z0-9_-]+$/.test(value)) return this.setFieldError('pCode', 'Hanya huruf/angka/_/-');
        const duplicateSku = Array.isArray(this.products)
            ? this.products.find(p => {
                const code = String(p?.code || '').trim().toUpperCase();
                return code === value && (this.editingProductId === null || p.id !== this.editingProductId);
            })
            : null;
        if (duplicateSku) return this.setFieldError('pCode', 'SKU sudah dipakai.');
        this.setFieldError('pCode', '');
    };

    const validateName = () => {
        if (!nameInput) return;
        const value = String(nameInput.value || '').trim().replace(/\s+/g, ' ');
        if (!value) return this.setFieldError('pName', '');
        if (value.length > 40) return this.setFieldError('pName', 'Maksimal 40 karakter.');
        if (containsEmoji(value)) return this.setFieldError('pName', 'Tidak boleh ada emoji.');
        if (!/^[\p{L}\p{N}\s.'()\-&,/]+$/u.test(value)) return this.setFieldError('pName', 'Hanya huruf/angka/spasi/tanda baca ringan.');
        const duplicateName = Array.isArray(this.products)
            ? this.products.find(p => {
                const name = String(p?.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
                return name === value.toLowerCase() && (this.editingProductId === null || p.id !== this.editingProductId);
            })
            : null;
        if (duplicateName) return this.setFieldError('pName', 'Nama produk sudah dipakai.');
        this.setFieldError('pName', '');
    };

    const validatePrice = () => {
        if (!priceInput) return;
        const value = String(priceInput.value || '').trim();
        if (!value) return this.setFieldError('pPrice', '');
        const num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num)) return this.setFieldError('pPrice', 'Harus angka bulat.');
        if (num < 1 || num > 1000000) return this.setFieldError('pPrice', 'Rentang 1–1.000.000.');
        this.setFieldError('pPrice', '');
    };

    const validateStock = () => {
        if (!stockInput) return;
        const value = String(stockInput.value || '').trim();
        if (!value) return this.setFieldError('pStock', '');
        const num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num)) return this.setFieldError('pStock', 'Harus angka bulat.');
        if (num < 1 || num > 1000) return this.setFieldError('pStock', 'Rentang 1–1000.');
        this.setFieldError('pStock', '');
    };

    const validateImageUrl = () => {
        if (!imgInput) return;
        const selected = document.querySelector('input[name="pImgMethod"]:checked');
        if (!selected || selected.value !== 'url') {
            this.setFieldError('pImg', '');
            return;
        }
        const value = String(imgInput.value || '').trim();
        if (!value) return this.setFieldError('pImg', 'Tautan gambar wajib diisi.');
        const safeUrl = (typeof sanitizeImageUrl === 'function') ? sanitizeImageUrl(value) : value;
        if (!safeUrl) return this.setFieldError('pImg', 'URL gambar tidak valid.');
        if (!this.isAllowedExternalImageUrl(safeUrl)) {
            const allowedDomains = Array.isArray(this.imagePolicy?.allowedDomains) ? this.imagePolicy.allowedDomains : [];
            const detail = allowedDomains.length > 0
                ? `Domain diizinkan: ${allowedDomains.join(', ')}`
                : 'Domain URL ini tidak diizinkan server.';
            return this.setFieldError('pImg', detail);
        }
        this.setFieldError('pImg', '');
    };

    codeInput?.addEventListener('input', validateSku);
    nameInput?.addEventListener('input', validateName);
    priceInput?.addEventListener('input', validatePrice);
    stockInput?.addEventListener('input', validateStock);
    imgInput?.addEventListener('input', validateImageUrl);
    imgMethodRadios.forEach(radio => radio.addEventListener('change', validateImageUrl));
};

AdminApp.prototype.uploadProductImage = async function uploadProductImage(file) {
    // Upload file ke backend -> R2, lalu kembalikan URL publik
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    const modal = this.getModalApi();
    try {
        const formData = new FormData();
        formData.append('image', file);

        const res = await fetch(`${apiBaseUrl}/api/admin/products/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        if (await this.handleApiError(res)) return null;

        const data = await res.json();
        if (res.ok && data.success) {
            return data.image_url;
        } else {
            const fallbackMessage = 'Gagal mengunggah gambar ke server';
            const message = this.formatAdminError(data, fallbackMessage);
            if (message.includes('PNG') || message.includes('JPEG') || message.includes('WebP')) {
                await modal.alert(`${message}\nRekomendasi: gunakan gambar rasio 1:1, minimal 1200 x 1200 px, dengan objek utama di tengah.`);
            } else {
                await modal.alert(message);
            }
            return null;
        }
    } catch (error) {
        logger.error('Gagal memproses perubahan produk', error);
        await modal.alert('Kesalahan jaringan saat mengunggah gambar.');
        return null;
    }
};
