import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const adminHtmlPath = join(rootDir, 'public', 'admin.html');
const configJsPath = join(rootDir, 'public', 'js', 'config.js');
const adminEntryPath = join(rootDir, 'public', 'js', 'admin.entry.module.js');
const adminBridgePath = join(rootDir, 'public', 'js', 'admin', 'admin.module.bridge.js');

const adminHtml = readFileSync(adminHtmlPath, 'utf-8');
const configJs = readFileSync(configJsPath, 'utf-8');
const adminEntry = readFileSync(adminEntryPath, 'utf-8');
const adminBridge = readFileSync(adminBridgePath, 'utf-8');

const checks = [
  {
    name: 'admin.html memakai single module entry admin.entry.module.js',
    pass: /<script type="module" src="js\/admin\.entry\.module\.js"><\/script>/.test(adminHtml),
  },
  {
    name: 'admin.entry.module.js import admin.module.bridge.js',
    pass: /import '\.\/admin\/admin\.module\.bridge\.js';/.test(adminEntry),
  },
  {
    name: 'admin.module.bridge.js tidak memakai dynamic import remote CDN',
    pass: !/import\(\s*['"`]https:\/\//i.test(adminBridge) && !/\/\+esm['"`]/i.test(adminBridge),
  },
  {
    name: 'admin.module.bridge.js memakai loader UMD dengan SRI dari config.js',
    pass: /source:\s*'umd-sri'/.test(adminBridge) && /ensureChartLibrary/.test(adminBridge) && /ensureJsPdfLibraries/.test(adminBridge),
  },
  {
    name: 'admin.entry.module.js import admin.vendors.js',
    pass: /import '\.\/admin\/admin\.vendors\.js';/.test(adminEntry),
  },
  {
    name: 'admin.html tidak preload Chart.js UMD',
    pass: !/cdn\.jsdelivr\.net\/npm\/chart\.js@/i.test(adminHtml),
  },
  {
    name: 'admin.html tidak preload jsPDF CDN',
    pass: !/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\//i.test(adminHtml),
  },
  {
    name: 'admin.html tidak preload jsPDF AutoTable CDN',
    pass: !/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf-autotable\//i.test(adminHtml),
  },
  {
    name: 'config.js memiliki entri CDN chart',
    pass: /chart:\s*{[\s\S]*url:\s*'https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.5\.1\/dist\/chart\.umd\.min\.js'/.test(configJs),
  },
  {
    name: 'config.js memiliki entri CDN jspdf',
    pass: /jspdf:\s*{[\s\S]*cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/3\.0\.3\//.test(configJs),
  },
  {
    name: 'config.js memiliki entri CDN jspdfAutotable',
    pass: /jspdfAutotable:\s*{[\s\S]*cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf-autotable\/3\.5\.29\//.test(configJs),
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
  console.error(`\nSmoke admin vendors gagal (${failed} check gagal).`);
  process.exit(1);
}

console.log('\nSmoke admin vendors lulus.');
