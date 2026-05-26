# Workflow Sistem Koperasi TWOSRA

## Metadata

- Last updated: 2026-05-09
- Owner: Tim Koperasi TWOSRA
- Scope: Source of truth alur bisnis, aturan data, dan failure mode runtime

Dokumen ini adalah sumber utama untuk memahami alur sistem. Tujuannya menjaga satu penjelasan workflow yang cukup lengkap, tetapi tetap singkat untuk onboarding cepat.

Untuk orientasi umum proyek, baca juga `README.md`.
Untuk konteks AI yang hemat token, mulai dari `docs/ai/START_HERE.md`.
Diagram alur visual pendamping tersedia di `docs/diagrams/workflow.md`.

Batasan dokumen ini:

- fokus pada aturan bisnis, alur data, dan perilaku runtime
- tidak membahas langkah setup/deploy detail (lihat `README.md` dan `scripts/README.md`)

## Versi Sederhana

Jika dijelaskan ke orang yang tidak teknis, alur sistem ini bisa dipahami seperti ini:

1. siswa memilih barang
2. server menyiapkan sesi checkout resmi
3. stok sementara "dipegang dulu" agar tidak bentrok dengan pembeli lain
4. siswa membayar lewat QRIS
5. server mengecek ke gateway apakah pembayaran benar-benar selesai
6. jika valid, server baru mencatat order final
7. admin nantinya menandai apakah barang sudah benar-benar diambil
8. jika ada data browser yang aneh atau berubah, server tetap memakai data resminya sendiri

Kalimat paling sederhananya:

- browser boleh mengirim data
- tetapi server yang memutuskan hasil akhirnya

## 1. Gambaran Besar

Sistem terdiri dari tiga lapisan:

1. frontend siswa dan admin
2. backend Cloudflare Worker
3. service pendukung: D1, R2, Pakasir, Telegram

Alur transaksi inti:

`katalog -> keranjang -> checkout session -> reservasi stok -> QRIS -> verifikasi payment -> simpan order final -> summary/PDF/verifikasi publik`

## 2. Prinsip Inti

- browser tidak dipercaya untuk harga final
- sumber kebenaran data ada di backend + D1
- `products.stock` adalah stok fisik
- stok publik = stok fisik - reservasi aktif
- order final baru dibuat setelah payment tervalidasi
- setelah checkout session terbentuk, payload browser bukan penentu order final
- setelah QRIS dibuat, total dibayar dan fee gateway pasca-checkout juga bukan sumber kebenaran browser
- penerimaan pesanan baru dapat ditutup sementara dari admin tanpa memutus checkout lama yang sudah sah
- pesanan yang sudah berhasil dibayar tetap sah walau web ditutup sesudahnya
- status pengambilan hanya boleh diubah dari menu admin
- status pengambilan bersifat satu arah: `BELUM_DIAMBIL -> SUDAH_DIAMBIL`
- halaman verifikasi publik bersifat baca-saja untuk status pengambilan
- sesi login admin bersifat tunggal (single-session): login baru menginvalidasi sesi lama

## 3. Komponen Penting

Frontend siswa:

- `public/index.html`
- `public/js/logger.js`
- `public/js/public.entry.module.js`
- `public/js/app.core.js`
- `public/js/app.events.js`
- `public/js/cart.core.js`
- `public/js/cart.ui.js`
- `public/js/cart.swipe.js`
- `public/js/data.js`
- `public/js/config.js`
- `public/js/checkout/form.*.js`

Frontend admin:

- `public/admin.html`
- `public/css/admin.css`
- `public/js/admin/admin.*.js`

Backend:

- `src/index.ts`
- `src/durable/rate-limiter.ts`
- `src/routes/public.ts`
- `src/routes/payment.ts`
- `src/routes/admin.ts`
- `src/utils/stock-reservations.ts`
- `src/utils/store-status.ts`
- `src/utils/telegram.ts`
- `src/utils/d1-retry.ts`
- `src/utils/logger.ts`
- `src/utils/checkout-session-schema.ts`
- `src/utils/order-pickup-schema.ts`
- `src/middleware/auth.ts`
- `src/middleware/csrf.ts`
- `src/middleware/rate-limit.ts`
- `src/middleware/request-logger.ts`

