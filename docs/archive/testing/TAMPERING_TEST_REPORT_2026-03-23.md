# Laporan Detail Uji Tampering

<!-- AI_IGNORE: File ini adalah arsip uji tampering untuk dibaca manusia saja. AI/agent TIDAK BOLEH membaca atau mengubah isi file ini. Rujuk AGENTS.md bagian Human-Only Archive untuk konteks. -->

> **ARSIP - HANYA UNTUK MANUSIA**
>
> File ini adalah arsip raw log pengujian tampering. Berisi ribuan baris log mentah (request/response, console browser, Telegram).
> - **AI/Agent:** Jangan baca atau ubah file ini. Gunakan `docs/TESTING.md` untuk konteks tampering ringkas.
> - **Manusia:** Gunakan file ini untuk audit trail dan referensi bukti pengujian.


Dokumen ini adalah arsip laporan detail untuk pengujian tampering yang dilakukan pada 23 Maret 2026.

Catatan pembaruan konteks proyek:

- laporan ini tetap valid sebagai arsip uji tampering pada 23 Maret 2026
- setelah tanggal itu, proyek juga mendapat perubahan non-tampering seperti:
  - hardening cancel payment frontend (`sendBeacon` + fallback `fetch keepalive`)
  - endpoint optimasi gambar `/api/image-optimize` + helper `optimizeImageUrl`
  - logging frontend dipusatkan ke `appLogger`
- untuk kondisi arsitektur terkini, rujuk juga `README.md`, `WORKFLOW.md`, dan `docs/ai/CURRENT_STATE.md`

Peran dokumen ini:

- menyimpan bukti mentah hasil pengujian
- menyimpan contoh request/response, log browser, dan log Telegram
- menjadi referensi audit jika nanti perlu melacak regresi keamanan atau finansial

Jika Anda ingin membaca versi ringkas dulu:

- baca `docs/TESTING.md` untuk checklist, arti istilah, dan kesimpulan singkat
- baca bagian ringkasan final di bagian bawah dokumen ini

Cara baca cepat dokumen ini:

- baca judul `Opsi A` sampai `Opsi D` untuk melihat skenario yang diuji
- baca subbagian `Log Di Tab Network`, `Log Di Console Browser`, `Tampilan Web`, dan `Log Di Bot Telegram/Tele` jika butuh bukti mentah
- baca `Ringkasan Final Hasil Testing Tampering` di bagian paling bawah untuk kesimpulan singkat

## Opsi A - DevTools Console: ubah quantity + total

### Log Di Tab Network

```text

fetch("http://127.0.0.1:8787/api/checkout/session", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":1000,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":996,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":1000,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":19,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":70,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":2000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":40,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1}],\\"total\\":5000}",

 "method": "POST"

});

{

   "success": true,

   "checkout_token": "17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82",

   "order_id": "INV327763ED44",

   "amount": 5000,

   "recovery_expires_at": "2026-03-23 11:55:27",

   "expires_at": "2026-03-23 11:55:27"

}

fetch("http://127.0.0.1:8787/api/payment/qris", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"checkout_token\\":\\"17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82\\"}",

 "method": "POST"

});

{

   "payment": {

       "project": "fredy-rizky-cihuy",

       "order_id": "INV327763ED44",

       "amount": 5000,

       "total_payment": 5345,

       "fee": 345,

       "received": 5000,

       "payment_method": "qris",

       "payment_number": "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111",

       "expired_at": "2026-03-23T12:45:27.239295901Z"

   },

   "checkout_token": "17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82",

   "order_id": "INV327763ED44",

   "amount": 5000,

   "payment_started_at": "2026-03-23 11:45:29",

   "gateway_expires_at": "2026-03-23T12:45:27.239295901Z",

   "recovery_expires_at": "2026-03-23 11:55:27",

   "expires_at": "2026-03-23 11:55:27"

}

fetch("http://127.0.0.1:8787/api/payment/status?checkout_token=17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": null,

 "method": "GET"

});

{

   "transaction": {

       "amount": 5000,

       "order_id": "INV327763ED44",

       "project": "fredy-rizky-cihuy",

       "status": "completed",

       "payment_method": "qris",

       "completed_at": "2026-03-23T11:45:51.385Z",

       "is_sandbox": true

   },

   "checkout_token": "17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82",

   "order_id": "INV327763ED44",

   "amount": 5000,

   "payment_started_at": "2026-03-23 11:45:29",

   "gateway_expires_at": "2026-03-23T12:45:27.239295901Z",

   "gateway_status": "completed",

   "recovery_expires_at": "2026-03-23 11:55:27",

   "expires_at": "2026-03-23 11:55:27"

}

fetch("http://127.0.0.1:8787/api/orders", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"nama\\":\\"FREDY YUSUF RIZKY\\",\\"kelas\\":\\"XI TITL\\",\\"wa\\":\\"62895322026691\\",\\"pickup_date\\":\\"2026-03-24\\",\\"pickup_slot\\":\\"FIRST_BREAK\\",\\"waktu\\":\\"Besok (Selasa, 24 Maret 2026) - Istirahat Pertama (09.15)\\",\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":1000,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":996,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":2},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":1000,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":19,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":2},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":70,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":2},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":2000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":40,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":2}],\\"total\\":10000,\\"payment_amount\\":5345,\\"payment_number\\":\\"THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111\\",\\"id_transaksi\\":\\"INV327763ED44\\",\\"checkout_token\\":\\"17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82\\",\\"checkout_expires_at\\":\\"2026-03-23 11:55:27\\",\\"payment_started_at\\":\\"2026-03-23 11:45:29\\",\\"gateway_expires_at\\":\\"2026-03-23T12:45:27.239295901Z\\",\\"waktu_pembayaran\\":\\"23 Maret 2026 18.46.10 WIB\\"}",

 "method": "POST"

});

{

   "success": true,

   "message": "Order created successfully",

   "verification_token": "038faf9cedb0d28474d728a628e5cb25035c997f009c44fc",

   "pickup_time": "Besok (Selasa, 24 Maret 2026) - Istirahat Pertama (09.15)",

   "order_summary": {

       "id_transaksi": "INV327763ED44",

       "nama": "FREDY YUSUF RIZKY",

       "kelas": "XI TITL",

       "waktu": "Besok (Selasa, 24 Maret 2026) - Istirahat Pertama (09.15)",

       "waktu_pembayaran": "23 Maret 2026 18.46.10 WIB",

       "total": 5000,

       "fee": 345,

       "payment_amount": 5345,

       "items": [

           {

               "product": {

                   "code": "CONTOH03",

                   "name": "CONTOH 03",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "A001",

                   "name": "Badge OSIS Bordir",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S006",

                   "name": "Kaos Kaki Putih Sekolah",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S001",

                   "name": "Topi Sekolah Hitam SMK",

                   "price": 2000

               },

               "quantity": 1

           }

       ]

   },

   "sanitized_from_checkout_session": true

}

```

### Log Di Console Browser

```text

(() => {

 const originalFetch = window.fetch;

 const tamperOrderQtyAndTotal = (body) => {

   const items = Array.isArray(body?.items) ? body.items : [];

   let newTotal = 0;

   items.forEach((item) => {

     const qty = Number(item?.quantity || 0);

     const stock = Number(item?.product?.stock);

     const price = Number(item?.product?.price || 0);

     // Tambah qty +1 hanya jika stok pada payload masih mencukupi

     if (Number.isFinite(stock) && Number.isInteger(qty) && stock >= (qty + 1)) {

       item.quantity = qty + 1;

     }

     newTotal += price \* Number(item?.quantity || 0);

   });

   body.total = Math.max(1000, newTotal);

   return body;

 };

 window.__tamperReset = () => {

   window.fetch = originalFetch;

   console.log("Tamper interceptor dimatikan.");

 };

 window.fetch = async (input, init = {}) => {

   const url = typeof input === "string" ? input : input?.url || "";

   if (url.includes("/api/orders") && init?.body) {

     const body = JSON.parse(init.body);

     tamperOrderQtyAndTotal(body);

     init = { ...init, body: JSON.stringify(body) };

     console.log("Tampered /api/orders:", body);

   }

   return originalFetch(input, init);

 };

 console.log("Tamper interceptor aktif untuk /api/orders.");

})();

VM165:41 Tamper interceptor aktif untuk /api/orders.

undefined

VM165:36 Tampered /api/orders: {nama: 'FREDY YUSUF RIZKY', kelas: 'XI TITL', wa: '62895322026691', pickup_date: '2026-03-24', pickup_slot: 'FIRST_BREAK', …}checkout_expires_at: "2026-03-23 11:55:27"checkout_token: "17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82"gateway_expires_at: "2026-03-23T12:45:27.239295901Z"id_transaksi: "INV327763ED44"items: Array(4)0: product: category: "Alat Tulis"code: "CONTOH03"created_at: "2026-03-22 15:33:17"id: 52image_url: "/api/images/product_1774193635436_lsyf9sc.jpg"name: "CONTOH 03"price: 1000stock: 996[[Prototype]]: Objectquantity: 2[[Prototype]]: Object1: product: category: "Aksesoris"code: "A001"created_at: "2026-03-22 13:52:25"id: 31image_url: "https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg"name: "Badge OSIS Bordir"price: 1000stock: 19[[Prototype]]: Objectquantity: 2[[Prototype]]: Object2: product: category: "Seragam"code: "S006"created_at: "2026-03-22 13:52:25"id: 26image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s"name: "Kaos Kaki Putih Sekolah"price: 1000stock: 70[[Prototype]]: Objectquantity: 2[[Prototype]]: Object3: product: category: "Seragam"code: "S001"created_at: "2026-03-22 13:52:25"id: 21image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s"name: "Topi Sekolah Hitam SMK"price: 2000stock: 40[[Prototype]]: Objectquantity: 2[[Prototype]]: Objectlength: 4[[Prototype]]: Array(0)kelas: "XI TITL"nama: "FREDY YUSUF RIZKY"payment_amount: 5345payment_number: "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111"payment_started_at: "2026-03-23 11:45:29"pickup_date: "2026-03-24"pickup_slot: "FIRST_BREAK"total: 10000wa: "62895322026691"waktu: "Besok (Selasa, 24 Maret 2026) - Istirahat Pertama (09.15)"waktu_pembayaran: "23 Maret 2026 18.46.10 WIB"[[Prototype]]: Object

```

