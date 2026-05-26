// Logger frontend terpusat agar format log konsisten lintas file.
const LOG_LEVEL_PRIORITY = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

const resolveLogLevel = (globalScope = window) => {
    const hostname = String(globalScope?.location?.hostname || '').toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'debug';
    return 'warn';
};

const toConsoleMethod = (level) => {
    if (level === 'debug') return 'debug';
    if (level === 'info') return 'info';
    if (level === 'warn') return 'warn';
    return 'error';
};

const emit = (currentLevel, level, message, context) => {
    if ((LOG_LEVEL_PRIORITY[level] || 999) < (LOG_LEVEL_PRIORITY[currentLevel] || 999)) return;
    const method = toConsoleMethod(level);
    const safeMessage = String(message || '');
    const prefix = `[frontend:${level}]`;
    if (typeof context === 'undefined') {
        console[method](`${prefix} ${safeMessage}`);
        return;
    }
    console[method](`${prefix} ${safeMessage}`, context);
};

const currentLevel = resolveLogLevel();

export const appLogger = {
    debug(message, context) {
        emit(currentLevel, 'debug', message, context);
    },
    info(message, context) {
        emit(currentLevel, 'info', message, context);
    },
    warn(message, context) {
        emit(currentLevel, 'warn', message, context);
    },
    error(message, context) {
        emit(currentLevel, 'error', message, context);
    }
};
