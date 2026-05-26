-- ===========================================
-- KOPERASI TWOSRA - DUMMY DATA PRODUK SAJA
-- ===========================================
-- Jalankan file ini SETELAH schema.sql
-- File ini hanya mengisi tabel products.
-- Cocok untuk testing katalog, admin produk, dan stok tanpa histori transaksi.
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
-- RINGKASAN DATA DUMMY
-- ===========================================
-- Total Products : 20
-- Total Orders   : 0
-- Cocok untuk    : katalog, admin produk, stok, dan simulasi checkout awal
