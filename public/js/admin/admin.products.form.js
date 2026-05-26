// Modul AdminApp (Products Form) — validasi form, submit produk, upload gambar
// Jangan instantiate AdminApp di file ini.

// Deteksi emoji untuk menjaga nama produk tetap bersih/rapi
import { sanitizeImageUrl } from '../config.js';
import { AdminApp } from './admin.core.js';

export const containsEmoji = (value) => {
    if (!value) return false;
    try {
        return /\p{Extended_Pictographic}/u.test(value);
    } catch (_error) {
        return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(value);
    }
};

AdminApp.prototype.handleAddProduct = async function handleAddProduct(e) {
    e.preventDefault();
    const modal = this.getModalApi();
    const apiBaseUrl = this.getApiBaseUrl();
    const btn = document.getElementById('btn-submit-product');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    const restoreButton = () => {
        btn.disabled = false;
        btn.textContent = this.editingProductId === null ? 'Simpan Produk' : 'Perbarui Produk';
    };

    const codeInput = document.getElementById('pCode');
    const nameInput = document.getElementById('pName');
    const priceInput = document.getElementById('pPrice');
    const stockInput = document.getElementById('pStock');
    const categoryInput = document.getElementById('pCategory');

    // Normalisasi input agar konsisten (spasi, kapital, dan format)
    const normalizedCode = String(codeInput?.value || '').trim().toUpperCase();
    const normalizedName = String(nameInput?.value || '').trim().replace(/\s+/g, ' ');
    const normalizedCategory = String(categoryInput?.value || '').trim();
    const rawPrice = String(priceInput?.value || '').trim();
    const rawStock = String(stockInput?.value || '').trim();
    const parsedPrice = Number(rawPrice);
    const parsedStock = Number(rawStock);

    // ====== VALIDASI DASAR ======
    // Semua modal.alert di-await agar tombol tidak kembali aktif sebelum user menutup dialog.
    if (!normalizedCode) {
        await modal.alert('Kode SKU wajib diisi.');
        restoreButton();
        return;
    }
    if (normalizedCode.length < 4) {
        await modal.alert('SKU minimal 4 karakter.');
        restoreButton();
        return;
    }
    if (normalizedCode.length > 10) {
        await modal.alert('SKU maksimal 10 karakter.');
        restoreButton();
        return;
    }
    if (/\s/.test(normalizedCode)) {
        await modal.alert('SKU tidak boleh mengandung spasi. Gunakan huruf/angka tanpa spasi.');
        restoreButton();
        return;
    }
    if (!/^[A-Z0-9_-]+$/.test(normalizedCode)) {
        await modal.alert('SKU hanya boleh berisi huruf, angka, garis bawah, atau tanda minus.');
        restoreButton();
        return;
    }
    if (!normalizedName) {
        await modal.alert('Nama produk wajib diisi.');
        restoreButton();
        return;
    }
    if (normalizedName.length > 40) {
        await modal.alert('Nama produk maksimal 40 karakter.');
        restoreButton();
        return;
    }
    if (containsEmoji(normalizedName)) {
        await modal.alert('Nama produk tidak boleh mengandung emoji.');
        restoreButton();
        return;
    }
    if (!/^[\p{L}\p{N}\s.'()\-&,/]+$/u.test(normalizedName)) {
        await modal.alert('Nama produk hanya boleh berisi huruf, angka, spasi, dan tanda baca ringan.');
        restoreButton();
        return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || !Number.isInteger(parsedPrice)) {
        await modal.alert('Harga harus berupa angka bulat.');
        restoreButton();
        return;
    }
    if (parsedPrice < 1 || parsedPrice > 1000000) {
        await modal.alert('Harga harus di antara 1 dan 1.000.000.');
        restoreButton();
        return;
    }
    if (!Number.isFinite(parsedStock) || !Number.isInteger(parsedStock)) {
        await modal.alert('Stok harus berupa angka bulat.');
        restoreButton();
        return;
    }
    if (parsedStock < 1 || parsedStock > 1000) {
        await modal.alert('Stok harus di antara 1 dan 1000.');
        restoreButton();
        return;
    }
    const allowedCategories = ['Alat Tulis', 'Seragam', 'Aksesoris', 'Makanan/Minuman', 'Lainnya'];
    if (!allowedCategories.includes(normalizedCategory)) {
        await modal.alert('Kategori tidak valid. Pilih salah satu kategori yang tersedia.');
        restoreButton();
        return;
    }

    // Cek duplikat setelah semua validasi format selesai, agar user tidak mendapat
    // error duplikat lalu memperbaikinya, baru tahu harga/stok juga salah.
    const duplicateName = Array.isArray(this.products)
        ? this.products.find(p => {
            const name = String(p?.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
            return name === normalizedName.toLowerCase() && (this.editingProductId === null || p.id !== this.editingProductId);
        })
        : null;
    const duplicateSku = Array.isArray(this.products)
        ? this.products.find(p => {
            const code = String(p?.code || '').trim().toUpperCase();
            return code === normalizedCode && (this.editingProductId === null || p.id !== this.editingProductId);
        })
        : null;
    if (duplicateName && duplicateSku) {
        await modal.alert('SKU dan nama produk sudah dipakai. Gunakan SKU dan nama lain.');
        restoreButton();
        return;
    }
    if (duplicateName) {
        await modal.alert('Nama produk sudah dipakai. Gunakan nama lain.');
        restoreButton();
        return;
    }
    if (duplicateSku) {
        await modal.alert('SKU sudah digunakan produk lain. Silakan gunakan SKU berbeda.');
        restoreButton();
        return;
    }

    // Simpan nilai yang sudah dinormalisasi ke input
    if (codeInput) codeInput.value = normalizedCode;
    if (nameInput) nameInput.value = normalizedName;

    const imgMethod = document.querySelector('input[name="pImgMethod"]:checked').value;
    let finalImageUrl = document.getElementById('pImg').value;
    if (imgMethod === 'url') {
        const normalizedUrl = String(finalImageUrl || '').trim();
        if (!normalizedUrl) {
            await modal.alert('Tautan gambar wajib diisi.');
            restoreButton();
            return;
        }
        const safeUrl = (typeof sanitizeImageUrl === 'function') ? sanitizeImageUrl(normalizedUrl) : normalizedUrl;
        if (!safeUrl) {
            await modal.alert('Tautan gambar tidak valid. Gunakan URL http/https yang benar.');
            restoreButton();
            return;
        }
        if (!this.isAllowedExternalImageUrl(safeUrl)) {
            const allowedDomains = Array.isArray(this.imagePolicy?.allowedDomains) ? this.imagePolicy.allowedDomains : [];
            const detail = allowedDomains.length > 0
                ? `Domain yang diizinkan: ${allowedDomains.join(', ')}`
                : 'Periksa kembali domain URL gambar yang diizinkan oleh server.';
            await modal.alert(`Domain URL gambar tidak diizinkan.\n${detail}`);
            restoreButton();
            return;
        }
        finalImageUrl = safeUrl;
    }

    // Proses unggah gambar terlebih dahulu jika metodenya "upload"
    if (imgMethod === 'upload') {
        const fileInput = document.getElementById('pImgFile');
        const file = fileInput.files[0];

        if (file) {
            const validationMessage = this.validateProductImageFile(file);
            if (validationMessage) {
                await modal.alert(validationMessage);
                restoreButton();
                return;
            }

            btn.textContent = 'Mengunggah Gambar (1/2)...';
            const uploadSuccess = await this.uploadProductImage(file);

            if (uploadSuccess) {
                finalImageUrl = uploadSuccess; // Ganti finalImageUrl dengan URL dari Cloudflare R2
            } else {
                btn.disabled = false;
                btn.textContent = 'Gagal, Coba Lagi';
                return; // Batalkan penyimpanan produk jika gagal upload gambar
            }
        } else if (this.editingProductId === null) {
            await modal.alert('Gambar produk harus dipilih!');
            restoreButton();
            return;
        }
        // Jika mode edit dan tidak ada file yang dipilih, maka kita jangan timpa URL gambar lama-nya (jaga existingImage)
        else {
            const existingProduct = this.products.find(p => p.id === this.editingProductId);
            if (existingProduct) {
                finalImageUrl = existingProduct.image_url;
            }
        }
    }

    btn.textContent = 'Menyimpan Metadata Produk (2/2)...';

    const payload = {
        code: normalizedCode,
        name: normalizedName,
        price: parsedPrice,
        category: normalizedCategory,
        image_url: finalImageUrl,
        stock: parsedStock
    };

    // Tentukan mode: tambah atau edit
    const isEditMode = this.editingProductId !== null;
    const url = isEditMode
        ? `${apiBaseUrl}/api/admin/products/${this.editingProductId}`
        : `${apiBaseUrl}/api/admin/products`;
    const method = isEditMode ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        if (await this.handleApiError(res)) {
            restoreButton();
            return;
        }

        const data = await res.json();
        if (res.ok && data.success) {
            await modal.alert(isEditMode ? 'Produk berhasil diperbarui!' : 'Produk berhasil ditambahkan!');
            this.cancelEdit();
            this.fetchAdminProducts();
        } else {
            this.showAdminError(data, 'Gagal menyimpan produk');
        }
    } catch (_error) {
        await modal.alert('Kesalahan jaringan.');
    } finally {
        restoreButton();
    }
};
