# Decisions

## Metadata

- Last updated: 2026-05-10
- Owner: Tim Koperasi TWOSRA
- Scope: Keputusan arsitektur aktif dan dampaknya

Dokumen ini menyimpan keputusan arsitektur/flow yang masih aktif dan sering membingungkan jika hanya dilihat dari kode. Jika sebuah keputusan sudah tidak aktif, hapus atau tandai sebagai diganti.

Aturan pakai:

- isi hanya keputusan yang benar-benar penting
- satu keputusan singkat lebih baik daripada penjelasan panjang
- jika keputusan sudah tidak berlaku, tandai sebagai diganti atau hapus jika benar-benar tidak relevan lagi

## D-001: Browser Bukan Sumber Kebenaran Setelah Checkout Session

Status: aktif

Keputusan:

- setelah `checkout_session` terbentuk, payload browser untuk `/api/orders` tidak authoritative

Alasan:

- browser mudah dimanipulasi
- server sudah punya snapshot yang lebih aman lewat:
  - `checkout_sessions`
  - `stock_reservations`
  - data produk di DB

Dampak:

- order final pasca-checkout harus dibentuk dari data server
- payload client hanya dipakai sebagai sinyal audit/log

File terkait:

- `src/routes/public.ts`
- `src/routes/payment.ts`

## D-002: Tampering Pasca-Checkout Disanitasi, Bukan Otomatis Ditolak

Status: aktif

Keputusan:

- jika payment valid untuk session asli, manipulasi payload sesudah checkout tidak boleh mengubah order final
- sistem mengabaikan payload client yang menyimpang dan tetap memproses order dari snapshot server

Alasan:

- payment sudah valid untuk session resmi
- menolak mentah semua kasus pasca-payment membuat UX dan operasional lebih kacau
- yang lebih penting adalah browser tidak bisa mengubah isi order final

Dampak:

- security log harus mencatat mismatch client vs server
- order final tetap mengikuti snapshot server

File terkait:

- `src/routes/public.ts`
- `public/js/checkout/form.payment.flow.js`
- `public/js/checkout/form.payment.polling.js`

## D-003: Incident Operasional Harus Dipisah Dari Tampering

Status: aktif

Keputusan:

- payment valid tetapi gagal simpan order tidak boleh langsung dianggap tampering

Alasan:

- penyebabnya bisa stok konflik langka, reservasi konflik langka, atau error internal server
- admin perlu membedakan security mismatch vs failure operasional

Dampak:

- log incident operasional dipisah dari log security
- UI tidak boleh menampilkan halaman sukses palsu saat order belum tercatat

File terkait:

- `src/routes/public.ts`
- `public/js/checkout/form.payment.flow.js`
- `public/js/checkout/form.payment.polling.js`

## D-004: Workflow Utama Hanya Satu Dokumen

Status: aktif

Keputusan:

- `WORKFLOW.md` adalah satu-satunya dokumen workflow utama
- dokumen workflow detail terpisah dihapus untuk menghindari duplikasi

Alasan:

- dua dokumen workflow dengan peran mirip membuat AI dan manusia bingung
- satu dokumen workflow utama lebih mudah dipelihara

Dampak:

- `WORKFLOW.md` harus cukup lengkap tetapi tetap ringkas
- konteks historis dipindahkan ke `MIGRATION.md`

File terkait:

- `WORKFLOW.md`
- `MIGRATION.md`

## D-005: MIGRATION Adalah Dokumen Historis, Bukan Primary Truth

Status: aktif

Keputusan:

- `MIGRATION.md` dipakai untuk menjelaskan perubahan dari flow lama ke flow baru
- bukan sumber kebenaran perilaku sistem saat ini

Alasan:

- dokumen migrasi berfungsi menjelaskan alasan perubahan, bukan keadaan akhir
- source of truth saat ini tetap kode terbaru dan `WORKFLOW.md`

Dampak:

- AI/manusia membaca `MIGRATION.md` hanya saat butuh konteks historis

File terkait:

- `MIGRATION.md`
- `WORKFLOW.md`
- `docs/ai/START_HERE.md`

## D-006: `payment_amount` Browser Bukan Sumber Kebenaran Finansial Pasca-Checkout

Status: aktif

Keputusan:

- setelah `checkout_session` terbentuk dan QRIS dibuat, total dibayar dan fee gateway tidak boleh dibentuk dari `payment_amount` browser
- nilai finansial final harus mengikuti snapshot server/gateway yang tersimpan di checkout session

Alasan:

- payload browser mudah dimanipulasi walau item order final sudah aman
- jika `payment_amount` browser dipercaya, fee QRIS dapat tercatat salah dan merusak summary, admin, verifikasi publik, serta log
- sumber kebenaran finansial harus sama di seluruh permukaan sistem

