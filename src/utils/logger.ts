// Structured logger utility.

import { sanitizeLogValue } from './log.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AppEnvironment = 'development' | 'production';

export function normalizeEnvironment(value: unknown, fallback: AppEnvironment = 'development'): AppEnvironment {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'production') return 'production';
	if (normalized === 'development') return 'development';
	return fallback;
}

export function resolveEnvironmentMode(env: { ENVIRONMENT?: unknown }): AppEnvironment {
	return normalizeEnvironment(env?.ENVIRONMENT);
}

interface LoggerOptions {
	service: string;
	environment: AppEnvironment;
	defaultContext?: Record<string, any>;
}

interface LogEntry {
	level: LogLevel;
	timestamp: string;
	service: string;
	environment: AppEnvironment;
	message: string;
	requestId?: string;
	[key: string]: any;
}

const COLORS = {
	reset: '\x1b[0m',
	debug: '\x1b[36m',
	info: '\x1b[32m',
	warn: '\x1b[33m',
	error: '\x1b[31m',
};

function formatDevLog(entry: LogEntry): string {
	const color = COLORS[entry.level] || COLORS.reset;
	const levelLabel = entry.level.toUpperCase().padEnd(5);
	const contextStr = entry.defaultContext ? `\n  Context: ${JSON.stringify(entry.defaultContext, null, 2)}` : '';
	const dataStr = entry.data ? `\n  Data: ${JSON.stringify(entry.data, null, 2)}` : '';
	
	return `${color}[${entry.timestamp}]${COLORS.reset} ${color}${levelLabel}${COLORS.reset} ${entry.service} (${entry.environment})\n  Message: ${entry.message}${contextStr}${dataStr}`;
}

/**
 * Buat logger terstruktur dengan context otomatis.
 * 
 * Development: output berwarna dan readable di terminal.
 * Production: satu baris JSON (mudah di-parse Cloudflare dashboard).
 */
export function createLogger(options: LoggerOptions) {
	const { service, environment, defaultContext = {} } = options;

	function log(level: LogLevel, message: string, data?: Record<string, any>): void {
		const entry: LogEntry = {
			level,
			timestamp: new Date().toISOString(),
			service,
			environment,
			message,
			...Object.keys(defaultContext).length > 0 && { defaultContext },
			...(data && Object.keys(data).length > 0 && { data }),
		};

		if (environment === 'development') {
			const formatted = formatDevLog(entry);
			
			if (level === 'error') {
				console.error(formatted);
			} else if (level === 'warn') {
				console.warn(formatted);
			} else {
				console.log(formatted);
			}
		} else {
			if (level === 'debug') return;
			console.log(JSON.stringify(entry));
		}
	}

	return {
		info(message: string, data?: Record<string, any>): void {
			log('info', message, data);
		},

		warn(message: string, data?: Record<string, any>): void {
			log('warn', message, data);
		},

		error(message: string, data?: Record<string, any>): void {
			log('error', message, data);
		},

		debug(message: string, data?: Record<string, any>): void {
			log('debug', message, data);
		},

		sanitize(value: unknown, maxLength = 200): string {
			return sanitizeLogValue(value, maxLength);
		},
	};
}

export function getGlobalLogger(environment?: unknown) {
	return createLogger({
		service: 'koperasi-backend',
		environment: normalizeEnvironment(environment),
	});
}