Database inti:

- `products`
- `checkout_sessions`
- `stock_reservations`
- `orders`
- `order_items`
- `admin_users`
- `store_status`

## 4. Identifier dan Sumber Kebenaran

Identifier utama:

- `order_id`: id transaksi yang dibangkitkan server
- `checkout_token`: token sesi checkout/payment
- `verification_token`: token verifikasi publik

Sumber kebenaran per area:

- stok fisik: `products.stock`
- stok tersedia publik: hasil hitung backend dari reservasi aktif
- amount checkout resmi: `checkout_sessions.amount`
- isi order final pasca-checkout: snapshot server dari `checkout_sessions` + `stock_reservations` + data produk DB
- total dibayar dan fee gateway resmi: metadata gateway yang tersimpan di `checkout_sessions`
- status pengambilan final: `orders.pickup_status` + `orders.picked_up_at`
- status penerimaan pesanan baru: `store_status.accepting_orders`

Penjelasan awam:

- "sumber kebenaran" artinya data mana yang paling dipercaya bila ada perbedaan
- dalam sistem ini, data resmi ada di server/database, bukan di browser pengguna

## 5. Alur Siswa Normal

### 5.1 Katalog

- frontend memanggil `GET /api/products`
- backend mengembalikan stok tersedia, bukan stok fisik mentah

### 5.2 Keranjang

- keranjang hidup di browser (`localStorage`)
- user bisa masuk mode pilih untuk memilih banyak item yang akan dihapus
- hapus item tunggal tersedia langsung per produk (ikon trash)
- `Hapus Semua` tetap aksi global saat mode pilih tidak aktif
- saat mode pilih aktif, checkout sementara dikunci agar tidak mencampur aksi hapus dan pembayaran
- sebelum checkout, frontend tetap divalidasi ulang terhadap data server

### 5.3 Checkout Session

Frontend memanggil `POST /api/checkout/session`.

Backend melakukan:

1. validasi item
2. hitung ulang total dari DB
3. cek stok tersedia real-time
4. buat `checkout_sessions`
5. buat `stock_reservations`

Hasil penting:

- browser menerima `checkout_token`
- browser menerima `order_id`
- browser menerima `amount` resmi dari server

Jika total client berbeda dari hitungan server:

- backend menolak dengan `E-CHECKOUT-TAMPERING`

Jika stok berubah karena user lain lebih cepat reserve:

- backend menolak dengan `E-STOCK-CHECKOUT`
- frontend mengarahkan user kembali menyesuaikan keranjang

Jika admin sedang menutup penerimaan pesanan:

- backend menolak checkout baru dengan `E-STORE-CLOSED`
- frontend menampilkan info bahwa koperasi sedang tidak menerima pesanan

### 5.4 Buat QRIS

Frontend memanggil `POST /api/payment/qris` memakai `checkout_token`.

Backend:

- mengambil amount resmi dari `checkout_sessions`
- meminta QRIS ke Pakasir
- menyimpan metadata payment ke session, termasuk total dibayar gateway dan fee gateway

Catatan cancel saat tab ditutup/refresh:

- frontend mencoba kirim cancel lewat `navigator.sendBeacon` terlebih dulu
- jika `sendBeacon` gagal/tidak tersedia, frontend fallback ke `fetch` dengan `keepalive: true`
- tujuan utamanya agar request cancel tetap sempat terkirim walau user meninggalkan halaman

### 5.5 Polling Payment

Frontend polling `GET /api/payment/status`.

Backend:

- cek status ke Pakasir
- update status gateway di session
- jika status final gagal, session dibatalkan dan reservasi dilepas

### 5.6 Simpan Order Final

Saat payment berstatus `completed`, frontend mengirim `POST /api/orders`.

Backend melakukan:

