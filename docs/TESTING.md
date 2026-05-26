# Testing Guide

## Metadata

- Last updated: 2026-05-09
- Owner: Tim Koperasi TWOSRA
- Scope: Hub testing aktif, checklist manual ringkas, dan referensi regresi/arsip

Dokumen ini adalah pintu masuk utama untuk testing aktif. Gunakan file ini untuk:

- checklist manual singkat sebelum deploy atau setelah perubahan sensitif
- ringkasan uji tampering
- pointer ke baseline regresi detail
- pointer ke arsip laporan panjang

## Read This First

1. Jalankan checklist `User`, `Admin`, dan `Operasional` di dokumen ini.
2. Jika butuh command baseline regresi checkout/payment, buka `docs/human/testing/REGRESSION_TEST_MATRIX.md`.
3. Jika butuh bukti historis tampering yang panjang, buka `docs/archive/testing/TAMPERING_TEST_REPORT_2026-03-23.md`.

## Manual Checklist

### User

- katalog tampil normal, stok tidak minus, dan produk habis tampil benar
- keranjang sinkron dengan stok tersedia
- checkout normal berjalan sampai QRIS muncul
- polling payment berjalan dari `pending` ke `completed`
- summary sukses tampil dan PDF bisa dibuat
- verifikasi publik menampilkan data transaksi dan `pickup_status`
- cancel payment manual mengembalikan user ke keranjang
- recovery mode bekerja sebelum timeout
- checkout baru ditolak saat web ditutup admin
- transaksi lama yang sudah punya session tetap bisa lanjut
- gambar eksternal dimuat lewat `/api/image-optimize`

### Admin

- login, verify session, logout, dan single-session enforcement normal
- daftar pesanan, filter, sorting, dan statistik berjalan
- export PDF/CSV berhasil dan angka subtotal/fee/total konsisten
- CRUD produk berjalan saat tidak ada reservasi aktif
- guard reservasi aktif menolak perubahan berisiko
- upload gambar valid berhasil dan invalid ditolak
- policy allowlist gambar dari `/api/admin/image-policy` diterapkan di form
- pickup status hanya bisa `BELUM_DIAMBIL -> SUDAH_DIAMBIL`
- menu `Pengaturan` memuat status web dan ganti password dengan benar

### Operasional

- `GET /api/health` sehat
- Telegram masuk ke topic `Order`, `Security`, dan `Admin` yang tepat
- cleanup reservasi expired berjalan normal
- minimal satu uji race reservasi dijalankan pada stok tipis
- endpoint sensitif mengeluarkan `429` saat stress test rate limit

## Tampering Summary

### Pre-checkout tampering

- target: `POST /api/checkout/session`
- expected: backend menolak request dengan `E-CHECKOUT-TAMPERING`

### Post-checkout tampering

- target: payload `POST /api/orders`
- expected: order final tetap mengikuti snapshot server (`checkout_sessions`, `stock_reservations`, data produk DB)
- mismatch client harus masuk security log

### Financial mismatch

- target: `payment_amount` browser atau field finansial lain yang menyimpang
- expected: fee dan total final tetap mengikuti snapshot server/gateway

## Detailed References

- baseline regresi detail: `docs/human/testing/REGRESSION_TEST_MATRIX.md`
- arsip tampering panjang: `docs/archive/testing/TAMPERING_TEST_REPORT_2026-03-23.md`
- workflow bisnis aktif: `WORKFLOW.md`
- script smoke/race/rate-limit: `scripts/README.md`
