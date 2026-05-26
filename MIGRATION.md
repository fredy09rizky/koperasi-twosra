# Changelog Migrasi

## Metadata

- Last updated: 2026-04-21
- Owner: Tim Koperasi TWOSRA
- Scope: Konteks historis perubahan arsitektur/flow dari versi lama ke versi aktif

> Status: Historical context only. Source of truth aktif adalah kode terbaru, `WORKFLOW.md`, dan `docs/ai/CURRENT_STATE.md`.

Dokumen ini merangkum perubahan besar dari flow lama ke flow saat ini.

Peran dokumen ini:

- membantu memahami *kenapa* arsitektur/flow berubah
- membantu membandingkan perilaku lama vs perilaku baru
- membantu audit saat menemukan istilah atau asumsi lama di kode/dokumen

Dokumen ini **bukan** sumber kebenaran utama untuk perilaku sistem saat ini.

Batasan isi dokumen ini:

- fokus pada perubahan dari flow lama ke flow baru
- tidak mengulang detail workflow harian secara penuh
- tidak menjadi referensi setup/deploy harian

Rujukan utama:

- detail workflow aktif: `WORKFLOW.md`
- setup/deploy/env: `README.md` + `scripts/README.md`

## Versi Sederhana

Kalau dijelaskan dengan bahasa non-teknis, dokumen ini menceritakan:

- dulu sistem checkout dan stok bekerja dengan cara yang lebih sederhana
- sekarang sistem dibuat lebih hati-hati agar stok, pembayaran, dan order final lebih aman
- tujuan perubahan ini adalah mengurangi bentrok stok, mengurangi data setengah jadi, dan membuat sistem lebih tahan terhadap manipulasi dari browser

Jika ada perbedaan penafsiran:

1. kode terbaru adalah sumber kebenaran tertinggi
2. `WORKFLOW.md` adalah referensi workflow utama
3. `MIGRATION.md` hanya dipakai untuk konteks historis/perubahan

Kapan perlu membaca dokumen ini:

- saat melacak perubahan arsitektur checkout/payment/stok
- saat menemukan bug/regresi yang tampak berasal dari transisi flow lama
- saat perlu tahu alasan dibalik guard atau struktur baru

## Ringkasan Perubahan

1. Sistem stok berpindah dari model stok langsung ke model **stok fisik + reservasi checkout**.
2. Proses simpan order diperketat dengan jalur kompatibel D1 (`DB.batch()` + kompensasi rollback manual) agar konsistensi tetap terjaga.
3. Endpoint produk admin dipisah dari endpoint publik agar metrik stok lebih jelas.
4. Cleanup reservasi dibuat hybrid (lazy + cron) untuk stabilitas saat trafik sepi.
5. UX konflik stok checkout dibuat lebih informatif.
6. Status operasional web dipindahkan menjadi source of truth server-side.

Arti sederhananya:

- sistem baru lebih ketat, tetapi lebih aman
- beberapa perubahan yang terasa "lebih ribet" sebenarnya dibuat untuk mencegah order salah, stok kacau, atau data pembayaran yang membingungkan

## Fitur Baru dan Kelebihannya

1. Reservasi stok saat checkout (`stock_reservations`)
- Kelebihan: mencegah oversell saat banyak user checkout bersamaan.

2. Stok publik berbasis ketersediaan real-time
- Kelebihan: katalog siswa menampilkan stok yang benar-benar bisa dibeli.

3. Order final memakai jalur kompatibel D1 (`DB.batch()` + kompensasi rollback manual)
- Kelebihan: menjaga konsistensi order/stok tanpa bergantung pada SQL `BEGIN/COMMIT`.

4. Admin melihat tiga metrik stok
- `stock_original`: stok fisik.
- `stock_reserved`: stok yang sedang dipegang checkout aktif.
- `stock_available`: stok yang bisa dibeli saat ini.
- Kelebihan: keputusan restock/admin lebih akurat.

5. Guard admin saat reservasi aktif
- Kelebihan: mencegah perubahan berisiko (ubah SKU, ubah harga, hapus produk, atau set stok di bawah reservasi aktif) sambil tetap mengizinkan update stok yang masih aman.

6. Timezone contract eksplisit (`created_at` ISO UTC `...Z`)
- Kelebihan: frontend tidak perlu menebak timezone.

7. Hybrid cleanup reservasi
- lazy cleanup saat request API.
- cron sweep `*/10 * * * *`.
- purge data lama tiap jam (menit 00 UTC).
- Kelebihan: stok cepat pulih saat expired walau trafik rendah.

8. UX konflik stok lebih jelas
- backend mengembalikan `code: E-STOCK-CHECKOUT` + `conflicted_products`.
- frontend menampilkan popup detail produk terdampak.
- Kelebihan: user tahu item mana yang harus disesuaikan di keranjang.

9. Source of truth finansial pasca-checkout diperketat
- `payment_amount` browser tidak lagi dipakai sebagai penentu fee atau total pembayaran final.
- fee dan total dibayar final mengikuti snapshot server/gateway.
- Kelebihan: pencatatan finansial admin, summary sukses, verifikasi publik, dan log jadi konsisten.

