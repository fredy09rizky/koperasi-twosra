-- ===========================================
-- KOPERASI TWOSRA - DUMMY DATA GABUNGAN (PRODUK + TRANSAKSI)
-- ===========================================
-- Jalankan file ini SETELAH schema.sql
-- Seed ini sengaja dibuat lebih ringan dengan harga eceran yang lebih realistis
-- agar katalog demo dan histori transaksi terlihat lebih natural saat dites.
-- Pakai file ini jika Anda ingin langsung mendapatkan:
-- - katalog produk terisi
-- - histori transaksi terisi
-- - verifikasi publik bisa langsung dites
-- - admin produk dan admin order sama-sama punya data
--
-- Jika hanya butuh salah satu domain saja, gunakan:
-- - data-dummy.products.sql      -> inject produk saja
-- - data-dummy.transactions.sql  -> inject transaksi saja
--
-- Catatan penting:
-- - schema.sql selalu dijalankan terlebih dahulu
-- - setelah itu pilih SATU file dummy saja
-- - jangan jalankan semua file dummy sekaligus tanpa reset DB, karena bisa bentrok/duplikat data
-- Mode terpisah juga tersedia:
-- - data-dummy.products.sql      -> inject produk saja
-- - data-dummy.transactions.sql  -> inject transaksi saja
-- Versi data dummy yang lebih besar tersedia di: data-dummy.large.sql
-- ===========================================

-- ===========================================
-- 1. SEED PRODUCTS (20 produk, harga eceran realistis)
-- ===========================================

INSERT INTO products (code, name, price, category, image_url, stock) VALUES
('P001', 'Pensil 2B Faber-Castell', 5900, 'Alat Tulis', 'https://images.pexels.com/photos/18889468/pexels-photo-18889468.jpeg', 80),
('P002', 'Pulpen Pilot G-2 Hitam', 25000, 'Alat Tulis', 'https://images.pexels.com/photos/13583359/pexels-photo-13583359.jpeg', 60),
('P003', 'Penghapus Seed Radar', 5000, 'Alat Tulis', 'https://images.pexels.com/photos/35202/eraser-office-supplies-office-office-accessories.jpg', 50),
('P004', 'Penggaris Besi 30cm', 12000, 'Alat Tulis', 'https://images.pexels.com/photos/6005026/pexels-photo-6005026.jpeg', 30),
('P005', 'Buku Tulis Sidu 58 Lbr', 5500, 'Alat Tulis', 'https://images.pexels.com/photos/3944424/pexels-photo-3944424.jpeg', 120),
('P006', 'Tipex Joyko Cair 20ml', 9500, 'Alat Tulis', 'https://images.pexels.com/photos/5554662/pexels-photo-5554662.jpeg', 35),
('S001', 'Topi Sekolah Hitam SMK', 22000, 'Seragam', 'https://images.pexels.com/photos/9258251/pexels-photo-9258251.jpeg', 40),
('S002', 'Dasi Sekolah Abu-abu', 15000, 'Seragam', 'https://images.pexels.com/photos/5264925/pexels-photo-5264925.jpeg', 30),
('S003', 'Ikat Pinggang Hitam Polos', 18000, 'Seragam', 'https://images.pexels.com/photos/7714764/pexels-photo-7714764.jpeg', 50),
('S004', 'Kacu Pramuka Coklat', 12000, 'Seragam', 'https://images.pexels.com/photos/6978153/pexels-photo-6978153.jpeg', 60),
('S005', 'Tali Kur Pramuka Putih', 8000, 'Seragam', 'https://images.pexels.com/photos/6978153/pexels-photo-6978153.jpeg', 45),
('A001', 'Badge OSIS Bordir', 10000, 'Aksesoris', 'https://images.pexels.com/photos/7468233/pexels-photo-7468233.jpeg', 25),
('A002', 'Name Tag Akrilik', 12000, 'Aksesoris', 'https://images.pexels.com/photos/7648020/pexels-photo-7648020.jpeg', 20),
('A003', 'Lanyard ID Card Hitam', 7000, 'Aksesoris', 'https://images.pexels.com/photos/7108127/pexels-photo-7108127.jpeg', 30),
('M001', 'Air Mineral Aqua 600ml', 4000, 'Makanan/Minuman', 'https://images.pexels.com/photos/7407296/pexels-photo-7407296.jpeg', 100),
('M002', 'Teh Pucuk Harum 350ml', 5000, 'Makanan/Minuman', 'https://images.pexels.com/photos/1417945/pexels-photo-1417945.jpeg', 80),
('M003', 'Roti Sobek Coklat', 8000, 'Makanan/Minuman', 'https://images.pexels.com/photos/7509699/pexels-photo-7509699.jpeg', 40),
('L001', 'Sampul Buku Plastik Bening', 3000, 'Lainnya', 'https://images.pexels.com/photos/4218864/pexels-photo-4218864.jpeg', 60),
('L002', 'Spidol Whiteboard Snowman', 8000, 'Lainnya', 'https://images.pexels.com/photos/4482016/pexels-photo-4482016.jpeg', 25),
('L003', 'Stiker Label Nama A4', 5000, 'Lainnya', 'https://images.pexels.com/photos/248993/pexels-photo-248993.jpeg', 40);

