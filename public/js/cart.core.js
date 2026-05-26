import { productsList } from './data.js';
import { formatRupiah, toSafeNumber } from './config.js';
import { storage } from './config.runtime.js';
import { getAppInstance } from './app.runtime.js';
import { UIModal } from './modal.js';

// Kelas `Cart` (Keranjang) bertugas mengelola data belanja siswa.
const notifyCart = (message) => {
    const appInstance = getAppInstance();
    if (appInstance && typeof appInstance.showToast === 'function') {
        appInstance.showToast(message);
    }
};

// Helper pencarian produk berdasarkan id.
const findProductById = (productId) => productsList.find((p) => p.id === productId);

export class Cart {
    constructor() {
        this.items = []; // Array: { product, quantity }
        this.selectedProductIds = new Set(); // Seleksi item untuk checkout (tidak disimpan ke localStorage)
        this.openSwipeProductId = null;
        this.editingQuantityProductId = null;
        this.itemElementCache = new Map();

        this.swipeActionWidth = 78;
        this.swipeOpenThreshold = 24;

        this.loadFromStorage();
        this.bindGlobalSwipeCloser();
    }

    getModalApi() {
        if (UIModal && typeof UIModal.confirm === 'function') {
            return UIModal;
        }
        return {
            confirm: async (message) => window.confirm(String(message ?? 'Lanjutkan?'))
        };
    }

    formatCurrency(value) {
        return formatRupiah(value);
    }

    // Mengambil data keranjang yang tersimpan sebelumnya.
    loadFromStorage() {
        const parsed = storage.get('koperasi_cart');
        this.items = Array.isArray(parsed) ? parsed : [];
    }

    saveToStorage() {
        storage.set('koperasi_cart', this.items);
    }

