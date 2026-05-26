export type JsonFetchResult = {
	response: Response;
	data: unknown;
	rawText: string;
	parseError: boolean;
};

export async function fetchJsonWithTimeout(
	url: string,
	init: RequestInit = {},
	timeoutMs = 10_000
): Promise<JsonFetchResult> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...init,
			signal: controller.signal
		});
		const rawText = await response.text();
		if (!rawText) {
			return {
				response,
				data: null,
				rawText,
				parseError: false
			};
		}

		try {
			return {
				response,
				data: JSON.parse(rawText),
				rawText,
				parseError: false
			};
		} catch {
			return {
				response,
				data: null,
				rawText,
				parseError: true
			};
		}
	} finally {
		clearTimeout(timeout);
	}
}