1. validasi identitas pemesan (nama, kelas, WA, pickup date/slot)
2. validasi session dan reservasi aktif
3. rekonstruksi order dari `checkout_sessions` + `stock_reservations` + DB produk
4. verifikasi ulang payment ke gateway (server-to-server)
5. deteksi mismatch payload client vs snapshot server (security log)
6. simpan `orders`
7. simpan `order_items`
8. potong stok fisik
9. ubah reservasi menjadi `CONSUMED`
10. update session jadi `COMPLETED`
11. kirim notifikasi Telegram (non-blocking)

Nilai `kelas` yang diterima server harus cocok dengan format:
`(X|XI|XII) (TP|TKR|TKP|DPIB|TITL|TKJ)` - validasi dilakukan server.

### 5.7 Summary dan PDF

- frontend menampilkan summary sukses hanya jika order benar-benar sudah tercatat
- bila payment sukses tetapi pencatatan order gagal otomatis, frontend masuk ke view `payment-review` alih-alih menampilkan sukses palsu
- summary sukses memprioritaskan `order_summary` dari backend bila tersedia
- frontend membuat PDF bukti bayar
- CSV transaksi bisa diekspor dari menu admin
- QR verifikasi memakai `verification_token`

### 5.8 Penandaan Pengambilan Barang

Setelah order final sudah ada, proses serah-terima barang dicatat terpisah.

Aturannya:

1. admin melihat order di menu admin
2. admin menandai `SUDAH_DIAMBIL` hanya jika barang benar-benar sudah diserahkan
3. backend menyimpan waktu pengambilan sampai detik
4. status ini bersifat final dan tidak dapat dikembalikan lewat UI biasa
5. halaman verifikasi publik hanya menampilkan hasilnya

### 5.9 Jika Web Ditutup Setelah Pembayaran

Jika admin menutup penerimaan pesanan setelah seorang siswa sudah sempat membayar:

1. pesanan yang sudah dibayar tetap dianggap sah
2. penutupan web hanya menghentikan checkout baru
3. transaksi lama yang sudah punya checkout session tetap boleh lanjut sampai order final/summary
4. admin hanya perlu menindaklanjuti jika memang ada kendala nyata

Contoh kendala yang mungkin muncul:

- stok fisik ternyata tidak cukup
- harga barang berubah tetapi belum diperbarui di sistem
- jadwal pengambilan terdampak libur atau penutupan koperasi yang panjang
- kondisi operasional lain yang membuat pesanan tidak bisa dipenuhi seperti semula

Pilihan tindak lanjut yang bisa ditawarkan admin:

- menunggu sampai stok tersedia
- mengganti dengan barang lain yang disepakati
- mengubah jadwal pengambilan
- refund manual

Catatan refund manual:

- refund dilakukan hanya jika pembeli memilih opsi refund setelah menerima penjelasan admin
- nominal refund mengikuti subtotal barang yang dipesan
- fee layanan/payment gateway tidak termasuk refund karena dibayarkan ke pihak ketiga

## 6. Recovery Payment

Recovery dipakai saat:

- browser refresh
- browser tertutup
- jaringan sempat putus
- status payment masih ambigu

Aturan recovery:

- frontend menyimpan sesi pending di `localStorage`
- selama belum melewati `expires_at`, sesi yang sama bisa dipulihkan
- recovery tidak membuat reservasi baru
- jika admin menutup penerimaan pesanan di tengah jalan, recovery transaksi lama tetap boleh berjalan
- jika recovery window habis, user diminta checkout ulang
- frontend juga dapat mengirim event seperti sesi dipulihkan, recovery habis, retry habis, atau fallback pencatatan order ke endpoint `/api/payment/event`
- event frontend yang normal cukup dicatat di structured logger; hanya event abnormal yang diteruskan ke Telegram

## 7. Model Reservasi Stok

`stock_reservations` punya tiga status:

- `RESERVED`: reservasi aktif
- `RELEASED`: reservasi dilepas
- `CONSUMED`: reservasi dipakai oleh order final

Reservasi dibuat saat checkout session berhasil.
Reservasi dilepas jika:

- user cancel
- session expired
- gateway gagal
- cleanup menemukan reservasi kadaluarsa

