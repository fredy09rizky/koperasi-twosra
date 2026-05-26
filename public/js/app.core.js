import { formatRupiah, optimizeImageUrl, toSafeNumber } from './config.js';
import { fetchProducts, fetchStoreStatus, productFetchState, productsList } from './data.js';
import { cart } from './cart.ui.js';
import { CheckoutForm, getCheckoutFormInstance, setCheckoutFormInstance } from './checkout/form.core.js';
import { appLogger } from './logger.js';
import { UIModal } from './modal.js';

export class App {
    constructor() {
        // Daftar nama-nama halaman (view) yang tersedia di HTML
        this.views = ['home', 'cart', 'checkout', 'payment', 'summary', 'tampering', 'payment-review'];
        this.currentCategory = 'Semua';
        this.currentSort = 'newest';
        this.currentSearchTerm = '';
        this.receiptTemplatePromise = null;
        this.init();
    }

    async init() {
        const checkoutInstance = setCheckoutFormInstance(new CheckoutForm());

        await Promise.all([
            fetchProducts(),
            fetchStoreStatus({ silent: true })
        ]);

        const sortSelect = document.getElementById('products-sort');
        if (sortSelect) {
            sortSelect.value = this.currentSort;
        }

        cart.validate();
        this.renderProducts();
        cart.updateUI();
        this.navigate('home');

        // Pulihkan sesi pembayaran jika user refresh/close browser di tengah transaksi
        const restoredPendingPayment = await checkoutInstance.restorePendingPaymentSession();
        if (restoredPendingPayment) {
            return;
        }
    }

    getModalApi() {
        if (UIModal && typeof UIModal.alert === 'function') {
            return UIModal;
        }
        return {
            alert: (message) => window.alert(String(message ?? 'Terjadi kesalahan.'))
        };
    }

    getLogger() {
        if (appLogger && typeof appLogger.error === 'function') {
            return appLogger;
        }
        return {
            error: () => {},
            warn: () => {},
            info: () => {}
        };
    }

    getCheckoutForm() {
        return getCheckoutFormInstance();
    }

    getCart() {
        return cart;
    }

    formatCurrency(value) {
        return formatRupiah(value);
    }

    normalizeSortKey(sortKey) {
        // Guard: hanya izinkan sort key yang didukung agar tidak ada nilai tak terduga masuk ke logika sort.
        const allowedSortKeys = new Set([
            'newest',
            'oldest',
            'name_asc',
            'price_desc',
            'price_asc',
            'stock_asc',
            'stock_desc'
        ]);
        return allowedSortKeys.has(sortKey) ? sortKey : 'newest';
    }

    sortProducts(products) {
        const sortedProducts = [...products];
        const sortKey = this.normalizeSortKey(this.currentSort);

        sortedProducts.sort((a, b) => {
            const idA = toSafeNumber(a.id);
            const idB = toSafeNumber(b.id);
            const priceA = toSafeNumber(a.price);
            const priceB = toSafeNumber(b.price);
            const stockA = toSafeNumber(a.stock);
            const stockB = toSafeNumber(b.stock);
            const nameA = String(a.name ?? '');
            const nameB = String(b.name ?? '');

            let result = 0;
            if (sortKey === 'oldest') {
                result = idA - idB;
            } else if (sortKey === 'name_asc') {
                result = nameA.localeCompare(nameB, 'id', { sensitivity: 'base' });
            } else if (sortKey === 'price_desc') {
                result = priceB - priceA;
            } else if (sortKey === 'price_asc') {
                result = priceA - priceB;
            } else if (sortKey === 'stock_asc') {
                result = stockA - stockB;
            } else if (sortKey === 'stock_desc') {
                result = stockB - stockA;
            } else {
                result = idB - idA;
            }

            if (result === 0) {
                // Tie-breaker: ID descending agar urutan stabil saat nilai utama sama
                return idB - idA;
            }
            return result;
        });

        return sortedProducts;
    }