10. Status pengambilan barang dicatat langsung di sistem
- order sekarang memiliki `pickup_status` dan `picked_up_at`.
- admin menandai order sebagai `SUDAH_DIAMBIL` dari menu admin.
- halaman verifikasi publik ikut menampilkan status dan waktu pengambilan.
- status pengambilan dibuat satu arah/final agar jejak serah-terima tidak bolak-balik.
- Kelebihan: koperasi tidak perlu lagi bergantung pada catatan kertas untuk mencegah pengambilan ganda.

11. Status buka/tutup penerimaan pesanan menjadi server-side
- source of truth baru ada di `store_status`.
- admin dapat menutup checkout baru tanpa memutus transaksi lama yang sudah punya checkout session.
- frontend publik menampilkan pesan peringatan di form pembeli saat checkout ketika web ditutup.
- perubahan status operasional dicatat ke topic Telegram `Admin`.
- Kelebihan: koperasi bisa menghentikan pesanan baru saat libur panjang tanpa mengorbankan recovery transaksi lama.

12. Tindak lanjut pesanan lama dipisahkan dari status buka/tutup web
- pesanan yang sudah dibayar tetap dianggap sah walau web ditutup sesudahnya.
- bila ada kendala stok, harga, atau jadwal, admin menindaklanjuti manual.
- refund manual mengikuti subtotal barang; fee gateway tidak ikut karena dibayarkan ke pihak ketiga.
- Kelebihan: aturan operasional lebih jelas dan tidak mencampur penutupan web dengan pembatalan otomatis.

13. Hardening cancel payment saat tab ditutup/refresh
- frontend sekarang memprioritaskan `navigator.sendBeacon` untuk request cancel
- fallback otomatis ke `fetch` dengan `keepalive: true` jika beacon gagal/tidak tersedia
- Kelebihan: peluang cancel terkirim tetap tinggi walau user langsung meninggalkan halaman.

14. Optimasi gambar produk eksternal lewat endpoint backend
- endpoint baru `GET /api/image-optimize` bertindak sebagai proxy transform/cache gambar
- frontend memakai helper `optimizeImageUrl(...)` agar gambar berukuran sangat besar tidak langsung diunduh mentah
- Kelebihan: transfer gambar lebih hemat untuk user, terutama pada katalog dan tabel admin.

15. Logging frontend dirapikan ke logger terpusat
- log browser tidak lagi tersebar `console.*` langsung di banyak modul
- sekarang menggunakan `appLogger` (`public/js/logger.js`)
- Kelebihan: noise console berkurang, format log konsisten, debugging lintas modul lebih rapi.

16. Rate limit sensitif dipindah ke mode distributed-first
- middleware rate limit sekarang memprioritaskan Durable Objects (`RATE_LIMITER`) untuk counter lintas instance
- fallback in-memory tetap ada jika binding DO belum aktif/gagal sementara
- Kelebihan: proteksi spam lebih konsisten di environment multi-instance.

17. Hardening endpoint optimasi gambar + sinkron policy admin
- `/api/image-optimize` kini mewajibkan domain sumber dari allowlist (`IMAGE_OPTIMIZE_ALLOWED_DOMAINS`)
- sumber non-gambar ditolak (`content-type` wajib `image/*`)
- endpoint diberi rate limit khusus
- admin menambah endpoint `GET /api/admin/image-policy` agar form produk bisa sinkron dengan allowlist yang sama
- Kelebihan: risiko abuse bandwidth/cost turun, validasi URL gambar lebih konsisten antara backend dan frontend admin.

18. Single-session enforcement untuk admin
- login admin sekarang menyimpan `active_session_id` di server.
- login baru otomatis menendang sesi lama.
- token admin dipersingkat menjadi 1 jam.
- frontend admin menampilkan popup sesi digantikan beserta device/browser, IP, dan waktu login WIB.
- Kelebihan: kontrol akses admin lebih ketat dan audit login lintas perangkat lebih jelas.

19. Fitur ganti password admin + invalidasi total sesi
- endpoint baru `POST /api/admin/change-password`.
- wajib verifikasi password lama + konfirmasi password baru.
- policy password baru: minimal 12 karakter, huruf besar/kecil, angka, simbol, tanpa spasi, dan tidak boleh sama dengan password lama.
- setelah sukses, backend menghapus `active_session_id` sehingga semua sesi login admin aktif langsung tidak berlaku.
- menu admin digabungkan menjadi tab `Pengaturan` (status web + keamanan akun).
- Kelebihan: rotasi kredensial lebih aman tanpa menyisakan sesi lama.

## Perubahan API Penting

1. Endpoint baru admin produk:
- `GET /api/admin/products`
- Mengembalikan data produk + metrik `stock_original`, `stock_reserved`, `stock_available`.

