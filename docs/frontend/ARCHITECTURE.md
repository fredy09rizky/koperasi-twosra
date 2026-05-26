# Arsitektur Frontend

## Metadata

- Last updated: 2026-05-10
- Owner: Tim Koperasi TWOSRA
- Scope: Struktur frontend vanilla JS dan alur data UI

Dokumen ini menjelaskan organisasi frontend vanilla JS dan alur data utamanya.

## Struktur File

```text
public/
|-- index.html              # Halaman siswa
|-- admin.html              # Dashboard admin
|-- verifikasi.html         # Verifikasi publik
|-- css/
|   |-- style.css           # Token/global UI shared (navbar, button, modal, global loading)
|   |-- verifikasi.css      # UI halaman verifikasi publik
|   |-- storefront.css      # UI halaman siswa (hero/katalog/keranjang base)
|   |-- storefront.checkout.css # UI checkout/payment/summary
|   |-- storefront.responsive.css # Responsive rules halaman siswa
|   |-- admin.css           # UI dashboard admin (layout/sidebar/stats)
|   `-- admin.forms.css     # UI form dan table UX admin
|-- js/
|   |-- public.entry.module.js # Entry module halaman siswa (direct ESM import)
|   |-- admin.entry.module.js  # Entry module halaman admin (direct ESM import)
|   |-- logger.js           # appLogger (satu pintu log frontend)
|   |-- config.js           # Konfigurasi core + util format/sanitasi + CDN/SRI loader
|   |-- config.runtime.js   # Helper runtime UI (loading overlay, debounce, storage)
|   |-- data.js             # State global produk + status web
|   |-- cart.core.js        # Core state & bisnis keranjang
|   |-- cart.swipe.js       # Interaksi swipe delete item keranjang
|   |-- cart.ui.js          # Render UI keranjang + binding event item
|   |-- modal.js            # Modal universal
|   |-- app.core.js         # Core App: katalog, routing view, guide, toast
|   |-- app.runtime.js      # Runtime holder instance App untuk lintas modul ESM
|   |-- app.receipt.js      # Generator PDF bukti pembayaran
|   |-- app.events.js       # Inisialisasi app + binding event DOM global
|   |-- verifikasi.js       # Halaman verifikasi publik (ESM entry)
|   |-- shared/
|   |   `-- runtime.module.js # Helper runtime frontend untuk modul ESM
|   |-- checkout/
|   |   |-- form.core.js
|   |   |-- form.validation.js
|   |   |-- form.session.js
|   |   |-- form.payment.flow.js
|   |   |-- form.payment.polling.js
|   |   `-- form.summary.js
|   `-- admin/
|       |-- admin.core.js
|       |-- admin.auth.js
|       |-- admin.orders.shared.js
|       |-- admin.orders.stats.kpi.js
|       |-- admin.orders.stats.charts.js
|       |-- admin.orders.list.js
|       |-- admin.products.policy.js
|       |-- admin.products.form.js
|       |-- admin.products.form.helpers.js
|       |-- admin.products.list.js
|       |-- admin.status.js    # Menu Pengaturan: status web + ganti password
|       |-- admin.pdf.modal.js
|       |-- admin.pdf.export.js
|       |-- admin.module.bridge.js
|       |-- admin.vendors.js
|       |-- admin.utils.js
|       `-- admin.init.js
`-- sounds/
```

## Pola Utama

1. Class/module pattern per domain (`App`, `Cart`, `CheckoutForm`, `AdminApp`).
2. Tanpa bundler; dependency graph dimuat lewat direct ESM import dari entry module.
3. State utama:
- `koperasi_cart` di `localStorage`
- `koperasi_pending_payment_session` di `localStorage`
- state mode pilih keranjang (`isSelectionMode`, `selectedProductIds`) dikelola runtime dan di-reset saat reload
- state runtime di `data.js`
- product cache 5 menit di memory (`productCache`, `productCacheTime`)

## Alur Siswa

1. `app.core.js` memuat produk (`GET /api/products`) dengan caching 5 menit.
2. `cart.core.js` + `cart.swipe.js` + `cart.ui.js` sinkronisasi keranjang terhadap stok tersedia, termasuk mode pilih untuk hapus batch/satuan.
3. `form.payment.flow.js` membuat checkout session + QRIS, lalu menyimpan order final setelah pembayaran sukses.
4. `form.payment.polling.js` + `form.session.js` menangani polling status adaptif (5s->30s), recovery session, timer, dan cancel.
5. `form.summary.js` render ringkasan + PDF.