Dampak:

- `fee` order final harus mengikuti metadata gateway/server
- `order_summary.payment_amount` harus mengikuti snapshot server
- mismatch `payment_amount` client vs server harus masuk security log
- tampering finansial diperlakukan sebagai security mismatch, bukan normal

File terkait:

- `src/routes/payment.ts`
- `src/routes/public.ts`
- `src/utils/telegram.ts`

## D-007: Log Telegram Dipisah ke Topic Order, Security, dan Admin

Status: aktif

Keputusan:

- log Telegram tidak lagi dianggap satu timeline campuran
- semua env Telegram penting sekarang wajib diisi lengkap:
  - `TELEGRAM_CHAT_ID`
  - `TELEGRAM_TOPIC_ORDER`
  - `TELEGRAM_TOPIC_SECURITY`
  - `TELEGRAM_TOPIC_ADMIN`
- event order/payment normal diarahkan ke topic `Order`
- security mismatch, incident, dan rate limit diarahkan ke topic `Security`
- audit admin diarahkan ke topic `Admin`

Alasan:

- satu chat campuran membuat log ramai dan sulit dipindai saat beberapa user transaksi berdekatan
- pemisahan topic memberi keterbacaan lebih baik tanpa menambah kompleksitas queue log
- proyek masih cukup kecil sehingga topic forum Telegram lebih proporsional daripada sistem queue penuh

Dampak:

- onboarding harus tahu bahwa topic ID Telegram adalah bagian dari konfigurasi wajib
- penggantian token/env lokal membutuhkan restart worker agar nilai baru terbaca
- urutan per transaksi tetap dijaga lokal di request yang sama, tetapi urutan global antar transaksi tetap tidak dijamin absolut

File terkait:

- `src/utils/telegram.ts`
- `src/routes/public.ts`
- `src/routes/payment.ts`
- `src/routes/admin.ts`
- `README.md`

## D-008: Status Pengambilan Bersifat Final dan Hanya Diubah Dari Menu Admin

Status: aktif

Keputusan:

- order memiliki status pengambilan tersendiri:
  - `BELUM_DIAMBIL`
  - `SUDAH_DIAMBIL`
- perubahan status hanya boleh dilakukan dari menu admin
- perubahan status bersifat satu arah/final:
  - `BELUM_DIAMBIL -> SUDAH_DIAMBIL`
- halaman verifikasi publik hanya menampilkan status pengambilan dan waktu pengambilan
- perubahan status pengambilan tidak dikirim sebagai log Telegram rutin

Alasan:

- koperasi butuh jejak serah-terima barang yang tidak lagi bergantung pada catatan kertas
- risiko utama yang ingin dikurangi adalah pengambilan ganda karena lupa dicatat
- status final lebih aman untuk audit daripada toggle yang bisa bolak-balik

Dampak:

- tabel `orders` perlu menyimpan `pickup_status` dan `picked_up_at`
- admin order list/detail harus menampilkan aksi final penandaan pengambilan
- verifikasi publik harus menampilkan status pengambilan dan waktu pengambilan sampai detik
- onboarding harus tahu bahwa fitur ini sengaja tidak punya rollback UI biasa

File terkait:

- `schema.sql`
- `src/routes/admin.ts`
- `src/routes/public.ts`
- `src/utils/order-pickup-schema.ts`
- `public/js/admin/admin.orders.shared.js`
- `public/js/admin/admin.orders.stats.kpi.js`
- `public/js/admin/admin.orders.stats.charts.js`
- `public/js/admin/admin.orders.list.js`
- `public/js/verifikasi.js`
- `public/verifikasi.html`

## D-009: Status Tutup Web Hanya Memblokir Checkout Baru

Status: aktif

Keputusan:

- saat admin menutup penerimaan pesanan, sistem hanya menolak checkout baru
- checkout yang sudah punya `checkout_session` tetap boleh lanjut ke QRIS, polling status, recovery, dan save order final

Alasan:

- memblokir transaksi lama yang sudah sah berisiko mengubah kasus normal menjadi incident operasional
- recovery diperlakukan sebagai kelanjutan transaksi lama, bukan checkout baru
- admin tetap bisa menghentikan arus pesanan baru tanpa mengorbankan transaksi yang sedang berjalan

Dampak:

- source of truth status buka/tutup ada di `store_status`
- `POST /api/checkout/session` harus menolak saat web ditutup
- endpoint payment/recovery/order final tetap menerima checkout token lama yang masih sah
- frontend publik harus membedakan "pesanan baru ditutup" vs "transaksi lama tetap diproses"

