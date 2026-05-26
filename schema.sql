-- ===========================================
-- KOPERASI TWOSRA - DATABASE SCHEMA
-- ===========================================
-- Cloudflare D1 (SQLite-based)
-- ===========================================

-- Drop tables in reverse order (foreign key dependencies)
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS stock_reservations;
DROP TABLE IF EXISTS checkout_sessions;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS store_status;
DROP TABLE IF EXISTS admin_users;

-- ===========================================
-- 1. PRODUCTS TABLE
-- ===========================================
-- Menyimpan data produk yang dijual di koperasi
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0), -- Kode produk unik (misal: P001)
    name TEXT NOT NULL CHECK (length(trim(name)) > 0), -- Nama produk
    price INTEGER NOT NULL CHECK (price >= 0), -- Harga dalam Rupiah penuh (misal: 5000 = Rp5.000)
    category TEXT NOT NULL CHECK (length(trim(category)) > 0), -- Kategori: Alat Tulis, Seragam, Makanan/Minuman, dll
    image_url TEXT,                       -- URL gambar (path relatif atau URL absolut)
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0), -- Stok asli/fisik (stok tersedia publik dihitung setelah dikurangi reservasi aktif)
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP  -- Waktu produk ditambahkan
);

-- Index untuk pencarian berdasarkan kategori
CREATE INDEX idx_products_category ON products(category);

-- ===========================================
-- 2. ORDERS TABLE
-- ===========================================
-- Menyimpan data utama pesanan/transaksi
CREATE TABLE orders (
    id TEXT PRIMARY KEY,                  -- ID transaksi unik (dari payment gateway atau generate sendiri)
    customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0), -- Nama pelanggan
    customer_class TEXT NOT NULL CHECK (length(trim(customer_class)) > 0), -- Kelas pelanggan (misal: X TKJ, XI TKR)
    wa_number TEXT NOT NULL CHECK (length(trim(wa_number)) > 0), -- Nomor WhatsApp
    pickup_time TEXT NOT NULL CHECK (length(trim(pickup_time)) > 0), -- Waktu pengambilan (deskripsi teks)
    total_amount INTEGER NOT NULL CHECK (total_amount >= 0), -- Total harga barang (tanpa fee)
    fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0), -- Fee layanan/payment gateway
    payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PAID', 'CANCELLED', 'REFUNDED')), -- Saat ini selalu 'PAID' (order baru disimpan setelah pembayaran tervalidasi). Disiapkan untuk status lain bila flow berubah (mis. CANCELLED/REFUNDED).
    pickup_status TEXT NOT NULL DEFAULT 'BELUM_DIAMBIL' CHECK (pickup_status IN ('BELUM_DIAMBIL', 'SUDAH_DIAMBIL')), -- Status pengambilan barang, satu arah: BELUM_DIAMBIL -> SUDAH_DIAMBIL
    picked_up_at TIMESTAMP,               -- Waktu final saat admin menandai barang sudah diserahkan
    verification_token TEXT UNIQUE,       -- Token acak untuk verifikasi publik via QR
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP  -- Waktu transaksi
);

-- Index untuk query berdasarkan status dan waktu
CREATE INDEX idx_orders_status ON orders(payment_status);
CREATE INDEX idx_orders_pickup_status ON orders(pickup_status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_created_wib ON orders(datetime(created_at, '+7 hours'));
CREATE INDEX idx_orders_customer ON orders(customer_name);

-- ===========================================
-- 3. ORDER_ITEMS TABLE
-- ===========================================
-- Menyimpan detail barang dalam setiap pesanan
CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,               -- Referensi ke orders.id
    product_name TEXT NOT NULL CHECK (length(trim(product_name)) > 0), -- Nama produk (snapshot saat pembelian)
    product_code_snapshot TEXT NOT NULL CHECK (length(trim(product_code_snapshot)) > 0), -- SKU/kode produk saat pembelian
    quantity INTEGER NOT NULL CHECK (quantity > 0), -- Jumlah barang
    price_at_purchase INTEGER NOT NULL CHECK (price_at_purchase >= 0), -- Harga satuan saat pembelian (snapshot)
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Index untuk query cepat berdasarkan order_id
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ===========================================
-- 4. CHECKOUT_SESSIONS TABLE
-- ===========================================
-- Menyimpan sesi checkout sementara agar endpoint payment tidak bisa dipakai bebas
CREATE TABLE checkout_sessions (
    checkout_token TEXT PRIMARY KEY,      -- Token acak untuk satu sesi checkout
    order_id TEXT NOT NULL UNIQUE,        -- ID transaksi yang dibangkitkan server
    amount INTEGER NOT NULL CHECK (amount >= 0), -- Total harga barang hasil hitung server
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),-- ACTIVE, COMPLETED, CANCELLED
    payment_started_at TIMESTAMP,         -- Waktu QRIS berhasil dibuat dan flow normal 2 menit dimulai
    gateway_expires_at TIMESTAMP,         -- expired_at mentah dari gateway pembayaran
    gateway_status TEXT,                  -- Status terakhir yang diketahui dari gateway
    gateway_total_payment INTEGER CHECK (gateway_total_payment IS NULL OR gateway_total_payment >= 0), -- Total dibayar resmi dari gateway (subtotal + fee)
    gateway_fee INTEGER NOT NULL DEFAULT 0 CHECK (gateway_fee >= 0), -- Fee resmi dari gateway, jangan ambil dari payload browser
    gateway_payment_number TEXT,          -- QR string/payment number dari gateway untuk idempotent replay
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL         -- Batas recovery aplikasi (10 menit)
);

