# Regression Test Matrix (Payment & Checkout)

## Metadata

- Last updated: 2026-05-09
- Owner: Tim Koperasi TWOSRA
- Scope: Matriks regresi payment/checkout dan baseline uji

Dokumen ini dipakai sebagai checklist regresi cepat untuk alur checkout, payment, dan finalisasi order.
Untuk titik mulai testing aktif yang lebih ringkas, baca `docs/TESTING.md`.

Tanggal update terakhir: **21 April 2026 (WIB)**.

## Cara Pakai

1. Jalankan command pada kolom `Command`.
2. Cocokkan outcome dengan kolom `Expected`.
3. Jika ada mismatch, catat skenario + endpoint + payload untuk investigasi.

Prasyarat:

- jika memakai base URL lokal (`http://127.0.0.1:8787`), jalankan dulu worker lokal (`npm run dev`) di terminal terpisah
- untuk skenario yang memakai `smoke:gateway:simulate`, pastikan kredensial gateway tersedia di env

## Matrix

| ID | Skenario | Endpoint utama | Expected | Command | Status terakhir |
| --- | --- | --- | --- | --- | --- |
| P-01 | Checkout normal | `POST /api/checkout/session` | `200`, `checkout_token` + `order_id` terbentuk | `npm run smoke:gateway:simulate` | PASS |
| P-02 | Tampering total sebelum checkout | `POST /api/checkout/session` | `400`, `E-CHECKOUT-TAMPERING` | `npm run smoke:gateway:simulate` | PASS |
| P-03 | QRIS create + replay | `POST /api/payment/qris` | request kedua replay snapshot (`is_replayed: true`) | `npm run smoke:gateway:simulate` | PASS |
| P-04 | Gateway simulation + status completed | `POST /api/paymentsimulation` + `GET /api/payment/status` | status gateway jadi `completed` | `npm run smoke:gateway:simulate` | PASS |
| P-05 | Finalisasi order normal | `POST /api/orders` | `200`, order tersimpan | `npm run smoke:gateway:simulate` | PASS |
| P-06 | Mismatch nominal gateway (total_payment berbeda) | `POST /api/orders` | `409`, pesan mismatch nominal | `npm test -- --run -t "POST /api/orders rejects when gateway nominal mismatches checkout snapshot"` | PASS |
| P-07 | Gateway `transactiondetail` hanya `amount` (tanpa `total_payment`) | `POST /api/orders` | diterima jika subtotal cocok | `npm test -- --run -t "POST /api/orders accepts gateway amount-only detail when subtotal matches checkout amount"` | PASS |
| P-08 | Idempotency order sudah ada | `POST /api/orders` | `200`, `Order already recorded` | `npm test -- --run -t "POST /api/orders returns idempotent success immediately when order already exists"` | PASS |
| P-09 | Double submit paralel `/api/orders` | `POST /api/orders` (2 request bersamaan) | tidak duplicate order; maksimal 1 row order | `npm test -- --run -t "POST /api/orders handles parallel double-submit without creating duplicate orders"` | PASS |
| P-10 | Expired checkout saat status polling | `GET /api/payment/status` | `404`, session `CANCELLED`, reservasi `RELEASED` (`EXPIRED`) | `npm test -- --run -t "GET /api/payment/status rejects expired checkout session and releases reservations"` | PASS |
| P-11 | Expired checkout saat save order | `POST /api/orders` | `404`, session `CANCELLED`, reservasi `RELEASED` (`EXPIRED`) | `npm test -- --run -t "POST /api/orders rejects expired checkout session and releases reservations"` | PASS |
| P-12 | Expired checkout saat cancel payment | `POST /api/payment/cancel` | `404`, session `CANCELLED`, reservasi `RELEASED` (`EXPIRED`) | `npm test -- --run -t "POST /api/payment/cancel rejects expired checkout session and releases reservations"` | PASS |

## Full Baseline

Untuk validasi menyeluruh setelah perubahan backend payment:

```bash
npm test -- --run
npm run smoke:gateway:simulate
```

Expected baseline saat dokumen ini ditulis:

- `vitest`: **78/78 PASS**
- smoke gateway simulate: **Semua smoke checks lulus**