    renderProducts() {
        const container = document.getElementById('products-container');
        if (!container) return;

        container.replaceChildren();

        const renderEmptyProductsState = ({ icon, title, desc, compact = false, retry = false }) => {
            const state = document.createElement('div');
            state.className = compact
                ? 'empty-products-state empty-products-state-compact'
                : 'empty-products-state';

            if (icon) {
                const iconEl = document.createElement('div');
                iconEl.className = 'empty-icon';
                iconEl.setAttribute('aria-hidden', 'true');
                iconEl.textContent = icon;
                state.appendChild(iconEl);
            }

            const titleEl = document.createElement('h3');
            titleEl.className = compact ? 'empty-title empty-title-compact' : 'empty-title';
            titleEl.textContent = title;
            state.appendChild(titleEl);

            const descEl = document.createElement('p');
            descEl.className = 'empty-desc';
            descEl.textContent = desc;
            state.appendChild(descEl);

            if (retry) {
                const retryButton = document.createElement('button');
                retryButton.type = 'button';
                retryButton.className = 'btn btn-primary';
                retryButton.id = 'btn-retry-products';
                retryButton.textContent = 'Coba Lagi';
                retryButton.addEventListener('click', async () => {
                    await fetchProducts(true);
                    this.renderProducts();
                });
                state.appendChild(retryButton);
            }

            container.appendChild(state);
            container.style.display = 'block';
        };

        if (productFetchState?.status === 'error') {
            renderEmptyProductsState({
                icon: '!',
                title: 'Katalog Tidak Bisa Dimuat',
                desc: productFetchState.message || 'Gagal memuat katalog dari server.',
                retry: true
            });
            return;
        }

        // Empty state jika belum ada produk di database
        if (productsList.length === 0) {
            renderEmptyProductsState({
                icon: '📦',
                title: 'Belum Ada Produk',
                desc: 'Saat ini belum ada produk yang dijual di Koperasi Sekolah. Silakan hubungi admin untuk menambahkan produk baru.'
            });
            return;
        }

        // Kembalikan ke tampilan grid jika produk tersedia
        container.style.display = 'grid';

        // Filter berdasarkan kategori aktif
        const filteredByCategory = this.currentCategory === 'Semua'
            ? productsList
            : productsList.filter(p => p.category === this.currentCategory);

        const normalizedSearchTerm = this.normalizeSearchTerm(this.currentSearchTerm);
        const filteredProducts = normalizedSearchTerm
            ? filteredByCategory.filter((product) => {
                const name = this.normalizeSearchTerm(product?.name);
                const category = this.normalizeSearchTerm(product?.category);
                return name.includes(normalizedSearchTerm) || category.includes(normalizedSearchTerm);
            })
            : filteredByCategory;

        const sortedProducts = this.sortProducts(filteredProducts);

        if (sortedProducts.length === 0) {
            const hasCategoryFilter = this.currentCategory !== 'Semua';
            const hasSearchFilter = normalizedSearchTerm.length > 0;
            let emptyDescription = `Belum ada stok barang untuk kategori "${this.currentCategory}".`;
            let emptyTitle = 'Kategori Kosong';
            if (hasSearchFilter && hasCategoryFilter) {
                emptyTitle = 'Produk Tidak Ditemukan';
                emptyDescription = `Tidak ada produk dengan kata kunci "${this.currentSearchTerm}" di kategori "${this.currentCategory}".`;
            } else if (hasSearchFilter) {
                emptyTitle = 'Produk Tidak Ditemukan';
                emptyDescription = `Tidak ada produk yang cocok dengan kata kunci "${this.currentSearchTerm}".`;
            }
            renderEmptyProductsState({
                title: emptyTitle,
                desc: emptyDescription,
                compact: true
            });
            return;
        }

        sortedProducts.forEach((product, index) => {
            const el = document.createElement('div');
            el.className = 'product-card';
            const safeProductId = toSafeNumber(product.id);
            const safeStock = toSafeNumber(product.stock);
            const safePrice = toSafeNumber(product.price);
            const isPurchasable = safeProductId > 0 && safeStock > 0;
            const isOutOfStock = !isPurchasable;
            const productName = String(product.name || '');
            const productCategory = String(product.category || '');
            const imageSource = product.image_url || product.image;
            const productImageCandidates = [
                { width: 280, height: 186 },
                { width: 420, height: 280 },
                { width: 560, height: 374 }
            ].map((dimension) => ({
                ...dimension,
                src: optimizeImageUrl(imageSource, {
                    width: dimension.width,
                    height: dimension.height,
                    quality: 62,
                    fit: 'cover'
                })
            })).filter((candidate) => Boolean(candidate.src));
            const safeImage = productImageCandidates.find((candidate) => candidate.width === 420)?.src
                || productImageCandidates[0]?.src
                || 'profile-img.png';
            const productImageSrcSet = productImageCandidates
                .map((candidate) => `${candidate.src} ${candidate.width}w`)
                .join(', ');
            const productImageSizes = '(max-width: 640px) 92vw, (max-width: 1024px) 44vw, 420px';
            const isLikelyAboveFold = index < 2;
            const imageLoading = isLikelyAboveFold ? 'eager' : 'lazy';
            const imageFetchPriority = isLikelyAboveFold ? 'high' : 'low';
            const imageDecoding = isLikelyAboveFold ? 'sync' : 'async';

            const image = document.createElement('img');
            image.src = safeImage;
            if (productImageSrcSet) {
                image.srcset = productImageSrcSet;
                image.sizes = productImageSizes;
            }
            image.alt = productName;
            image.className = 'product-img';
            image.loading = imageLoading;
            image.fetchPriority = imageFetchPriority;
            image.decoding = imageDecoding;

            const info = document.createElement('div');
            info.className = 'product-info';
            const meta = document.createElement('div');
            meta.className = 'product-meta-row';
            const category = document.createElement('span');
            category.className = 'product-category';
            category.textContent = productCategory;
            const stock = document.createElement('span');
            stock.className = `product-stock-chip ${isOutOfStock ? 'is-empty' : ''}`.trim();
            stock.textContent = isOutOfStock ? 'Stok Habis' : `Sisa Stok: ${safeStock}`;
            meta.appendChild(category);
            meta.appendChild(stock);

            const title = document.createElement('h3');
            title.className = 'product-title';
            title.textContent = productName;

            const price = document.createElement('div');
            price.className = 'product-price';
            price.textContent = this.formatCurrency(safePrice);

            const addButton = document.createElement('button');
            addButton.className = `btn ${isOutOfStock ? 'btn-secondary btn-disabled-soft' : 'btn-primary'} btn-block js-add-cart`;
            addButton.disabled = isOutOfStock;
            addButton.textContent = isOutOfStock ? 'Habis Terjual' : 'Tambah ke Keranjang';

            info.appendChild(meta);
            info.appendChild(title);
            info.appendChild(price);
            info.appendChild(addButton);
            el.appendChild(image);
            el.appendChild(info);

            if (addButton && isPurchasable) {
                addButton.addEventListener('click', () => cart.addItem(safeProductId));
            }
            container.appendChild(el);
        });
    }

