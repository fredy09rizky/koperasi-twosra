export function isPrivateIpv4Hostname(hostname: string): boolean {
	const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!match) return false;
	const a = Number(match[1]);
	const b = Number(match[2]);
	if (a === 0) return true;
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	return false;
}

export function isBlockedHostname(hostnameRaw: string): boolean {
	const hostname = String(hostnameRaw || '').trim().toLowerCase();
	if (!hostname) return true;
	if (hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local')) return true;
	return isPrivateIpv4Hostname(hostname);
}

export function isHostnameAllowed(hostnameRaw: string, allowedDomains: string[]): boolean {
	const hostname = String(hostnameRaw || '').trim().toLowerCase();
	if (!hostname) return false;
	return allowedDomains.some((rule) => {
		const normalizedRule = String(rule || '').trim().toLowerCase();
		if (!normalizedRule) return false;
		if (normalizedRule.startsWith('*.')) {
			const base = normalizedRule.slice(2);
			if (!base) return false;
			return hostname === base || hostname.endsWith(`.${base}`);
		}
		return hostname === normalizedRule;
	});
}
