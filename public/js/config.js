import { appLogger } from './logger.js';

/**
 * Konfigurasi Aplikasi Frontend Koperasi TWOSRA
 */

// API URL - otomatis mengikuti origin yang sama
const WORKER_API_URL = window.location.origin;

// CDN Library URLs dengan Subresource Integrity (SRI) hashes
// Hashes ini memastikan file yang dimuat tidak dimanipulasi oleh pihak ketiga.
const CDN_SCRIPTS = {
    chart: {
        url: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
        integrity: 'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ',
        crossorigin: 'anonymous'
    },
    qrcode: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
        integrity: 'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU',
        crossorigin: 'anonymous'
    },
    html2pdf: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
        integrity: 'sha384-Yv5O+t3uE3hunW8uyrbpPW3iw6/5/Y7HitWJBLgqfMoA36NogMmy+8wWZMpn3HWc',
        crossorigin: 'anonymous'
    },
    jspdf: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js',
        integrity: 'sha384-GwHhSt8QjC7J+v0zZ0Flfho/T76YHEcCL9w4rvjTIUHauh6gWJeBSIi3vWXxNhtA',
        crossorigin: 'anonymous'
    },
    jspdfAutotable: {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js',
        integrity: 'sha384-UFvZBDnJ4PAYKb7VYwq105qNLT/F1oZzrmAmuOH2bBML35uj8CsDA2gZNKfdXIbD',
        crossorigin: 'anonymous'
    }
};

const IMAGE_OPTIMIZE_ENDPOINT = '/api/image-optimize';

// Format Rupiah (IDR)
const formatRupiah = (number) => {
    const parsedNumber = Number(number);
    const safeNumber = Number.isFinite(parsedNumber) ? parsedNumber : 0;
    const absoluteNumber = Math.abs(safeNumber);
    const hasFraction = Math.round(absoluteNumber) !== absoluteNumber;
    const formattedNumber = new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: hasFraction ? 2 : 0,
        maximumFractionDigits: hasFraction ? 2 : 0
    }).format(absoluteNumber);

    return `${safeNumber < 0 ? '-' : ''}Rp${formattedNumber}`;
};

// Konversi aman ke number (fallback 0)
const toSafeNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
};

// Format tanggal ke format Indonesia (WIB)
const formatTanggalIndonesia = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const normalizeUtcTimestamp = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const normalized = raw.replace(' ', 'T');
    const hasTimezone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized);
    return hasTimezone ? normalized : `${normalized}Z`;
};

const formatWibDateTime = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '-';
    if (/\bWIB\b/i.test(raw)) return raw;

    const date = new Date(normalizeUtcTimestamp(raw));
    if (Number.isNaN(date.getTime())) return raw;

    const datePart = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(date);
    const timePart = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(date).replace(/\./g, ':');

    return `${datePart} ${timePart} WIB`;
};

// Escape karakter HTML untuk mencegah injeksi script saat render string dinamis
const escapeHtml = (value) => {
    const raw = String(value ?? '');
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Sanitasi URL gambar agar hanya protokol aman atau path lokal
const sanitizeImageUrl = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    // Izinkan path lokal website ini
    if (raw.startsWith('/')) {
        return raw;
    }

    try {
        const parsed = new URL(raw, window.location.origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
    } catch (error) {
        return '';
    }

    return '';
};

const clampInt = (value, min, max, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const normalized = Math.trunc(parsed);
    return Math.min(max, Math.max(min, normalized));
};

const resolveImageFit = (value, fallback = 'cover') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'contain' || normalized === 'cover' || normalized === 'scale-down') {
        return normalized;
    }
    return fallback;
};

const optimizeImageUrl = (value, options = {}) => {
    const safeImageUrl = sanitizeImageUrl(value);
    if (!safeImageUrl) return '';

    try {
        const sourceUrl = new URL(safeImageUrl, window.location.origin);
        if (sourceUrl.origin === window.location.origin && sourceUrl.pathname === IMAGE_OPTIMIZE_ENDPOINT) {
            return sourceUrl.toString();
        }
        const optimizeUrl = new URL(IMAGE_OPTIMIZE_ENDPOINT, window.location.origin);
        optimizeUrl.searchParams.set('url', sourceUrl.toString());
        optimizeUrl.searchParams.set('w', String(clampInt(options.width, 64, 2000, 720)));
        optimizeUrl.searchParams.set('h', String(clampInt(options.height, 64, 2000, 480)));
        optimizeUrl.searchParams.set('q', String(clampInt(options.quality, 35, 90, 72)));
        optimizeUrl.searchParams.set('fit', resolveImageFit(options.fit, 'cover'));
        return optimizeUrl.toString();
    } catch (_error) {
        return safeImageUrl;
    }
};

const scriptLoadRegistry = new Map();

/**
 * Memuat script eksternal dengan Subresource Integrity (SRI) verification.
 * Mencegah eksekusi script yang dimanipulasi oleh pihak ketiga.
 */
