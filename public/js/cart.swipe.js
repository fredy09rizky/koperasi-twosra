import { toSafeNumber } from './config.js';
import { Cart } from './cart.core.js';

// Modul `Cart` untuk interaksi swipe item keranjang.
// Jangan instantiate `Cart` di file ini.

Cart.prototype.closeOpenSwipe = function closeOpenSwipe(exceptProductId = null) {
    const swipeItems = document.querySelectorAll('.cart-item-swipe.is-open');

    swipeItems.forEach((container) => {
        const productId = toSafeNumber(container.dataset.swipeProductId);
        if (exceptProductId && productId === exceptProductId) return;
        this.setSwipeState(productId, false, { animate: true });
    });
};

Cart.prototype.setSwipeState = function setSwipeState(productId, shouldOpen, options = {}) {
    const normalizedId = toSafeNumber(productId);
    if (normalizedId <= 0) return;

    const container = document.querySelector(`.cart-item-swipe[data-swipe-product-id="${normalizedId}"]`);
    if (!container) return;

    const shell = container.querySelector('.cart-item-swipe-shell');
    if (!shell) return;

    if (shouldOpen) {
        this.closeOpenSwipe(normalizedId);
        container.classList.add('is-open');
        this.openSwipeProductId = normalizedId;
    } else {
        container.classList.remove('is-open');
        if (this.openSwipeProductId === normalizedId) {
            this.openSwipeProductId = null;
        }
    }

    const shouldAnimate = options.animate !== false;
    shell.classList.toggle('is-dragging', !shouldAnimate);
    shell.style.transform = shouldOpen
        ? `translateX(-${this.swipeActionWidth}px)`
        : 'translateX(0px)';
};

Cart.prototype.bindSwipeInteractions = function bindSwipeInteractions(container, productId) {
    const shell = container.querySelector('.cart-item-swipe-shell');
    if (!shell) return;

    const state = {
        pointerId: null,
        startX: 0,
        startY: 0,
        startOffset: 0,
        currentOffset: 0,
        moved: false,
        suppressClick: false
    };

    const finishGesture = (event) => {
        if (state.pointerId !== event.pointerId) return;

        const shouldOpen = state.currentOffset <= -this.swipeOpenThreshold;
        state.pointerId = null;

        this.setSwipeState(productId, shouldOpen, { animate: true });

        if (state.moved) {
            event.preventDefault();
            state.suppressClick = true;
            state.moved = false;
        }
    };

    shell.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('button, input, label')) return;

        state.pointerId = event.pointerId;
        state.startX = event.clientX;
        state.startY = event.clientY;
        state.startOffset = container.classList.contains('is-open') ? -this.swipeActionWidth : 0;
        state.currentOffset = state.startOffset;
        state.moved = false;
        state.suppressClick = false;

        if (typeof shell.setPointerCapture === 'function') {
            shell.setPointerCapture(event.pointerId);
        }

        shell.classList.add('is-dragging');
    });

    shell.addEventListener('pointermove', (event) => {
        if (state.pointerId !== event.pointerId) return;

        const deltaX = event.clientX - state.startX;
        const deltaY = event.clientY - state.startY;

        if (Math.abs(deltaX) <= 2) return;
        if (Math.abs(deltaY) > Math.abs(deltaX)) return;

        event.preventDefault();
        state.moved = true;

        this.closeOpenSwipe(productId);

        const nextOffset = Math.min(0, Math.max(-this.swipeActionWidth, state.startOffset + deltaX));
        state.currentOffset = nextOffset;
        shell.style.transform = `translateX(${nextOffset}px)`;
    });

    shell.addEventListener('pointerup', finishGesture);
    shell.addEventListener('pointercancel', finishGesture);

    shell.addEventListener('click', (event) => {
        if (state.suppressClick || state.moved) {
            event.preventDefault();
            event.stopPropagation();
            state.moved = false;
            state.suppressClick = false;
            return;
        }

        if (container.classList.contains('is-open') && !event.target.closest('.cart-item-swipe-delete-btn')) {
            this.setSwipeState(productId, false, { animate: true });
        }
    });
};