Reservasi dikonsumsi saat order final berhasil dicatat.

## 8. Keamanan dan Anti-Tampering

Sebelum checkout session:

- backend harus menolak harga/total palsu dari browser

Sesudah checkout session:

- browser tidak boleh mengubah order final
- browser tidak boleh mengubah fee atau total dibayar final
- jika payload `/api/orders` berbeda dari snapshot server, backend harus:
  - mengabaikan payload client yang tidak authoritative
  - memakai snapshot server untuk order final
  - mencatat security log mismatch

Khusus area finansial:

- field seperti `payment_amount` dari browser tidak boleh dipakai sebagai sumber kebenaran fee
- mismatch `payment_amount` client vs snapshot server/gateway harus dianggap security mismatch

Khusus area rate limit:

- endpoint sensitif memprioritaskan limiter Durable Objects (`RATE_LIMITER`)
- jika binding DO tidak tersedia/gagal sementara, limiter in-memory menjadi fallback agar perlindungan tetap ada
- endpoint `GET /api/image-optimize` memakai rate limit khusus terpisah

Khusus area optimasi gambar:

- `/api/image-optimize` hanya menerima sumber URL dari domain allowlist
- sumber non-gambar ditolak (`content-type` harus `image/*`)
- guard anti-SSRF tetap aktif (blok localhost/IP private termasuk `0.0.0.0/8` dan `169.254.0.0/16` + anti-recursive ke endpoint optimize yang sama)

Khusus area CSRF:

- semua endpoint mutating tetap validasi `Origin`/`Referer`
- jika header tersebut kosong, request hanya boleh lolos untuk caller internal dengan `x-internal-key` yang cocok dengan `INTERNAL_WEBHOOK_KEY`

Khusus area sesi admin:

- token login admin berumur 1 jam
- setiap token admin membawa `session_id` (`sid`) yang diverifikasi ke DB
- login baru menyimpan `active_session_id` baru dan otomatis menendang sesi lama
- request admin dengan `sid` lama ditolak (`401`) dan frontend menampilkan popup detail login pengganti (device/browser, IP, waktu WIB)
- endpoint ganti password admin mewajibkan password lama valid + policy password kuat, lalu menginvalidasi semua sesi aktif dan memaksa login ulang

Pembedaan penting:

- security mismatch: payload client berbeda dari snapshot server
- operational incident: payment valid tetapi order gagal dicatat

Jangan campur dua kategori ini di log.

Penjelasan awam:

- **security mismatch** = pengguna/browser mengirim data yang berbeda dari data resmi server
- **operational incident** = sistem sedang bermasalah secara teknis, walau pembayaran atau data dasarnya bisa saja valid

Perbedaan ini penting karena:

- admin tidak boleh langsung menuduh semua masalah sebagai percobaan curang
- tetapi admin juga tidak boleh menganggap manipulasi sebagai error biasa

## 9. Alur Admin

Admin flow utama:

1. login via JWT cookie HttpOnly
2. login baru otomatis menginvalidasi sesi lama (single-session enforcement)
3. dashboard memuat order dan produk
4. statistik dihitung dari order tervalidasi dengan KPI yang dijaga tetap ringkas untuk kebutuhan operasional
5. admin dapat menandai status pengambilan final dari order
6. admin dapat membuka/menutup penerimaan pesanan baru dari menu `Pengaturan`
7. admin dapat mengganti password dari menu `Pengaturan` (konfirmasi password lama + konfirmasi aksi)
8. jika password berhasil diubah, semua sesi admin aktif diakhiri dan admin wajib login ulang
9. admin dapat CRUD produk dan upload gambar
10. admin form produk mengikuti policy domain URL gambar eksternal dari endpoint `GET /api/admin/image-policy`
11. admin dapat mengekspor laporan transaksi ke PDF atau CSV

Guard penting pada produk:

- saat ada reservasi aktif, sistem menolak:
  - ubah SKU
  - ubah nama produk
  - ubah kategori produk
  - ubah harga
  - hapus produk
  - set stok fisik di bawah jumlah reservasi aktif

