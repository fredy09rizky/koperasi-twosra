// Modul `App` khusus generasi PDF bukti pembayaran.
// Jangan instantiate `App` di file ini.

import { ensureHtml2PdfLibrary, ensureQrCodeLibrary, formatWibDateTime, toSafeNumber } from './config.js';
import { App } from './app.core.js';

App.prototype.downloadReceipt = async function downloadReceipt(btnElement) {
    const logger = this.getLogger();
    // 1. Ambil data pesanan mutakhir dari antrian `checkoutForm`
    const checkout = this.getCheckoutForm();
    const data = checkout?.currentOrderData;
    if (!data) {
        this.showToast("Data pesanan tidak ditemukan.");
        return;
    }

    // 2. Beri efek "Loading" pada tombol unduh agar antarmuka interaktif
    const originalButtonNodes = btnElement
        ? Array.from(btnElement.childNodes).map((node) => node.cloneNode(true))
        : [];
    if (btnElement) {
        const spinner = document.createElement('span');
        spinner.className = 'button-spinner';
        btnElement.replaceChildren(spinner, document.createTextNode(' Generating...'));
        btnElement.disabled = true;
    }

    try {
        const [QRCodeLibrary, html2pdfLibrary] = await Promise.all([
            ensureQrCodeLibrary(),
            ensureHtml2PdfLibrary()
        ]);
        await this.ensureReceiptTemplate();

        // 3. Masukkan data teks pelanggan ke dalam kerangka HTML yang disembunyikan
        document.getElementById('r-receipt-number').textContent = data.id_transaksi || '-';
        document.getElementById('r-receipt-date').textContent = formatWibDateTime(data.waktu_pembayaran);
        document.getElementById('r-customer-name').textContent = data.nama || '-';
        document.getElementById('r-customer-class').textContent = data.kelas || '-';
        document.getElementById('r-jadwal-ambil').textContent = data.waktu || '-';

        // Pisahkan harga kotor (harga barang asli) dan fee (biaya layanan tambahan QRIS)
        const subtotal = data.total;
        const fee = (data.payment_amount || data.total) - subtotal;

        document.getElementById('r-subtotal-amount').textContent = this.formatCurrency(subtotal);
        document.getElementById('r-fee-amount').textContent = this.formatCurrency(fee);
        document.getElementById('r-total-amount').textContent = this.formatCurrency(data.payment_amount || data.total);

        // 4. Susun daftar / tabel barang yang dibeli secara dinamis
        const itemsBody = document.getElementById('r-items-body');
        if (itemsBody) {
            itemsBody.replaceChildren();
        }
        const receiptItems = Array.isArray(data.items) ? data.items : [];
        receiptItems.forEach(item => {
            const productName = String(item.product?.name || '');
            const safeQuantity = toSafeNumber(item.quantity);
            const safePrice = toSafeNumber(item.product?.price);
            const row = document.createElement('tr');
            const nameCell = document.createElement('td');
            nameCell.textContent = productName;
            const qtyCell = document.createElement('td');
            qtyCell.className = 'receipt-cell-end';
            qtyCell.textContent = String(safeQuantity);
            const priceCell = document.createElement('td');
            priceCell.className = 'receipt-cell-end';
            priceCell.textContent = this.formatCurrency(safeQuantity * safePrice);
            row.appendChild(nameCell);
            row.appendChild(qtyCell);
            row.appendChild(priceCell);
            if (itemsBody) {
                itemsBody.appendChild(row);
            }
        });

        const qrContainer = document.getElementById('r-qr-code');
        qrContainer.replaceChildren();
        const verificationHint = document.getElementById('r-qr-desc');
        const verificationToken = String(data.verification_token || '').trim();

        if (verificationToken) {
            const verificationLink = `${window.location.origin}/verifikasi.html?token=${encodeURIComponent(verificationToken)}`;
            new QRCodeLibrary(qrContainer, {
                text: verificationLink,
                width: 180,
                height: 180,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCodeLibrary.CorrectLevel.H
            });

            if (verificationHint) {
                verificationHint.replaceChildren(
                    document.createTextNode('Scan QR Code untuk verifikasi'),
                    document.createElement('br'),
                    document.createTextNode('keaslian transaksi di sistem Koperasi')
                );
            }
        } else {
            const emptyState = document.createElement('div');
            emptyState.className = 'receipt-qr-empty';
            emptyState.textContent = 'QR verifikasi belum tersedia';
            qrContainer.appendChild(emptyState);
            if (verificationHint) {
                verificationHint.replaceChildren(
                    document.createTextNode('Pesanan belum memiliki token verifikasi publik.'),
                    document.createElement('br'),
                    document.createTextNode('Tunjukkan ID transaksi ke admin bila diperlukan.')
                );
            }
        }

        // Beri waktu 0.5 detik agar mesin peramban selesai merender visual QR Code seutuhnya
        await new Promise(resolve => setTimeout(resolve, 500));

        // 6. Siapkan "mesin pemotret" dan tata letak kertas PDF
        const element = document.getElementById('receipt');
        const receiptNumber = data.id_transaksi || 'T';
        const opt = {
            margin: 0.3,                                  // Margin standar faktur
            filename: `Bukti_Pembayaran-${receiptNumber}.pdf`,
            image: { type: 'jpeg', quality: 1 },          // Jepretan maksimum tanpa kompresi
            html2canvas: {
                scale: 3,                                 // Perbesar resolusi gambar 3x lipat (Tahan Blur)
                useCORS: true,                            // Izinkan gambar dari domain luar lintas-server
                dpi: 192,
                letterRendering: true,
                backgroundColor: '#ffffff',
                scrollY: 0,                               // Kunci jepretan dari piksel Y 0 (Mencegah Blank Bug)
                windowY: 0
            },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };

        // 7. Pengamanan rendering PDF: ubah aset gambar URL menjadi base64
        // Ini untuk mencegah masalah fatal CORS atau Blank Image dari Pustaka html2canvas
        const logoEl = document.getElementById('logo-img-receipt');
        let originalSrc = '';

        if (logoEl) {
            originalSrc = logoEl.src;
            // Hanya terjemahkan jika aset gambar belum berbentuk 'data:image/base64'
            if (!originalSrc.startsWith('data:')) {
                try {
                    // L-03: AbortController timeout 5 detik agar tidak hang di koneksi lambat
                    const logoFetchController = new AbortController();
                    const logoFetchTimeout = setTimeout(() => logoFetchController.abort(), 5000);
                    const response = await fetch(originalSrc, { signal: logoFetchController.signal });
                    clearTimeout(logoFetchTimeout);
                    const blob = await response.blob();
                    const finalSrc = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });
                    logoEl.src = finalSrc;
                } catch (err) {
                    logger.warn("Could not convert logo to base64", err);
                }
            }
        }

        // 8. Tembak layar, ekspor menjadi PDF, dan download (timeout 30 detik)
        const PDF_TIMEOUT_MS = 30000;
        const pdfPromise = html2pdfLibrary().set(opt).from(element).save();
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PDF generation timeout')), PDF_TIMEOUT_MS)
        );
        await Promise.race([pdfPromise, timeoutPromise]);

        // 9. Kembalikan URL logo sekolah menjadi aslinya (pembersihan memori)
        if (logoEl && originalSrc) {
            logoEl.src = originalSrc;
        }

        this.showToast("Bukti pembayaran berhasil diunduh.");

    } catch (error) {
        logger.error("PDF Generation Error", error);
        this.showToast("Gagal men-generate PDF. Silakan coba lagi.");
    } finally {
        // Matikan Efek Lingkaran Sedang Memuat (Kembalikan Tombol Semula)
        if (btnElement) {
            btnElement.replaceChildren(...originalButtonNodes);
            btnElement.disabled = false;
        }
    }
};
