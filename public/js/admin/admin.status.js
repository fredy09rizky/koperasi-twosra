// Modul AdminApp — status operasional web (buka/tutup toko)
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.fetchStoreStatus = async function fetchStoreStatus(options = {}) {
    const { silent = false, message = 'Memuat status web...' } = options;
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    const modal = this.getModalApi();
    try {
        return await this.withGlobalLoading(async () => {
        const response = await fetch(`${apiBaseUrl}/api/admin/store-status`, {
            credentials: 'include'
        });

        if (await this.handleApiError(response)) return null;

        const payload = await this.parseJsonSafe(response);

        if (!response.ok || !payload?.success) {
            this.showAdminError(payload, 'Gagal memuat status web.');
            return null;
        }

        this.storeStatusData = payload.data || null;
        this.renderStoreStatus();
        return this.storeStatusData;
        }, { silent, message });
    } catch (error) {
        logger.error('Gagal memuat status operasional web admin', error);
        if (!silent) {
            modal.alert('Gagal terhubung ke server saat memuat status web.');
        }
        return null;
    }
};

AdminApp.prototype.renderStoreStatus = function renderStoreStatus() {
    const badge = document.getElementById('store-status-badge');
    const title = document.getElementById('store-status-title');
    const desc = document.getElementById('store-status-desc');
    const updatedAt = document.getElementById('store-status-updated-at');
    const updatedBy = document.getElementById('store-status-updated-by');
    const activeCheckout = document.getElementById('store-status-active-checkout');
    const activeQris = document.getElementById('store-status-active-qris');
    const warningBox = document.getElementById('store-status-warning');
    const warningText = document.getElementById('store-status-warning-text');
    const toggleButton = document.getElementById('btn-toggle-store-status');

    if (!badge || !title || !desc || !updatedAt || !updatedBy || !activeCheckout || !activeQris || !warningBox || !warningText || !toggleButton) {
        return;
    }

    const data = this.storeStatusData || {};
    const isAcceptingOrders = Boolean(data.accepting_orders);
    const activeCheckoutCount = Number(data.active_checkout_count || 0);
    const activeQrisCount = Number(data.active_qris_count || 0);
    const updatedAtRaw = String(data.updated_at || '').trim();
    const updatedAtDate = updatedAtRaw ? new Date(updatedAtRaw) : null;
    const updatedAtLabel = updatedAtDate instanceof Date && !Number.isNaN(updatedAtDate.getTime())
        ? this.formatAdminDateTime(updatedAtDate, { withSeconds: true, month: 'short' })
        : '-';

    badge.textContent = isAcceptingOrders ? 'BUKA' : 'TUTUP';
    badge.style.background = isAcceptingOrders ? '#dcfce7' : '#fee2e2';
    badge.style.color = isAcceptingOrders ? '#166534' : '#991b1b';
    badge.style.border = isAcceptingOrders ? '1px solid #bbf7d0' : '1px solid #fecaca';
    title.textContent = isAcceptingOrders ? 'Web sedang menerima pesanan baru.' : 'Web sedang tidak menerima pesanan baru.';
    desc.textContent = isAcceptingOrders
        ? 'Siswa dapat membuat checkout baru seperti biasa. Checkout lama dan mode pemulihan tetap diproses normal.'
        : 'Checkout baru diblokir. Checkout yang sudah dimulai sebelumnya tetap boleh lanjut hingga selesai.';
    updatedAt.textContent = updatedAtLabel;
    updatedBy.textContent = data.updated_by ? this.safeText(data.updated_by) : '-';
    activeCheckout.textContent = `${activeCheckoutCount}`;
    activeQris.textContent = `${activeQrisCount}`;
    if (typeof this.renderOrdersQuickSummary === 'function') {
        this.renderOrdersQuickSummary();
    }

    if (activeCheckoutCount > 0 || activeQrisCount > 0) {
        warningBox.classList.remove('hidden');
        warningText.textContent = activeQrisCount > 0
            ? `Saat ini masih ada ${activeCheckoutCount} checkout aktif, termasuk ${activeQrisCount} yang sudah masuk QRIS. Pesanan baru bisa ditutup sekarang, tetapi transaksi yang sudah berjalan tetap diproses.`
            : `Saat ini masih ada ${activeCheckoutCount} checkout aktif. Jika ingin penutupan lebih bersih, pertimbangkan menunggu beberapa menit lagi.`;
    } else {
        warningBox.classList.add('hidden');
        warningText.textContent = '';
    }

    toggleButton.textContent = isAcceptingOrders ? 'Tutup Penerimaan Pesanan' : 'Buka Penerimaan Pesanan';
    toggleButton.classList.remove('btn-primary', 'btn-danger', 'btn-secondary');
    toggleButton.classList.add(isAcceptingOrders ? 'btn-danger' : 'btn-primary');
};