### Tampilan Web

```text

<section id="view-summary" class="view">

           <div class="success-alert">

               <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

                   <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>

                   <polyline points="22 4 12 14.01 9 11.01"></polyline>

               </svg>

               <h2>Pesanan Berhasil Dibuat!</h2>

               <p>Terima kasih, berikut ringkasan pesanan Anda.</p>

           </div>

           <div class="summary-card">

               <h3>Detail Pemesan</h3>

               <table class="summary-table">

                   <tbody><tr>

                       <td>Nama Lengkap</td>

                       <td id="summary-nama">FREDY YUSUF RIZKY</td>

                   </tr>

                   <tr>

                       <td>Kelas</td>

                       <td id="summary-kelas">XI TITL</td>

                   </tr>

                   <tr>

                       <td>Waktu Pengambilan</td>

                       <td id="summary-waktu">Besok (Selasa, 24 Maret 2026) - Istirahat Pertama (09.15)</td>

                   </tr>

                   <tr>

                       <td>ID Transaksi</td>

                       <td id="summary-trx-id" style="font-family: monospace; font-size: 0.9em; word-break: break-all;">INV327763ED44</td>

                   </tr>

                   <tr>

                       <td>Waktu Pembayaran</td>

                       <td id="summary-pay-time">23 Maret 2026 18.46.10 WIB</td>

                   </tr>

               </tbody></table>

               <h3 style="margin-top: 1.5rem;">Daftar Barang</h3>

               <div id="summary-items" class="summary-items-list"><div class="summary-item">

           <div class="summary-item-name">

               1x CONTOH 03

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Badge OSIS Bordir

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Kaos Kaki Putih Sekolah

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Topi Sekolah Hitam SMK

           </div>

           <div class="summary-item-price">

               Rp 2.000

           </div>

       </div></div>

               <div class="summary-total-details">

                   <div class="summary-detail-row">

                       <span>Total Harga Barang</span>

                       <span id="summary-subtotal-price">Rp 5.000</span>

                   </div>

                   <div class="summary-detail-row">

                       <span>Biaya Layanan/QRIS</span>

                       <span id="summary-fee-price">Rp 345</span>

                   </div>

                   <div class="summary-total">

                       <span>Total Dibayar</span>

                       <strong id="summary-total-price">Rp 5.345</strong>

                   </div>

               </div>

           </div>

           <button class="btn btn-secondary btn-block" id="btn-download-receipt" style="margin-top: 1rem; background-color: var(--success-color); color: white; border-color: var(--success-color);" data-action="download-receipt">

               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; vertical-align: text-bottom;">

                   <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>

                   <polyline points="7 10 12 15 17 10"></polyline>

                   <line x1="12" y1="15" x2="12" y2="3"></line>

               </svg> Download Bukti Pembayaran

           </button>

           <button class="btn btn-primary btn-block js-reset-flow" style="margin-top: 1rem;">Kembali ke

               Beranda</button>

           <div class="alert-info" style="margin-top: 2rem; background-color: #e2e3e5; color: #383d41; padding: 1rem; border-radius: 8px; text-align: center; font-size: 0.9rem;">

               <strong>Keterangan:</strong><br>

               Simpan halaman ini dan unduh bukti pembayaran untuk ditunjukkan saat pengambilan barang di koperasi.

           </div>

       </section>

```

### Log Di Bot Tele

```text

[23/03/2026 18:45] BOT NOTIFIKASI WEB: Log Payment: sesi checkout dibuat

Order

\- Order ID: INV327763ED44

\- Amount: 5000

\- Jenis barang: 4

\- Ringkasan item: 1x CONTOH 03 \(CONTOH03\); 1x Badge OSIS Bordir \(A001\); 1x Kaos Kaki Putih Sekolah \(S006\); 1x Topi Sekolah Hitam SMK \(S001\)

Session

\- Checkout Token: 17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82

\- Recovery window sampai: 2026-03-23 11:55:27

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

[23/03/2026 18:45] BOT NOTIFIKASI WEB: Log Payment: QRIS berhasil dibuat

Order

\- Order ID: INV327763ED44

\- Amount: 5000

\- Fee Gateway: 345

Session

\- Checkout Token: 17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82

\- Payment Started At: 2026-03-23 11:45:29

\- Gateway Expired At: 2026-03-23T12:45:27.239295901Z

\- Recovery window sampai: 2026-03-23 11:55:27

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

Lainnya

\- Total Payment Gateway: 5345

[23/03/2026 18:46] BOT NOTIFIKASI WEB: Security Alert: payload order berubah setelah checkout

Order

\- Order ID: INV327763ED44

\- Session Amount: 5000

\- Client Total: 10000

\- Server Total: 5000

\- Total Dibayar: 5345

\- Fee Gateway: 345

\- Selisih Total: 5000

\- Jumlah unit client: 8

\- Jumlah unit server: 4

\- Ringkasan item server: 1x CONTOH 03 \(CONTOH03\); 1x Badge OSIS Bordir \(A001\); 1x Kaos Kaki Putih Sekolah \(S006\); 1x Topi Sekolah Hitam SMK \(S001\)

\- Ringkasan item client: 2x CONTOH03; 2x A001; 2x S006; 2x S001

\- Selisih qty: A001 / Badge OSIS Bordir -> client 2, server 1, delta +1

\- Selisih qty: CONTOH03 / CONTOH 03 -> client 2, server 1, delta +1

\- Selisih qty: S001 / Topi Sekolah Hitam SMK -> client 2, server 1, delta +1

\- Selisih qty: S006 / Kaos Kaki Putih Sekolah -> client 2, server 1, delta +1

Session

\- Checkout Token: 17b7ebcc426c34b6ab497095c894175f25a7742fb0591f82

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

Status

\- Aksi sistem: payload client diabaikan, order diproses dari snapshot checkout server

Lainnya

\- Nama: FREDY YUSUF RIZKY

[23/03/2026 18:46] BOT NOTIFIKASI WEB: Notifikasi Pesanan Koperasi Baru (SUDAH DIBAYAR QRIS)

ID Transaksi: INV327763ED44

Nama: FREDY YUSUF RIZKY

Kelas: XI TITL

No. WA: 62895322026691

Waktu Pengambilan: Besok \(Selasa, 24 Maret 2026\) - Istirahat Pertama \(09.15\)

Waktu Pembayaran: 23 Maret 2026 18.46.10 WIB

Rincian Pesanan:

\- 1x CONTOH 03

\- 1x Badge OSIS Bordir

\- 1x Kaos Kaki Putih Sekolah

\- 1x Topi Sekolah Hitam SMK

Total Tagihan: Rp 5.000

Nominal Dibayar (termasuk fee): Rp 5.345

```

## Opsi B - DevTools Console: ubah harga item + total

### Log Di Tab Network

