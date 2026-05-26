# Migrations

Folder ini **bukan** sumber kebenaran utama untuk skema database.

## Sumber Kebenaran

- `schema.sql` di root folder adalah sumber kebenaran skema database saat ini
- Runtime schema guards di `src/utils/*-schema.ts` menjaga kompatibilitas dengan database lama yang belum di-migrate

## Kenapa Folder Ini Kosong?

Proyek ini menggunakan pendekatan single-file schema (`schema.sql`) untuk simplicity.
Jika nanti migrasi bertahap diperlukan, file migrasi akan ditaruh di sini dengan format:
`NNNN-description.sql`

Untuk sekarang, jalankan `schema.sql` langsung untuk setup/reset database.

Catatan konteks terbaru:

- perubahan flow cleanup reservasi (lazy ringan vs cron sweep + purge per jam) diatur pada kode route/worker, bukan melalui file migrasi terpisah
- endpoint baru seperti `/api/image-optimize` tidak memerlukan perubahan skema database