Catatan statistik admin:

- pendapatan kotor = subtotal barang + fee QRIS
- pendapatan bersih koperasi = subtotal barang
- ini penting karena fee QRIS ditanggung pembeli, bukan dipotong dari pendapatan koperasi
- KPI statistik admin sengaja dibatasi pada metrik order final yang langsung berguna untuk operasional koperasi
- KPI dan grafik utama sama-sama mulai dari preset default `Bulan Ini`, tetapi setiap grafik tetap dapat memakai filter sendiri
- preset `Tahun Ini` dibaca sebagai data dari 1 Januari sampai waktu WIB saat ini, bukan termasuk tanggal masa depan di tahun yang sama

## 10. Cleanup Reservasi dan Session

Cleanup memakai dua lapisan:

1. **lazy release** expired reservations - dipanggil di awal hampir semua endpoint yang menyentuh stok atau session:
   - `POST /api/checkout/session`
   - `POST /api/payment/qris`
   - `GET /api/payment/status`
   - `POST /api/payment/cancel`
   - `GET /api/products`
   - `POST /api/orders`
2. **lazy cleanup** sesi checkout kedaluwarsa - berjalan berkala tiap 60 detik (in-flight guard mencegah dua cleanup berjalan bersamaan)
   - sesi checkout yang sudah melewati `expires_at` dihapus agar sesi sementara dan reservasi lama tidak menumpuk
3. **cron sweep** tiap 10 menit via Cloudflare Scheduled Worker

Tambahan:

- purge data reservasi lama dijalankan per jam (tick menit `00` UTC)
- `checkout_sessions` kedaluwarsa dibersihkan lewat lazy cleanup di jalur payment, bukan lewat cron terpisah

## 11. Log Operasional

Telegram dipakai untuk:

- order baru
- security mismatch / tampering signal
- event payment penting
- event frontend payment/recovery
- incident operasional
- rate limit dan aktivitas penting lain

Konfigurasi saat ini:

- Telegram diasumsikan memakai 1 forum group
- topic `Order` untuk checkout/payment/order normal
- topic `Security` untuk tampering, incident, dan rate limit
- topic `Admin` untuk audit login/admin, termasuk perubahan status buka/tutup penerimaan pesanan
- env `TELEGRAM_CHAT_ID`, `TELEGRAM_TOPIC_ORDER`, `TELEGRAM_TOPIC_SECURITY`, dan `TELEGRAM_TOPIC_ADMIN` wajib diisi
- perubahan status pengambilan tidak dikirim sebagai log Telegram rutin
- event `Rate Limit:*` dicatat sekali per client dan window limit agar pola abuse tetap terlihat tanpa membanjiri topic
- timestamp operasional yang dikirim ke Telegram dinormalisasi ke ISO UTC (`...Z`) untuk konsistensi lintas log

Log yang baik harus membantu membedakan:

- tampering payload
- stok konflik/reservasi konflik
- payment valid tapi order gagal dicatat
- error internal server

## 12. Failure Mode Yang Perlu Diingat

Hal yang masih mungkin terjadi meski proteksi utama sudah ada:

- stock conflict langka saat finalisasi
- reservation conflict langka di timing buruk
- incident internal saat simpan order
- metadata gateway tidak lengkap pada session akibat incident langka sebelum save order

Karena itu:

- summary sukses tidak boleh tampil jika order belum benar-benar tercatat
- incident pasca-payment harus punya jalur review manual

## 13. Cara Pakai Dokumen Ini

Jika Anda perlu menjelaskan sistem ini ke orang awam:

- pakai bagian `Versi Sederhana`
- lalu pakai bagian `Identifier dan Sumber Kebenaran`
- dan pakai bagian `Keamanan dan Anti-Tampering`

Kalau butuh cepat:

- baca bagian 1, 2, 5, 8

Kalau butuh debug payment:

- baca bagian 5, 6, 8, 11, 12

Kalau butuh debug stok:

- baca bagian 5.3, 7, 10, 12

Kalau butuh debug admin:

- baca bagian 9