File terkait:

- `src/utils/store-status.ts`
- `src/routes/payment.ts`
- `src/routes/admin.ts`
- `public/js/checkout/form.payment.flow.js`
- `public/js/checkout/form.payment.polling.js`

## D-010: Penutupan Web Tidak Membatalkan Pesanan Yang Sudah Dibayar

Status: aktif

Keputusan:

- jika payment sudah valid dan order sudah atau sedang diproses dari sesi checkout yang sah, penutupan web setelah itu tidak membatalkan pesanan secara otomatis
- tindak lanjut untuk pesanan lama dilakukan manual hanya jika ada kendala operasional nyata
- bila pembeli memilih refund manual, nominal refund mengikuti subtotal barang; fee gateway tidak ikut karena dibayarkan ke pihak ketiga

Alasan:

- menutup web dipakai untuk menghentikan pesanan baru, bukan untuk membatalkan transaksi lama yang sah
- memaksa pembatalan otomatis sesudah bayar justru meningkatkan risiko incident operasional dan kebingungan pengguna
- kebijakan refund perlu tegas karena koperasi tidak menerima fee gateway sebagai pemasukan bersih

Dampak:

- dokumentasi dan UI harus menjelaskan bahwa pesanan lama tetap sah walau web ditutup setelahnya
- admin hanya perlu follow-up bila ada masalah stok, harga, jadwal pickup, atau operasional lain
- refund merupakan keputusan operasional manual, bukan flow otomatis sistem

File terkait:

- `WORKFLOW.md`
- `README.md`
- `public/index.html`
- `public/admin.html`

## D-011: Cancel Payment Frontend Harus Tahan Tab Close/Refresh

Status: aktif

Keputusan:

- saat user keluar dari tab payment, frontend memprioritaskan `navigator.sendBeacon` untuk mengirim cancel
- jika `sendBeacon` gagal/tidak tersedia, frontend fallback ke `fetch` dengan `keepalive: true`

Alasan:

- request cancel biasa sering putus saat browser menutup halaman
- reservasi stok perlu dilepas secepat mungkin agar stok publik tetap akurat

Dampak:

- cancel manual dan cancel otomatis punya peluang kirim yang lebih andal
- tetap perlu lapisan cleanup backend (lazy + cron) sebagai jaring pengaman

File terkait:

- `public/js/checkout/form.payment.flow.js`
- `public/js/checkout/form.payment.polling.js`
- `src/routes/payment.ts`
- `src/index.ts`

## D-012: Gambar Eksternal Frontend Lewat Proxy Optimasi Backend

Status: aktif

Keputusan:

- frontend tidak langsung memuat URL gambar mentah dari origin eksternal
- frontend memakai helper `optimizeImageUrl(...)` yang mengarah ke endpoint backend `GET /api/image-optimize`

Alasan:

- banyak gambar sumber berukuran besar (multi-MB, resolusi jauh di atas kebutuhan UI)
- halaman katalog/admin perlu menekan bandwidth dan waktu render di koneksi mobile

Dampak:

- backend menambahkan guard URL gambar (protocol/hostname/anti-recursive), clamp parameter (`w/h/q`), dan cache header
- frontend katalog, keranjang, dan thumbnail admin harus pakai URL hasil helper optimasi

File terkait:

- `src/routes/public.ts`
- `public/js/config.js`
- `public/js/app.core.js`
- `public/js/app.receipt.js`
- `public/js/app.events.js`
- `public/js/cart.core.js`
- `public/js/cart.swipe.js`
- `public/js/cart.ui.js`
- `public/js/admin/admin.utils.js`

## D-013: Logging Frontend Dipusatkan ke `appLogger`

Status: aktif

Keputusan:

- logging frontend memakai `public/js/logger.js` sebagai satu pintu (`appLogger.info/warn/error/debug`)
- hindari `console.log/error/warn` tersebar langsung di modul bisnis frontend

Alasan:

- format log lebih konsisten dan mudah difilter saat debugging
- menurunkan noise console di browser

Dampak:

- semua modul frontend publik/admin/verifikasi mengandalkan `appLogger`
- aturan ini hanya untuk frontend; backend tetap memakai structured logger `createLogger`

File terkait:

- `public/js/logger.js`
- `public/index.html`
- `public/admin.html`
- `public/verifikasi.html`

## D-014: Rate Limit Endpoint Sensitif Memprioritaskan Durable Objects

Status: aktif

Keputusan:

- middleware rate limit memprioritaskan penyimpanan counter terdistribusi via Durable Objects (`RATE_LIMITER`)
- jika binding DO belum aktif atau request ke DO timeout/gagal sementara, sistem fallback ke limiter in-memory