AdminApp.prototype.toggleStoreStatus = async function toggleStoreStatus() {
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    const modal = this.getModalApi();
    const button = document.getElementById('btn-toggle-store-status');
    const data = this.storeStatusData || {};
    const currentAcceptingOrders = Boolean(data.accepting_orders);
    const nextAcceptingOrders = !currentAcceptingOrders;
    const activeCheckoutCount = Number(data.active_checkout_count || 0);
    const activeQrisCount = Number(data.active_qris_count || 0);

    let confirmMessage = nextAcceptingOrders
        ? 'Yakin ingin membuka kembali penerimaan pesanan? Siswa akan bisa membuat checkout baru lagi.'
        : 'Yakin ingin menutup penerimaan pesanan? Pesanan baru akan ditolak sampai admin membuka kembali.';

    if (!nextAcceptingOrders && (activeCheckoutCount > 0 || activeQrisCount > 0)) {
        confirmMessage += `\n\nSaat ini masih ada ${activeCheckoutCount} checkout aktif`;
        if (activeQrisCount > 0) {
            confirmMessage += `, termasuk ${activeQrisCount} yang sudah masuk QRIS`;
        }
        confirmMessage += '. Transaksi yang sudah berjalan tetap diproses, jadi admin disarankan menunggu beberapa saat lagi bila ingin penutupan lebih bersih.';
    }

    const confirmed = await modal.confirm(
        confirmMessage,
        nextAcceptingOrders ? 'Buka Penerimaan Pesanan' : 'Tutup Penerimaan Pesanan',
        'warning'
    );
    if (!confirmed) return;

    try {
        if (button) {
            button.disabled = true;
        }
        await this.withGlobalLoading(async () => {
        const response = await fetch(`${apiBaseUrl}/api/admin/store-status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ accepting_orders: nextAcceptingOrders })
        });

        if (await this.handleApiError(response)) return;

        const payload = await this.parseJsonSafe(response);

        if (!response.ok || !payload?.success) {
            this.showAdminError(payload, 'Gagal memperbarui status web.');
            return;
        }

        this.storeStatusData = payload.data || null;
        this.renderStoreStatus();
        await modal.alert(
            nextAcceptingOrders
                ? 'Web berhasil dibuka kembali untuk menerima pesanan baru.'
                : 'Web berhasil ditutup untuk pesanan baru. Checkout yang sudah berjalan tetap diproses.',
            'Berhasil',
            'success'
        );
        }, { message: nextAcceptingOrders ? 'Membuka penerimaan pesanan...' : 'Menutup penerimaan pesanan...' });
    } catch (error) {
        logger.error('Gagal memperbarui status operasional web', error);
        await modal.alert('Terjadi kesalahan saat memperbarui status web.', 'Gagal', 'error');
    } finally {
        if (button) {
            button.disabled = false;
        }
        await this.fetchStoreStatus({ silent: true });
    }
};

AdminApp.prototype.togglePasswordFieldVisibility = function togglePasswordFieldVisibility(button) {
    if (!button) return;
    const targetId = String(button.getAttribute('data-toggle-password') || '').trim();
    if (!targetId) return;
    const input = document.getElementById(targetId);
    if (!input) return;

    const nextType = input.type === 'password' ? 'text' : 'password';
    input.type = nextType;
    this.renderPasswordToggleButton(button, nextType === 'password');
};

AdminApp.prototype.renderPasswordToggleButton = function renderPasswordToggleButton(button, isMasked) {
    if (!button) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const appendPath = (d) => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
    };

    if (isMasked) {
        appendPath('M2.75 12s3.35-5.75 9.25-5.75S21.25 12 21.25 12 17.9 17.75 12 17.75 2.75 12 2.75 12Z');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '3.25');
        svg.appendChild(circle);
    } else {
        [
            'M3.5 3.5 20.5 20.5',
            'M10.58 6.36A10.87 10.87 0 0 1 12 6.25c5.9 0 9.25 5.75 9.25 5.75a17.1 17.1 0 0 1-3.26 3.87',
            'M14.83 14.83A3.99 3.99 0 0 1 8.99 8.99',
            'M6.33 6.33A16.72 16.72 0 0 0 2.75 12s3.35 5.75 9.25 5.75a10.8 10.8 0 0 0 4.06-.77'
        ].forEach(appendPath);
    }

    button.replaceChildren(svg);
    button.setAttribute('aria-label', isMasked ? 'Lihat password' : 'Sembunyikan password');
    button.setAttribute('aria-pressed', isMasked ? 'false' : 'true');
};

AdminApp.prototype.validateAdminPasswordChangeInput = function validateAdminPasswordChangeInput(values) {
    const currentPassword = String(values?.currentPassword || '');
    const newPassword = String(values?.newPassword || '');
    const confirmPassword = String(values?.confirmPassword || '');

    if (!currentPassword) {
        return 'Password lama wajib diisi.';
    }
    if (!newPassword) {
        return 'Password baru wajib diisi.';
    }
    if (!confirmPassword) {
        return 'Konfirmasi password baru wajib diisi.';
    }
    if (newPassword !== confirmPassword) {
        return 'Konfirmasi password baru tidak cocok.';
    }
    if (newPassword === currentPassword) {
        return 'Password baru tidak boleh sama dengan password lama.';
    }
    if (/\s/.test(newPassword)) {
        return 'Password baru tidak boleh mengandung spasi.';
    }
    if (newPassword.length < 12) {
        return 'Password baru minimal 12 karakter.';
    }
    if (!/[A-Z]/.test(newPassword)) {
        return 'Password baru wajib mengandung huruf besar.';
    }
    if (!/[a-z]/.test(newPassword)) {
        return 'Password baru wajib mengandung huruf kecil.';
    }
    if (!/[0-9]/.test(newPassword)) {
        return 'Password baru wajib mengandung angka.';
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
        return 'Password baru wajib mengandung simbol.';
    }

    return '';
};

AdminApp.prototype.resetAdminPasswordForm = function resetAdminPasswordForm() {
    const form = document.getElementById('admin-password-form');
    if (form) {
        form.reset();
    }

    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
        const targetId = String(button.getAttribute('data-toggle-password') || '').trim();
        if (!targetId) return;
        const input = document.getElementById(targetId);
        if (!input) return;
        input.type = 'password';
        this.renderPasswordToggleButton(button, true);
    });
};

AdminApp.prototype.handleChangePassword = async function handleChangePassword(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }

    const currentInput = document.getElementById('adminCurrentPassword');
    const newInput = document.getElementById('adminNewPassword');
    const confirmInput = document.getElementById('adminConfirmPassword');
    const submitButton = document.getElementById('btn-change-password');

    if (!currentInput || !newInput || !confirmInput) {
        return;
    }

    const payload = {
        current_password: String(currentInput.value || ''),
        new_password: String(newInput.value || ''),
        confirm_password: String(confirmInput.value || '')
    };
    const apiBaseUrl = this.getApiBaseUrl();
    const logger = this.getAppLogger();
    const modal = this.getModalApi();

    const validationMessage = this.validateAdminPasswordChangeInput({
        currentPassword: payload.current_password,
        newPassword: payload.new_password,
        confirmPassword: payload.confirm_password
    });
    if (validationMessage) {
        await modal.alert(validationMessage, 'Validasi Password', 'warning');
        return;
    }

    const confirmed = await modal.confirm(
        'Yakin ingin mengganti password admin sekarang? Semua sesi login aktif akan langsung diakhiri dan Anda harus login ulang.',
        'Konfirmasi Ganti Password',
        'warning'
    );
    if (!confirmed) return;

    try {
        if (submitButton) {
            submitButton.disabled = true;
        }
        await this.withGlobalLoading(async () => {
        const response = await fetch(`${apiBaseUrl}/api/admin/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });

        if (await this.handleApiError(response)) return;

        const responseBody = await this.parseJsonSafe(response);
        if (!response.ok || !responseBody?.success) {
            this.showAdminError(responseBody, 'Gagal mengubah password admin.');
            return;
        }

        this.resetAdminPasswordForm();
        await modal.alert(
            responseBody?.message || 'Password berhasil diubah. Silakan login ulang.',
            'Berhasil',
            'success'
        );
        await this.logout({ skipServer: true });
        }, { message: 'Menyimpan password baru...' });
    } catch (error) {
        logger.error('Gagal mengganti password admin', error);
        await modal.alert('Terjadi kesalahan saat mengganti password admin.', 'Gagal', 'error');
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
};
