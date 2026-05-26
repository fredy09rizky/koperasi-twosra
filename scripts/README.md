# Deployment Scripts

## Metadata

- Last updated: 2026-05-09
- Owner: Tim Koperasi TWOSRA
- Scope: Panduan script deploy, smoke test, race test, dan rate-limit test

Script otomatis untuk deploy dan pengujian operasional proyek Cloudflare Workers.

Untuk checklist manual ringkas dan navigasi testing aktif, mulai dari `docs/TESTING.md`.

## Dua Jalur Deploy

Dokumen ini membedakan dua jenis deploy:

1. **Setup awal production**
   Dipakai saat project pertama kali dipasang di Cloudflare atau saat recovery terkontrol dari nol.
   Di tahap ini Anda masih harus membuat D1, R2, secret, lalu bootstrap schema awal.

2. **Deploy rutin perubahan kode**
   Dipakai setelah resource production sudah ada.
   Di tahap ini `npm run deploy:production` cukup untuk deploy kode harian.

## Quick Start Deploy Production

```bash
npm run deploy:production
```

Script ini adalah jalur deploy rutin yang aman untuk perubahan kode harian:

1. Cek login Wrangler.
2. Baca target dari `wrangler.jsonc`.
3. Verifikasi D1/R2 yang sudah terhubung di akun Cloudflare aktif.
4. Jalankan gate lokal: typecheck, lint, test, smoke frontend, smoke vendor admin, dan audit global frontend.
5. Deploy Worker.

Script ini **tidak** meng-upload secret, tidak menjalankan `schema.sql`, dan tidak menjalankan `seed.sql`.

## Prasyarat

```bash
npx wrangler login
npm install
```

Pastikan resource production sudah pernah diprovision dan secret production sudah diisi di Cloudflare.

## Catatan Penting

- Script meminta konfirmasi sebelum deploy production.
- Secret production tidak disentuh oleh deploy rutin. Ubah secret manual lewat Wrangler/Dashboard saat memang perlu rotasi.
- `schema.sql` berisi `DROP TABLE`; jangan dijalankan ke remote production sebagai bagian deploy rutin.
- `seed.sql` hanya untuk bootstrap awal, bukan deploy harian.
- Database ID di `wrangler.jsonc` harus sudah benar dari provisioning awal.
- Setelah mengubah bindings/migrations di `wrangler.jsonc` (misalnya `RATE_LIMITER` Durable Object), jalankan `npx wrangler types`.

## Setup Awal Production / Manual Fallback

Gunakan bagian ini hanya untuk setup awal resource production atau recovery terkontrol.
Perubahan database/schema setelah production berjalan harus dilakukan manual dan direview terpisah dari deploy kode.

```bash
npx wrangler d1 create koperasi_db
npx wrangler r2 bucket create images-bucket
npx wrangler secret put JWT_SECRET
npx wrangler secret put PAKASIR_PROJECT_SLUG
npx wrangler secret put PAKASIR_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_TOPIC_ORDER
npx wrangler secret put TELEGRAM_TOPIC_SECURITY
npx wrangler secret put TELEGRAM_TOPIC_ADMIN
npx wrangler secret put ENVIRONMENT
npx wrangler d1 execute koperasi_db --file=schema.sql --remote
npx wrangler d1 execute koperasi_db --file=seed.sql --remote
npm run deploy:production
```

Manual fallback di atas hanya untuk bootstrap awal atau recovery terkontrol. Untuk deploy perubahan kode biasa, pakai `npm run deploy:production`.

## Health Check

Production menyediakan endpoint health detail:

```bash
curl https://koperasi-twosra.fredy09rizky.workers.dev/api/health
# {"status":"healthy","timestamp":"...","checks":{"api":"ok","database":"ok","storage":"ok"}}
```

## Smoke Test

Prasyarat cepat:

1. Jalankan worker lokal di terminal terpisah (`npm run dev`) **atau** set `SMOKE_BASE_URL` ke worker yang sudah aktif.
2. Untuk mode `--simulate-payment` (`smoke:gateway:simulate`), pastikan kredensial gateway tersedia (`PAKASIR_PROJECT_SLUG` + `PAKASIR_API_KEY` atau env `SMOKE_PAKASIR_*`).

```bash
npm run smoke
npm run smoke:gateway
npm run smoke:gateway:simulate
npm run smoke:admin-vendors
npm run smoke:frontend-structure
npm run audit:globals
```

Opsional target URL:

```bash
SMOKE_BASE_URL=http://127.0.0.1:8787 npm run smoke
SMOKE_BASE_URL=https://your-worker.workers.dev npm run smoke:gateway
```

