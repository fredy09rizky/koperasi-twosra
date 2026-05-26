import { optimizeImageUrl, toSafeNumber } from './config.js';
import { Cart } from './cart.core.js';
import './cart.swipe.js';

// Modul `Cart` untuk render UI keranjang.
// Jangan instantiate `Cart` di file lain.

function buildCartImageCandidates(imageSource) {
    return [
        { width: 80, height: 80 },
        { width: 120, height: 120 },
        { width: 160, height: 160 }
    ].map((dimension) => ({
        ...dimension,
        src: optimizeImageUrl(imageSource, {
            width: dimension.width,
            height: dimension.height,
            quality: 62,
            fit: 'cover'
        })
    })).filter((candidate) => Boolean(candidate.src));
}

function ensureCartItemElement(cartInstance, productId) {
    const normalizedId = toSafeNumber(productId);
    let wrapper = cartInstance.itemElementCache.get(normalizedId);
    if (wrapper && wrapper.__cartRefs) {
        return { wrapper, refs: wrapper.__cartRefs, isNew: false };
    }

    wrapper = document.createElement('div');
    wrapper.className = 'cart-item-swipe';
    wrapper.dataset.swipeProductId = String(normalizedId);

    const swipeActions = document.createElement('div');
    swipeActions.className = 'cart-item-swipe-actions';
    swipeActions.setAttribute('aria-hidden', 'true');

    const swipeDeleteButton = document.createElement('button');
    swipeDeleteButton.type = 'button';
    swipeDeleteButton.className = 'cart-item-swipe-delete-btn';
    swipeDeleteButton.textContent = 'Hapus';
    swipeActions.appendChild(swipeDeleteButton);

    const itemShell = document.createElement('div');
    itemShell.className = 'cart-item cart-item-swipe-shell';

    const checkLabel = document.createElement('label');
    checkLabel.className = 'cart-item-check-wrap';

    const itemCheckbox = document.createElement('input');
    itemCheckbox.type = 'checkbox';
    itemCheckbox.className = 'cart-item-check';
    checkLabel.appendChild(itemCheckbox);

    const image = document.createElement('img');
    image.className = 'cart-item-img';
    image.loading = 'lazy';
    image.decoding = 'async';

    const details = document.createElement('div');
    details.className = 'cart-item-details';

    const title = document.createElement('h4');
    title.className = 'cart-item-title';

    const meta = document.createElement('div');
    meta.className = 'cart-item-meta';

    const price = document.createElement('div');
    price.className = 'cart-item-price';
    meta.appendChild(price);
    details.appendChild(title);
    details.appendChild(meta);

    const qtyControls = document.createElement('div');
    qtyControls.className = 'cart-qty-controls';

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'qty-btn qty-btn-minus';
    btnMinus.textContent = '-';

    const qtyDisplayWrap = document.createElement('div');
    qtyDisplayWrap.className = 'qty-display-wrap';

    const qtyDisplayButton = document.createElement('button');
    qtyDisplayButton.type = 'button';
    qtyDisplayButton.className = 'qty-display-btn';

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.step = '1';
    qtyInput.inputMode = 'numeric';
    qtyInput.pattern = '[0-9]*';
    qtyInput.className = 'qty-inline-input hidden';

    qtyDisplayWrap.appendChild(qtyDisplayButton);
    qtyDisplayWrap.appendChild(qtyInput);

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'qty-btn qty-btn-plus';
    btnPlus.textContent = '+';

    qtyControls.appendChild(btnMinus);
    qtyControls.appendChild(qtyDisplayWrap);
    qtyControls.appendChild(btnPlus);

    itemShell.appendChild(checkLabel);
    itemShell.appendChild(image);
    itemShell.appendChild(details);
    itemShell.appendChild(qtyControls);

    wrapper.appendChild(swipeActions);
    wrapper.appendChild(itemShell);

    const refs = {
        swipeDeleteButton,
        itemCheckbox,
        checkLabel,
        image,
        title,
        price,
        btnMinus,
        qtyDisplayButton,
        qtyInput,
        btnPlus
    };
    wrapper.__cartRefs = refs;

    if (normalizedId > 0) {
        swipeDeleteButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            cartInstance.deleteSingleItem(normalizedId);
        });

        itemCheckbox.addEventListener('change', () => cartInstance.toggleItemSelection(normalizedId));
        btnMinus.addEventListener('click', () => cartInstance.updateQuantity(normalizedId, -1));
        btnPlus.addEventListener('click', () => cartInstance.updateQuantity(normalizedId, 1));

        qtyDisplayButton.addEventListener('click', () => cartInstance.startQuantityEdit(normalizedId));
        qtyDisplayButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                cartInstance.startQuantityEdit(normalizedId);
            }
        });

        qtyInput.addEventListener('input', () => {
            qtyInput.value = qtyInput.value.replace(/[^0-9]/g, '');
        });

        qtyInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                cartInstance.commitQuantityEdit(normalizedId, qtyInput.value);
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                cartInstance.cancelQuantityEdit();
            }
        });

        qtyInput.addEventListener('blur', () => cartInstance.commitQuantityEdit(normalizedId, qtyInput.value));

        cartInstance.bindSwipeInteractions(wrapper, normalizedId);
    }

    cartInstance.itemElementCache.set(normalizedId, wrapper);
    return { wrapper, refs, isNew: true };
}

