# Sistem Pemesanan dan Manajemen Koperasi TWOSRA

## Metadata

- Last updated: 2026-05-09
- Owner: Tim Koperasi TWOSRA
- Scope: Landing page utama proyek untuk GitHub dan pembaca manusia

Backend + frontend statis untuk sistem pemesanan Koperasi TWOSRA berbasis Cloudflare Workers.

## Ringkasan

Proyek ini dipakai untuk:

- siswa memesan barang koperasi lewat katalog, keranjang, checkout, dan QRIS
- admin mengelola produk, pesanan, statistik, pickup, dan pengaturan operasional
- publik memverifikasi transaksi lewat `verification_token`

Alur intinya sederhana:

1. siswa memilih barang
2. server membuat `checkout_session` resmi
3. stok sementara direservasi
4. siswa membayar lewat QRIS
5. server memverifikasi payment
6. order final baru dicatat setelah payment tervalidasi

## Aturan Inti

- browser bukan sumber kebenaran order final setelah `checkout_session` terbentuk
- stok publik = stok fisik - reservasi aktif
- order final hanya disimpan setelah verifikasi payment server-to-server
- status pickup hanya bisa diubah dari admin dan bersifat final satu arah
- penutupan web oleh admin hanya memblokir checkout baru; transaksi lama yang sah tetap boleh lanjut

## Fitur Utama

### Sisi siswa

- katalog produk dari D1 dengan stok tersedia
- keranjang di `localStorage`
- checkout server-side
- QRIS via Pakasir
- polling payment dan recovery mode
- summary sukses dan bukti PDF
- verifikasi publik status transaksi dan pickup
- optimasi gambar eksternal lewat `/api/image-optimize`

### Sisi admin

- login admin dengan single-session enforcement
- CRUD produk dan upload gambar ke R2
- statistik, export PDF/CSV, dan daftar pesanan
- pickup final `BELUM_DIAMBIL -> SUDAH_DIAMBIL`
- menu `Pengaturan` untuk buka/tutup penerimaan pesanan dan ganti password

### Sisi backend

- Hono + Cloudflare Workers
- D1 untuk data transaksi dan produk
- R2 untuk gambar
- Telegram topic `Order`, `Security`, dan `Admin`
- structured logging untuk debug dan tracing
- CSRF protection, rate limit, dan anti-tampering

## Dokumentasi

- `README.md`: pintu masuk utama manusia/GitHub
- `WORKFLOW.md`: source of truth workflow bisnis dan perilaku sistem
- `AGENTS.md`: pintu masuk utama AI agent
- `docs/TESTING.md`: testing aktif, checklist manual, dan pointer regresi
- `docs/frontend/ARCHITECTURE.md`: arsitektur frontend vanilla JS
- `MIGRATION.md`: konteks historis perubahan arsitektur
- `DESIGN.md`: referensi visual/frontend khusus

## Quick Start

### 1. Install dependency

```bash
npm install
```

### 2. Siapkan environment lokal

Salin `.dev.vars.example` ke `.dev.vars`, lalu isi nilai development yang dibutuhkan.

Minimal env penting:

```env
JWT_SECRET=your-development-jwt-secret-here
PAKASIR_PROJECT_SLUG=your-project-slug
PAKASIR_API_KEY=your-api-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
TELEGRAM_TOPIC_ORDER=3
TELEGRAM_TOPIC_SECURITY=4
TELEGRAM_TOPIC_ADMIN=5
ENVIRONMENT=development
```

### 3. Jalankan worker lokal

```bash
npm run dev
```

URL lokal default:

- siswa: `http://127.0.0.1:8787/`
- admin: `http://127.0.0.1:8787/admin.html`
- verifikasi: `http://127.0.0.1:8787/verifikasi.html?token=<TOKEN>`

## Struktur Repo Ringkas