2. `POST /api/checkout/session`:
- Sekarang membuat reservasi stok.
- Bisa mengembalikan `E-STOCK-CHECKOUT` saat stok berubah.
- Bisa mengembalikan `E-CHECKOUT-TAMPERING` saat total checkout mismatch dengan data server.

3. `GET /api/products`:
- Nilai `stock` yang diterima frontend siswa sekarang merepresentasikan `stock_available`.

4. `GET /api/admin/orders` dan `GET /api/orders/verify/:token`:
- `created_at` dinormalisasi ke ISO UTC (`...Z`).

5. Endpoint status operasional:
- `GET /api/store-status`
- `GET /api/admin/store-status`
- `PUT /api/admin/store-status`
- checkout baru sekarang bisa ditolak dengan `E-STORE-CLOSED`.

6. Endpoint policy gambar admin:
- `GET /api/admin/image-policy`
- Mengembalikan `allowed_domains` agar form admin sinkron dengan policy backend.

## Perubahan Skema Database

1. Tabel baru:
- `stock_reservations`
- `store_status`

2. Peran tabel:
- `products.stock` tetap menjadi stok fisik/original.
- reservasi aktif dihitung dari `stock_reservations` status `RESERVED`.
- `store_status.accepting_orders` menjadi sumber kebenaran status buka/tutup checkout baru.

## Dampak ke Frontend

1. Frontend siswa:
- menerima pesan konflik stok lebih detail.
- diarahkan kembali ke keranjang untuk menyesuaikan qty/item.
- menampilkan pesan peringatan di dalam form checkout ketika web ditutup.
- tetap mengizinkan recovery transaksi lama yang sudah sah.
- memiliki view `payment-review` agar pembayaran sukses tetapi order gagal tercatat tidak tampil sebagai sukses palsu.
- menampilkan penjelasan tindak lanjut operasional dan refund manual setelah pembayaran bila diperlukan.

2. Frontend admin:
- sumber data produk beralih ke endpoint admin privat.
- tabel produk menampilkan stok asli, reservasi, dan tersedia.
- mendapat tab `Pengaturan` untuk buka/tutup penerimaan pesanan baru.
- tab `Pengaturan` juga menambahkan form ganti password dengan popup konfirmasi sebelum submit.
- mendapat warning checkout aktif/QRIS aktif sebelum menutup web.

## Perubahan Tooling Operasional Terbaru

1. Script deploy production pernah diperkuat untuk mengurangi human error env
- catatan historis: script sebelumnya pernah membantu set secret `ENVIRONMENT=production`.
- status terbaru 2026-05-01: `scripts/deploy-production.mjs` tidak lagi upload/set secret dan hanya dipakai untuk deploy perubahan kode rutin.
- dampak: setup awal resource, perubahan database/schema, dan rotasi secret dilakukan manual/terkontrol di luar script deploy rutin.

2. Script race reservation diperluas untuk simulasi traffic realistis
- `scripts/reservation-race-test.mjs` sekarang mendukung skenario mixed lebih besar (misal `users=10`, `heavy-users=5`).
- jeda per user dibuat acak dalam skala milidetik (tetap dikontrol `--stagger-ms`) agar tidak selalu urut user 1..N.
- output terminal sekarang menampilkan detail per user:
  - urutan selesai request
  - status hasil
  - `order_id`, `checkout_token`, `amount`
  - timestamp mulai/selesai hingga milidetik dan durasi request
- dampak: investigasi race condition, timeout, dan konflik stok jadi lebih mudah dibaca.

## Checklist Deploy Migrasi

1. Deploy schema terbaru (`schema.sql`) ke D1.
2. Deploy worker terbaru (termasuk scheduled handler).
3. Pastikan cron aktif di Cloudflare Worker (`*/10 * * * *`).
4. Verifikasi endpoint admin produk baru berjalan.
5. Uji race condition minimal 3 user dengan stok tipis.
6. Uji flow cancel/expired untuk memastikan reservasi dilepas.
7. Uji jalur `payment-review` atau fallback payment sukses tetapi order gagal dicatat otomatis.

## Risiko Residual yang Perlu Dimonitor

1. Jika cron belum aktif, stok tetap aman via lazy cleanup tetapi recovery stok bisa lebih lambat saat trafik sepi.
2. Jika konfigurasi gateway bermasalah, order final tetap ditahan (fail-safe), tapi tim operasional perlu pantau log Telegram.
3. Pada jam trafik puncak, monitor latensi endpoint checkout/session dan status D1.

## Istilah Singkat Yang Sering Muncul

- **Lazy cleanup**
  - pembersihan yang dijalankan saat ada request masuk

- **Cron**
  - jadwal otomatis yang berjalan berkala di server

- **Order final atomik**
  - penyimpanan order dibuat sebagai satu rangkaian yang harus berhasil bersama
  - tujuannya agar tidak ada kondisi "order masuk tapi stok tidak ikut berubah" atau sebaliknya

- **Source of truth**
  - data yang paling dipercaya ketika ada perbedaan

- **Regresi**
  - bug yang muncul lagi setelah sebelumnya pernah diperbaiki
