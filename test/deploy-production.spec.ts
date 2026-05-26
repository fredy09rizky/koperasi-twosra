// @vitest-environment node

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateWranglerWhoami, resolveWranglerInvocation } from '../scripts/deploy-production.helpers.mjs';

describe('deploy production script', () => {
	it('prefers the local Wrangler CLI entrypoint over nested npx invocation', () => {
		const rootDir = 'C:/repo';
		const expectedCliPath = join(rootDir, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');

		const invocation = resolveWranglerInvocation(rootDir, (filePath) => filePath === expectedCliPath);

		expect(invocation.binary).toBe(process.execPath);
		expect(invocation.prefixArgs).toEqual([expectedCliPath]);
		expect(invocation.mode).toBe('direct-node-cli');
	});

	it('treats explicit whoami loggedIn=false JSON as unauthenticated', () => {
		const result = evaluateWranglerWhoami({
			success: false,
			status: 1,
			output: '{"loggedIn":false}',
			stderr: '',
			error: '',
		});

		expect(result).toEqual({
			ok: false,
			kind: 'unauthenticated',
			detail: '',
		});
	});

	it('surfaces unexpected Wrangler process failures instead of mislabeling them as login errors', () => {
		const result = evaluateWranglerWhoami({
			success: false,
			status: 1,
			output: '',
			stderr: 'Error: spawn EPERM',
			error: '',
		});

		expect(result.ok).toBe(false);
		expect(result.kind).toBe('error');
		expect(result.detail).toContain('spawn EPERM');
	});
});