```text
.
|-- public/               # frontend static assets
|-- src/                  # worker backend
|-- scripts/              # deploy, smoke, race, rate-limit helpers
|-- test/                 # backend tests
|-- docs/                 # docs aktif, testing, ai, frontend, archive
|-- schema.sql            # source of truth schema database
|-- seed.sql              # bootstrap data awal
|-- wrangler.jsonc        # binding Cloudflare, cron, DO
|-- WORKFLOW.md           # workflow bisnis aktif
|-- AGENTS.md             # aturan AI agent
|-- MIGRATION.md          # konteks historis
`-- README.md
```

## Environment Variables

| Variable | Wajib | Fungsi |
| --- | --- | --- |
| `JWT_SECRET` | ya | secret JWT admin, minimal 32 karakter |
| `PAKASIR_PROJECT_SLUG` | ya | slug project Pakasir |
| `PAKASIR_API_KEY` | ya | API key Pakasir |
| `TELEGRAM_BOT_TOKEN` | ya | token bot Telegram |
| `TELEGRAM_CHAT_ID` | ya | chat tujuan notifikasi Telegram |
| `TELEGRAM_TOPIC_ORDER` | ya | topic/thread log order dan payment normal |
| `TELEGRAM_TOPIC_SECURITY` | ya | topic/thread security alert, incident, dan rate limit |
| `TELEGRAM_TOPIC_ADMIN` | ya | topic/thread audit login dan event admin |
| `ENVIRONMENT` | ya | `development` atau `production`; divalidasi saat startup |
| `CORS_ALLOWED_ORIGINS` | tidak | whitelist origin browser tambahan |
| `IMAGE_OPTIMIZE_ALLOWED_DOMAINS` | tidak | allowlist domain sumber gambar eksternal |
| `INTERNAL_WEBHOOK_KEY` | tidak* | shared secret untuk request mutating non-browser tanpa `Origin`/`Referer` |

Catatan:

- `INTERNAL_WEBHOOK_KEY` tidak diperlukan untuk browser flow normal.
- perubahan `.dev.vars` memerlukan restart `wrangler dev`.
- jika `ENVIRONMENT` salah atau kosong, startup validation akan throw.

## Reset DB Lokal

```bash
wrangler d1 execute koperasi_db --local --file=schema.sql
wrangler d1 execute koperasi_db --local --file=seed.sql
```

Data dummy opsional:

```bash
wrangler d1 execute koperasi_db --local --file=data-dummy.products.sql
wrangler d1 execute koperasi_db --local --file=data-dummy.transactions.sql
wrangler d1 execute koperasi_db --local --file=data-dummy.sql
```

## Testing dan Script Penting

Mulai dari `docs/TESTING.md` untuk checklist manual aktif.

Command yang paling sering dipakai:

```bash
npm test -- --run
npm run smoke:gateway:simulate
npm run smoke:admin-vendors
npm run smoke:frontend-structure
npm run race:reservation -- --scenario=mixed --users=10 --heavy-users=5 --stagger-ms=1
npm run test:rate-limit -- --mode=both --requests=300 --concurrency=30 --strict
```

Detail smoke, race test, rate-limit test, dan deploy helper ada di `scripts/README.md`.

## Deploy Ringkas

Ada dua jalur deploy yang berbeda:

1. **Setup awal production**
2. **Deploy rutin perubahan kode**

### 1. Setup awal production

Lakukan ini hanya sekali saat pertama kali menyiapkan project di Cloudflare, atau saat recovery terkontrol dari nol.

Yang harus sudah ada:

- Worker Cloudflare
- database D1
- bucket R2
- secret production
- schema database awal
- seed awal bila memang diperlukan

Contoh alur setup awal:

#### Login dan provision resource

```bash
npx wrangler login
npx wrangler d1 create koperasi_db
npx wrangler r2 bucket create images-bucket
```

#### Secret WAJIB

Semua secret di blok ini harus di-set, jika tidak `validateEnvOnStartup` akan throw saat request pertama.

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put PAKASIR_PROJECT_SLUG
npx wrangler secret put PAKASIR_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_TOPIC_ORDER
npx wrangler secret put TELEGRAM_TOPIC_SECURITY
npx wrangler secret put TELEGRAM_TOPIC_ADMIN
npx wrangler secret put ENVIRONMENT
```

---

#### Secret OPSIONAL

Lewati bila tidak diperlukan. Set hanya bila nilainya berbeda dari default Worker:

```bash
# Lewati bila Worker hanya dipanggil dari origin Worker itu sendiri
npx wrangler secret put CORS_ALLOWED_ORIGINS

# Lewati untuk memakai default: images.pexels.com,i.ibb.co
npx wrangler secret put IMAGE_OPTIMIZE_ALLOWED_DOMAINS

# Lewati bila tidak ada caller server-to-server tanpa Origin/Referer
npx wrangler secret put INTERNAL_WEBHOOK_KEY
```

---

#### Schema dan seed database

```bash
npx wrangler d1 execute koperasi_db --remote --file=schema.sql
npx wrangler d1 execute koperasi_db --remote --file=seed.sql
```

Catatan:

- `schema.sql` dipakai untuk bootstrap/reset terkontrol, bukan deploy harian
- `seed.sql` hanya untuk data awal
- sesuaikan `wrangler.jsonc` dengan `database_id` dan binding resource yang benar

### 2. Deploy rutin perubahan kode

Setelah setup awal selesai dan resource production sudah ada, gunakan command berikut untuk deploy harian:

```bash
npm run deploy:production
```

Script ini:

- memverifikasi resource dari `wrangler.jsonc`
- menjalankan gate lokal
- hanya deploy kode worker

Script ini tidak:

- upload secret
- menjalankan `schema.sql`
- menjalankan `seed.sql`

Setup awal resource production, perubahan schema/database, dan rotasi secret dilakukan manual secara terkontrol.

## API Ringkas

### Public

- `GET /api/health`
- `GET /api/products`
- `GET /api/store-status`
- `GET /api/images/:key`
- `GET /api/image-optimize`
- `POST /api/orders`
- `GET /api/orders/verify/:token`

### Payment

- `POST /api/checkout/session`
- `POST /api/payment/qris`
- `GET /api/payment/status`
- `POST /api/payment/event`
- `POST /api/payment/cancel`

### Admin

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/verify`
- `POST /api/admin/change-password`
- `GET /api/admin/image-policy`
- `GET /api/admin/store-status`
- `PUT /api/admin/store-status`
- `GET /api/admin/orders`
- `GET /api/admin/orders/analytics`
- `POST /api/admin/orders/:id/pickup`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `DELETE /api/admin/products/:id`
- `POST /api/admin/products/upload`

## Database Ringkas

Tabel inti:

- `products`
- `checkout_sessions`
- `stock_reservations`
- `orders`
- `order_items`
- `admin_users`
- `store_status`

Catatan:

- `schema.sql` adalah source of truth utama skema database
- folder `migrations/` bukan sumber kebenaran utama

## Cloudflare Notes

Untuk runtime, limits, dan API produk Cloudflare yang mudah berubah, selalu cek dokumentasi resmi terbaru sebelum implementasi atau tuning:

- `https://developers.cloudflare.com/workers/`
- `https://developers.cloudflare.com/workers/platform/limits/`

## Bacaan Lanjutan

- workflow bisnis aktif: `WORKFLOW.md`
- onboarding AI: `AGENTS.md`
- testing aktif: `docs/TESTING.md`
- arsitektur frontend: `docs/frontend/ARCHITECTURE.md`
- konteks historis: `MIGRATION.md`