const loadScriptOnce = (src, options = {}) => {
    const safeSrc = String(src || '').trim();
    if (!safeSrc) {
        return Promise.reject(new Error('Script source is required'));
    }

    if (scriptLoadRegistry.has(safeSrc)) {
        return scriptLoadRegistry.get(safeSrc);
    }

    // Cek apakah script sudah ada di DOM
    const existingScript = document.querySelector(`script[src="${safeSrc}"]`);
    if (existingScript) {
        const existingPromise = Promise.resolve(existingScript);
        scriptLoadRegistry.set(safeSrc, existingPromise);
        return existingPromise;
    }

    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = safeSrc;
        script.async = true;

        // Tambahkan SRI integrity jika tersedia
        const integrity = options.integrity || '';
        if (integrity) {
            script.integrity = integrity;
        }

        // Tambahkan crossorigin jika tersedia
        const crossorigin = options.crossorigin || 'anonymous';
        if (crossorigin) {
            script.crossOrigin = crossorigin;
        }

        script.onload = () => resolve(script);
        script.onerror = () => {
            scriptLoadRegistry.delete(safeSrc);
            const errorMsg = integrity
                ? `Gagal memuat script atau integrity check gagal: ${safeSrc}`
                : `Gagal memuat script: ${safeSrc}`;
            reject(new Error(errorMsg));
        };
        document.head.appendChild(script);
    });

    scriptLoadRegistry.set(safeSrc, promise);
    return promise;
};

/**
 * Helper untuk membuat elemen DOM dengan aman.
 * Mengurangi risiko XSS dari data dinamis.
 *
 * Usage:
 *   const el = createSafeElement('div', { className: 'card', textContent: 'Hello' });
 *   const el2 = createSafeElement('img', { src: '/path.jpg', alt: 'Image' });
 *
 *   → Gunakan hanya jika value sudah pasti aman; JANGAN teruskan input user langsung.
 */
const createSafeElement = (tag, attributes = {}, children = []) => {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'textContent') {
            el.textContent = value;
        } else if (key.startsWith('data-')) {
            el.setAttribute(key, String(value));
        } else if (key in el) {
            el[key] = value;
        } else {
            el.setAttribute(key, value);
        }
    }

    // Tambahkan child nodes (bisa string atau elemen)
    children.forEach(child => {
        if (typeof child === 'string') {
            el.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            el.appendChild(child);
        }
    });

    return el;
};

const ensureQrCodeLibrary = async () => {
    if (typeof window.QRCode === 'function') {
        return window.QRCode;
    }

    const config = CDN_SCRIPTS.qrcode;
    await loadScriptOnce(config.url, {
        integrity: config.integrity,
        crossorigin: config.crossorigin
    });
    if (typeof window.QRCode !== 'function') {
        throw new Error('Library QR Code gagal dimuat.');
    }
    return window.QRCode;
};

const ensureHtml2PdfLibrary = async () => {
    if (typeof window.html2pdf === 'function') {
        return window.html2pdf;
    }

    const config = CDN_SCRIPTS.html2pdf;
    await loadScriptOnce(config.url, {
        integrity: config.integrity,
        crossorigin: config.crossorigin
    });
    if (typeof window.html2pdf !== 'function') {
        throw new Error('Library HTML2PDF gagal dimuat.');
    }
    return window.html2pdf;
};

const ensureChartLibrary = async () => {
    if (typeof window.Chart === 'function') {
        return window.Chart;
    }

    const config = CDN_SCRIPTS.chart;
    await loadScriptOnce(config.url, {
        integrity: config.integrity,
        crossorigin: config.crossorigin
    });

    if (typeof window.Chart !== 'function') {
        throw new Error('Library Chart.js gagal dimuat.');
    }

    return window.Chart;
};

const ensureJsPdfLibraries = async () => {
    const jspdfConfig = CDN_SCRIPTS.jspdf;
    const autotableConfig = CDN_SCRIPTS.jspdfAutotable;

    await loadScriptOnce(jspdfConfig.url, {
        integrity: jspdfConfig.integrity,
        crossorigin: jspdfConfig.crossorigin
    });

    await loadScriptOnce(autotableConfig.url, {
        integrity: autotableConfig.integrity,
        crossorigin: autotableConfig.crossorigin
    });

    const jsPDF = window.jspdf && typeof window.jspdf.jsPDF === 'function'
        ? window.jspdf.jsPDF
        : null;
    if (!jsPDF) {
        throw new Error('Library jsPDF gagal dimuat.');
    }

    const autoTable = typeof window.jspdf?.jsPDF?.API?.autoTable === 'function'
        ? window.jspdf.jsPDF.API.autoTable
        : (typeof window.jspdfAutoTable === 'function' ? window.jspdfAutoTable : null);

    return { jsPDF, autoTable };
};

const playManagedAudio = async (audioId, volume = 1) => {
    const audio = document.getElementById(audioId);
    if (!audio) return false;

    const audioSrc = audio.dataset?.src || '';
    if (!audio.getAttribute('src') && audioSrc) {
        audio.setAttribute('src', audioSrc);
        audio.load();
    }

    audio.volume = volume;
    try {
        await audio.play();
        return true;
    } catch (error) {
        appLogger.warn('Auto-play diredam browser');
        return false;
    }
};

export {
    WORKER_API_URL,
    CDN_SCRIPTS,
    IMAGE_OPTIMIZE_ENDPOINT,
    formatRupiah,
    toSafeNumber,
    formatTanggalIndonesia,
    formatWibDateTime,
    escapeHtml,
    sanitizeImageUrl,
    optimizeImageUrl,
    loadScriptOnce,
    ensureQrCodeLibrary,
    ensureHtml2PdfLibrary,
    ensureChartLibrary,
    ensureJsPdfLibraries,
    createSafeElement,
    playManagedAudio
};