Catatan penting:
- cancel payment diprioritaskan lewat `navigator.sendBeacon`, fallback ke `fetch` `keepalive`.
- gambar katalog/keranjang memakai `optimizeImageUrl(...)` ke endpoint `/api/image-optimize`.
- saat mode pilih keranjang aktif, tombol checkout dikunci sampai user `Batal` atau selesai `Hapus Terpilih`.
- polling payment adaptif: dimulai 5 detik, meningkat hingga 30 detik untuk menghemat resource.
- global error handlers menangkap error JS yang tidak tertangani.
- footer publik menampilkan status layanan dinamis (`Sedang menerima pesanan` / `Sementara ditutup`) berbasis state `fetchStoreStatus()` di `data.js`.

## Alur Admin

1. `admin.auth.js` login/verify/logout.
   - termasuk heartbeat verifikasi sesi tiap 60 detik + `visibilitychange` check untuk mendeteksi sesi ter-kick.
2. `admin.orders.shared.js` + `admin.orders.stats.kpi.js` + `admin.orders.stats.charts.js` + `admin.orders.list.js` untuk daftar order, pickup final, dan statistik.
   - tab statistik memakai dataset `orders` dari `GET /api/admin/orders/analytics`; KPI dijaga ringkas dan fokus ke metrik order final.
3. `admin.products.policy.js` + `admin.products.form.js` + `admin.products.form.helpers.js` + `admin.products.list.js` untuk CRUD produk + upload.
4. Policy domain gambar eksternal diambil oleh `admin.products.policy.js` dari `GET /api/admin/image-policy`.
5. `admin.status.js` menu `Pengaturan`: buka/tutup penerimaan pesanan + ganti password admin.
6. `admin.pdf.modal.js` + `admin.pdf.export.js` untuk validasi dan export PDF/CSV.

Catatan penting:
- thumbnail produk admin juga lewat `optimizeImageUrl(...)` (lihat `admin.utils.js`).
- form URL gambar produk admin menampilkan hint allowlist domain dari backend (`/api/admin/image-policy`) sebelum submit.
- script vendor admin berat (Chart.js, jsPDF, jsPDF-autotable) dimuat lazy lewat loader UMD dengan SRI integrity.
- admin memiliki `admin.module.bridge.js` sebagai adapter vendor yang memaksa jalur loader SRI; remote dynamic `import()` CDN tidak dipakai.
- `index.html` dan `admin.html` sekarang memakai single `<script type="module">` entry (`public.entry.module.js` / `admin.entry.module.js`).
- style statistik admin (`.stats-*`, `.stat-*`) dipusatkan di `public/css/admin.css`.
- style form/table admin dipisah ke `public/css/admin.forms.css`.
- style halaman siswa dipisah ke `public/css/storefront.css` + `public/css/storefront.checkout.css` + `public/css/storefront.responsive.css` agar `style.css` tetap berisi layer shared.
- jika backend mengembalikan `401 E-ADMIN-SESSION-REPLACED`, frontend admin menampilkan popup berisi device/browser, IP, dan waktu login WIB dari sesi pengganti lalu kembali ke halaman login.
- ganti password memerlukan popup konfirmasi; jika sukses frontend langsung logout lokal karena semua sesi aktif sudah diinvalidasi backend.

## Logging Frontend

- Semua log frontend melalui `appLogger` (`public/js/logger.js`).
- Tujuan: format konsisten, lebih mudah debug, dan menghindari `console.*` tersebar.
- Ini hanya untuk frontend; backend tetap memakai structured logger `createLogger`.

## Keamanan Frontend

- SRI (Subresource Integrity) untuk semua script CDN eksternal.
- Render data dinamis memakai DOM API, `textContent`, dan `createSafeElement`; assignment `innerHTML` tidak dipakai di `public/js`.
- `smoke:frontend-structure` menandai regresi bila ada `innerHTML` baru di `public/js`.
- Validasi nama pemesan Unicode-aware (`^[\p{L}\s.'\-()]+$u`), maksimal 22 karakter sesuai backend.
- CSRF protection otomatis via Origin/Referer validation di backend.

## Integrasi API Frontend

- Health check: `GET /api/health`
- Katalog: `GET /api/products` (cached 5 menit)
- Optimasi gambar: `GET /api/image-optimize`
- Policy gambar admin: `GET /api/admin/image-policy`
- Checkout: `POST /api/checkout/session`
- QRIS: `POST /api/payment/qris`
- Status payment: `GET /api/payment/status`
- Cancel payment: `POST /api/payment/cancel`
- Save order final: `POST /api/orders`
- Verifikasi publik: `GET /api/orders/verify/:token`
