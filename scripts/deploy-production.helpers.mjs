import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveWranglerInvocation(baseDir, fileExists = existsSync) {
  const localCliPath = join(baseDir, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
  if (fileExists(localCliPath)) {
    return {
      binary: process.execPath,
      prefixArgs: [localCliPath],
      mode: 'direct-node-cli',
    };
  }

  return {
    binary: 'npx',
    prefixArgs: ['wrangler'],
    mode: 'npx-fallback',
  };
}

export function resolveNpmInvocation(env = process.env, fileExists = existsSync) {
  const npmCliPath = typeof env.npm_execpath === 'string' ? env.npm_execpath.trim() : '';
  if (npmCliPath && fileExists(npmCliPath)) {
    return {
      binary: process.execPath,
      prefixArgs: [npmCliPath],
      mode: 'direct-node-cli',
    };
  }

  // Fallback ke npm-cli.js bundled dengan instalasi Node aktif.
  // Dipakai saat script dijalankan langsung (`node scripts/...`), bukan via `npm run`,
  // sehingga env.npm_execpath tidak terisi.
  if (typeof process !== 'undefined' && typeof process.execPath === 'string') {
    const nodeDir = process.execPath.replace(/[\\/]node(?:\.exe)?$/i, '');
    const bundledNpmCli = `${nodeDir}/node_modules/npm/bin/npm-cli.js`;
    if (fileExists(bundledNpmCli)) {
      return {
        binary: process.execPath,
        prefixArgs: [bundledNpmCli],
        mode: 'direct-node-cli',
      };
    }
  }

  return {
    binary: 'npm',
    prefixArgs: [],
    mode: 'binary-fallback',
  };
}

export function parseJsonOutput(text, fallback = []) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function evaluateWranglerWhoami(result) {
  const parsed = parseJsonOutput(result.output || '', null);
  if (parsed && typeof parsed === 'object' && 'loggedIn' in parsed) {
    return parsed.loggedIn === false
      ? { ok: false, kind: 'unauthenticated', detail: '' }
      : { ok: true, kind: 'authenticated', detail: '' };
  }

  const combinedOutput = `${result.output || ''}\n${result.stderr || ''}\n${result.error || ''}`.trim();
  if (result.success) {
    return { ok: true, kind: 'authenticated', detail: combinedOutput };
  }

  if (/not authenticated/i.test(combinedOutput)) {
    return { ok: false, kind: 'unauthenticated', detail: '' };
  }

  return {
    ok: false,
    kind: 'error',
    detail: combinedOutput || `Wrangler exited with status ${result.status ?? 'unknown'}.`,
  };
}