```text

fetch("http://127.0.0.1:8787/api/checkout/session", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":1000,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":994,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":1000,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":17,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":68,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":2000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":39,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1}],\\"total\\":5000}",

 "method": "POST"

});

{

   "success": true,

   "checkout_token": "a54f6e4be7190cf26d626750578ef5bf616a999f77207acb",

   "order_id": "INV068266ECC6",

   "amount": 5000,

   "recovery_expires_at": "2026-03-23 12:07:48",

   "expires_at": "2026-03-23 12:07:48"

}

fetch("http://127.0.0.1:8787/api/payment/qris", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"checkout_token\\":\\"a54f6e4be7190cf26d626750578ef5bf616a999f77207acb\\"}",

 "method": "POST"

});

{

   "payment": {

       "project": "fredy-rizky-cihuy",

       "order_id": "INV068266ECC6",

       "amount": 5000,

       "total_payment": 5345,

       "fee": 345,

       "received": 5000,

       "payment_method": "qris",

       "payment_number": "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111",

       "expired_at": "2026-03-23T12:57:47.647992214Z"

   },

   "checkout_token": "a54f6e4be7190cf26d626750578ef5bf616a999f77207acb",

   "order_id": "INV068266ECC6",

   "amount": 5000,

   "payment_started_at": "2026-03-23 11:57:49",

   "gateway_expires_at": "2026-03-23T12:57:47.647992214Z",

   "recovery_expires_at": "2026-03-23 12:07:48",

   "expires_at": "2026-03-23 12:07:48"

}

fetch("http://127.0.0.1:8787/api/payment/status?checkout_token=a54f6e4be7190cf26d626750578ef5bf616a999f77207acb", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": null,

 "method": "GET"

});

{

   "transaction": {

       "amount": 5000,

       "order_id": "INV068266ECC6",

       "project": "fredy-rizky-cihuy",

       "status": "completed",

       "payment_method": "qris",

       "completed_at": "2026-03-23T11:58:00.558Z",

       "is_sandbox": true

   },

   "checkout_token": "a54f6e4be7190cf26d626750578ef5bf616a999f77207acb",

   "order_id": "INV068266ECC6",

   "amount": 5000,

   "payment_started_at": "2026-03-23 11:57:49",

   "gateway_expires_at": "2026-03-23T12:57:47.647992214Z",

   "gateway_status": "completed",

   "recovery_expires_at": "2026-03-23 12:07:48",

   "expires_at": "2026-03-23 12:07:48"

}

fetch("http://127.0.0.1:8787/api/orders", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"nama\\":\\"FREDY YUSUF RIZKY\\",\\"kelas\\":\\"XI TKR\\",\\"wa\\":\\"62895322026691\\",\\"pickup_date\\":\\"2026-03-25\\",\\"pickup_slot\\":\\"SECOND_BREAK\\",\\"waktu\\":\\"Lusa (Rabu, 25 Maret 2026) - Istirahat Kedua (11.45)\\",\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":500,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":994,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":500,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":17,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":500,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":68,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":39,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1}],\\"total\\":2500,\\"payment_amount\\":5345,\\"payment_number\\":\\"THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111\\",\\"id_transaksi\\":\\"INV068266ECC6\\",\\"checkout_token\\":\\"a54f6e4be7190cf26d626750578ef5bf616a999f77207acb\\",\\"checkout_expires_at\\":\\"2026-03-23 12:07:48\\",\\"payment_started_at\\":\\"2026-03-23 11:57:49\\",\\"gateway_expires_at\\":\\"2026-03-23T12:57:47.647992214Z\\",\\"waktu_pembayaran\\":\\"23 Maret 2026 18.58.11 WIB\\"}",

 "method": "POST"

});

{

   "success": true,

   "message": "Order created successfully",

   "verification_token": "31bf70d3c1ca731d5e2aee0f2500cad89b93ae6a3ae11ff8",

   "pickup_time": "Lusa (Rabu, 25 Maret 2026) - Istirahat Kedua (11.45)",

   "order_summary": {

       "id_transaksi": "INV068266ECC6",

       "nama": "FREDY YUSUF RIZKY",

       "kelas": "XI TKR",

       "waktu": "Lusa (Rabu, 25 Maret 2026) - Istirahat Kedua (11.45)",

       "waktu_pembayaran": "23 Maret 2026 18.58.11 WIB",

       "total": 5000,

       "fee": 345,

       "payment_amount": 5345,

       "items": [

           {

               "product": {

                   "code": "CONTOH03",

                   "name": "CONTOH 03",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "A001",

                   "name": "Badge OSIS Bordir",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S006",

                   "name": "Kaos Kaki Putih Sekolah",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S001",

                   "name": "Topi Sekolah Hitam SMK",

                   "price": 2000

               },

               "quantity": 1

           }

       ]

   },

   "sanitized_from_checkout_session": true

}

```

### Log Di Console Browser

```text

(() => {

 const originalFetch = window.fetch;

 const PRICE_FACTOR = 0.5;

 const tamperOrderPriceAndTotal = (body) => {

   const items = Array.isArray(body?.items) ? body.items : [];

   let newTotal = 0;

   items.forEach((item) => {

     const qty = Number(item?.quantity || 0);

     const oldPrice = Number(item?.product?.price || 0);

     const newPrice = Math.max(1, Math.floor(oldPrice \* PRICE_FACTOR));

     if (item?.product) item.product.price = newPrice;

     newTotal += newPrice \* qty;

   });

   body.total = Math.max(1000, newTotal);

   return body;

 };

 window.__tamperReset = () => {

   window.fetch = originalFetch;

   console.log("Tamper interceptor dimatikan.");

 };

 window.fetch = async (input, init = {}) => {

   const url = typeof input === "string" ? input : input?.url || "";

   if (url.includes("/api/orders") && init?.body) {

     const body = JSON.parse(init.body);

     tamperOrderPriceAndTotal(body);

     init = { ...init, body: JSON.stringify(body) };

     console.log("Tampered /api/orders (price+total):", body);

   }

   return originalFetch(input, init);

 };

 console.log("Tamper interceptor aktif untuk /api/orders (price+total).");

})();

VM318:38 Tamper interceptor aktif untuk /api/orders (price+total).

undefined

VM318:33 Tampered /api/orders (price+total): {nama: 'FREDY YUSUF RIZKY', kelas: 'XI TKR', wa: '62895322026691', pickup_date: '2026-03-25', pickup_slot: 'SECOND_BREAK', …}checkout_expires_at: "2026-03-23 12:07:48"checkout_token: "a54f6e4be7190cf26d626750578ef5bf616a999f77207acb"gateway_expires_at: "2026-03-23T12:57:47.647992214Z"id_transaksi: "INV068266ECC6"items: Array(4)0: product: category: "Alat Tulis"code: "CONTOH03"created_at: "2026-03-22 15:33:17"id: 52image_url: "/api/images/product_1774193635436_lsyf9sc.jpg"name: "CONTOH 03"price: 500stock: 994[[Prototype]]: Objectquantity: 1[[Prototype]]: Object1: product: category: "Aksesoris"code: "A001"created_at: "2026-03-22 13:52:25"id: 31image_url: "https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg"name: "Badge OSIS Bordir"price: 500stock: 17[[Prototype]]: Objectquantity: 1[[Prototype]]: Object2: product: category: "Seragam"code: "S006"created_at: "2026-03-22 13:52:25"id: 26image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s"name: "Kaos Kaki Putih Sekolah"price: 500stock: 68[[Prototype]]: Objectquantity: 1[[Prototype]]: Object3: product: category: "Seragam"code: "S001"created_at: "2026-03-22 13:52:25"id: 21image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s"name: "Topi Sekolah Hitam SMK"price: 1000stock: 39[[Prototype]]: Objectquantity: 1[[Prototype]]: Objectlength: 4[[Prototype]]: Array(0)kelas: "XI TKR"nama: "FREDY YUSUF RIZKY"payment_amount: 5345payment_number: "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111"payment_started_at: "2026-03-23 11:57:49"pickup_date: "2026-03-25"pickup_slot: "SECOND_BREAK"total: 2500wa: "62895322026691"waktu: "Lusa (Rabu, 25 Maret 2026) - Istirahat Kedua (11.45)"waktu_pembayaran: "23 Maret 2026 18.58.11 WIB"[[Prototype]]: Object

```

### Tampilan Web

