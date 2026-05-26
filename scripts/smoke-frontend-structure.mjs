import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const verifyHtmlPath = join(rootDir, 'public', 'verifikasi.html');
const verifyJsPath = join(rootDir, 'public', 'js', 'verifikasi.js');
const verifyCssPath = join(rootDir, 'public', 'css', 'verifikasi.css');
const indexHtmlPath = join(rootDir, 'public', 'index.html');
const adminHtmlPath = join(rootDir, 'public', 'admin.html');
const publicEntryPath = join(rootDir, 'public', 'js', 'public.entry.module.js');
const adminEntryPath = join(rootDir, 'public', 'js', 'admin.entry.module.js');
const adminProductsListPath = join(rootDir, 'public', 'js', 'admin', 'admin.products.list.js');
const adminOrdersListPath = join(rootDir, 'public', 'js', 'admin', 'admin.orders.list.js');
const cartUiPath = join(rootDir, 'public', 'js', 'cart.ui.js');
const publicEventsPath = join(rootDir, 'public', 'js', 'app.events.js');
const appCorePath = join(rootDir, 'public', 'js', 'app.core.js');
const modalPath = join(rootDir, 'public', 'js', 'modal.js');
const adminInitPath = join(rootDir, 'public', 'js', 'admin', 'admin.init.js');
const adminAuthPath = join(rootDir, 'public', 'js', 'admin', 'admin.auth.js');
const adminPdfExportPath = join(rootDir, 'public', 'js', 'admin', 'admin.pdf.export.js');

const verifyHtml = readFileSync(verifyHtmlPath, 'utf-8');
const verifyJs = readFileSync(verifyJsPath, 'utf-8');
const verifyCss = readFileSync(verifyCssPath, 'utf-8');
const indexHtml = readFileSync(indexHtmlPath, 'utf-8');
const adminHtml = readFileSync(adminHtmlPath, 'utf-8');
const publicEntry = readFileSync(publicEntryPath, 'utf-8');
const adminEntry = readFileSync(adminEntryPath, 'utf-8');
const adminProductsList = readFileSync(adminProductsListPath, 'utf-8');
const adminOrdersList = readFileSync(adminOrdersListPath, 'utf-8');
const cartUi = readFileSync(cartUiPath, 'utf-8');
const publicEvents = readFileSync(publicEventsPath, 'utf-8');
const appCore = readFileSync(appCorePath, 'utf-8');
const modalJs = readFileSync(modalPath, 'utf-8');
const adminInit = readFileSync(adminInitPath, 'utf-8');
const adminAuth = readFileSync(adminAuthPath, 'utf-8');
const adminPdfExport = readFileSync(adminPdfExportPath, 'utf-8');

function listJsFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listJsFiles(fullPath));
    } else if (entry.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const jsRoot = join(rootDir, 'public', 'js');
const unexpectedInnerHtmlFiles = listJsFiles(jsRoot)
  .filter((filePath) => /innerHTML\s*=/.test(readFileSync(filePath, 'utf-8')));

const checks = [
  {
    name: 'verifikasi.html memakai stylesheet eksternal verifikasi.css',
    pass: /<link rel="stylesheet" href="css\/verifikasi\.css">/i.test(verifyHtml),
  },
  {
    name: 'verifikasi.html tidak lagi mengandung inline <style>',
    pass: !/<style[\s>]/i.test(verifyHtml),
  },
  {
    name: 'verifikasi.html memuat verifikasi.js sebagai module',
    pass: /<script type="module" src="js\/verifikasi\.js"><\/script>/i.test(verifyHtml),
  },
  {
    name: 'verifikasi.js memakai runtime apiUrl (module-safe)',
    pass: /runtime\.apiUrl/.test(verifyJs),
  },
  {
    name: 'verifikasi.js import helper shared runtime.module.js',
    pass: /from '\.\/shared\/runtime\.module\.js'/.test(verifyJs),
  },
  {
    name: 'verifikasi.css berisi class utama halaman verifikasi',
    pass: /\.verification-container/.test(verifyCss) && /\.verif-main/.test(verifyCss),
  },
  {
    name: 'index.html memakai module entry public.entry.module.js',
    pass: /<script type="module" src="js\/public\.entry\.module\.js"><\/script>/i.test(indexHtml),
  },
  {
    name: 'admin.html memakai module entry admin.entry.module.js',
    pass: /<script type="module" src="js\/admin\.entry\.module\.js"><\/script>/i.test(adminHtml),
  },
  {
    name: 'public.entry.module.js memakai import ESM langsung (tanpa loadLegacyScriptBatch)',
    pass: /import '\.\/app\.events\.js';/.test(publicEntry) && !/loadLegacyScriptBatch\(PUBLIC_LEGACY_SCRIPTS\)/.test(publicEntry),
  },
  {
    name: 'admin.entry.module.js memakai import ESM langsung (tanpa loadLegacyScriptBatch)',
    pass: /import '\.\/admin\/admin\.init\.js';/.test(adminEntry) && !/loadLegacyScriptBatch\(ADMIN_LEGACY_SCRIPTS\)/.test(adminEntry),
  },
  {
    name: 'admin.products.list.js render produk tanpa innerHTML',
    pass: !/innerHTML\s*=/.test(adminProductsList) && /replaceChildren\(\)/.test(adminProductsList),
  },
  {
    name: 'admin.orders.list.js render data order tanpa innerHTML',
    pass: !/innerHTML\s*=/.test(adminOrdersList) && /replaceChildren\(\)/.test(adminOrdersList),
  },
  {
    name: 'cart.ui.js render item keranjang tanpa innerHTML',
    pass: !/innerHTML\s*=/.test(cartUi) && /replaceChildren\(\)/.test(cartUi),
  },
  {
    name: 'logo container homepage memakai elemen interaktif semantik',
    pass: /<button[^>]*class="logo-container"[^>]*id="logo-container"[^>]*data-nav="home"[^>]*>/i.test(indexHtml)
      && /<button[^>]*class="logo-container"[^>]*id="logo-container"[^>]*data-nav="\/"[^>]*>/i.test(verifyHtml),
  },
  {
    name: 'public navigation menangani logo sebagai kontrol keyboard-accessible',
    pass: /querySelectorAll\('\[data-nav\]'\)/.test(publicEvents),
  },
  {
    name: 'filter kategori produk punya state aria-pressed yang sinkron',
    pass: /setAttribute\('aria-pressed', 'true'\)/.test(appCore)
      && /setAttribute\('aria-pressed', 'false'\)/.test(appCore)
      && /aria-pressed="true"/i.test(indexHtml),
  },
  {
    name: 'sidebar admin mendukung roving tabindex dan navigasi panah',
    pass: /ArrowRight/.test(adminInit)
      && /ArrowLeft/.test(adminInit)
      && /setAttribute\('tabindex', isActive \? '0' : '-1'\)/.test(adminAuth),
  },
  {
    name: 'modal global mengembalikan fokus ke pemicu setelah ditutup',
    pass: /const previouslyFocusedElement = document\.activeElement/.test(modalJs)
      && /previouslyFocusedElement\.focus\(\)/.test(modalJs),
  },
  {
    name: 'ekspor PDF tidak memaksa hard-wrap ID transaksi 13 karakter',
    pass: !/wrapText\(String\(order\.id \|\| '-'\), 12\)/.test(adminPdfExport),
  },
  {
    name: 'ekspor PDF membiarkan daftar belanja wrap alami oleh lebar kolom',
    pass: !/return `\$\{safeQty\}x \$\{wrapText\(safeName\)\}`;/.test(adminPdfExport),
  },
  {
    name: 'tidak ada assignment innerHTML di public/js',
    pass: unexpectedInnerHtmlFiles.length === 0,
  },
];

let failed = 0;
for (const check of checks) {
  if (check.pass) {
    console.log(`PASS: ${check.name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\nSmoke frontend structure gagal (${failed} check gagal).`);
  process.exit(1);
}

console.log('\nSmoke frontend structure lulus.');
