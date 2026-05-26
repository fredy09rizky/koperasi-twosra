// Modul CheckoutForm — render ringkasan pesanan dan payment review
// Jangan instantiate CheckoutForm di file ini.

import { CheckoutForm } from './form.core.js';
import { formatWibDateTime } from '../config.js';

CheckoutForm.prototype.renderSummary = function renderSummary(data) {
    // Render ringkasan setelah pembayaran sukses
    document.getElementById('summary-nama').textContent = data.nama;
    document.getElementById('summary-kelas').textContent = data.kelas;
    document.getElementById('summary-waktu').textContent = data.waktu;
    document.getElementById('summary-trx-id').textContent = data.id_transaksi || '-';
    document.getElementById('summary-pay-time').textContent = formatWibDateTime(data.waktu_pembayaran);

    // Fee = total bayar - subtotal (jika ada fee gateway)
    const subtotal = data.total;
    const fee = (data.payment_amount || data.total) - subtotal;

    document.getElementById('summary-subtotal-price').textContent = this.formatCurrency(subtotal);
    document.getElementById('summary-fee-price').textContent = this.formatCurrency(fee);
    document.getElementById('summary-total-price').textContent = this.formatCurrency(data.payment_amount || data.total);

    const itemsContainer = document.getElementById('summary-items');
    itemsContainer.replaceChildren();

    // Render daftar item yang dibeli (snapshot dari server jika tersedia, fallback ke cart)
    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'summary-item';
        const productName = String(item.product?.name || item.secure_name || '');
        const safeQuantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
        // Prioritaskan secure_price dari server; fallback ke harga produk dari cart
        const rawPrice = item.secure_price ?? item.product?.price;
        const safePrice = Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : 0;
        const nameEl = document.createElement('div');
        nameEl.className = 'summary-item-name';
        nameEl.textContent = `${safeQuantity}x ${productName}`;
        const priceEl = document.createElement('div');
        priceEl.className = 'summary-item-price';
        priceEl.textContent = this.formatCurrency(safePrice * safeQuantity);
        div.appendChild(nameEl);
        div.appendChild(priceEl);
        itemsContainer.appendChild(div);
    });
};

CheckoutForm.prototype.renderPaymentReview = function renderPaymentReview(data) {
    const messageEl = document.getElementById('review-message');
    const orderIdEl = document.getElementById('review-order-id');
    const paymentTimeEl = document.getElementById('review-payment-time');
    const totalPaidEl = document.getElementById('review-total-paid');

    if (messageEl) {
        messageEl.textContent = data.message || 'Pembayaran terdeteksi, tetapi pesanan belum tercatat otomatis.';
    }
    if (orderIdEl) {
        orderIdEl.textContent = data.id_transaksi || '-';
    }
    if (paymentTimeEl) {
        paymentTimeEl.textContent = formatWibDateTime(data.waktu_pembayaran);
    }
    if (totalPaidEl) {
        totalPaidEl.textContent = this.formatCurrency(data.payment_amount || data.total || 0);
    }
};