```text

<section id="view-summary" class="view">

           <div class="success-alert">

               <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

                   <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>

                   <polyline points="22 4 12 14.01 9 11.01"></polyline>

               </svg>

               <h2>Pesanan Berhasil Dibuat!</h2>

               <p>Terima kasih, berikut ringkasan pesanan Anda.</p>

           </div>

           <div class="summary-card">

               <h3>Detail Pemesan</h3>

               <table class="summary-table">

                   <tbody><tr>

                       <td>Nama Lengkap</td>

                       <td id="summary-nama">FREDY YUSUF RIZKY</td>

                   </tr>

                   <tr>

                       <td>Kelas</td>

                       <td id="summary-kelas">XI TKR</td>

                   </tr>

                   <tr>

                       <td>Waktu Pengambilan</td>

                       <td id="summary-waktu">Lusa (Rabu, 25 Maret 2026) - Istirahat Kedua (11.45)</td>

                   </tr>

                   <tr>

                       <td>ID Transaksi</td>

                       <td id="summary-trx-id" style="font-family: monospace; font-size: 0.9em; word-break: break-all;">INV068266ECC6</td>

                   </tr>

                   <tr>

                       <td>Waktu Pembayaran</td>

                       <td id="summary-pay-time">23 Maret 2026 18.58.11 WIB</td>

                   </tr>

               </tbody></table>

               <h3 style="margin-top: 1.5rem;">Daftar Barang</h3>

               <div id="summary-items" class="summary-items-list"><div class="summary-item">

           <div class="summary-item-name">

               1x CONTOH 03

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Badge OSIS Bordir

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Kaos Kaki Putih Sekolah

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Topi Sekolah Hitam SMK

           </div>

           <div class="summary-item-price">

               Rp 2.000

           </div>

       </div></div>

               <div class="summary-total-details">

                   <div class="summary-detail-row">

                       <span>Total Harga Barang</span>

                       <span id="summary-subtotal-price">Rp 5.000</span>

                   </div>

                   <div class="summary-detail-row">

                       <span>Biaya Layanan/QRIS</span>

                       <span id="summary-fee-price">Rp 345</span>

                   </div>

                   <div class="summary-total">

                       <span>Total Dibayar</span>

                       <strong id="summary-total-price">Rp 5.345</strong>

                   </div>

               </div>

           </div>

           <button class="btn btn-secondary btn-block" id="btn-download-receipt" style="margin-top: 1rem; background-color: var(--success-color); color: white; border-color: var(--success-color);" data-action="download-receipt">

               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; vertical-align: text-bottom;">

                   <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>

                   <polyline points="7 10 12 15 17 10"></polyline>

                   <line x1="12" y1="15" x2="12" y2="3"></line>

               </svg> Download Bukti Pembayaran

           </button>

           <button class="btn btn-primary btn-block js-reset-flow" style="margin-top: 1rem;">Kembali ke

               Beranda</button>

           <div class="alert-info" style="margin-top: 2rem; background-color: #e2e3e5; color: #383d41; padding: 1rem; border-radius: 8px; text-align: center; font-size: 0.9rem;">

               <strong>Keterangan:</strong><br>

               Simpan halaman ini dan unduh bukti pembayaran untuk ditunjukkan saat pengambilan barang di koperasi.

           </div>

       </section>

```

### Log Di Bot Tele

```text

[23/03/2026 18:57] BOT NOTIFIKASI WEB: Log Payment: sesi checkout dibuat

Order

\- Order ID: INV068266ECC6

\- Amount: 5000

\- Jenis barang: 4

\- Ringkasan item: 1x CONTOH 03 \(CONTOH03\); 1x Badge OSIS Bordir \(A001\); 1x Kaos Kaki Putih Sekolah \(S006\); 1x Topi Sekolah Hitam SMK \(S001\)

Session

\- Checkout Token: a54f6e4be7190cf26d626750578ef5bf616a999f77207acb

\- Recovery window sampai: 2026-03-23 12:07:48

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

[23/03/2026 18:57] BOT NOTIFIKASI WEB: Log Payment: QRIS berhasil dibuat

Order

\- Order ID: INV068266ECC6

\- Amount: 5000

\- Fee Gateway: 345

Session

\- Checkout Token: a54f6e4be7190cf26d626750578ef5bf616a999f77207acb

\- Payment Started At: 2026-03-23 11:57:49

\- Gateway Expired At: 2026-03-23T12:57:47.647992214Z

\- Recovery window sampai: 2026-03-23 12:07:48

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

Lainnya

\- Total Payment Gateway: 5345

[23/03/2026 18:58] BOT NOTIFIKASI WEB: Notifikasi Pesanan Koperasi Baru (SUDAH DIBAYAR QRIS)

ID Transaksi: INV068266ECC6

Nama: FREDY YUSUF RIZKY

Kelas: XI TKR

No. WA: 62895322026691

Waktu Pengambilan: Lusa \(Rabu, 25 Maret 2026\) - Istirahat Kedua \(11.45\)

Waktu Pembayaran: 23 Maret 2026 18.58.11 WIB

Rincian Pesanan:

\- 1x CONTOH 03

\- 1x Badge OSIS Bordir

\- 1x Kaos Kaki Putih Sekolah

\- 1x Topi Sekolah Hitam SMK

Total Tagihan: Rp 5.000

Nominal Dibayar (termasuk fee): Rp 5.345

[23/03/2026 18:58] BOT NOTIFIKASI WEB: Security Alert: payload order berubah setelah checkout

Order

\- Order ID: INV068266ECC6

\- Session Amount: 5000

\- Client Total: 2500

\- Server Total: 5000

\- Total Dibayar: 5345

\- Fee Gateway: 345

\- Selisih Total: -2500

\- Jumlah unit client: 4

\- Jumlah unit server: 4

\- Ringkasan item server: 1x CONTOH 03 \(CONTOH03\); 1x Badge OSIS Bordir \(A001\); 1x Kaos Kaki Putih Sekolah \(S006\); 1x Topi Sekolah Hitam SMK \(S001\)

\- Ringkasan item client: 1x CONTOH03; 1x A001; 1x S006; 1x S001

Session

\- Checkout Token: a54f6e4be7190cf26d626750578ef5bf616a999f77207acb

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

Status

\- Aksi sistem: payload client diabaikan, order diproses dari snapshot checkout server

Lainnya

\- Nama: FREDY YUSUF RIZKY

```

## Opsi C - DevTools Console: ubah `payment_amount` saja

### Log Di Tab Network

```text

fetch("http://127.0.0.1:8787/api/checkout/session", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":1000,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":993,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":1000,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":16,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":67,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":2000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":38,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1}],\\"total\\":5000}",

 "method": "POST"

});

{

   "success": true,

   "checkout_token": "458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f",

   "order_id": "INV3612355B7A",

   "amount": 5000,

   "recovery_expires_at": "2026-03-23 13:02:41",

   "expires_at": "2026-03-23 13:02:41"

}

fetch("http://127.0.0.1:8787/api/payment/qris", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"checkout_token\\":\\"458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f\\"}",

 "method": "POST"

});

{

   "payment": {

       "project": "fredy-rizky-cihuy",

       "order_id": "INV3612355B7A",

       "amount": 5000,

       "total_payment": 5345,

       "fee": 345,

       "received": 5000,

       "payment_method": "qris",

       "payment_number": "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111",

       "expired_at": "2026-03-23T13:52:40.639902556Z"

   },

   "checkout_token": "458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f",

   "order_id": "INV3612355B7A",

   "amount": 5000,

   "payment_started_at": "2026-03-23 12:52:42",

   "gateway_expires_at": "2026-03-23T13:52:40.639902556Z",

   "recovery_expires_at": "2026-03-23 13:02:41",

   "expires_at": "2026-03-23 13:02:41"

}

fetch("http://127.0.0.1:8787/api/payment/status?checkout_token=458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": null,

 "method": "GET"

});

{

   "transaction": {

       "amount": 5000,

       "order_id": "INV3612355B7A",

       "project": "fredy-rizky-cihuy",

       "status": "completed",

       "payment_method": "qris",

       "completed_at": "2026-03-23T12:52:53.895Z",

       "is_sandbox": true

   },

   "checkout_token": "458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f",

   "order_id": "INV3612355B7A",

   "amount": 5000,

   "payment_started_at": "2026-03-23 12:52:42",

   "gateway_expires_at": "2026-03-23T13:52:40.639902556Z",

   "gateway_status": "completed",

   "recovery_expires_at": "2026-03-23 13:02:41",

   "expires_at": "2026-03-23 13:02:41"

}

fetch("http://127.0.0.1:8787/api/orders", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"nama\\":\\"FREDY YUSUF RIZKY\\",\\"kelas\\":\\"X DPIB\\",\\"wa\\":\\"6285217939239\\",\\"pickup_date\\":\\"2026-03-25\\",\\"pickup_slot\\":\\"FIRST_BREAK\\",\\"waktu\\":\\"Lusa (Rabu, 25 Maret 2026) - Istirahat Pertama (09.15)\\",\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":1000,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":993,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":1000,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":16,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":67,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":2000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":38,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1}],\\"total\\":5000,\\"payment_amount\\":5000,\\"payment_number\\":\\"THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111\\",\\"id_transaksi\\":\\"INV3612355B7A\\",\\"checkout_token\\":\\"458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f\\",\\"checkout_expires_at\\":\\"2026-03-23 13:02:41\\",\\"payment_started_at\\":\\"2026-03-23 12:52:42\\",\\"gateway_expires_at\\":\\"2026-03-23T13:52:40.639902556Z\\",\\"waktu_pembayaran\\":\\"23 Maret 2026 19.53.03 WIB\\"}",

 "method": "POST"

});

{

   "success": true,

   "message": "Order created successfully",

   "verification_token": "9f792ca0fff1d87f20f3cfd8eae12b53819bc7f0b155d59b",

   "pickup_time": "Lusa (Rabu, 25 Maret 2026) - Istirahat Pertama (09.15)",

   "order_summary": {

       "id_transaksi": "INV3612355B7A",

       "nama": "FREDY YUSUF RIZKY",

       "kelas": "X DPIB",

       "waktu": "Lusa (Rabu, 25 Maret 2026) - Istirahat Pertama (09.15)",

       "waktu_pembayaran": "23 Maret 2026 19.53.03 WIB",

       "total": 5000,

       "fee": 0,

       "payment_amount": 5000,

       "items": [

           {

               "product": {

                   "code": "CONTOH03",

                   "name": "CONTOH 03",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "A001",

                   "name": "Badge OSIS Bordir",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S006",

                   "name": "Kaos Kaki Putih Sekolah",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S001",

                   "name": "Topi Sekolah Hitam SMK",

                   "price": 2000

               },

               "quantity": 1

           }

       ]

   },

   "sanitized_from_checkout_session": false

}

```

