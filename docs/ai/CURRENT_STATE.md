# Current State

## Metadata

- Last updated: 2026-05-10
- Owner: Tim Koperasi TWOSRA
- Scope: Status aktif proyek, area sensitif, dan risiko terkini

File ini merangkum kondisi aktif project. Kode terbaru tetap menjadi sumber kebenaran utama.

## Stable Decisions

- Stok publik = stok fisik dikurangi reservasi aktif.
- `checkout_session` dibuat sebelum QRIS; pembuatan memakai `DB.batch()` + kompensasi rollback manual (tanpa SQL `BEGIN/COMMIT`).
- Order final hanya dibuat setelah payment tervalidasi server-to-server.
- Payload browser untuk `/api/orders` bukan sumber kebenaran order final setelah checkout session terbentuk.
- `payment_amount` browser bukan sumber kebenaran finansial final setelah QRIS dibuat; fee dan total mengikuti snapshot server/gateway.
- Tampering sebelum checkout ditolak; tampering sesudah checkout disanitasi dari snapshot server dan dicatat sebagai security mismatch.
- Payment valid tetapi order gagal dicatat adalah incident operasional, bukan otomatis tampering.
- Status pengambilan final satu arah: `BELUM_DIAMBIL → SUDAH_DIAMBIL`; hanya bisa diubah dari admin.
- Verifikasi publik hanya menampilkan status pengambilan dan tidak mengekspos `wa_number`.
- Status buka/tutup penerimaan pesanan disimpan di `store_status`; checkout baru ditolak saat tutup, transaksi lama tetap lanjut.
- Sesi login admin bersifat tunggal; login baru menginvalidasi sesi lama (`active_session_id` diganti).
- Ganti password admin wajib verifikasi password lama, policy password kuat, dan invalidasi semua sesi aktif.
- Telegram memakai forum topic wajib: `Order`, `Security`, dan `Admin`.
- CSRF protection aktif untuk semua endpoint mutating via Origin/Referer validation.
- Request mutating tanpa Origin/Referer hanya boleh dengan `x-internal-key` yang cocok `INTERNAL_WEBHOOK_KEY`.
- Rate limit endpoint sensitif memakai Durable Objects (`RATE_LIMITER`) dengan circuit breaker dan fallback in-memory.
- Cleanup reservasi: lazy release + cron sweep 10 menit + purge data lama per jam.
- Data form pemesanan/pending payment disimpan di `localStorage` tanpa enkripsi untuk recovery lintas tab.

## Kondisi Kode Saat Ini

### Backend

- Route besar sudah dipecah ke service domain di `src/services/`; kontrak API tidak berubah.
- Helper duplikat sudah dikonsolidasikan:
  - `src/utils/d1-schema-helpers.ts`: schema migration helpers.
  - `src/utils/format.ts`: `formatSqlTimestamp`.
  - `src/utils/network.ts`: hostname validation helpers.
  - `src/utils/route-helpers.ts`: `getRequestLogger` shared untuk `public.ts`, `payment.ts`, dan `public-order-finalization.ts`.
  - `src/utils/operational-log.ts`: `createOperationalLogPromise` untuk route public.
- `src/types/bindings.ts` menyediakan tipe `CheckoutSession`, `StockReservation`, `StoreStatusRecord`, `D1RunResult`, `D1CountRow` untuk mengurangi `as any` pada D1 query.
- `src/utils/type-safe.ts` dipakai untuk membaca payload/error/status HTTP tanpa `as any`.
- `queueOperationalLog` di `payment.ts` dan `public.ts` sengaja terpisah karena routing topic Telegram-nya berbeda.
- Custom date range filter admin (`dateFilter === 'custom'`) menggunakan WIB midnight (`+07:00`) untuk `endWibExclusive`.
- `src/durable/rate-limiter.ts`: nilai `now` dari payload di-clamp ke maksimal 60 detik ke depan dari waktu server.

### Frontend

- Entry point: `public/js/public.entry.module.js` dan `public/js/admin.entry.module.js` (direct ESM, tanpa bundler).
- Render data dinamis memakai DOM API, `textContent`, `createSafeElement`; tidak ada `innerHTML` di `public/js`.
- `smoke:frontend-structure` menjadi guard regresi untuk mencegah `innerHTML` baru.
- Vendor admin berat (Chart.js, jsPDF) dimuat lazy lewat loader UMD dengan SRI; remote dynamic `import()` CDN tidak dipakai.
- `form.summary.js`: render item memprioritaskan `secure_price` dari server, fallback ke `item.product.price`.
- `form.payment.flow.js`: snapshot `currentOrderData` disimpan sebelum `cleanupPaymentState` agar PDF download tetap bisa mengakses data.
- `app.receipt.js`: PDF generation punya timeout 30 detik via `Promise.race`.
- `cart.core.js`: `loadFromStorage`/`saveToStorage` memakai `storage` helper dari `config.runtime.js` (fix Firefox private mode crash).
- `cart.ui.js`: `aria-label` pada `#cart-badge` diupdate dinamis setiap kali jumlah item berubah.
- `admin.products.form.js`: semua `modal.alert` di-`await`; urutan validasi: required → format → range → kategori → duplikat.
- `admin.products.policy.js`: event listener file input diubah ke `async` agar `modal.alert` bisa di-`await`.
- Waktu pembayaran di summary, payment-review, dan PDF diformat ke WIB di frontend; backend mengirim timestamp ISO UTC.
- Polling payment adaptif: 5s → 10s → 15s → 20s → 30s.
- Cancel payment: prioritas `sendBeacon`, fallback `fetch keepalive`.