    filterProducts(category) {
        this.currentCategory = category;

        const filterBtns = document.querySelectorAll('.category-filter .btn');
        filterBtns.forEach(btn => {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
            btn.setAttribute('aria-pressed', 'false');
        });

        const clickedBtn = Array.from(filterBtns).find(b => b.getAttribute('data-category') === category);
        if (clickedBtn) {
            clickedBtn.classList.remove('btn-secondary');
            clickedBtn.classList.add('btn-primary');
            clickedBtn.setAttribute('aria-pressed', 'true');
        }

        this.renderProducts();
    }

    async ensureReceiptTemplate() {
        if (document.getElementById('receipt')) return;
        if (!this.receiptTemplatePromise) {
            this.receiptTemplatePromise = fetch('partials/receipt-template.html', { cache: 'no-store' })
                .then(async (response) => {
                    if (!response.ok) {
                        throw new Error('Template bukti pembayaran gagal dimuat.');
                    }
                    const markup = await response.text();
                    const parsed = new DOMParser().parseFromString(markup, 'text/html');
                    parsed.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());
                    const receiptContainer = parsed.getElementById('receipt-container');
                    if (!receiptContainer) {
                        throw new Error('Template bukti pembayaran tidak valid.');
                    }
                    const importedContainer = document.importNode(receiptContainer, true);
                    document.body.appendChild(importedContainer);
                });
        }
        try {
            await this.receiptTemplatePromise;
        } catch (error) {
            this.receiptTemplatePromise = null;
            throw error;
        }
    }

    setSort(sortKey) {
        this.currentSort = this.normalizeSortKey(sortKey);
        this.renderProducts();
    }

    normalizeSearchTerm(rawValue) {
        return String(rawValue ?? '')
            .trim()
            .toLocaleLowerCase('id-ID');
    }

    setSearchTerm(rawValue) {
        this.currentSearchTerm = String(rawValue ?? '').trim();
        this.renderProducts();
    }

    // Fungsi untuk berpindah antar halaman (menyembunyikan yang lain, menampilkan yang dituju)
    navigate(viewId) {
        if (viewId === 'checkout') {
            const modal = this.getModalApi();
            cart.validate();
            cart.updateUI();
            const checkoutSnapshot = cart.getCheckoutSnapshot();

            if (cart.items.length === 0) {
                modal.alert("Keranjang masih kosong.");
                return;
            }
            if (checkoutSnapshot.totalTypes === 0) {
                modal.alert("Pilih minimal satu produk di keranjang untuk melanjutkan checkout.");
                return;
            }
            if (checkoutSnapshot.totalTypes > 5) {
                modal.alert("Maks. 5 jenis barang berbeda per pesanan. Silakan kurangi sebagian jenis barang dari keranjang Anda.");
                return;
            }
            if (checkoutSnapshot.total < 1000) {
                modal.alert("Minimal total pesanan adalah Rp1.000 untuk dapat diproses.");
                return;
            }
            // Perbarui ketersediaan hari buka koperasi sebelum menampilkan formulir
            const checkoutInstance = this.getCheckoutForm();
            if (checkoutInstance) {
                checkoutInstance.updateDayOptions();
                void checkoutInstance.refreshStoreStatus({ silent: true });
            }
        }

        this.views.forEach(v => {
            const el = document.getElementById('view-' + v);
            if (el) el.classList.add('hidden');
        });

        const target = document.getElementById('view-' + viewId);
        if (target) {
            target.classList.remove('hidden');
            window.scrollTo(0, 0);
        }
    }

    resetFlow() {
        const checkoutInstance = this.getCheckoutForm();
        if (checkoutInstance) {
            // Bersihkan sesi pembayaran dan form jika user ingin mulai ulang
            checkoutInstance.resetPaymentState(true);
            if (checkoutInstance.form) {
                checkoutInstance.form.reset();
            }
        }
        this.navigate('home');
    }

    // Menampilkan pesan pop-up singkat (Toast) di pojok layar
    showToast(message) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '20');
        icon.setAttribute('height', '20');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '2');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M22 11.08V12a10 10 0 1 1-5.93-9.14');
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '22 4 12 14.01 9 11.01');
        icon.appendChild(path);
        icon.appendChild(polyline);
        const text = document.createElement('span');
        text.textContent = String(message ?? '');
        toast.appendChild(icon);
        toast.appendChild(text);

        container.appendChild(toast);

        // Jeda 10ms sebelum menambah class 'show' agar CSS transition terpicu dengan benar
        requestAnimationFrame(() => {
            setTimeout(() => toast.classList.add('show'), 10);
        });

        // Sembunyikan setelah 3 detik; delay 300ms sinkron dengan durasi CSS transition fade-out
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

if (typeof window !== 'undefined') {
    window.App = App;
}