### Log Di Console Browser

```text

(() => {

 const originalFetch = window.fetch;

 const tamperPaymentAmountOnly = (body) => {

   const originalPaymentAmount = Number(body?.payment_amount || 0);

   const originalTotal = Number(body?.total || 0);

   // Contoh: paksa nilai bayar sama persis dengan subtotal barang (seolah fee hilang)

   body.payment_amount = Math.max(1000, originalTotal);

   console.log("payment_amount lama:", originalPaymentAmount);

   console.log("payment_amount baru:", body.payment_amount);

   return body;

 };

 window.__tamperReset = () => {

   window.fetch = originalFetch;

   console.log("Tamper interceptor dimatikan.");

 };

 window.fetch = async (input, init = {}) => {

   const url = typeof input === "string" ? input : input?.url || "";

   if (url.includes("/api/orders") && init?.body) {

     const body = JSON.parse(init.body);

     tamperPaymentAmountOnly(body);

     init = { ...init, body: JSON.stringify(body) };

     console.log("Tampered /api/orders (payment_amount only):", body);

   }

   return originalFetch(input, init);

 };

 console.log("Tamper interceptor aktif untuk /api/orders (payment_amount only).");

})();

VM463:32 Tamper interceptor aktif untuk /api/orders (payment_amount only).

undefined

VM463:11 payment_amount lama: 5345

VM463:12 payment_amount baru: 5000

VM463:27 Tampered /api/orders (payment_amount only): {nama: 'FREDY YUSUF RIZKY', kelas: 'X DPIB', wa: '6285217939239', pickup_date: '2026-03-25', pickup_slot: 'FIRST_BREAK', …}checkout_expires_at: "2026-03-23 13:02:41"checkout_token: "458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f"gateway_expires_at: "2026-03-23T13:52:40.639902556Z"id_transaksi: "INV3612355B7A"items: Array(4)0: product: category: "Alat Tulis"code: "CONTOH03"created_at: "2026-03-22 15:33:17"id: 52image_url: "/api/images/product_1774193635436_lsyf9sc.jpg"name: "CONTOH 03"price: 1000stock: 993[[Prototype]]: Objectquantity: 1[[Prototype]]: Object1: product: category: "Aksesoris"code: "A001"created_at: "2026-03-22 13:52:25"id: 31image_url: "https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg"name: "Badge OSIS Bordir"price: 1000stock: 16[[Prototype]]: Objectquantity: 1[[Prototype]]: Object2: product: category: "Seragam"code: "S006"created_at: "2026-03-22 13:52:25"id: 26image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s"name: "Kaos Kaki Putih Sekolah"price: 1000stock: 67[[Prototype]]: Objectquantity: 1[[Prototype]]: Object3: product: category: "Seragam"code: "S001"created_at: "2026-03-22 13:52:25"id: 21image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s"name: "Topi Sekolah Hitam SMK"price: 2000stock: 38[[Prototype]]: Objectquantity: 1[[Prototype]]: Objectlength: 4[[Prototype]]: Array(0)kelas: "X DPIB"nama: "FREDY YUSUF RIZKY"payment_amount: 5000payment_number: "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111"payment_started_at: "2026-03-23 12:52:42"pickup_date: "2026-03-25"pickup_slot: "FIRST_BREAK"total: 5000wa: "6285217939239"waktu: "Lusa (Rabu, 25 Maret 2026) - Istirahat Pertama (09.15)"waktu_pembayaran: "23 Maret 2026 19.53.03 WIB"[[Prototype]]: Object

```

### Tampilan Web

```text

<section id="view-summary" class="view">

           <div class="success-alert">

               <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

                   <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>

                   <polyline points="22 4 12 14.01 9 11.01"></polyline>

               </svg>

               <h2>Pesanan Berhasil Dibuat!</h2>

               <p>Terima kasih, berikut ringkasan pesanan Anda.</p>

           </div>

           <div class="summary-card">

               <h3>Detail Pemesan</h3>

               <table class="summary-table">

                   <tbody><tr>

                       <td>Nama Lengkap</td>

                       <td id="summary-nama">FREDY YUSUF RIZKY</td>

                   </tr>

                   <tr>

                       <td>Kelas</td>

                       <td id="summary-kelas">X DPIB</td>

                   </tr>

                   <tr>

                       <td>Waktu Pengambilan</td>

                       <td id="summary-waktu">Lusa (Rabu, 25 Maret 2026) - Istirahat Pertama (09.15)</td>

                   </tr>

                   <tr>

                       <td>ID Transaksi</td>

                       <td id="summary-trx-id" style="font-family: monospace; font-size: 0.9em; word-break: break-all;">INV3612355B7A</td>

                   </tr>

                   <tr>

                       <td>Waktu Pembayaran</td>

                       <td id="summary-pay-time">23 Maret 2026 19.53.03 WIB</td>

                   </tr>

               </tbody></table>

               <h3 style="margin-top: 1.5rem;">Daftar Barang</h3>

               <div id="summary-items" class="summary-items-list"><div class="summary-item">

           <div class="summary-item-name">

               1x CONTOH 03

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Badge OSIS Bordir

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Kaos Kaki Putih Sekolah

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Topi Sekolah Hitam SMK

           </div>

           <div class="summary-item-price">

               Rp 2.000

           </div>

       </div></div>

               <div class="summary-total-details">

                   <div class="summary-detail-row">

                       <span>Total Harga Barang</span>

                       <span id="summary-subtotal-price">Rp 5.000</span>

                   </div>

                   <div class="summary-detail-row">

                       <span>Biaya Layanan/QRIS</span>

                       <span id="summary-fee-price">Rp 0</span>

                   </div>

                   <div class="summary-total">

                       <span>Total Dibayar</span>

                       <strong id="summary-total-price">Rp 5.000</strong>

                   </div>

               </div>

           </div>

           <button class="btn btn-secondary btn-block" id="btn-download-receipt" style="margin-top: 1rem; background-color: var(--success-color); color: white; border-color: var(--success-color);" data-action="download-receipt">

               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; vertical-align: text-bottom;">

                   <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>

                   <polyline points="7 10 12 15 17 10"></polyline>

                   <line x1="12" y1="15" x2="12" y2="3"></line>

               </svg> Download Bukti Pembayaran

           </button>

           <button class="btn btn-primary btn-block js-reset-flow" style="margin-top: 1rem;">Kembali ke

               Beranda</button>

           <div class="alert-info" style="margin-top: 2rem; background-color: #e2e3e5; color: #383d41; padding: 1rem; border-radius: 8px; text-align: center; font-size: 0.9rem;">

               <strong>Keterangan:</strong><br>

               Simpan halaman ini dan unduh bukti pembayaran untuk ditunjukkan saat pengambilan barang di koperasi.

           </div>

       </section>

```

### Log Di Bot Telegram

```text

[23/03/2026 19:52] BOT NOTIFIKASI WEB: Log Payment: sesi checkout dibuat

Order

\- Order ID: INV3612355B7A

\- Amount: 5000

\- Jenis barang: 4

\- Ringkasan item: 1x CONTOH 03 \(CONTOH03\); 1x Badge OSIS Bordir \(A001\); 1x Kaos Kaki Putih Sekolah \(S006\); 1x Topi Sekolah Hitam SMK \(S001\)

Session

\- Checkout Token: 458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f

\- Recovery window sampai: 2026-03-23 13:02:41

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

[23/03/2026 19:52] BOT NOTIFIKASI WEB: Log Payment: QRIS berhasil dibuat

Order

\- Order ID: INV3612355B7A

\- Amount: 5000

\- Fee Gateway: 345

Session

\- Checkout Token: 458805a64217ec1e4adb9835ef49d1b3b2f4f86058fc282f

\- Payment Started At: 2026-03-23 12:52:42

\- Gateway Expired At: 2026-03-23T13:52:40.639902556Z

\- Recovery window sampai: 2026-03-23 13:02:41

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

Lainnya

\- Total Payment Gateway: 5345

[23/03/2026 19:53] BOT NOTIFIKASI WEB: Notifikasi Pesanan Koperasi Baru (SUDAH DIBAYAR QRIS)

ID Transaksi: INV3612355B7A

Nama: FREDY YUSUF RIZKY

Kelas: X DPIB

No. WA: 6285217939239

Waktu Pengambilan: Lusa \(Rabu, 25 Maret 2026\) - Istirahat Pertama \(09.15\)

Waktu Pembayaran: 23 Maret 2026 19.53.03 WIB

Rincian Pesanan:

\- 1x CONTOH 03

\- 1x Badge OSIS Bordir

\- 1x Kaos Kaki Putih Sekolah

\- 1x Topi Sekolah Hitam SMK

Total Tagihan: Rp 5.000

```