function syncCartItemElement(cartInstance, wrapper, refs, item) {
    const safeId = toSafeNumber(item.product.id);
    const safeQuantity = toSafeNumber(item.quantity);
    const safePrice = toSafeNumber(item.product.price);
    const productName = String(item.product.name || '');
    const isChecked = cartInstance.selectedProductIds.has(safeId);
    const isSwipeOpen = cartInstance.openSwipeProductId === safeId;
    const isEditingQty = cartInstance.editingQuantityProductId === safeId;
    const imageSource = item.product.image_url || item.product.image;
    const cartImageCandidates = buildCartImageCandidates(imageSource);
    const safeImage = cartImageCandidates.find((candidate) => candidate.width === 120)?.src
        || cartImageCandidates[0]?.src
        || 'profile-img.png';
    const cartImageSrcSet = cartImageCandidates
        .map((candidate) => `${candidate.src} ${candidate.width}w`)
        .join(', ');

    wrapper.classList.toggle('is-open', isSwipeOpen);
    wrapper.dataset.swipeProductId = String(safeId);

    refs.swipeDeleteButton.setAttribute('aria-label', `Hapus produk ${productName}`);
    refs.checkLabel.setAttribute('aria-label', `Pilih produk ${productName}`);
    refs.itemCheckbox.checked = isChecked;

    refs.image.src = safeImage;
    refs.image.alt = productName;
    if (cartImageSrcSet) {
        refs.image.srcset = cartImageSrcSet;
        refs.image.sizes = '80px';
    } else {
        refs.image.removeAttribute('srcset');
        refs.image.removeAttribute('sizes');
    }

    refs.title.textContent = productName;
    refs.price.textContent = cartInstance.formatCurrency(safePrice);

    refs.btnMinus.setAttribute('aria-label', `Kurangi jumlah ${productName}`);
    refs.qtyDisplayButton.setAttribute('aria-label', `Ubah jumlah ${productName}`);
    refs.qtyDisplayButton.textContent = String(safeQuantity);
    refs.qtyDisplayButton.classList.toggle('hidden', isEditingQty);

    refs.qtyInput.classList.toggle('hidden', !isEditingQty);
    refs.qtyInput.value = String(safeQuantity);
    refs.qtyInput.setAttribute('aria-label', `Input jumlah ${productName}`);

    refs.btnPlus.setAttribute('aria-label', `Tambah jumlah ${productName}`);

    cartInstance.setSwipeState(safeId, isSwipeOpen, { animate: false });

    if (isEditingQty && document.activeElement !== refs.qtyInput) {
        requestAnimationFrame(() => {
            refs.qtyInput.focus();
            refs.qtyInput.select();
        });
    }
}

