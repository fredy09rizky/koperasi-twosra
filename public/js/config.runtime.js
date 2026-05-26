import { appLogger } from './logger.js';

/**
 * Runtime helpers dipisah dari config.js agar util core tetap ringan.
 * File ini memegang helper UI runtime + localStorage.
 */

// Global loading overlay (mendukung nested loading)
let loadingCounter = 0;
const showGlobalLoading = (message = 'Memuat...') => {
    const overlay = document.getElementById('global-loading');
    if (!overlay) return;
    const label = overlay.querySelector('[data-loading-text]');
    if (label) label.textContent = message;
    loadingCounter += 1;
    overlay.classList.add('active');
};

const hideGlobalLoading = () => {
    const overlay = document.getElementById('global-loading');
    if (!overlay) return;
    loadingCounter = Math.max(loadingCounter - 1, 0);
    if (loadingCounter === 0) {
        overlay.classList.remove('active');
    }
};

/**
 * Paksa tutup loading overlay apapun nilai counter-nya.
 * Digunakan saat flow sudah selesai tapi counter tidak seimbang.
 */
const forceHideGlobalLoading = () => {
    const overlay = document.getElementById('global-loading');
    if (!overlay) return;
    loadingCounter = 0;
    overlay.classList.remove('active');
};

// Debounce function untuk search
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

const getRuntimeLogger = () => {
    return appLogger;
};

// Local storage helper
const storage = {
    get: (key) => {
        const logger = getRuntimeLogger();
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (error) {
            logger.error('Error reading from localStorage', error);
            return null;
        }
    },
    set: (key, value) => {
        const logger = getRuntimeLogger();
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            logger.error('Error writing to localStorage', error);
            return false;
        }
    },
    remove: (key) => {
        const logger = getRuntimeLogger();
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            logger.error('Error removing from localStorage', error);
            return false;
        }
    }
};

export {
    debounce,
    storage,
    showGlobalLoading,
    hideGlobalLoading,
    forceHideGlobalLoading
};