## Opsi D - DevTools Console: gabungan `qty + price + payment_amount`

### Log Di Tab Network

```text

fetch("http://127.0.0.1:8787/api/checkout/session", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":1000,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":992,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":1000,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":15,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":66,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":2000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":37,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":1}],\\"total\\":5000}",

 "method": "POST"

});

{

   "success": true,

   "checkout_token": "7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b",

   "order_id": "INV13654062BF",

   "amount": 5000,

   "recovery_expires_at": "2026-03-23 13:15:36",

   "expires_at": "2026-03-23 13:15:36"

}

fetch("http://127.0.0.1:8787/api/payment/qris", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"checkout_token\\":\\"7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b\\"}",

 "method": "POST"

});

{

   "payment": {

       "project": "fredy-rizky-cihuy",

       "order_id": "INV13654062BF",

       "amount": 5000,

       "total_payment": 5345,

       "fee": 345,

       "received": 5000,

       "payment_method": "qris",

       "payment_number": "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111",

       "expired_at": "2026-03-23T14:05:35.844747074Z"

   },

   "checkout_token": "7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b",

   "order_id": "INV13654062BF",

   "amount": 5000,

   "payment_started_at": "2026-03-23 13:05:38",

   "gateway_expires_at": "2026-03-23T14:05:35.844747074Z",

   "recovery_expires_at": "2026-03-23 13:15:36",

   "expires_at": "2026-03-23 13:15:36"

}

fetch("http://127.0.0.1:8787/api/payment/status?checkout_token=7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": null,

 "method": "GET"

});

{

   "transaction": {

       "amount": 5000,

       "order_id": "INV13654062BF",

       "project": "fredy-rizky-cihuy",

       "status": "completed",

       "payment_method": "qris",

       "completed_at": "2026-03-23T13:05:44.297Z",

       "is_sandbox": true

   },

   "checkout_token": "7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b",

   "order_id": "INV13654062BF",

   "amount": 5000,

   "payment_started_at": "2026-03-23 13:05:38",

   "gateway_expires_at": "2026-03-23T14:05:35.844747074Z",

   "gateway_status": "completed",

   "recovery_expires_at": "2026-03-23 13:15:36",

   "expires_at": "2026-03-23 13:15:36"

}

fetch("http://127.0.0.1:8787/api/orders", {

 "headers": {

   "accept": "*/*",

   "accept-language": "id,en-US;q=0.9,en;q=0.8",

   "content-type": "application/json",

   "sec-ch-ua": "\\"Chromium\\";v=\\"146\\", \\"Not-A.Brand\\";v=\\"24\\", \\"Google Chrome\\";v=\\"146\\"",

   "sec-ch-ua-mobile": "?0",

   "sec-ch-ua-platform": "\\"Windows\\"",

   "sec-fetch-dest": "empty",

   "sec-fetch-mode": "cors",

   "sec-fetch-site": "same-origin",

   "Referer": "http://127.0.0.1:8787/"

 },

 "body": "{\\"nama\\":\\"FREDY YUSUF RIZKY\\",\\"kelas\\":\\"X TP\\",\\"wa\\":\\"62895322026691\\",\\"pickup_date\\":\\"2026-03-26\\",\\"pickup_slot\\":\\"FIRST_BREAK\\",\\"waktu\\":\\"Kamis, 26 Maret 2026 - Istirahat Pertama (09.15)\\",\\"items\\":[{\\"product\\":{\\"id\\":52,\\"code\\":\\"CONTOH03\\",\\"name\\":\\"CONTOH 03\\",\\"price\\":500,\\"category\\":\\"Alat Tulis\\",\\"image_url\\":\\"/api/images/product_1774193635436_lsyf9sc.jpg\\",\\"stock\\":992,\\"created_at\\":\\"2026-03-22 15:33:17\\"},\\"quantity\\":2},{\\"product\\":{\\"id\\":31,\\"code\\":\\"A001\\",\\"name\\":\\"Badge OSIS Bordir\\",\\"price\\":500,\\"category\\":\\"Aksesoris\\",\\"image_url\\":\\"https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg\\",\\"stock\\":15,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":2},{\\"product\\":{\\"id\\":26,\\"code\\":\\"S006\\",\\"name\\":\\"Kaos Kaki Putih Sekolah\\",\\"price\\":500,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s\\",\\"stock\\":66,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":2},{\\"product\\":{\\"id\\":21,\\"code\\":\\"S001\\",\\"name\\":\\"Topi Sekolah Hitam SMK\\",\\"price\\":1000,\\"category\\":\\"Seragam\\",\\"image_url\\":\\"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s\\",\\"stock\\":37,\\"created_at\\":\\"2026-03-22 13:52:25\\"},\\"quantity\\":2}],\\"total\\":5000,\\"payment_amount\\":5000,\\"payment_number\\":\\"THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111\\",\\"id_transaksi\\":\\"INV13654062BF\\",\\"checkout_token\\":\\"7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b\\",\\"checkout_expires_at\\":\\"2026-03-23 13:15:36\\",\\"payment_started_at\\":\\"2026-03-23 13:05:38\\",\\"gateway_expires_at\\":\\"2026-03-23T14:05:35.844747074Z\\",\\"waktu_pembayaran\\":\\"23 Maret 2026 20.05.59 WIB\\"}",

 "method": "POST"

});

{

   "success": true,

   "message": "Order created successfully",

   "verification_token": "2d91ef98a11b26fa8d4acf04782546dde0e4f37f776cfcbc",

   "pickup_time": "Kamis, 26 Maret 2026 - Istirahat Pertama (09.15)",

   "order_summary": {

       "id_transaksi": "INV13654062BF",

       "nama": "FREDY YUSUF RIZKY",

       "kelas": "X TP",

       "waktu": "Kamis, 26 Maret 2026 - Istirahat Pertama (09.15)",

       "waktu_pembayaran": "23 Maret 2026 20.05.59 WIB",

       "total": 5000,

       "fee": 0,

       "payment_amount": 5000,

       "items": [

           {

               "product": {

                   "code": "CONTOH03",

                   "name": "CONTOH 03",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "A001",

                   "name": "Badge OSIS Bordir",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S006",

                   "name": "Kaos Kaki Putih Sekolah",

                   "price": 1000

               },

               "quantity": 1

           },

           {

               "product": {

                   "code": "S001",

                   "name": "Topi Sekolah Hitam SMK",

                   "price": 2000

               },

               "quantity": 1

           }

       ]

   },

   "sanitized_from_checkout_session": true

}

```

### Log Di Console Browser

