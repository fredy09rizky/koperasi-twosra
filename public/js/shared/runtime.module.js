export const createFallbackLogger = () => ({
    error: () => {},
    warn: () => {},
    info: () => {}
});

export const createFallbackFormatRupiah = () => (value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? parsed : 0;
    return `Rp${new Intl.NumberFormat('id-ID').format(safe)}`;
};

export const createFallbackEscapeHtml = () => (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const resolveFrontendRuntime = (root = window) => {
    const safeRoot = root && typeof root === 'object' ? root : window;
    const apiUrlValue = typeof safeRoot.WORKER_API_URL === 'string'
        ? safeRoot.WORKER_API_URL.trim()
        : '';
    const logger = safeRoot.appLogger && typeof safeRoot.appLogger.error === 'function'
        ? safeRoot.appLogger
        : createFallbackLogger();

    return {
        apiUrl: apiUrlValue || safeRoot.location?.origin || window.location.origin,
        formatRupiah: typeof safeRoot.formatRupiah === 'function'
            ? safeRoot.formatRupiah
            : createFallbackFormatRupiah(),
        escapeHtml: typeof safeRoot.escapeHtml === 'function'
            ? safeRoot.escapeHtml
            : createFallbackEscapeHtml(),
        logger
    };
};
