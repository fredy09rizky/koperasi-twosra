import { sanitizeLogValue } from './log.js';

export function getClientIp(headers: Headers): string {
	const cfIp = headers.get('cf-connecting-ip')?.trim();
	if (cfIp) return cfIp;

	const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
	if (forwardedFor) return forwardedFor;

	const realIp = headers.get('x-real-ip')?.trim();
	if (realIp) return realIp;

	return 'local-dev';
}

export function summarizeUserAgent(headers: Headers): string {
	// Cukup ringkas untuk log Telegram, tanpa perlu mengirim parser UA yang berat.
	const rawUserAgent = headers.get('user-agent')?.trim();
	if (!rawUserAgent) return 'Unknown Device';

	const userAgent = rawUserAgent.toLowerCase();

	let browser = 'Unknown Browser';
	if (userAgent.includes('edg/')) browser = 'Edge';
	else if (userAgent.includes('chrome/') && !userAgent.includes('edg/')) browser = 'Chrome';
	else if (userAgent.includes('firefox/')) browser = 'Firefox';
	else if (userAgent.includes('safari/') && !userAgent.includes('chrome/')) browser = 'Safari';
	else if (userAgent.includes('opr/') || userAgent.includes('opera/')) browser = 'Opera';

	let device = 'Unknown Device';
	if (userAgent.includes('android')) device = 'Android';
	else if (userAgent.includes('iphone')) device = 'iPhone';
	else if (userAgent.includes('ipad')) device = 'iPad';
	else if (userAgent.includes('windows')) device = 'Windows';
	else if (userAgent.includes('mac os x') || userAgent.includes('macintosh')) device = 'macOS';
	else if (userAgent.includes('linux')) device = 'Linux';

	return `${browser} / ${device}`;
}

export function getRequestMetaLines(headers: Headers): string[] {
	const rawUserAgent = sanitizeLogValue(headers.get('user-agent') || '-', 180);
	return [
		`IP: ${getClientIp(headers)}`,
		`Device: ${summarizeUserAgent(headers)}`,
		`User-Agent: ${rawUserAgent || '-'}`
	];
}