> **Catatan:** Smoke test otomatis menyertakan header `Origin` untuk CSRF protection. `x-internal-key` tidak diperlukan untuk script ini karena request berjalan sebagai browser-like call. Test juga memverifikasi `/api/health` (D1 + R2 bindings) sebelum lanjut ke test fungsional.

`smoke:admin-vendors` memverifikasi guard statik frontend admin:

- `admin.html` tidak lagi preload Chart.js/jsPDF/AutoTable
- `admin.html` memakai single entry `js/admin.entry.module.js`
- `admin.entry.module.js` tetap mengimpor `admin.module.bridge.js`
- `admin.entry.module.js` mengimpor `admin.vendors.js`
- `admin.module.bridge.js` tidak memakai dynamic remote `import()` CDN
- `admin.module.bridge.js` memakai loader UMD + SRI dari `config.js`
- `config.js` menyimpan URL CDN vendor admin yang dipakai lazy-load

`smoke:frontend-structure` memverifikasi guard struktur frontend publik:

- `verifikasi.html` tidak lagi membawa CSS inline besar
- `verifikasi.css` aktif sebagai stylesheet terpisah
- `verifikasi.js` dimuat sebagai module
- `index.html` memakai `js/public.entry.module.js`
- `admin.html` memakai `js/admin.entry.module.js`

`audit:globals` menghasilkan peta coupling global frontend berdasarkan akses `window.*` yang ditrack, untuk memprioritaskan migrasi ESM bertahap.

## Reservation Race Test

```bash
npm run race:reservation
npm run race:reservation -- --users=5 --stagger-ms=5
npm run race:reservation -- --code=L003 --qty=2
npm run race:reservation -- --base-url=https://your-worker.workers.dev --users=5 --stagger-ms=1
npm run race:reservation -- --scenario=mixed --users=5 --heavy-users=3 --stagger-ms=1
npm run race:reservation -- --scenario=mixed --users=10 --heavy-users=5 --stagger-ms=1
```

Catatan:

- Request checkout dikirim paralel pada produk yang sama.
- Jeda user dibuat acak dalam skala milidetik sesuai `--stagger-ms`.
- Output menampilkan detail per user: urutan selesai, status, `order_id`, `checkout_token`, `amount`, timestamp, dan durasi.
- **Penting:** Jika test dijalankan setelah rate limit test, semua request bisa dapat 429 karena window rate limit belum habis. Tunggu ~5 menit atau gunakan `--base-url` ke instance berbeda.

## Catatan Cleanup Operasional

- Cleanup ringan checkout session/reservasi dipicu endpoint payment, plus lazy release di endpoint publik (`/api/products`, `/api/orders`).
- Cleanup berat (purge lama) berjalan dari cron Worker, termasuk tick menit `00` UTC untuk pekerjaan per jam.

## Rate Limit Test (Checkout + Admin Login)

Untuk uji cepat rate limiter pada worker deploy:

```bash
npm run test:rate-limit -- --base-url=https://koperasi-twosra.fredy09rizky.workers.dev --mode=both --requests=300 --concurrency=30 --admin-user=admin --admin-pass=salah-password --pause-ms=1500
```

Baseline standar regresi (disepakati):

- gunakan command di atas setelah setiap deploy
- hasil lulus minimum: kedua skenario (`checkout` dan `admin-login`) sama-sama memunculkan status `429`

Mode yang tersedia:

- `--mode=checkout`
- `--mode=admin-login`
- `--mode=both` (default)

Argumen penting:

- `--requests=300` total request per skenario (baseline)
- `--concurrency=30` jumlah request paralel (baseline)
- `--admin-user=admin`
- `--admin-pass=salah-password`
- `--pause-ms=1500` jeda antar skenario saat mode `both` (baseline)

Output script menampilkan:

- ringkasan status code per skenario
- jumlah hit `429`
- warning jika `429` belum muncul

> **Catatan:** Script otomatis menyertakan header `Origin` yang benar untuk CSRF protection (jadi tidak membutuhkan `x-internal-key`). Bug fix (April 2026): Origin extraction diperbaiki dari regex manual ke `new URL(url).origin`.

Opsi `--strict`: exit code 1 jika 429 tidak muncul (berguna untuk CI pipeline):

```bash
npm run test:rate-limit -- --base-url=https://koperasi-twosra.fredy09rizky.workers.dev --mode=both --requests=300 --concurrency=30 --strict
```

## Catatan Tambahan
Data sesi pembayaran disimpan di `localStorage` (tanpa enkripsi) agar fitur recovery mode tetap berfungsi saat tab ditutup.