```text

(() => {

 const originalFetch = window.fetch;

 const PRICE_FACTOR = 0.5;

 const tamperMixedOrderPayload = (body) => {

   const items = Array.isArray(body?.items) ? body.items : [];

   let newTotal = 0;

   items.forEach((item) => {

     const qty = Number(item?.quantity || 0);

     const stock = Number(item?.product?.stock);

     const oldPrice = Number(item?.product?.price || 0);

     const newPrice = Math.max(1, Math.floor(oldPrice \* PRICE_FACTOR));

     if (Number.isFinite(stock) && Number.isInteger(qty) && stock >= (qty + 1)) {

       item.quantity = qty + 1;

     }

     if (item?.product) item.product.price = newPrice;

     newTotal += newPrice \* Number(item?.quantity || 0);

   });

   body.total = Math.max(1000, newTotal);

   body.payment_amount = body.total;

   return body;

 };

 window.__tamperReset = () => {

   window.fetch = originalFetch;

   console.log("Tamper interceptor dimatikan.");

 };

 window.fetch = async (input, init = {}) => {

   const url = typeof input === "string" ? input : input?.url || "";

   if (url.includes("/api/orders") && init?.body) {

     const body = JSON.parse(init.body);

     tamperMixedOrderPayload(body);

     init = { ...init, body: JSON.stringify(body) };

     console.log("Tampered /api/orders (mixed):", body);

   }

   return originalFetch(input, init);

 };

 console.log("Tamper interceptor aktif untuk /api/orders (mixed).");

})();

VM671:44 Tamper interceptor aktif untuk /api/orders (mixed).

undefined

VM671:39 Tampered /api/orders (mixed): {nama: 'FREDY YUSUF RIZKY', kelas: 'X TP', wa: '62895322026691', pickup_date: '2026-03-26', pickup_slot: 'FIRST_BREAK', …}checkout_expires_at: "2026-03-23 13:15:36"checkout_token: "7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b"gateway_expires_at: "2026-03-23T14:05:35.844747074Z"id_transaksi: "INV13654062BF"items: Array(4)0: product: category: "Alat Tulis"code: "CONTOH03"created_at: "2026-03-22 15:33:17"id: 52image_url: "/api/images/product_1774193635436_lsyf9sc.jpg"name: "CONTOH 03"price: 500stock: 992[[Prototype]]: Objectquantity: 2[[Prototype]]: Object1: product: category: "Aksesoris"code: "A001"created_at: "2026-03-22 13:52:25"id: 31image_url: "https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/9c107b357e764fb6afb73aa21fea223b~tplv-aphluv4xwc-white-pad-v1:250:250.jpeg"name: "Badge OSIS Bordir"price: 500stock: 15[[Prototype]]: Objectquantity: 2[[Prototype]]: Object2: product: category: "Seragam"code: "S006"created_at: "2026-03-22 13:52:25"id: 26image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ_n_WZEiOxi1veILhlTQlzJ9X-W8p8TmpSNw&s"name: "Kaos Kaki Putih Sekolah"price: 500stock: 66[[Prototype]]: Objectquantity: 2[[Prototype]]: Object3: product: category: "Seragam"code: "S001"created_at: "2026-03-22 13:52:25"id: 21image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxVMACnsHZCRfePts_uWZVHDMeDZyHYXMxRA&s"name: "Topi Sekolah Hitam SMK"price: 1000stock: 37[[Prototype]]: Objectquantity: 2[[Prototype]]: Objectlength: 4[[Prototype]]: Array(0)kelas: "X TP"nama: "FREDY YUSUF RIZKY"payment_amount: 5000payment_number: "THIS.IS.JUST.AN.EXAMPLE.FOR.SANDBOX.00020101021226610016ID.CO.SHOPEE.WWW01189360091800216005230208216005230303UME51440014ID.CO.QRIS.WWW.11111"payment_started_at: "2026-03-23 13:05:38"pickup_date: "2026-03-26"pickup_slot: "FIRST_BREAK"total: 5000wa: "62895322026691"waktu: "Kamis, 26 Maret 2026 - Istirahat Pertama (09.15)"waktu_pembayaran: "23 Maret 2026 20.05.59 WIB"[[Prototype]]: Object

```

### Tampilan Web

```text

<section id="view-summary" class="view">

           <div class="success-alert">

               <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

                   <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>

                   <polyline points="22 4 12 14.01 9 11.01"></polyline>

               </svg>

               <h2>Pesanan Berhasil Dibuat!</h2>

               <p>Terima kasih, berikut ringkasan pesanan Anda.</p>

           </div>

           <div class="summary-card">

               <h3>Detail Pemesan</h3>

               <table class="summary-table">

                   <tbody><tr>

                       <td>Nama Lengkap</td>

                       <td id="summary-nama">FREDY YUSUF RIZKY</td>

                   </tr>

                   <tr>

                       <td>Kelas</td>

                       <td id="summary-kelas">X TP</td>

                   </tr>

                   <tr>

                       <td>Waktu Pengambilan</td>

                       <td id="summary-waktu">Kamis, 26 Maret 2026 - Istirahat Pertama (09.15)</td>

                   </tr>

                   <tr>

                       <td>ID Transaksi</td>

                       <td id="summary-trx-id" style="font-family: monospace; font-size: 0.9em; word-break: break-all;">INV13654062BF</td>

                   </tr>

                   <tr>

                       <td>Waktu Pembayaran</td>

                       <td id="summary-pay-time">23 Maret 2026 20.05.59 WIB</td>

                   </tr>

               </tbody></table>

               <h3 style="margin-top: 1.5rem;">Daftar Barang</h3>

               <div id="summary-items" class="summary-items-list"><div class="summary-item">

           <div class="summary-item-name">

               1x CONTOH 03

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Badge OSIS Bordir

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Kaos Kaki Putih Sekolah

           </div>

           <div class="summary-item-price">

               Rp 1.000

           </div>

       </div><div class="summary-item">

           <div class="summary-item-name">

               1x Topi Sekolah Hitam SMK

           </div>

           <div class="summary-item-price">

               Rp 2.000

           </div>

       </div></div>

               <div class="summary-total-details">

                   <div class="summary-detail-row">

                       <span>Total Harga Barang</span>

                       <span id="summary-subtotal-price">Rp 5.000</span>

                   </div>

                   <div class="summary-detail-row">

                       <span>Biaya Layanan/QRIS</span>

                       <span id="summary-fee-price">Rp 0</span>

                   </div>

                   <div class="summary-total">

                       <span>Total Dibayar</span>

                       <strong id="summary-total-price">Rp 5.000</strong>

                   </div>

               </div>

           </div>

           <button class="btn btn-secondary btn-block" id="btn-download-receipt" style="margin-top: 1rem; background-color: var(--success-color); color: white; border-color: var(--success-color);" data-action="download-receipt">

               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 5px; vertical-align: text-bottom;">

                   <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>

                   <polyline points="7 10 12 15 17 10"></polyline>

                   <line x1="12" y1="15" x2="12" y2="3"></line>

               </svg> Download Bukti Pembayaran

           </button>

           <button class="btn btn-primary btn-block js-reset-flow" style="margin-top: 1rem;">Kembali ke

               Beranda</button>

           <div class="alert-info" style="margin-top: 2rem; background-color: #e2e3e5; color: #383d41; padding: 1rem; border-radius: 8px; text-align: center; font-size: 0.9rem;">

               <strong>Keterangan:</strong><br>

               Simpan halaman ini dan unduh bukti pembayaran untuk ditunjukkan saat pengambilan barang di koperasi.

           </div>

       </section>

```

### Log Di Bot Telegram