Cart.prototype.updateUI = function updateUI() {
    // 1) Update badge jumlah item di navbar (semua item).
    const badge = document.getElementById('cart-badge');
    if (badge) {
        const count = this.getTotalItems();
        badge.textContent = count;
        badge.setAttribute('aria-label', `${count} item di keranjang`);
    }

    // 2) Render isi keranjang.
    const cartItemsContainer = document.getElementById('cart-items');
    if (!cartItemsContainer) return;

    const hasItems = this.items.length > 0;

    const cartContent = document.getElementById('cart-content');
    const cartEmpty = document.getElementById('cart-empty');
    if (cartContent) cartContent.classList.toggle('hidden', !hasItems);
    if (cartEmpty) cartEmpty.classList.toggle('hidden', hasItems);

    if (!hasItems) {
        this.selectedProductIds.clear();
        this.openSwipeProductId = null;
        this.editingQuantityProductId = null;
        cartItemsContainer.replaceChildren();
        this.itemElementCache.clear();
    } else {
        this.syncSelectedItems();
    }

    const btnClear = document.getElementById('btn-clear-cart');
    if (btnClear) {
        btnClear.classList.toggle('hidden', !hasItems);
    }

    const selectedTypeCount = this.getSelectedTypeCount();
    const selectedUnitCount = this.getSelectedTotalItems();
    const selectedTotalPrice = this.getSelectedTotalPrice();

    const selectedSummary = document.getElementById('cart-selected-summary');
    if (selectedSummary) {
        if (!hasItems) {
            selectedSummary.textContent = 'Belum ada produk dipilih';
        } else if (selectedTypeCount <= 0) {
            selectedSummary.textContent = 'Pilih produk untuk checkout. Geser kartu ke kiri bila ingin menghapus cepat.';
        } else {
            selectedSummary.textContent = `${selectedTypeCount} produk dipilih (${selectedUnitCount} item). Total di atas hanya untuk pilihan ini.`;
        }
    }

    const totalPriceEl = document.getElementById('cart-total-price');
    if (totalPriceEl) {
        totalPriceEl.textContent = this.formatCurrency(selectedTotalPrice);
    }

    const btnCheckout = document.getElementById('btn-checkout');
    if (btnCheckout) {
        const isMinOrderMet = selectedTotalPrice >= 1000;
        const isMaxTypesExceeded = selectedTypeCount > 5;
        const hasSelection = selectedTypeCount > 0;
        btnCheckout.disabled = !hasSelection || !isMinOrderMet || isMaxTypesExceeded;

        if (!hasItems || !hasSelection) {
            btnCheckout.textContent = 'Pilih Produk Dulu';
        } else if (isMaxTypesExceeded) {
            btnCheckout.textContent = 'Maksimal 5 Jenis Barang';
        } else if (!isMinOrderMet) {
            btnCheckout.textContent = 'Minimal Pesanan Rp1.000';
        } else {
            btnCheckout.textContent = 'Lanjut ke Pemesanan';
        }
    }

    if (!hasItems) return;

    // 3) Render item secara parsial agar posisi scroll tetap stabil.
    const nextItemIds = new Set();
    this.items.forEach((item, index) => {
        const safeId = toSafeNumber(item.product.id);
        if (safeId <= 0) return;

        const { wrapper, refs } = ensureCartItemElement(this, safeId);
        syncCartItemElement(this, wrapper, refs, item);

        const currentChildAtIndex = cartItemsContainer.children[index] || null;
        if (currentChildAtIndex !== wrapper) {
            cartItemsContainer.insertBefore(wrapper, currentChildAtIndex);
        }

        nextItemIds.add(safeId);
    });

    this.itemElementCache.forEach((wrapper, productId) => {
        if (nextItemIds.has(productId)) return;
        wrapper.remove();
        this.itemElementCache.delete(productId);
    });
};

// Inisialisasi global.
export const cart = new Cart();