CREATE INDEX idx_checkout_sessions_expires ON checkout_sessions(expires_at);
CREATE INDEX idx_checkout_sessions_status_expires ON checkout_sessions(status, expires_at);
CREATE INDEX idx_checkout_sessions_created ON checkout_sessions(created_at);
CREATE INDEX idx_checkout_sessions_order_id ON checkout_sessions(order_id);

-- ===========================================
-- 5. STOCK_RESERVATIONS TABLE
-- ===========================================
-- Menyimpan reservasi stok sementara selama sesi checkout masih aktif
CREATE TABLE stock_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkout_token TEXT NOT NULL,         -- Token sesi checkout
    order_id TEXT NOT NULL,               -- ID transaksi dari checkout_sessions
    product_id INTEGER,                   -- Referensi produk aktif bila masih ada
    product_code TEXT NOT NULL,           -- Kode produk yang di-reserve
    quantity INTEGER NOT NULL CHECK (quantity > 0), -- Jumlah unit yang di-reserve
    status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RELEASED', 'CONSUMED')), -- RESERVED, RELEASED, CONSUMED
    expires_at TIMESTAMP NOT NULL,        -- Masa berlaku reservasi (mengikuti checkout session)
    release_reason TEXT,                  -- Alasan release (EXPIRED/CANCELLED/dll)
    released_at TIMESTAMP,                -- Waktu reservasi dilepas
    consumed_at TIMESTAMP,                -- Waktu reservasi dikonversi jadi order final
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (checkout_token) REFERENCES checkout_sessions(checkout_token) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX idx_stock_reservations_checkout_product ON stock_reservations(checkout_token, product_code);
CREATE INDEX idx_stock_reservations_product_status_expires ON stock_reservations(product_code, status, expires_at);
CREATE INDEX idx_stock_reservations_checkout_status ON stock_reservations(checkout_token, status);
CREATE INDEX idx_stock_reservations_checkout_order_status_expires ON stock_reservations(checkout_token, order_id, status, expires_at);
CREATE INDEX idx_stock_reservations_status_expires_product ON stock_reservations(status, expires_at, product_code);

-- ===========================================
-- 6. STORE_STATUS TABLE
-- ===========================================
-- Menyimpan status operasional web: menerima pesanan baru atau ditutup sementara
CREATE TABLE store_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    accepting_orders INTEGER NOT NULL DEFAULT 1 CHECK (accepting_orders IN (0, 1)),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
);

INSERT INTO store_status (id, accepting_orders, updated_at, updated_by) VALUES
(1, 1, CURRENT_TIMESTAMP, NULL);

-- ===========================================
-- 7. ADMIN_USERS TABLE
-- ===========================================
-- Menyimpan data user admin untuk autentikasi
CREATE TABLE admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0), -- Username untuk login
    password_hash TEXT NOT NULL,          -- Password hash (bcrypt)
    active_session_id TEXT,               -- Session ID aktif terakhir (single-session enforcement)
    session_last_login_ip TEXT,           -- IP dari login terakhir yang sah
    session_last_login_device TEXT,       -- Ringkasan browser/perangkat dari login terakhir
    session_last_login_at TIMESTAMP,      -- Waktu login terakhir (UTC)
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP  -- Waktu user dibuat
);

-- Index lookup tambahan hanya untuk sesi aktif; username sudah tercakup oleh UNIQUE constraint
CREATE INDEX idx_admin_users_active_session_id ON admin_users(active_session_id);

-- ===========================================
-- SECURITY NOTES:
-- ===========================================
-- 1. Password hash menggunakan bcrypt dengan cost factor 10
-- 2. Harga disimpan sebagai INTEGER Rupiah penuh (bukan sen) untuk menghindari floating point issues
-- 3. Foreign key aktif pada order_items dan stock_reservations untuk menjaga integritas relasi inti
-- 4. CHECK constraint dipakai untuk nilai uang, stok, flag boolean semu, dan status enum ringan
-- 5. Index ditambahkan untuk optimasi query pada kolom yang sering di-search/filter
-- 6. Akun admin bootstrap TIDAK ada di file ini - lihat `seed.sql` terpisah
-- ===========================================
