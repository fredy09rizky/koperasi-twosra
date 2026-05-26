// Modul AdminApp (Products List) — tabel katalog, pagination, edit/hapus
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.fetchAdminProducts = async function fetchAdminProducts(options = {}) {
    const { silent = false, message = 'Memuat katalog produk...' } = options;
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    const modal = this.getModalApi();
    // Rute admin khusus agar dashboard bisa melihat stok asli + reservasi + stok tersedia.
    try {
        await this.fetchAdminImagePolicy();
        await this.withGlobalLoading(async () => {
            const res = await fetch(`${apiBaseUrl}/api/admin/products`, {
                credentials: 'include'
            });

            // Rute ini private, jadi tetap cek status + fallback auth
            if (!res.ok) {
                if (typeof this.handleApiError === 'function' && await this.handleApiError(res)) {
                    return;
                }
                logger.error("Failed to fetch products");
                modal.alert('Gagal memuat katalog produk. Coba segarkan halaman.');
                return;
            }

            const { data } = await res.json();
            this.products = data;
            this.renderProductsData(data);
        }, { silent, message });
    } catch (e) {
        logger.error('Gagal memuat produk admin', e);
        modal.alert('Gagal terhubung ke server. Periksa koneksi internet.');
    }
};

AdminApp.prototype.renderProductsData = function renderProductsData(products) {
    // Render tabel produk dengan sanitasi output agar aman dari XSS
    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;

    tbody.replaceChildren();

    if (!products || products.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'table-empty';
        const wrap = document.createElement('div');
        wrap.className = 'products-empty-wrap';
        const message = document.createElement('div');
        message.textContent = 'Belum ada produk.';
        const refreshButton = document.createElement('button');
        refreshButton.type = 'button';
        refreshButton.className = 'btn btn-outline';
        refreshButton.id = 'btn-refresh-products-empty';
        refreshButton.textContent = 'Segarkan';
        wrap.appendChild(message);
        wrap.appendChild(refreshButton);
        td.appendChild(wrap);
        tr.appendChild(td);
        tbody.appendChild(tr);
        this.updateProductPagination(0, 0, 0);
        return;
    }

    const totalProducts = products.length;
    const totalPages = Math.ceil(totalProducts / this.productsPerPage);
    if (this.currentProductPage > totalPages) this.currentProductPage = totalPages;
    if (this.currentProductPage < 1) this.currentProductPage = 1;
    const startIndex = (this.currentProductPage - 1) * this.productsPerPage;
    const endIndex = startIndex + this.productsPerPage;
    const currentProducts = products.slice(startIndex, endIndex);

    currentProducts.forEach((p) => {
        const tr = document.createElement('tr');
        const productName = String(p.name || '');
        const productCode = String(p.code || '');
        const productCategory = String(p.category || '');
        const safeImageUrl = this.safeImage(p.image_url, {
            width: 96,
            height: 96,
            quality: 68,
            fit: 'cover'
        });
        const safeStockOriginal = Number.isFinite(Number(p.stock_original)) ? Number(p.stock_original) : Number(p.stock || 0);
        const safeStockReserved = Number.isFinite(Number(p.stock_reserved)) ? Number(p.stock_reserved) : 0;
        const safeStockAvailable = Number.isFinite(Number(p.stock_available)) ? Number(p.stock_available) : Number(p.stock || 0);
        const safeId = Number.isFinite(Number(p.id)) ? Number(p.id) : 0;
        const safePrice = Number.isFinite(Number(p.price)) ? Number(p.price) : 0;

        const infoCell = document.createElement('td');
        const infoWrap = document.createElement('div');
        infoWrap.className = 'product-info-cell';

        const image = document.createElement('img');
        image.src = safeImageUrl;
        image.width = 40;
        image.height = 40;
        image.className = 'product-thumb-image';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = productName;

        const textWrap = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.className = 'product-name-text';
        nameEl.textContent = productName;
        const codeEl = document.createElement('small');
        codeEl.className = 'product-code-text';
        codeEl.textContent = `[${productCode}] ID:${safeId}`;
        textWrap.appendChild(nameEl);
        textWrap.appendChild(codeEl);
        infoWrap.appendChild(image);
        infoWrap.appendChild(textWrap);
        infoCell.appendChild(infoWrap);

        const categoryCell = document.createElement('td');
        const categoryPill = document.createElement('span');
        categoryPill.className = 'product-category-pill';
        categoryPill.textContent = productCategory;
        categoryCell.appendChild(categoryPill);

        const createNumberCell = (className, value) => {
            const td = document.createElement('td');
            const bold = document.createElement('b');
            bold.className = className;
            bold.textContent = String(value);
            td.appendChild(bold);
            return td;
        };

        const priceCell = document.createElement('td');
        const priceEl = document.createElement('b');
        priceEl.className = 'price-text';
        priceEl.textContent = this.formatCurrency(safePrice);
        priceCell.appendChild(priceEl);

        const actionsCell = document.createElement('td');
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'row-actions';
        actionsCell.appendChild(actionsContainer);

        tr.appendChild(infoCell);
        tr.appendChild(categoryCell);
        tr.appendChild(createNumberCell('stock-origin-text', safeStockOriginal));
        tr.appendChild(createNumberCell('stock-reserved-text', safeStockReserved));
        tr.appendChild(createNumberCell('stock-available-text', safeStockAvailable));
        tr.appendChild(priceCell);
        tr.appendChild(actionsCell);

        const editButton = document.createElement('button');
        editButton.className = 'btn btn-secondary';
        editButton.classList.add('row-action-btn');
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => this.editProduct(safeId));

        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn btn-danger';
        deleteButton.textContent = 'Hapus';
        deleteButton.addEventListener('click', () => this.deleteProduct(safeId, productName));

        actionsContainer.appendChild(editButton);
        actionsContainer.appendChild(deleteButton);
        tbody.appendChild(tr);
    });

    this.updateProductPagination(totalPages, startIndex, endIndex);
};

