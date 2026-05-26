export const UIModal = {
    init: function() {
        if (document.getElementById('ui-modal-container')) return;
        const container = document.createElement('div');
        container.id = 'ui-modal-container';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'true');
        document.body.appendChild(container);
    },

    _createContent: function(title, message, type, isConfirm = false) {
        const labelId = `ui-modal-label-${Date.now()}`;
        const fragment = document.createDocumentFragment();

        const overlay = document.createElement('div');
        overlay.className = 'ui-modal-overlay';

        const content = document.createElement('div');
        content.className = 'ui-modal-content';
        content.setAttribute('role', 'document');
        content.setAttribute('aria-labelledby', labelId);

        const icon = document.createElement('div');
        const iconType = ['success', 'error', 'warning'].includes(type) ? type : 'info';
        icon.className = `ui-modal-icon ${iconType}`;
        icon.setAttribute('aria-hidden', 'true');
        if (type === 'success') {
            icon.textContent = '✓';
        } else if (type === 'error') {
            icon.textContent = 'x';
        } else if (type === 'warning') {
            icon.textContent = '!';
        } else {
            icon.textContent = 'i';
        }

        const textWrap = document.createElement('div');
        textWrap.className = 'ui-modal-text';
        if (title) {
            const titleEl = document.createElement('h3');
            titleEl.className = 'ui-modal-title';
            titleEl.id = labelId;
            titleEl.textContent = String(title);
            textWrap.appendChild(titleEl);
        }

        const messageEl = document.createElement('p');
        messageEl.className = 'ui-modal-message';
        messageEl.textContent = String(message ?? '');
        textWrap.appendChild(messageEl);

        const actions = document.createElement('div');
        actions.className = 'ui-modal-actions';
        if (isConfirm) {
            const cancelButton = document.createElement('button');
            cancelButton.className = 'btn btn-secondary';
            cancelButton.id = 'ui-modal-btn-cancel';
            cancelButton.textContent = 'Batal';
            actions.appendChild(cancelButton);
        }

        const confirmButton = document.createElement('button');
        confirmButton.className = 'btn btn-primary';
        confirmButton.id = 'ui-modal-btn-confirm';
        confirmButton.textContent = isConfirm ? 'Ya, Lanjutkan' : 'OK';
        actions.appendChild(confirmButton);

        content.appendChild(icon);
        content.appendChild(textWrap);
        content.appendChild(actions);
        fragment.appendChild(overlay);
        fragment.appendChild(content);

        return fragment;
    },

    /**
     * Pasang focus trap di dalam modal agar keyboard tidak keluar dari dialog.
     * Ini diperlukan untuk aksesibilitas (WCAG 2.1 SC 2.4.3).
     */
    _setupFocusTrap: function(container) {
        const focusableSelectors = [
            'button:not([disabled])', '[href]', 'input:not([disabled])',
            'select:not([disabled])', 'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', ');

        const handleKeydown = (e) => {
            if (e.key !== 'Tab') return;
            const focusable = Array.from(container.querySelectorAll(focusableSelectors));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        container.addEventListener('keydown', handleKeydown);
        return () => container.removeEventListener('keydown', handleKeydown);
    },

    _restoreFocus: function(previouslyFocusedElement) {
        if (!(previouslyFocusedElement instanceof HTMLElement)) return;
        if (!previouslyFocusedElement.isConnected) return;
        previouslyFocusedElement.focus();
    },

    alert: function(message, title = 'Informasi', type = 'info') {
        return new Promise((resolve) => {
            this.init();
            const container = document.getElementById('ui-modal-container');
            const previouslyFocusedElement = document.activeElement;
            container.setAttribute('aria-label', title || 'Informasi');
            container.replaceChildren(this._createContent(title, message, type, false));

            requestAnimationFrame(() => {
                container.classList.add('active');
            });

            const btnConfirm = document.getElementById('ui-modal-btn-confirm');
            btnConfirm.focus();

            const cleanupTrap = this._setupFocusTrap(container);

            const close = () => {
                cleanupTrap();
                escHandler && document.removeEventListener('keydown', escHandler);
                container.classList.remove('active');
                setTimeout(() => {
                    container.replaceChildren();
                    this._restoreFocus(previouslyFocusedElement);
                    resolve(true);
                }, 300);
            };

            const escHandler = (e) => {
                if (e.key === 'Escape') close();
            };
            document.addEventListener('keydown', escHandler);

            btnConfirm.onclick = close;
        });
    },

    confirm: function(message, title = 'Konfirmasi', type = 'warning') {
        return new Promise((resolve) => {
            this.init();
            const container = document.getElementById('ui-modal-container');
            const previouslyFocusedElement = document.activeElement;
            container.setAttribute('aria-label', title || 'Konfirmasi');
            container.replaceChildren(this._createContent(title, message, type, true));

            requestAnimationFrame(() => {
                container.classList.add('active');
            });

            const btnConfirm = document.getElementById('ui-modal-btn-confirm');
            const btnCancel = document.getElementById('ui-modal-btn-cancel');
            btnCancel.focus();

            const cleanupTrap = this._setupFocusTrap(container);

            const close = (result) => {
                cleanupTrap();
                escHandler && document.removeEventListener('keydown', escHandler);
                container.classList.remove('active');
                setTimeout(() => {
                    container.replaceChildren();
                    this._restoreFocus(previouslyFocusedElement);
                    resolve(result);
                }, 300);
            };

            const escHandler = (e) => {
                if (e.key === 'Escape') close(false);
            };
            document.addEventListener('keydown', escHandler);

            btnConfirm.onclick = () => close(true);
            btnCancel.onclick = () => close(false);
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    UIModal.init();
});
