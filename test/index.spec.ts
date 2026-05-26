import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetTestDatabase } from './helpers.js';

describe('Koperasi Backend API', () => {
	beforeEach(async () => {
		await resetTestDatabase();
	});

	describe('Health Check', () => {
		it('GET / returns server status', async () => {
			const request = new Request('http://example.com/');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type') || '').toContain('text/html');
			expect(await response.text()).toContain('<!DOCTYPE html>');
		});

		it('GET /api/health returns detailed health with DB and storage status', async () => {
			const request = new Request('http://example.com/api/health');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const data = await response.json<any>();
			expect(data.status).toBe('healthy');
			expect(data.checks).toHaveProperty('api');
			expect(data.checks).toHaveProperty('database');
			expect(data.checks).toHaveProperty('storage');
			expect(data.checks.api.status).toBe('ok');
			expect(data.checks.database.status).toBe('ok');
			// Storage sekarang dibedakan antara "binding ada" vs "benar-benar diprobe".
			expect(['binding_present', 'not_configured']).toContain(data.checks.storage.status);
		});

		it('GET /api/health includes ISO timestamp', async () => {
			const request = new Request('http://example.com/api/health');
			const response = await SELF.fetch(request);
			const data = await response.json<any>();
			expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		});

		it('GET /api/health does not expose raw internal error fields on healthy response', async () => {
			const request = new Request('http://example.com/api/health');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const data = await response.json<any>();
			expect(data.error).toBeUndefined();
			expect(data?.checks?.database?.details).toBeUndefined();
		});
	});

	describe('Products API', () => {
		it('GET /api/products returns products list', async () => {
			const request = new Request('http://example.com/api/products');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toHaveProperty('success');
			expect(data).toHaveProperty('data');
		});

		it('GET /api/image-optimize accepts small image response without content-length', async () => {
			const originalFetch = globalThis.fetch;
			vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

				if (url.startsWith('https://images.pexels.com/')) {
					expect(init?.redirect).toBe('manual');
					return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
						status: 200,
						headers: { 'Content-Type': 'image/png' }
					});
				}

				return originalFetch(input, init);
			}) as typeof fetch);

			try {
				const request = new Request('http://example.com/api/image-optimize?url=https%3A%2F%2Fimages.pexels.com%2Fsmall.png&w=128&h=128&q=70');
				const response = await SELF.fetch(request);
				expect(response.status).toBe(200);
				expect(response.headers.get('x-image-optimized')).toBe('1');
				expect(response.headers.get('content-length')).toBeNull();
				expect(await response.arrayBuffer()).toHaveProperty('byteLength', 4);
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('GET /api/image-optimize rejects oversized image response without content-length', async () => {
			const originalFetch = globalThis.fetch;
			vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url;

				if (url.startsWith('https://images.pexels.com/')) {
					return new Response(new Uint8Array((5 * 1024 * 1024) + 1), {
						status: 200,
						headers: { 'Content-Type': 'image/png' }
					});
				}

				return originalFetch(input, init);
			}) as typeof fetch);

			try {
				const request = new Request('http://example.com/api/image-optimize?url=https%3A%2F%2Fimages.pexels.com%2Fhuge.png');
				const response = await SELF.fetch(request);
				expect(response.status).toBe(413);
				expect(await response.text()).toContain('Ukuran gambar sumber melebihi batas aman');
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});

});
