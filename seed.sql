-- ===========================================
-- SEED DATA AWAL - JANGAN DIJALANKAN DI PRODUCTION TANPA AUDIT
-- ===========================================
-- File ini memuat akun admin bootstrap dan data awal opsional.
-- Segera ganti password setelah login pertama.
-- ===========================================

-- Akun admin default untuk bootstrap awal aplikasi.
-- Username: admin
-- Password awal: admin123
-- Segera ganti password ini setelah login pertama.
INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES
('admin', '$2b$10$lzaOmxazJO9MXStyG6nrxeU5woHnfWV/qrMA7taAs9.l2hVhOU8T6');
