# AI Start Here

## Metadata

- Last updated: 2026-05-10
- Owner: Tim Koperasi TWOSRA
- Scope: Konteks minimum AI sebelum membaca kode

Tujuan file ini adalah memberi konteks awal yang stabil dan hemat token.

## Project Summary

Proyek ini adalah sistem pemesanan Koperasi TWOSRA berbasis Cloudflare Workers.

Permukaan utama:

- siswa: katalog, keranjang, checkout, QRIS, summary, PDF
- admin: login, produk, order, statistik, export PDF/CSV, `Pengaturan`
- publik: verifikasi transaksi via `verification_token`

## Stack

- runtime: Cloudflare Workers
- router: Hono
- language: TypeScript backend + vanilla JS frontend
- database: Cloudflare D1
- object storage: Cloudflare R2
- payment gateway: Pakasir
- logging operasional: Telegram
- structured logging: `src/utils/logger.ts`

## Main Entry Points

- `src/index.ts`
- `src/routes/public.ts`
- `src/routes/payment.ts`
- `src/routes/admin.ts`
- `public/index.html`
- `public/admin.html`
- `public/js/logger.js`

## Core Business Model

- `products.stock` = stok fisik/original
- stok publik = stok fisik - reservasi aktif
- `store_status.accepting_orders` = source of truth status buka/tutup checkout baru
- checkout membuat `checkout_session` + `stock_reservations`
- payment valid tidak langsung membuat order
- order final hanya dibuat setelah payment tervalidasi

## Core Truths

- setelah `checkout_session` terbentuk, browser bukan sumber kebenaran order final
- payload browser untuk `/api/orders` hanya sinyal audit
- setelah QRIS dibuat, `payment_amount` browser bukan sumber kebenaran finansial final
- fee dan total bayar pasca-checkout mengikuti snapshot server/gateway
- tampering sebelum checkout ditolak; tampering sesudah checkout disanitasi dan dicatat
- penutupan web hanya memblokir checkout baru; transaksi lama yang sah tetap boleh lanjut
- cancel payment frontend diprioritaskan lewat `sendBeacon` lalu fallback `fetch keepalive`
- request mutating non-browser tanpa `Origin`/`Referer` hanya boleh dengan `x-internal-key`

## Read Next

1. `docs/ai/TASK_ROUTING.md`
2. `docs/ai/CURRENT_STATE.md`
3. `docs/ai/DECISIONS.md` bila perlu alasan desain
4. `WORKFLOW.md` bila perlu workflow penuh

## Human-Only Archive

Jangan jadikan file ini bacaan awal AI:

- `docs/archive/testing/TAMPERING_TEST_REPORT_2026-03-23.md`
