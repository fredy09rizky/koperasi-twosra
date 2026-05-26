# Agent Instructions

## Metadata

- Last updated: 2026-05-10
- Owner: Tim Koperasi TWOSRA
- Scope: Aturan cepat untuk agent/AI yang mulai bekerja di repo ini

Aturan cepat untuk agent/AI yang mulai bekerja di repo ini.

## 1. Read Order Before Exploring Code

Jangan langsung membaca seluruh repo. Gunakan urutan ini:

1. `docs/ai/START_HERE.md`
2. `docs/ai/TASK_ROUTING.md`
3. `docs/ai/CURRENT_STATE.md`
4. `docs/ai/DECISIONS.md` bila perlu alasan desain
5. `WORKFLOW.md` bila perlu alur sistem
6. baru file kode yang relevan dengan tugas

Jika tugasnya kecil, baca hanya dokumen AI di atas lalu file domain yang relevan.

## 2. Source Of Truth Priority

Jika ada perbedaan antar dokumen:

1. kode terbaru
2. `WORKFLOW.md`
3. `docs/ai/CURRENT_STATE.md`
4. `docs/ai/DECISIONS.md`
5. `MIGRATION.md` sebagai konteks historis

## 3. Project-Specific Truths

- proyek ini adalah sistem pemesanan Koperasi TWOSRA berbasis Cloudflare Workers
- setelah `checkout_session` terbentuk, browser bukan sumber kebenaran order final
- payload browser untuk `/api/orders` hanya sinyal audit, bukan penentu order final
- setelah QRIS dibuat, `payment_amount` browser bukan sumber kebenaran finansial final
- fee dan total dibayar pasca-checkout mengikuti snapshot server/gateway
- tampering sebelum checkout dan sesudah checkout diperlakukan berbeda
- payment valid tapi order gagal dicatat adalah incident operasional, bukan otomatis tampering
- status pengambilan final satu arah: `BELUM_DIAMBIL -> SUDAH_DIAMBIL`
- status pengambilan hanya boleh diubah dari admin; verifikasi publik hanya menampilkan
- update pickup tidak dikirim sebagai log Telegram rutin
- Telegram memakai topic wajib: `Order`, `Security`, dan `Admin`
- CSRF protection aktif untuk semua endpoint mutating via Origin/Referer validation
- `INTERNAL_WEBHOOK_KEY` hanya untuk caller internal/webhook non-browser tanpa `Origin`/`Referer`
- sesi login admin bersifat tunggal; login baru menginvalidasi sesi lama
- token admin berlaku 1 jam; sesi lama yang ter-kick mendapat `401 E-ADMIN-SESSION-REPLACED`
- ganti password admin wajib verifikasi password lama, policy password kuat, dan invalidasi semua sesi aktif
- environment divalidasi di startup; error konfigurasi langsung throw
- rate limiter memprioritaskan Durable Objects dengan fallback in-memory
- `/api/image-optimize` memakai `redirect: manual` untuk mencegah SSRF
- nama pemesan validasi Unicode-aware, maksimal 22 karakter
- nama produk admin validasi Unicode-aware, maksimal 40 karakter
- product caching frontend 5 menit untuk mengurangi request API berulang
- adaptive payment polling: `5s -> 10s -> 15s -> 20s -> 30s`
- semua CDN script eksternal memakai SRI
- health check tersedia di `/api/health`
- cleanup reservasi memakai batching `500` row per iterasi, max `5000`
- data sesi pembayaran disimpan di `localStorage` tanpa enkripsi untuk recovery lintas tab

## 4. Routing By Domain