```text

[23/03/2026 20:05] BOT NOTIFIKASI WEB: Log Payment: sesi checkout dibuat

Order

\- Order ID: INV13654062BF

\- Amount: 5000

\- Jenis barang: 4

\- Ringkasan item: 1x CONTOH 03 \(CONTOH03\); 1x Badge OSIS Bordir \(A001\); 1x Kaos Kaki Putih Sekolah \(S006\); 1x Topi Sekolah Hitam SMK \(S001\)

Session

\- Checkout Token: 7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b

\- Recovery window sampai: 2026-03-23 13:15:36

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

[23/03/2026 20:05] BOT NOTIFIKASI WEB: Log Payment: QRIS berhasil dibuat

Order

\- Order ID: INV13654062BF

\- Amount: 5000

\- Fee Gateway: 345

Session

\- Checkout Token: 7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b

\- Payment Started At: 2026-03-23 13:05:38

\- Gateway Expired At: 2026-03-23T14:05:35.844747074Z

\- Recovery window sampai: 2026-03-23 13:15:36

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

Lainnya

\- Total Payment Gateway: 5345

[23/03/2026 20:06] BOT NOTIFIKASI WEB: Security Alert: payload order berubah setelah checkout

Order

\- Order ID: INV13654062BF

\- Session Amount: 5000

\- Client Total: 5000

\- Server Total: 5000

\- Total Dibayar: 5000

\- Fee Gateway: 0

\- Selisih Total: 0

\- Jumlah unit client: 8

\- Jumlah unit server: 4

\- Ringkasan item server: 1x CONTOH 03 \(CONTOH03\); 1x Badge OSIS Bordir \(A001\); 1x Kaos Kaki Putih Sekolah \(S006\); 1x Topi Sekolah Hitam SMK \(S001\)

\- Ringkasan item client: 2x CONTOH03; 2x A001; 2x S006; 2x S001

\- Selisih qty: A001 / Badge OSIS Bordir -> client 2, server 1, delta +1

\- Selisih qty: CONTOH03 / CONTOH 03 -> client 2, server 1, delta +1

\- Selisih qty: S001 / Topi Sekolah Hitam SMK -> client 2, server 1, delta +1

\- Selisih qty: S006 / Kaos Kaki Putih Sekolah -> client 2, server 1, delta +1

Session

\- Checkout Token: 7281db7c7e4236fe1f8cbf36654dfefb441a93375ae8e27b

Request Meta

\- IP: local-dev

\- Device: Chrome / Windows

\- User-Agent: Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit/537.36 \(KHTML, like Gecko\) Chrome/146.0.0.0 Safari/537.36

Status

\- Aksi sistem: payload client diabaikan, order diproses dari snapshot checkout server

Lainnya

\- Nama: FREDY YUSUF RIZKY

[23/03/2026 20:06] BOT NOTIFIKASI WEB: Notifikasi Pesanan Koperasi Baru (SUDAH DIBAYAR QRIS)

ID Transaksi: INV13654062BF

Nama: FREDY YUSUF RIZKY

Kelas: X TP

No. WA: 62895322026691

Waktu Pengambilan: Kamis, 26 Maret 2026 - Istirahat Pertama \(09.15\)

Waktu Pembayaran: 23 Maret 2026 20.05.59 WIB

Rincian Pesanan:

\- 1x CONTOH 03

\- 1x Badge OSIS Bordir

\- 1x Kaos Kaki Putih Sekolah

\- 1x Topi Sekolah Hitam SMK

Total Tagihan: Rp 5.000

Informasi Tambahan Dari Saya Request Get Manual ke http://127.0.0.1:8787/api/admin/orders?page=1&limit=4

{

 "success": true,

 "data": [

   {

     "id": "INV13654062BF",

     "customer_name": "FREDY YUSUF RIZKY",

     "customer_class": "X TP",

     "wa_number": "62895322026691",

     "pickup_time": "Kamis, 26 Maret 2026 - Istirahat Pertama (09.15)",

     "total_amount": 5000,

     "fee": 0,

     "payment_status": "PAID",

     "verification_token": "2d91ef98a11b26fa8d4acf04782546dde0e4f37f776cfcbc",

     "created_at": "2026-03-23T13:06:00Z",

     "items": [

       {

         "id": 136,

         "order_id": "INV13654062BF",

         "product_name": "CONTOH 03",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 137,

         "order_id": "INV13654062BF",

         "product_name": "Badge OSIS Bordir",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 138,

         "order_id": "INV13654062BF",

         "product_name": "Kaos Kaki Putih Sekolah",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 139,

         "order_id": "INV13654062BF",

         "product_name": "Topi Sekolah Hitam SMK",

         "quantity": 1,

         "price_at_purchase": 2000

       }

     ]

   },

   {

     "id": "INV3612355B7A",

     "customer_name": "FREDY YUSUF RIZKY",

     "customer_class": "X DPIB",

     "wa_number": "6285217939239",

     "pickup_time": "Lusa (Rabu, 25 Maret 2026) - Istirahat Pertama (09.15)",

     "total_amount": 5000,

     "fee": 0,

     "payment_status": "PAID",

     "verification_token": "9f792ca0fff1d87f20f3cfd8eae12b53819bc7f0b155d59b",

     "created_at": "2026-03-23T12:53:04Z",

     "items": [

       {

         "id": 132,

         "order_id": "INV3612355B7A",

         "product_name": "CONTOH 03",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 133,

         "order_id": "INV3612355B7A",

         "product_name": "Badge OSIS Bordir",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 134,

         "order_id": "INV3612355B7A",

         "product_name": "Kaos Kaki Putih Sekolah",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 135,

         "order_id": "INV3612355B7A",

         "product_name": "Topi Sekolah Hitam SMK",

         "quantity": 1,

         "price_at_purchase": 2000

       }

     ]

   },

   {

     "id": "INV068266ECC6",

     "customer_name": "FREDY YUSUF RIZKY",

     "customer_class": "XI TKR",

     "wa_number": "62895322026691",

     "pickup_time": "Lusa (Rabu, 25 Maret 2026) - Istirahat Kedua (11.45)",

     "total_amount": 5000,

     "fee": 345,

     "payment_status": "PAID",

     "verification_token": "31bf70d3c1ca731d5e2aee0f2500cad89b93ae6a3ae11ff8",

     "created_at": "2026-03-23T11:58:11Z",

     "items": [

       {

         "id": 128,

         "order_id": "INV068266ECC6",

         "product_name": "CONTOH 03",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 129,

         "order_id": "INV068266ECC6",

         "product_name": "Badge OSIS Bordir",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 130,

         "order_id": "INV068266ECC6",

         "product_name": "Kaos Kaki Putih Sekolah",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 131,

         "order_id": "INV068266ECC6",

         "product_name": "Topi Sekolah Hitam SMK",

         "quantity": 1,

         "price_at_purchase": 2000

       }

     ]

   },

   {

     "id": "INV327763ED44",

     "customer_name": "FREDY YUSUF RIZKY",

     "customer_class": "XI TITL",

     "wa_number": "62895322026691",

     "pickup_time": "Besok (Selasa, 24 Maret 2026) - Istirahat Pertama (09.15)",

     "total_amount": 5000,

     "fee": 345,

     "payment_status": "PAID",

     "verification_token": "038faf9cedb0d28474d728a628e5cb25035c997f009c44fc",

     "created_at": "2026-03-23T11:46:11Z",

     "items": [

       {

         "id": 124,

         "order_id": "INV327763ED44",

         "product_name": "CONTOH 03",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 125,

         "order_id": "INV327763ED44",

         "product_name": "Badge OSIS Bordir",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 126,

         "order_id": "INV327763ED44",

         "product_name": "Kaos Kaki Putih Sekolah",

         "quantity": 1,

         "price_at_purchase": 1000

       },

       {

         "id": 127,

         "order_id": "INV327763ED44",

         "product_name": "Topi Sekolah Hitam SMK",

         "quantity": 1,

         "price_at_purchase": 2000

       }

     ]

   }

 ],

 "meta": {

   "page": 1,

   "limit": 4,

   "total": 49,

   "hasMore": true

 }

}

```

## Ringkasan Final Hasil Testing Tampering

Tanggal penutupan evaluasi: 23 Maret 2026

### 1. Kesimpulan Umum

Setelah perbaikan pada flow payment dan save order, pengujian tampering pasca-checkout menunjukkan bahwa browser sudah tidak bisa lagi mengubah:

- qty order final
- harga item order final
- fee QRIS
- total pembayaran yang tercatat

Server sekarang tetap membentuk order final dari snapshot server (`checkout_session` + `stock_reservations` + data produk DB), lalu mencatat mismatch payload client ke log security.

### 2. Status Per Skenario

- Opsi A - ubah quantity + total: LULUS
- Opsi B - ubah harga item + total: LULUS
- Opsi C - ubah `payment_amount` saja: LULUS
- Opsi D - gabungan `qty + price + payment_amount`: LULUS

### 3. Temuan Penting Sebelum dan Sesudah Perbaikan

Sebelum perbaikan:

- item order final sudah aman dari tampering pasca-checkout
- tetapi field finansial `payment_amount` masih terlalu percaya payload browser
- akibatnya fee dapat tercatat `0` walaupun gateway mengenakan fee
- dampaknya ikut merembet ke summary sukses, data admin, verifikasi publik, dan log Telegram

Sesudah perbaikan:

- `payment_amount` dan `fee` diambil dari snapshot gateway/server, bukan dari browser
- Opsi C sekarang terdeteksi sebagai security mismatch
- Opsi D sekarang tetap menghasilkan:
  - item final resmi dari server
  - fee resmi `345`
  - total dibayar resmi `5345`
- verifikasi publik dan endpoint admin kini menampilkan fee yang benar

### 4. Bukti Hasil Akhir yang Paling Penting

Pada retest Opsi C:

- client mengirim `payment_amount: 5000`
- server tetap menyimpan `fee: 345`
- server tetap mengembalikan `payment_amount: 5345`
- `sanitized_from_checkout_session: true`
- log security mencatat:
  - `Client Payment Amount: 5000`
  - `Server Payment Amount: 5345`
  - `Client Fee: 0`
  - `Server Fee: 345`

Pada retest Opsi D:

- client mengubah qty, harga, dan `payment_amount` sekaligus
- server tetap menyimpan qty resmi
- server tetap menyimpan harga resmi
- server tetap menyimpan `fee: 345`
- log security mencatat:
  - selisih qty
  - selisih harga
  - selisih payment amount

### 5. Status Risiko Saat Ini

Risiko besar yang sebelumnya ada pada area finansial dapat dianggap sudah tertutup untuk skenario tampering manual yang diuji di dokumen ini.

Kategori status:

- keamanan order pasca-checkout: aman
- keamanan finansial pasca-checkout: aman
- logging mismatch: memadai
- verifikasi publik: konsisten
- data admin order: konsisten

### 6. Sisa Follow-Up Kecil

Masih ada beberapa hal minor yang layak dicatat:

- urutan log Telegram sempat menjadi catatan observability, tetapi retest terakhir menunjukkan urutannya sudah benar
- skenario tampering sebelum `POST /api/checkout/session` sudah diuji ulang dan tetap ditolak dengan benar
- jika ingin dokumentasi lebih ringkas di masa depan, log mentah ini masih bisa dipisah lagi dari executive summary

### 7. Putusan Akhir

Untuk domain tampering yang diuji di dokumen ini, sistem dapat dinyatakan:

- LAYAK LANJUT ke smoke test akhir
- TIDAK ADA blocker besar tersisa pada tampering pasca-checkout
- SIAP dipakai sebagai baseline sebelum pengujian deploy/staging berikutnya