-- ===========================================
-- 2. SEED ORDERS (15 transaksi, nominal realistis)
-- ===========================================

INSERT INTO orders (id, customer_name, customer_class, wa_number, pickup_time, total_amount, fee, payment_status, pickup_status, picked_up_at, created_at) VALUES
('INV4521A1BX', 'Ahmad Rizki', 'X TKJ', '6281234567890', 'Kamis, 19 Maret 2026 - Istirahat Pertama (09.15)', 105200, 1121, 'PAID', 'SUDAH_DIAMBIL', '2026-03-19T02:02:14Z', '2026-03-19T01:15:00Z'),
('INV4521B2CY', 'Bella Safira', 'X TKR', '6281234567891', 'Kamis, 19 Maret 2026 - Istirahat Pertama (09.15)', 104000, 1111, 'PAID', 'SUDAH_DIAMBIL', '2026-03-19T02:28:45Z', '2026-03-19T01:40:00Z'),
('INV4522C3DZ', 'Candra Wisnu', 'XI TKJ', '6281234567892', 'Jumat, 20 Maret 2026 - Istirahat Pertama (09.15)', 103600, 1108, 'PAID', 'BELUM_DIAMBIL', NULL, '2026-03-20T02:10:00Z'),
('INV4522D4EA', 'Desi Ratnasari', 'XI TKR', '6281234567893', 'Jumat, 20 Maret 2026 - Istirahat Kedua (11.45)', 120000, 1236, 'PAID', 'SUDAH_DIAMBIL', '2026-03-20T04:17:09Z', '2026-03-20T03:05:00Z'),
('INV4523E5FB', 'Eko Budianto', 'XI TP', '6281234567894', 'Sabtu, 21 Maret 2026 - Istirahat Pertama (09.15)', 72000, 862, 'PAID', 'BELUM_DIAMBIL', NULL, '2026-03-21T01:50:00Z'),
('INV4523F6GC', 'Fitri Handayani', 'XII TKJ', '6281234567895', 'Sabtu, 21 Maret 2026 - Istirahat Kedua (11.45)', 168000, 1610, 'PAID', 'SUDAH_DIAMBIL', '2026-03-21T05:33:51Z', '2026-03-21T04:20:00Z'),
('INV4524G7HD', 'Galih Pratama', 'XII TKR', '6281234567896', 'Senin, 23 Maret 2026 - Istirahat Pertama (09.15)', 20000, 456, 'PAID', 'BELUM_DIAMBIL', NULL, '2026-03-23T01:00:00Z'),
('INV4524H8IE', 'Hesti Kusuma', 'X TKP', '6281234567897', 'Senin, 23 Maret 2026 - Istirahat Kedua (11.45)', 88000, 986, 'PAID', 'SUDAH_DIAMBIL', '2026-03-23T03:42:27Z', '2026-03-23T02:30:00Z'),
('INV4527I9JF', 'Irvan Maulana', 'X DPIB', '6281234567898', 'Selasa, 24 Maret 2026 - Istirahat Pertama (09.15)', 92000, 1018, 'PAID', 'BELUM_DIAMBIL', NULL, '2026-03-24T01:55:00Z'),
('INV4528J0KG', 'Jeni Permata', 'X TITL', '6281234567899', 'Selasa, 24 Maret 2026 - Istirahat Kedua (11.45)', 48000, 674, 'PAID', 'SUDAH_DIAMBIL', '2026-03-24T03:18:03Z', '2026-03-24T02:30:00Z'),
('INV4534K1LH', 'Kevin Ramadhan', 'XI TKP', '6281234567900', 'Rabu, 25 Maret 2026 - Istirahat Pertama (09.15)', 148000, 1454, 'PAID', 'BELUM_DIAMBIL', NULL, '2026-03-25T03:10:00Z'),
('INV4534L2MI', 'Linda Setyawati', 'XI DPIB', '6281234567901', 'Rabu, 25 Maret 2026 - Istirahat Kedua (11.45)', 80000, 924, 'PAID', 'SUDAH_DIAMBIL', '2026-03-25T04:58:11Z', '2026-03-25T03:45:00Z'),
('INV4535M3NJ', 'Maulana Yusuf', 'XI TITL', '6281234567902', 'Selasa, 24 Maret 2026 - Istirahat Pertama (09.15)', 154000, 1501, 'PAID', 'BELUM_DIAMBIL', NULL, '2026-03-24T04:15:00Z'),
('INV4535N4OK', 'Nadia Puspita', 'XII TP', '6281234567903', 'Selasa, 24 Maret 2026 - Istirahat Kedua (11.45)', 52000, 706, 'PAID', 'SUDAH_DIAMBIL', '2026-03-24T05:21:36Z', '2026-03-24T04:50:00Z'),
('INV4536O5PL', 'Oki Hermawan', 'XII TKP', '6281234567904', 'Rabu, 25 Maret 2026 - Istirahat Pertama (09.15)', 100000, 1080, 'PAID', 'BELUM_DIAMBIL', NULL, '2026-03-25T01:05:00Z');