- payment/checkout: `src/routes/payment.ts`, `src/routes/public.ts`, `public/js/checkout/form.payment.flow.js`, `public/js/checkout/form.payment.polling.js`
- stock/reservation: `src/utils/stock-reservations.ts`, `src/routes/payment.ts`, `src/routes/public.ts`, `schema.sql`
- race/stress test reservasi: `scripts/reservation-race-test.mjs`, `scripts/README.md`
- admin: `src/routes/admin.ts`, `public/js/admin/*`, `public/admin.html`
- admin settings (`Pengaturan`): `src/routes/admin.ts`, `public/js/admin/admin.status.js`, `public/admin.html`
- pickup/serah-terima: `src/routes/admin.ts`, `src/routes/public.ts`, `src/utils/order-pickup-schema.ts`, `public/js/admin/admin.orders.shared.js`, `public/js/admin/admin.orders.list.js`, `public/js/verifikasi.js`
- security/logging: `src/middleware/*`, `src/utils/request-meta.ts`, `src/utils/telegram.ts`, `src/utils/route-helpers.ts`
- auth/session admin: `src/middleware/auth.ts`, `src/utils/admin-session-schema.ts`, `src/routes/admin.ts`, `public/js/admin/admin.auth.js`
- image/performance frontend: `src/routes/public.ts`, `src/services/image-optimizer.ts`, `public/js/config.js`, `public/js/config.runtime.js`, `public/js/app.core.js`, `public/js/app.receipt.js`, `public/js/app.events.js`, `public/js/cart.core.js`, `public/js/cart.swipe.js`, `public/js/cart.ui.js`, `public/js/admin/admin.utils.js`
- image policy admin: `src/routes/admin.ts`, `public/js/admin/admin.products.policy.js`, `public/js/admin/admin.products.form.js`, `public/js/admin/admin.products.form.helpers.js`, `public/js/admin/admin.products.list.js`
- health check: `src/routes/public.ts` (`GET /api/health`)
- env validation: `src/index.ts` (`validateEnvOnStartup`)

Jika tugas menyentuh testing atau operasi:

- baca `docs/TESTING.md` untuk checklist aktif
- baca `scripts/README.md` untuk smoke/race/rate-limit/deploy helper
- baca `README.md` untuk env `TELEGRAM_CHAT_ID` + `TELEGRAM_TOPIC_*`

## 5. Cloudflare Workers Warning

Knowledge about Cloudflare Workers APIs and limits may be outdated.

Always retrieve current documentation before any task involving:

- Workers runtime
- D1
- R2
- KV
- Durable Objects
- Queues
- Vectorize
- Workers AI
- Agents SDK
- platform limits or quotas

Cloudflare docs:

- https://developers.cloudflare.com/workers/
- https://docs.mcp.cloudflare.com/mcp

## 6. Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | local development |
| `npx wrangler deploy` | deploy manual ke Cloudflare |
| `npx wrangler types` | generate TypeScript types |
| `npm run deploy:production` | deploy rutin non-destruktif |
| `npm run smoke:gateway:simulate` | smoke test + simulasi pembayaran + finalisasi order |
| `npm run race:reservation -- --scenario=mixed --users=10 --heavy-users=5 --stagger-ms=1` | race test reservasi |
| `npm run test:rate-limit -- --mode=both --requests=300 --concurrency=30` | stress test rate limiter |
| `npm run test:rate-limit -- --mode=both --requests=300 --concurrency=30 --strict` | mode CI untuk rate limiter |

Run `wrangler types` setelah mengubah bindings di `wrangler.jsonc`.

## 7. Structured Logger

Proyek ini memakai structured logger, bukan `console.log` langsung, untuk business logic.

File penting:

- backend logger: `src/utils/logger.ts`
- request context logger: `src/middleware/request-logger.ts`
- frontend logger: `public/js/logger.js` (`appLogger`)

Aturan:

- jangan pakai `console.log/error/warn` untuk business logic backend
- pakai `logger` untuk error handling dan important events
- structured logger tidak menggantikan Telegram notifications

## 8. Human-Only Archive

File berikut hanya arsip panjang untuk pembaca manusia, bukan bacaan awal AI:

- `docs/archive/testing/TAMPERING_TEST_REPORT_2026-03-23.md`

## 9. Encoding & Line Endings

- standar file source dan dokumentasi: UTF-8
- line ending yang diharapkan: LF
- jika terminal menampilkan gejala mojibake, verifikasi isi file langsung sebelum menyimpulkan file rusak