AdminApp.prototype.updateProductPagination = function updateProductPagination(totalPages, startIndex = 0, endIndex = 0) {
    const btnPrev = document.getElementById('btn-prev-product-page');
    const btnNext = document.getElementById('btn-next-product-page');
    const pageInfo = document.getElementById('product-page-info');
    if (!btnPrev || !btnNext || !pageInfo) return;

    const totalProducts = Array.isArray(this.products) ? this.products.length : 0;
    if (!totalPages || totalProducts === 0) {
        pageInfo.textContent = 'Menampilkan 0 data';
        btnPrev.disabled = true;
        btnNext.disabled = true;
        return;
    }

    const visibleStart = startIndex + 1;
    const visibleEnd = Math.min(endIndex, totalProducts);
    pageInfo.textContent = `Menampilkan ${visibleStart}-${visibleEnd} dari ${totalProducts} (Halaman ${this.currentProductPage}/${totalPages})`;
    btnPrev.disabled = this.currentProductPage <= 1;
    btnNext.disabled = this.currentProductPage >= totalPages;
};

AdminApp.prototype.prevProductPage = function prevProductPage() {
    if (this.currentProductPage > 1) {
        this.currentProductPage -= 1;
        this.renderProductsData(this.products);
    }
};

AdminApp.prototype.nextProductPage = function nextProductPage() {
    const totalProducts = Array.isArray(this.products) ? this.products.length : 0;
    const totalPages = Math.ceil(totalProducts / this.productsPerPage);
    if (this.currentProductPage < totalPages) {
        this.currentProductPage += 1;
        this.renderProductsData(this.products);
    }
};

AdminApp.prototype.editProduct = function editProduct(id) {
    const product = this.products.find(p => p.id === id);
    if (!product) return;

    this.editingProductId = id;

    // Isi form dengan data produk yang dipilih
    document.getElementById('pCode').value = product.code;
    document.getElementById('pName').value = product.name;
    document.getElementById('pPrice').value = product.price;
    document.getElementById('pStock').value = Number.isFinite(Number(product.stock_original))
        ? Number(product.stock_original)
        : Number(product.stock || 0);
    document.getElementById('pCategory').value = product.category;

    // Reset metode input gambar ke URL dan isi nilainya
    document.querySelector('input[name="pImgMethod"][value="url"]').checked = true;
    this.toggleImageInput();
    document.getElementById('pImg').value = product.image_url;

    // Kosongkan form file input
    document.getElementById('pImgFile').value = '';
    document.getElementById('pImgPreview').style.display = 'none';
    document.getElementById('pImgFileStatus').textContent = '';

    // Perbarui teks antarmuka (UI) form
    document.getElementById('form-product-title').textContent = 'Edit Produk';
    document.getElementById('btn-submit-product').textContent = 'Perbarui Produk';
    document.getElementById('btn-cancel-edit').classList.remove('hidden');

    // Gulir (scroll) layar otomatis ke arah form
    document.getElementById('add-product-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

AdminApp.prototype.cancelEdit = function cancelEdit() {
    this.editingProductId = null;
    this.productForm.reset();

    // Kembalikan ke opsi input URL
    document.querySelector('input[name="pImgMethod"][value="url"]').checked = true;
    this.toggleImageInput();

    document.getElementById('pImgPreview').style.display = 'none';
    document.getElementById('pImgFileStatus').textContent = '';

    document.getElementById('form-product-title').textContent = 'Tambah Produk Baru';
    document.getElementById('btn-submit-product').textContent = 'Simpan Produk';
    document.getElementById('btn-cancel-edit').classList.add('hidden');
};

AdminApp.prototype.deleteProduct = async function deleteProduct(id, name) {
    const apiBaseUrl = this.getApiBaseUrl();
    const modal = this.getModalApi();
    if (!await modal.confirm(`Yakin ingin menghapus produk "${name}"?`, "Hapus Produk", "warning")) return;

    try {
        const res = await fetch(`${apiBaseUrl}/api/admin/products/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (await this.handleApiError(res)) return; // Hentikan proses jika gagal verifikasi (unauthorized)

        const data = await res.json();

        if (res.ok && data.success) {
            this.fetchAdminProducts(); // Segarkan daftar produk di tabel
        } else {
            this.showAdminError(data, 'Gagal menghapus');
        }
    } catch (_error) {
        modal.alert('Kesalahan jaringan.');
    }
};
