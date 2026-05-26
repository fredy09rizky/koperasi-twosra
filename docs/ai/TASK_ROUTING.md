# AI Task Routing

## Metadata

- Last updated: 2026-05-10
- Owner: Tim Koperasi TWOSRA
- Scope: Routing baca file berdasarkan domain tugas AI

File ini dipakai untuk menghemat token. Pilih area tugas, lalu baca file minimum yang relevan.

## 1. Checkout / Payment

Baca dulu:

- `src/routes/payment.ts`
- `src/services/payment-sessions.ts`
- `src/services/pakasir-gateway.ts`
- `src/routes/public.ts`
- `src/services/public-order-finalization.ts`
- `src/services/public-pickup.ts`
- `public/index.html`
- `public/js/checkout/form.payment.flow.js`
- `public/js/checkout/form.payment.polling.js`
- `public/js/checkout/form.session.js`
- `public/js/checkout/form.summary.js`

Tambahan bila perlu:

- `WORKFLOW.md`
- `src/utils/telegram.ts`
- `src/utils/store-status.ts` bila tugas menyentuh buka/tutup penerimaan pesanan
- `README.md` bila tugas menyentuh env Telegram/topic forum

Gunakan area ini untuk:

- QRIS
- polling status payment
- recovery mode
- event frontend payment/recovery
- fallback `payment-review`
- save order final
- anti-tampering pasca-checkout
- pemetaan log order vs security topic
- blokir checkout baru saat web sedang ditutup admin

## 2. Stock / Reservation

Baca dulu:

- `src/utils/stock-reservations.ts`
- `src/services/payment-sessions.ts`
- `src/services/public-products.ts`
- `src/routes/payment.ts`
- `src/routes/public.ts`
- `src/services/public-pickup.ts`
- `schema.sql`

Tambahan bila perlu:

- `MIGRATION.md`
- `WORKFLOW.md`
- `scripts/reservation-race-test.mjs`
- `scripts/README.md`

Gunakan area ini untuk:

- stok tersedia
- reservasi checkout
- release expired reservation
- consume reservation
- incident stok konflik
- stress/race test reservasi multi-user (single/mixed scenario)

Catatan:

- baca `MIGRATION.md` hanya jika sedang membandingkan flow lama vs flow baru
- race test saat ini mendukung jeda acak per user dan output detail per user (order/token/amount/timestamp ms)

## 3. Public Catalog / Cart / Checkout UI

Baca dulu:

- `public/index.html`
- `public/js/logger.js`
- `public/js/app.core.js`
- `public/js/app.receipt.js`
- `public/js/app.events.js`
- `public/js/cart.core.js`
- `public/js/cart.swipe.js`
- `public/js/cart.ui.js`
- `public/js/data.js`
- `public/js/checkout/form.core.js`
- `public/js/checkout/form.validation.js`

Gunakan area ini untuk:

- katalog siswa
- keranjang
- form checkout
- summary
- PDF bukti
- hardening cancel saat tab ditutup/refresh (`sendBeacon` + `keepalive`)

## 3a. Image Optimization / Frontend Performance

Baca dulu:

- `src/routes/public.ts` (route `GET /api/image-optimize`)
- `src/services/image-optimizer.ts`
- `src/services/public-products.ts` bila tugas menyentuh katalog/stok publik/cache ETag
- `public/js/config.js` (`optimizeImageUrl`)
- `public/js/config.runtime.js` (helper storage/debounce/loading runtime)
- `public/js/app.core.js`
- `public/js/app.receipt.js`
- `public/js/app.events.js`
- `public/js/cart.core.js`
- `public/js/cart.swipe.js`
- `public/js/cart.ui.js`
- `public/js/admin/admin.utils.js`
- `src/routes/admin.ts` (`GET /api/admin/image-policy`)
- `public/js/admin/admin.products.policy.js`
- `public/js/admin/admin.products.form.js`
- `public/js/admin/admin.products.form.helpers.js`
- `public/js/admin/admin.products.list.js`

Gunakan area ini untuk:

- optimasi gambar URL eksternal
- clamp ukuran/kualitas gambar (`w/h/q`)
- guard URL sumber gambar (protocol/hostname/anti-recursive)
- allowlist domain sumber gambar (`IMAGE_OPTIMIZE_ALLOWED_DOMAINS`)
- validasi `content-type` agar hanya file gambar
- troubleshooting score PageSpeed terkait payload gambar besar

## 4. Admin

Baca dulu:

- `src/routes/admin.ts`
- `src/services/admin-orders.ts`
- `src/services/admin-products.ts`
- `src/services/admin-order-items.ts`
- `public/admin.html`
- `public/js/admin/admin.init.js`
- `public/js/admin/admin.auth.js`
- `public/js/admin/admin.orders.shared.js`
- `public/js/admin/admin.orders.stats.kpi.js`
- `public/js/admin/admin.orders.stats.charts.js`
- `public/js/admin/admin.orders.list.js`
- `public/js/admin/admin.products.policy.js`
- `public/js/admin/admin.products.form.js`
- `public/js/admin/admin.products.list.js`
- `public/js/admin/admin.status.js`

Tambahan bila perlu:

- `public/js/admin/admin.pdf.modal.js`
- `public/js/admin/admin.pdf.export.js`
- `src/routes/public.ts`
- `src/utils/order-pickup-schema.ts`

Gunakan area ini untuk:

- login admin
- order dashboard
- status pengambilan final
- statistik
- analytics admin (`GET /api/admin/orders/analytics`)
- CRUD produk
- upload gambar
- policy domain URL gambar eksternal (`/api/admin/image-policy`)
- menu `Pengaturan`: status web buka/tutup penerimaan pesanan + ganti password admin (`/api/admin/change-password`)

## 5. Auth / Rate Limit / Security

Baca dulu:

- `src/middleware/auth.ts`
- `src/middleware/csrf.ts`
- `src/middleware/rate-limit.ts`
- `src/utils/admin-session-schema.ts`
- `src/routes/public.ts`
- `src/routes/payment.ts`
- `src/utils/request-meta.ts`
- `src/utils/telegram.ts`
- `src/utils/route-helpers.ts`

Gunakan area ini untuk:

- JWT admin
- CSRF protection (Origin/Referer validation)
- aturan request non-browser mutating via `x-internal-key` (`INTERNAL_WEBHOOK_KEY`)
- rate limit (Durable Objects + circuit breaker + fallback in-memory)
- security log
- request metadata
- anti-tampering behavior
- Telegram forum topic (`Order`, `Security`, `Admin`)
- env validation (`src/index.ts`)
- single-session enforcement admin (login baru menendang sesi lama)
- invalidasi semua sesi setelah ganti password admin

## 6. Database / Schema

Baca dulu:

- `schema.sql`
- `data-dummy.sql`
- `src/types/bindings.ts`
- `wrangler.jsonc`

Catatan:

- folder `migrations/` saat ini bukan sumber kebenaran utama
- schema utama tetap ada di `schema.sql`

## 6a. Backend Tests

Baca file test sesuai domain:

- health/produk/image optimizer: `test/index.spec.ts`
- service helper/regression: `test/services.spec.ts`
- checkout/payment/session/cancel/event: `test/checkout-payment.spec.ts`
- finalisasi order/idempotency: `test/orders.spec.ts`
- admin/auth/products/analytics: `test/admin.spec.ts`
- CSRF: `test/csrf.spec.ts`
- ringkasan pesanan admin: `test/admin-orders-summary.spec.ts`
- setup shared: `test/helpers.ts`

## 7. Troubleshooting Incident

Baca dulu:

- `docs/ai/CURRENT_STATE.md`
- `WORKFLOW.md`
- file route/domain yang terkait

Bedakan dua kelas kejadian:

- security mismatch: payload client berbeda dari snapshot server
- operational incident: payment valid tapi order gagal dicatat

## 8. If The Task Is Small

Jangan baca lebih dari yang perlu.

Contoh:

- hanya ubah teks summary payment: cukup baca `public/index.html` + `public/js/checkout/form.summary.js`
- hanya ubah validasi admin produk: cukup baca `src/services/admin-products.ts` + `src/routes/admin.ts` + `public/js/admin/admin.products.form.js`