-- ===========================================
-- 3. SEED ORDER_ITEMS
-- ===========================================

INSERT INTO order_items (order_id, product_name, product_code_snapshot, quantity, price_at_purchase) VALUES
('INV4521A1BX', 'Pensil 2B Faber-Castell', 'P001', 8, 5900),
('INV4521A1BX', 'Penghapus Seed Radar', 'P003', 4, 5000),
('INV4521A1BX', 'Tipex Joyko Cair 20ml', 'P006', 4, 9500),

('INV4521B2CY', 'Topi Sekolah Hitam SMK', 'S001', 4, 22000),
('INV4521B2CY', 'Air Mineral Aqua 600ml', 'M001', 4, 4000),

('INV4522C3DZ', 'Buku Tulis Sidu 58 Lbr', 'P005', 8, 5500),
('INV4522C3DZ', 'Pensil 2B Faber-Castell', 'P001', 4, 5900),
('INV4522C3DZ', 'Penghapus Seed Radar', 'P003', 4, 5000),
('INV4522C3DZ', 'Air Mineral Aqua 600ml', 'M001', 4, 4000),

('INV4522D4EA', 'Dasi Sekolah Abu-abu', 'S002', 8, 15000),

('INV4523E5FB', 'Ikat Pinggang Hitam Polos', 'S003', 4, 18000),

('INV4523F6GC', 'Kacu Pramuka Coklat', 'S004', 8, 12000),
('INV4523F6GC', 'Tali Kur Pramuka Putih', 'S005', 4, 8000),
('INV4523F6GC', 'Badge OSIS Bordir', 'A001', 4, 10000),

('INV4524G7HD', 'Teh Pucuk Harum 350ml', 'M002', 4, 5000),

('INV4524H8IE', 'Topi Sekolah Hitam SMK', 'S001', 4, 22000),

('INV4527I9JF', 'Ikat Pinggang Hitam Polos', 'S003', 4, 18000),
('INV4527I9JF', 'Teh Pucuk Harum 350ml', 'M002', 4, 5000),

('INV4528J0KG', 'Roti Sobek Coklat', 'M003', 4, 8000),
('INV4528J0KG', 'Air Mineral Aqua 600ml', 'M001', 4, 4000),

('INV4534K1LH', 'Topi Sekolah Hitam SMK', 'S001', 4, 22000),
('INV4534K1LH', 'Dasi Sekolah Abu-abu', 'S002', 4, 15000),

('INV4534L2MI', 'Kacu Pramuka Coklat', 'S004', 4, 12000),
('INV4534L2MI', 'Tali Kur Pramuka Putih', 'S005', 4, 8000),

('INV4535M3NJ', 'Topi Sekolah Hitam SMK', 'S001', 4, 22000),
('INV4535M3NJ', 'Buku Tulis Sidu 58 Lbr', 'P005', 12, 5500),

('INV4535N4OK', 'Roti Sobek Coklat', 'M003', 4, 8000),
('INV4535N4OK', 'Teh Pucuk Harum 350ml', 'M002', 4, 5000),

('INV4536O5PL', 'Dasi Sekolah Abu-abu', 'S002', 4, 15000),
('INV4536O5PL', 'Badge OSIS Bordir', 'A001', 4, 10000),
('INV4536O5PL', 'Sampul Buku Plastik Bening', 'L001', 4, 300);

-- ===========================================
-- 4. BACKFILL TOKEN VERIFIKASI PUBLIK
-- ===========================================

UPDATE orders
SET verification_token = lower(hex(randomblob(24)))
WHERE verification_token IS NULL;

-- ===========================================
-- RINGKASAN DATA DUMMY
-- ===========================================
-- Total Products   : 20
-- Total Orders     : 15
-- Rentang Tanggal  : 19 Maret - 25 Maret 2026
-- Nominal Harga    : kisaran eceran realistis untuk katalog dan histori demo
-- Cocok untuk      : katalog, admin dasar, status pengambilan, verifikasi publik, dan flow payment lokal