    bindGlobalSwipeCloser() {
        if (typeof document === 'undefined') return;

        document.addEventListener('pointerdown', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('.cart-item-swipe')) return;
            this.closeOpenSwipe();
        });
    }

    // Memvalidasi keranjang terhadap data stok dan produk terbaru di database.
    validate() {
        if (!Array.isArray(productsList) || productsList.length === 0) return;

        let hasChanges = false;
        const validItems = [];

        this.items.forEach((item) => {
            const dbProduct = findProductById(item?.product?.id);
            if (!dbProduct) {
                hasChanges = true;
                return;
            }

            item.product = dbProduct;

            const stock = toSafeNumber(dbProduct.stock);
            if (stock <= 0) {
                hasChanges = true;
                return;
            }

            let normalizedQuantity = toSafeNumber(item.quantity);
            if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
                normalizedQuantity = 1;
                hasChanges = true;
            }

            if (normalizedQuantity > stock) {
                normalizedQuantity = stock;
                hasChanges = true;
            }

            item.quantity = normalizedQuantity;
            validItems.push(item);
        });

        if (hasChanges) {
            this.items = validItems;
            this.saveToStorage();
            notifyCart('Beberapa barang di keranjang otomatis disesuaikan dengan ketersediaan stok terbaru!');
        }

        this.syncSelectedItems();
    }

    // Menambahkan barang ke keranjang.
    addItem(productId) {
        const product = findProductById(productId);
        if (!product) return;

        const stock = toSafeNumber(product.stock);
        if (stock <= 0) {
            notifyCart(`Maaf, stok ${product.name} sedang kosong!`);
            return;
        }

        const existingItem = this.items.find((item) => item.product.id === productId);
        if (existingItem) {
            if (existingItem.quantity >= stock) {
                notifyCart(`Maksimal stok ${product.name} hanya tersedia ${product.stock} buah.`);
                return;
            }
            existingItem.quantity += 1;
        } else {
            this.items.push({ product, quantity: 1 });
            // Default item baru: tidak tercentang.
            this.selectedProductIds.delete(toSafeNumber(productId));
        }

        this.saveToStorage();
        this.updateUI();
        notifyCart(`${product.name} telah masuk keranjang!`);
    }

    updateQuantity(productId, delta) {
        const normalizedId = toSafeNumber(productId);
        if (normalizedId <= 0) return;

        const itemIndex = this.items.findIndex((item) => toSafeNumber(item.product.id) === normalizedId);
        if (itemIndex < 0) return;

        const item = this.items[itemIndex];
        const dbProduct = findProductById(normalizedId);
        const maxStock = toSafeNumber(dbProduct ? dbProduct.stock : item.product.stock);
        if (maxStock <= 0) {
            notifyCart(`Stok ${item.product.name} saat ini tidak tersedia.`);
            return;
        }

        if (delta > 0) {
            if (item.quantity >= maxStock) {
                notifyCart(`Stok maksimal ${item.product.name} adalah ${maxStock} buah.`);
                return;
            }
            item.quantity += 1;
        } else if (delta < 0) {
            if (item.quantity <= 1) {
                return; // Batas minimum qty tetap 1.
            }
            item.quantity -= 1;
        } else {
            return;
        }

        if (this.editingQuantityProductId === normalizedId) {
            this.editingQuantityProductId = null;
        }

        this.saveToStorage();
        this.updateUI();
    }

    startQuantityEdit(productId) {
        const normalizedId = toSafeNumber(productId);
        if (normalizedId <= 0) return;

        if (!this.items.some((item) => toSafeNumber(item.product.id) === normalizedId)) return;
        this.editingQuantityProductId = normalizedId;
        this.updateUI();
    }

    cancelQuantityEdit() {
        if (this.editingQuantityProductId === null) return;
        this.editingQuantityProductId = null;
        this.updateUI();
    }

    commitQuantityEdit(productId, rawValue) {
        const normalizedId = toSafeNumber(productId);
        if (normalizedId <= 0) return;

        const item = this.items.find((entry) => toSafeNumber(entry.product.id) === normalizedId);
        if (!item) {
            this.editingQuantityProductId = null;
            this.updateUI();
            return;
        }

        const dbProduct = findProductById(normalizedId);
        const maxStock = toSafeNumber(dbProduct ? dbProduct.stock : item.product.stock);
        if (maxStock <= 0) {
            this.items = this.items.filter((entry) => toSafeNumber(entry.product.id) !== normalizedId);
            this.selectedProductIds.delete(normalizedId);
            this.editingQuantityProductId = null;
            this.saveToStorage();
            this.updateUI();
            notifyCart(`Stok ${item.product.name} saat ini tidak tersedia.`);
            return;
        }

        const cleaned = String(rawValue ?? '').replace(/[^0-9-]/g, '');
        let nextValue = Number.parseInt(cleaned, 10);

        if (!Number.isFinite(nextValue) || nextValue <= 0) {
            nextValue = 1;
            notifyCart('Jumlah minimal adalah 1.');
        }

        if (nextValue > maxStock) {
            nextValue = maxStock;
            notifyCart(`Jumlah melebihi stok. Maksimal untuk ${item.product.name} adalah ${maxStock}.`);
        }

        if (item.quantity !== nextValue) {
            item.quantity = nextValue;
            this.saveToStorage();
        }

        this.editingQuantityProductId = null;
        this.updateUI();
    }

    getTotalItems() {
        return this.items.reduce((total, item) => total + item.quantity, 0);
    }

    getTotalPrice() {
        return this.items.reduce((total, item) => total + (item.product.price * item.quantity), 0);
    }

    syncSelectedItems() {
        const validIds = new Set(
            this.items.map((item) => toSafeNumber(item.product.id)).filter((id) => id > 0)
        );

        const nextSelected = new Set();
        this.selectedProductIds.forEach((id) => {
            if (validIds.has(id)) nextSelected.add(id);
        });
        this.selectedProductIds = nextSelected;
    }

    isItemSelected(productId) {
        const normalizedId = toSafeNumber(productId);
        if (normalizedId <= 0) return false;
        return this.selectedProductIds.has(normalizedId);
    }

    toggleItemSelection(productId) {
        const normalizedId = toSafeNumber(productId);
        if (normalizedId <= 0) return;

        if (this.selectedProductIds.has(normalizedId)) {
            this.selectedProductIds.delete(normalizedId);
        } else {
            this.selectedProductIds.add(normalizedId);
        }

        this.updateUI();
    }

    clearSelection() {
        this.selectedProductIds.clear();
        this.updateUI();
    }

    getSelectedItems() {
        this.syncSelectedItems();
        return this.items.filter((entry) => this.selectedProductIds.has(toSafeNumber(entry.product.id)));
    }

    getSelectedTypeCount() {
        return this.getSelectedItems().length;
    }

    getSelectedTotalItems() {
        return this.getSelectedItems().reduce((total, item) => total + item.quantity, 0);
    }

    getSelectedTotalPrice() {
        return this.getSelectedItems().reduce((total, item) => total + (item.product.price * item.quantity), 0);
    }

    getCheckoutSnapshot() {
        const selectedItems = this.getSelectedItems();
        const selectedProductIds = selectedItems
            .map((item) => toSafeNumber(item.product.id))
            .filter((id) => id > 0);

        return {
            items: selectedItems.map((item) => ({
                product: { ...item.product },
                quantity: item.quantity
            })),
            total: selectedItems.reduce((total, item) => total + (item.product.price * item.quantity), 0),
            totalTypes: selectedItems.length,
            totalUnits: selectedItems.reduce((total, item) => total + item.quantity, 0),
            selectedProductIds
        };
    }

    removePurchasedItems(productIds = []) {
        const idSet = new Set(
            (Array.isArray(productIds) ? productIds : [])
                .map((id) => toSafeNumber(id))
                .filter((id) => id > 0)
        );

        if (idSet.size === 0) return;

        this.items = this.items.filter((entry) => !idSet.has(toSafeNumber(entry.product.id)));
        idSet.forEach((id) => this.selectedProductIds.delete(id));

        if (this.openSwipeProductId && idSet.has(this.openSwipeProductId)) {
            this.openSwipeProductId = null;
        }

        if (this.editingQuantityProductId && idSet.has(this.editingQuantityProductId)) {
            this.editingQuantityProductId = null;
        }

        this.saveToStorage();
        this.updateUI();
    }

    clear() {
        this.items = [];
        this.selectedProductIds.clear();
        this.openSwipeProductId = null;
        this.editingQuantityProductId = null;
        this.saveToStorage();
        this.updateUI();
    }

    async confirmClearAll() {
        const modal = this.getModalApi();
        if (await modal.confirm('Apakah Anda yakin ingin menghapus semua barang dari keranjang?', 'Hapus', 'warning')) {
            this.clear();
            notifyCart('Keranjang berhasil dikosongkan!');
        }
    }

    async deleteSingleItem(productId) {
        const normalizedId = toSafeNumber(productId);
        const item = this.items.find((entry) => toSafeNumber(entry.product.id) === normalizedId);
        if (!item) return;

        const safeName = String(item.product?.name || 'produk ini').trim();
        const modal = this.getModalApi();
        const confirmed = await modal.confirm(
            `Hapus "${safeName}" dari keranjang?`,
            'Hapus Produk',
            'warning'
        );
        if (!confirmed) return;

        this.items = this.items.filter((entry) => toSafeNumber(entry.product.id) !== normalizedId);
        this.selectedProductIds.delete(normalizedId);

        if (this.openSwipeProductId === normalizedId) {
            this.openSwipeProductId = null;
        }

        if (this.editingQuantityProductId === normalizedId) {
            this.editingQuantityProductId = null;
        }

        this.saveToStorage();
        this.updateUI();
        notifyCart('Produk berhasil dihapus dari keranjang.');
    }
}

if (typeof window !== 'undefined') {
    window.Cart = Cart;
}