### CSS / HTML

- `public/css/style.css`: token/global shared (navbar, button, modal, global loading, `prefers-reduced-motion`).
- `public/css/storefront.css` + `storefront.checkout.css` + `storefront.responsive.css`: UI halaman siswa.
- `public/css/admin.css` + `admin.forms.css`: UI dashboard admin.
- `public/css/verifikasi.css`: UI halaman verifikasi publik.
- Security headers HTML: CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.
- Aksesibilitas: `aria-label` pada `#cart-badge`, `role="dialog"` + `aria-modal` pada PDF modal, `role="status"` + `aria-live` pada `#global-loading`.

### Test Suite

- 8 file test, 78 test, semua PASS.
- `test/admin-orders-summary.spec.ts`: regresi ringkasan cepat pesanan admin.
- `test/index.spec.ts`: health, produk, image optimizer.
- `test/services.spec.ts`: service regressions.
- `test/checkout-payment.spec.ts`: checkout session, QRIS, payment status/event/cancel.
- `test/orders.spec.ts`: finalisasi order dan idempotency.
- `test/admin.spec.ts`: auth/admin/products/analytics.
- `test/csrf.spec.ts`: CSRF middleware.
- `test/helpers.ts`: reset database dan helper pickup.

## Important Security Behavior

- `POST /api/checkout/session` menghitung ulang total dari DB dan menolak mismatch total client (`E-CHECKOUT-TAMPERING`).
- `/api/orders` merekonstruksi order final dari `checkout_sessions`, `stock_reservations`, dan data produk DB.
- Mismatch item, subtotal, atau payment amount dari browser dicatat sebagai security mismatch (`Security Alert`) ke topic Telegram Security dan tidak mengubah order final.
- `checkout_token` di log dipotong dengan `maskToken()` untuk korelasi tanpa replay token penuh.
- Public verify endpoint mengembalikan field eksplisit dan tidak mengembalikan nomor WA.
- Upload gambar admin dibatasi ukuran (3MB), MIME, dan signature file.
- Image optimizer memakai allowlist domain, `redirect: manual`, blocklist host lokal/private, dan validasi `content-type: image/*`.
- Admin auth: `sid` token harus cocok dengan `admin_users.active_session_id`, tidak cukup validasi JWT saja.

## Important Operational Behavior

- Summary sukses hanya tampil setelah order benar-benar tercatat.
- Jika payment sukses tetapi order gagal dicatat, frontend masuk view `payment-review`.
- Penutupan web tidak membatalkan pesanan yang sudah dibayar.
- Refund manual mengikuti subtotal barang; fee gateway tidak ikut.
- Event rate limit yang diblokir (`429`) masuk log operasional sekali per client per window.
- Update status pengambilan tidak dikirim sebagai log Telegram rutin.
- Timestamp operasional untuk Telegram distandarkan ke ISO UTC.

## Known Sensitive Areas

1. `src/routes/public.ts` — validasi order final, anti-tampering, verification token, health check, image optimizer.
2. `src/routes/payment.ts` — checkout session, reservasi awal, QRIS, status polling, cancel, payment event.
3. `src/routes/admin.ts` — login, single-session, store status, change password, analytics, CRUD produk, upload, pickup final.
4. `src/utils/stock-reservations.ts` — source of truth reservasi stok aktif, release, consume, cleanup.
5. `src/middleware/csrf.ts` — Origin/Referer validation dan internal key flow.
6. `src/middleware/rate-limit.ts` + `src/durable/rate-limiter.ts` — distributed rate limit via DO, circuit breaker, fallback in-memory.
7. `public/js/config.js` — SRI CDN loader, `sanitizeImageUrl`, `optimizeImageUrl`, `createSafeElement`.
8. `public/js/admin/admin.module.bridge.js` + `admin.vendors.js` — vendor admin harus lewat loader SRI.

## Current Risks / Follow-Up

- `finalizePaidOrderRequest` di `src/services/public-order-finalization.ts` masih 600+ baris. Decompose adalah prioritas refactor berikutnya, tapi berisiko karena menyangkut core payment flow.
- `.dev.vars` tidak boleh berisi credential production. Rotasi secret wajib jika credential nyata pernah tersalin.
- Retest tampering pasca-checkout perlu dipertahankan sebagai smoke/regression security.

## Verification Commands

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run smoke:frontend-structure
npm run smoke:admin-vendors
node scripts/audit-globals.mjs
```

## Read Next

- Overview project: `README.md`
- Workflow bisnis: `WORKFLOW.md`
- Routing tugas AI: `docs/ai/TASK_ROUTING.md`
- Alasan desain: `docs/ai/DECISIONS.md`
- Arsitektur frontend: `docs/frontend/ARCHITECTURE.md`