Alasan:

- limiter in-memory saja tidak cukup andal untuk skala multi-instance
- transisi bertahap perlu tetap aman tanpa membuat endpoint gagal total saat konfigurasi DO belum siap

Dampak:

- endpoint sensitif (`admin-login`, `checkout/session`, `payment/*`, termasuk endpoint publik tertentu) mendapat proteksi lebih konsisten lintas instance
- tetap ada mode degradasi aman saat DO tidak tersedia

File terkait:

- `src/middleware/rate-limit.ts`
- `src/durable/rate-limiter.ts`
- `src/index.ts`
- `wrangler.jsonc`

## D-015: `/api/image-optimize` Dikeraskan Dengan Allowlist Domain dan Validasi Tipe Konten

Status: aktif

Keputusan:

- endpoint `GET /api/image-optimize` hanya menerima URL sumber dari domain yang diizinkan
- endpoint menolak sumber non-gambar (`content-type` harus `image/*`)
- endpoint memiliki rate limit khusus
- form admin produk mengikuti policy domain yang sama lewat `GET /api/admin/image-policy`

Alasan:

- endpoint transform gambar berpotensi jadi jalur abuse bandwidth/cost jika terlalu terbuka
- validasi terpusat di backend + sinkronisasi ke frontend admin mengurangi URL sumber berisiko sejak input awal

Dampak:

- konfigurasi env `IMAGE_OPTIMIZE_ALLOWED_DOMAINS` menjadi parameter operasional penting
- input URL gambar eksternal di admin lebih ketat dan konsisten dengan policy backend

File terkait:

- `src/routes/public.ts`
- `src/routes/admin.ts`
- `public/js/admin/admin.products.policy.js`
- `public/js/admin/admin.products.form.js`
- `public/js/admin/admin.products.list.js`
- `public/admin.html`
- `src/types/bindings.ts`

## D-016: Sesi Admin Bersifat Tunggal (Single-Session Enforcement)

Status: aktif

Keputusan:

- hanya satu sesi login aktif untuk akun admin pada satu waktu
- login baru otomatis menginvalidasi sesi lama (`active_session_id` diganti)
- token admin membawa `sid` dan wajib cocok dengan sesi aktif di DB saat akses route admin
- saat sesi lama ter-kick, backend mengembalikan `401 E-ADMIN-SESSION-REPLACED` beserta metadata login pengganti (device/browser, IP, waktu WIB)

Alasan:

- mencegah akun admin aktif bersamaan di banyak perangkat tanpa kontrol
- memudahkan audit operasional ketika terjadi login dari perangkat baru
- lebih aman dan lebih sederhana daripada mengandalkan fingerprint/IP sebagai kunci autentikasi

Dampak:

- middleware auth admin tidak lagi cukup dengan verifikasi signature JWT saja
- flow frontend admin harus menampilkan popup sesi digantikan dan kembali ke login
- logout lama yang sudah ter-kick harus bersifat no-op terhadap sesi terbaru (tidak boleh menghapus sesi aktif baru)
- TTL token admin dipersingkat menjadi 1 jam

File terkait:

- `src/middleware/auth.ts`
- `src/utils/admin-session-schema.ts`
- `src/routes/admin.ts`
- `public/js/admin/admin.auth.js`
- `schema.sql`

## D-017: Ganti Password Admin Wajib Re-Auth Total

Status: aktif

Keputusan:

- admin dapat mengganti password hanya dari menu `Pengaturan`
- endpoint `POST /api/admin/change-password` mewajibkan:
  - `current_password` valid
  - `new_password` dan `confirm_password` cocok
  - password baru kuat (minimal 12, huruf besar/kecil, angka, simbol, tanpa spasi)
  - password baru tidak boleh sama dengan password lama
- setelah password berhasil diubah, `active_session_id` dihapus (invalidate semua sesi aktif)
- frontend menampilkan konfirmasi sebelum submit dan memaksa login ulang setelah sukses

Alasan:

- menjaga kredensial admin tetap rotasi tanpa membuka risiko sesi lama tetap aktif
- mengurangi blast radius bila cookie/token lama sempat terekspos
- flow tetap sederhana karena hanya ada satu akun admin saat ini

Dampak:

- admin harus login ulang di semua perangkat setelah password diubah
- route ganti password membutuhkan rate limit terpisah dari login
- UI admin tab `Pengaturan` menggabungkan kontrol status web dan keamanan akun

File terkait:

- `src/routes/admin.ts`
- `public/js/admin/admin.status.js`
- `public/js/admin/admin.init.js`
- `public/admin.html`
- `public/css/admin.css`
- `public/css/admin.forms.css`
- `test/admin.spec.ts`
