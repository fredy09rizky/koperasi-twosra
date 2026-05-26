// Modul AdminApp (Products Policy) — policy domain gambar dan input gambar
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.fetchAdminImagePolicy = async function fetchAdminImagePolicy() {
    if (this.imagePolicyLoaded) return;
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    try {
        const res = await fetch(`${apiBaseUrl}/api/admin/image-policy`, {
            credentials: 'include'
        });
        if (!res.ok) return;
        const payload = await res.json();
        const allowedDomains = Array.isArray(payload?.data?.allowed_domains)
            ? payload.data.allowed_domains.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
            : [];
        this.imagePolicy = {
            allowedDomains
        };
        this.imagePolicyLoaded = true;
        this.applyImagePolicyHint();
    } catch (error) {
        logger.warn('Gagal memuat policy domain gambar admin', error);
    }
};

AdminApp.prototype.applyImagePolicyHint = function applyImagePolicyHint() {
    const hintEl = document.getElementById('pImgPolicyHint');
    if (!hintEl) return;
    const allowedDomains = Array.isArray(this.imagePolicy?.allowedDomains)
        ? this.imagePolicy.allowedDomains
        : [];
    if (allowedDomains.length === 0) {
        hintEl.textContent = 'Domain URL gambar eksternal harus termasuk daftar domain yang diizinkan server.';
        return;
    }
    hintEl.textContent = `Domain URL eksternal yang diizinkan: ${allowedDomains.join(', ')}`;
};

AdminApp.prototype.isAllowedExternalImageUrl = function isAllowedExternalImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return true;
    if (raw.startsWith('/api/images/')) return true;

    let parsed;
    try {
        parsed = new URL(raw, window.location.origin);
    } catch (_error) {
        return false;
    }
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    if (parsed.origin === window.location.origin) {
        return parsed.pathname.startsWith('/api/images/');
    }

    const allowedDomains = Array.isArray(this.imagePolicy?.allowedDomains)
        ? this.imagePolicy.allowedDomains
        : [];
    if (allowedDomains.length === 0) return true;

    const hostname = String(parsed.hostname || '').trim().toLowerCase();
    return allowedDomains.some((rule) => {
        const normalizedRule = String(rule || '').trim().toLowerCase();
        if (!normalizedRule) return false;
        if (normalizedRule.startsWith('*.')) {
            const base = normalizedRule.slice(2);
            if (!base) return false;
            return hostname === base || hostname.endsWith(`.${base}`);
        }
        return hostname === normalizedRule;
    });
};

AdminApp.prototype.toggleImageInput = function toggleImageInput() {
    // Toggle input gambar: URL atau upload file
    const method = document.querySelector('input[name="pImgMethod"]:checked').value;
    const urlWrapper = document.getElementById('pImgUrlWrapper');
    const uploadWrapper = document.getElementById('pImgUploadWrapper');
    const imgInputUrl = document.getElementById('pImg');
    const imgInputFile = document.getElementById('pImgFile');

    if (method === 'url') {
        urlWrapper.style.display = 'block';
        uploadWrapper.style.display = 'none';
        imgInputUrl.disabled = false;
        imgInputFile.disabled = true;
        imgInputUrl.required = true;
        imgInputFile.required = false;
    } else {
        urlWrapper.style.display = 'none';
        uploadWrapper.style.display = 'block';
        imgInputUrl.disabled = true;
        imgInputFile.disabled = false;
        imgInputUrl.required = false;
        // Hanya wajib isi file saat tambah produk baru
        imgInputFile.required = this.editingProductId === null;
    }
};

AdminApp.prototype.initFileAttachmentListener = function initFileAttachmentListener() {
    const modal = this.getModalApi();
    const fileInput = document.getElementById('pImgFile');
    const preview = document.getElementById('pImgPreview');
    const previewImg = preview.querySelector('img');
    const status = document.getElementById('pImgFileStatus');

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) {
                preview.style.display = 'none';
                return;
            }

            const validationMessage = this.validateProductImageFile(file);
            if (validationMessage) {
                await modal.alert(validationMessage);
                fileInput.value = '';
                preview.style.display = 'none';
                status.textContent = '';
                return;
            }

            // Tampilkan preview cepat di formulir (base64 lokal sementara)
            const reader = new FileReader();
            reader.onload = (re) => {
                previewImg.src = re.target.result;
                status.textContent = `${file.name} (Siap diunggah). Disarankan rasio 1:1 agar tampil lebih utuh di katalog.`;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        });
    }
};
