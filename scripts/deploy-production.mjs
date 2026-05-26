/**
 * Routine production deploy for Koperasi TWOSRA.
 *
 * Default flow is intentionally non-destructive:
 * 1. Verify Wrangler login and configured Cloudflare resources.
 * 2. Run local regression gates.
 * 3. Deploy the Worker.
 *
 * This script does not upload secrets, reset D1 schema, or run seed.sql.
 * Production provisioning is a separate one-time/manual operation.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  evaluateWranglerWhoami,
  parseJsonOutput,
  resolveNpmInvocation,
  resolveWranglerInvocation,
} from './deploy-production.helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function color(message, name = 'reset') {
  return `${COLORS[name] || COLORS.reset}${message}${COLORS.reset}`;
}

function log(message = '', colorName = 'reset') {
  console.log(color(message, colorName));
}

function logStep(message) {
  log(`\n${'-'.repeat(72)}`, 'cyan');
  log(`  ${message}`, 'cyan');
  log('-'.repeat(72), 'cyan');
}

function logSuccess(message) {
  log(`  OK  ${message}`, 'green');
}

function logWarn(message) {
  log(`  WARN  ${message}`, 'yellow');
}

function logError(message) {
  log(`  ERROR  ${message}`, 'red');
}

function commandName(binary) {
  if (/[/\\]/.test(binary) || /\.(cmd|exe|bat)$/i.test(binary)) {
    return binary;
  }
  return process.platform === 'win32' ? `${binary}.cmd` : binary;
}

function runCommand(binary, args = [], options = {}) {
  const resolvedBinary = commandName(binary);
  // Sejak Node 18.20.2/20.12.2/21.7.3+, spawnSync di Windows menolak menjalankan
  // .bat/.cmd tanpa shell: true (CVE-2024-27980). Argumen di script ini semuanya
  // literal/hardcoded, sehingga shell: true aman dari command injection.
  const needsWindowsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedBinary);
  const result = spawnSync(resolvedBinary, args, {
    cwd: options.cwd || rootDir,
    encoding: 'utf-8',
    stdio: options.silent ? 'pipe' : 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: needsWindowsShell,
  });

  return {
    success: result.status === 0,
    status: result.status,
    output: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message || '',
  };
}

const wranglerInvocation = resolveWranglerInvocation(rootDir);

function runWrangler(args = [], options = {}) {
  return runCommand(wranglerInvocation.binary, [...wranglerInvocation.prefixArgs, ...args], options);
}

const npmInvocation = resolveNpmInvocation(process.env);

function runNpm(args = [], options = {}) {
  return runCommand(npmInvocation.binary, [...npmInvocation.prefixArgs, ...args], options);
}

async function askQuestion(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${color(question, 'yellow')} (y/N) `, (answer) => {
      rl.close();
      resolve(String(answer || '').trim().toLowerCase() === 'y');
    });
  });
}

function readWranglerConfig() {
  const wranglerPath = join(rootDir, 'wrangler.jsonc');
  if (!existsSync(wranglerPath)) {
    throw new Error('wrangler.jsonc tidak ditemukan.');
  }

  const text = readFileSync(wranglerPath, 'utf-8');
  const workerName = text.match(/"name"\s*:\s*"([^"]+)"/)?.[1] || 'koperasi-twosra';
  const dbName = text.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1] || 'koperasi_db';
  const dbId = text.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1] || '';
  const bucketName = text.match(/"bucket_name"\s*:\s*"([^"]+)"/)?.[1] || 'images-bucket';

  return { workerName, dbName, dbId, bucketName };
}

function checkWranglerLogin() {
  logStep('Checking Wrangler login');
  const result = runWrangler(['whoami', '--json'], { silent: true });
  const authState = evaluateWranglerWhoami(result);

  if (!authState.ok) {
    if (authState.kind === 'error') {
      logError('Wrangler auth check gagal dijalankan.');
      log(`  Detail: ${authState.detail}`, 'red');
      process.exit(result.status || 1);
    }

    logError('Wrangler belum login atau token tidak valid.');
    log('  Jalankan: npx wrangler login', 'yellow');
    process.exit(1);
  }

  logSuccess('Wrangler login aktif.');
}

function checkCloudflareResources(config) {
  logStep('Checking configured Cloudflare resources');
  log(`  Worker: ${config.workerName}`, 'cyan');
  log(`  D1 DB : ${config.dbName}${config.dbId ? ` (${config.dbId})` : ''}`, 'cyan');
  log(`  R2    : ${config.bucketName}`, 'cyan');

  const d1Result = runWrangler(['d1', 'list', '--json'], { silent: true });
  if (!d1Result.success) {
    logError('Tidak bisa membaca daftar D1 dari akun Cloudflare.');
    log(d1Result.stderr || d1Result.error || d1Result.output, 'red');
    process.exit(1);
  }

  const databases = parseJsonOutput(d1Result.output, []);
  const dbExists = Array.isArray(databases) && databases.some((db) =>
    db?.name === config.dbName || db?.uuid === config.dbId || db?.database_id === config.dbId
  );
  if (!dbExists) {
    logError(`D1 database "${config.dbName}" tidak ditemukan di akun Cloudflare aktif.`);
    log('  Provision database secara manual dulu, lalu update wrangler.jsonc.', 'yellow');
    process.exit(1);
  }
  logSuccess(`D1 database "${config.dbName}" ditemukan.`);

  const r2Result = runWrangler(['r2', 'bucket', 'info', config.bucketName, '--json'], { silent: true });
  if (!r2Result.success) {
    const combinedError = `${r2Result.stderr || ''}\n${r2Result.error || ''}\n${r2Result.output || ''}`.trim();
    if (/not found|does not exist|unknown bucket/i.test(combinedError)) {
      logError(`R2 bucket "${config.bucketName}" tidak ditemukan di akun Cloudflare aktif.`);
      log('  Provision bucket secara manual dulu, lalu update wrangler.jsonc.', 'yellow');
      process.exit(1);
    }

    logError(`Tidak bisa membaca info R2 bucket "${config.bucketName}" dari akun Cloudflare.`);
    log(combinedError || 'Wrangler tidak mengembalikan detail error.', 'red');
    process.exit(1);
  }

  const bucketInfo = parseJsonOutput(r2Result.output, null);
  if (!bucketInfo || bucketInfo?.name !== config.bucketName) {
    logError(`Respons info R2 bucket "${config.bucketName}" tidak valid.`);
    log(r2Result.output || 'Output kosong dari Wrangler.', 'red');
    process.exit(1);
  }
  logSuccess(`R2 bucket "${config.bucketName}" ditemukan.`);
}

function runGate(label, binary, args) {
  logStep(label);
  const result = binary === 'npm'
    ? runNpm(args)
    : runCommand(binary, args);
  if (!result.success) {
    logError(`${label} gagal. Deploy dibatalkan.`);
    if (result.stderr || result.error || result.output) {
      log(result.stderr || result.error || result.output, 'red');
    }
    process.exit(result.status || 1);
  }
  logSuccess(`${label} lulus.`);
}

function runPreflightChecks() {
  runGate('Typecheck', 'npm', ['run', 'typecheck']);
  runGate('Lint', 'npm', ['run', 'lint']);
  runGate('Backend test suite', 'npm', ['test', '--', '--run']);
  runGate('Frontend structure smoke', 'npm', ['run', 'smoke:frontend-structure']);
  runGate('Admin vendor smoke', 'npm', ['run', 'smoke:admin-vendors']);
  runGate('Frontend global coupling audit', 'npm', ['run', 'audit:globals']);
}

async function deployWorker(config) {
  logStep('Deploy confirmation');
  log(`  Target worker : ${config.workerName}`, 'cyan');
  log(`  D1 database   : ${config.dbName}`, 'cyan');
  log(`  R2 bucket     : ${config.bucketName}`, 'cyan');
  logWarn('Script ini hanya deploy kode. Secret, schema, dan seed tidak disentuh.');

  const confirmed = await askQuestion('Deploy kode terbaru ke production sekarang?');
  if (!confirmed) {
    logWarn('Deploy dibatalkan oleh user.');
    return;
  }

  runGate('Wrangler deploy', wranglerInvocation.binary, [...wranglerInvocation.prefixArgs, 'deploy']);
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(__filename);
}

async function main() {
  log('\nKOPERASI TWOSRA - ROUTINE PRODUCTION DEPLOY', 'cyan');
  log('Non-destructive deploy: verify -> test -> deploy\n', 'cyan');

  try {
    const config = readWranglerConfig();
    checkWranglerLogin();
    checkCloudflareResources(config);
    runPreflightChecks();
    await deployWorker(config);

    logStep('Done');
    logSuccess('Deploy routine selesai.');
    log('  Next: cek /api/health, Telegram log, dan smoke gateway bila diperlukan.', 'yellow');
  } catch (error) {
    logError('Deploy routine gagal.');
    log(error instanceof Error ? error.message : String(error), 'red');
    process.exit(1);
  }
}

if (isDirectRun()) {
  main();
}
