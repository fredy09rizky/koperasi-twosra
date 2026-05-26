import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const rootDir = process.cwd();
const jsRoot = join(rootDir, 'public', 'js');

const trackedPatterns = [
  { label: 'window.WORKER_API_URL', regex: /\bwindow\.WORKER_API_URL\b/g },
  { label: 'window.formatRupiah', regex: /\bwindow\.formatRupiah\b/g },
  { label: 'window.escapeHtml', regex: /\bwindow\.escapeHtml\b/g },
  { label: 'window.optimizeImageUrl', regex: /\bwindow\.optimizeImageUrl\b/g },
  { label: 'window.appLogger', regex: /\bwindow\.appLogger\b/g },
  { label: 'window.UIModal', regex: /\bwindow\.UIModal\b/g },
  { label: 'window.showGlobalLoading', regex: /\bwindow\.showGlobalLoading\b/g },
  { label: 'window.hideGlobalLoading', regex: /\bwindow\.hideGlobalLoading\b/g },
  { label: 'window.storage', regex: /\bwindow\.storage\b/g },
  { label: 'window.debounce', regex: /\bwindow\.debounce\b/g },
  { label: 'window.cart', regex: /\bwindow\.cart\b/g },
  { label: 'window.checkoutForm', regex: /\bwindow\.checkoutForm\b/g },
  { label: 'window.productsList', regex: /\bwindow\.productsList\b/g },
  { label: 'window.productFetchState', regex: /\bwindow\.productFetchState\b/g },
  { label: 'window.storeStatusState', regex: /\bwindow\.storeStatusState\b/g }
];

const walk = (dirPath) => {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absPath);
    }
  }
  return files;
};

const countPattern = (content, regex) => (content.match(regex) || []).length;

const files = walk(jsRoot);
const rows = [];

for (const file of files) {
  const content = readFileSync(file, 'utf-8');
  const counts = {};
  let totalHits = 0;

  for (const tracked of trackedPatterns) {
    const hits = countPattern(content, tracked.regex);
    if (hits > 0) {
      counts[tracked.label] = hits;
      totalHits += hits;
    }
  }

  if (totalHits > 0) {
    rows.push({
      file: relative(rootDir, file).replace(/\\/g, '/'),
      totalHits,
      counts
    });
  }
}

rows.sort((a, b) => b.totalHits - a.totalHits);

console.log('Audit coupling global frontend (berdasarkan akses window.* yang ter-tracking):\n');
for (const row of rows) {
  const details = Object.entries(row.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}:${count}`)
    .join(', ');
  console.log(`${row.file} -> ${row.totalHits} hit (${details})`);
}

if (rows.length === 0) {
  console.log('Tidak ada akses window.* tracked yang ditemukan.');
}
