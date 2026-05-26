// Modul AdminApp (PDF Export) — ekspor PDF dan CSV
// Jangan instantiate AdminApp di file ini.

import { AdminApp } from './admin.core.js';

AdminApp.prototype.exportOrdersToPDF = async function exportOrdersToPDF() {
    const modal = this.getModalApi();
    const logger = this.getAppLogger();
    const formatCurrency = (value) => (
        typeof this.formatCurrency === 'function'
            ? this.formatCurrency(value)
            : `Rp${new Intl.NumberFormat('id-ID').format(Number.isFinite(Number(value)) ? Number(value) : 0)}`
    );

    if (!this.pdfDataCandidate || this.pdfDataCandidate.length === 0) {
        modal.alert('Tidak ada data pesanan tervalidasi untuk diekspor.');
        return;
    }

    try {
        const pdfLibraries = typeof this.ensurePdfVendors === 'function'
            ? await this.ensurePdfVendors()
            : (typeof ensureJsPdfLibraries === 'function' ? await ensureJsPdfLibraries() : null);
        const jsPDF = pdfLibraries?.jsPDF || window.jspdf?.jsPDF;
        if (typeof jsPDF !== 'function') {
            throw new Error('Library jsPDF belum tersedia');
        }
        const doc = new jsPDF('l', 'mm', 'a4');

        const context = this.getPdfFilterContext();

        // Header laporan
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text("Laporan Riwayat Transaksi - Koperasi TWOSRA", 14, 20);

        // Subjudul (tanggal cetak)
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const now = new Date();
        const wibOptions = { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
        const generatedAt = new Intl.DateTimeFormat('id-ID', wibOptions).format(now).replace(/\./g, ':');
        doc.text(`Dicetak pada: ${generatedAt} WIB`, 14, 28);

        const totalTransactions = this.pdfDataCandidate.length;
        const totalNetRevenue = this.pdfDataCandidate.reduce((sum, order) => {
            const safeAmount = Number.isFinite(Number(order?.total_amount)) ? Number(order.total_amount) : 0;
            return sum + safeAmount;
        }, 0);
        const totalFee = this.pdfDataCandidate.reduce((sum, order) => {
            const safeFee = Number.isFinite(Number(order?.fee)) ? Number(order.fee) : 0;
            return sum + safeFee;
        }, 0);
        const totalGrossRevenue = totalNetRevenue + totalFee;
        const totalItemsSold = this.pdfDataCandidate.reduce((sum, order) => {
            const items = Array.isArray(order?.items) ? order.items : [];
            const orderQty = items.reduce((itemSum, item) => itemSum + (Number(item?.quantity) || 0), 0);
            return sum + orderQty;
        }, 0);
        const activePeriodText = `${context.dateFilterText}${context.customContext}`;

        const contextLine = `Rentang Waktu: ${activePeriodText} | Urutan: ${context.sortOrderText}`;
        const summaryLine = `Total Transaksi: ${totalTransactions} | Total Produk Terjual: ${totalItemsSold}`;
        const financeLine = `Akumulasi Pendapatan — Pendapatan Bersih (Subtotal): ${formatCurrency(totalNetRevenue)} | Akumulasi Fee QRIS: ${formatCurrency(totalFee)} | Pendapatan Kotor (Total Dibayar): ${formatCurrency(totalGrossRevenue)}`;

        const pageWidth = doc.internal.pageSize.getWidth();
        const targetTableWidth = 260;
        const horizontalMargin = Math.max(10, (pageWidth - targetTableWidth) / 2);
        const textWrapWidth = pageWidth - (horizontalMargin * 2);

        const contextLines = doc.splitTextToSize(contextLine, textWrapWidth);
        doc.text(contextLines, 14, 34);
        const summaryY = 34 + (contextLines.length * 5);
        const summaryLines = doc.splitTextToSize(summaryLine, textWrapWidth);
        doc.text(summaryLines, 14, summaryY);
        const financeY = summaryY + (summaryLines.length * 5);
        const financeLines = doc.splitTextToSize(financeLine, textWrapWidth);
        doc.text(financeLines, 14, financeY);
        const tableStartY = financeY + (financeLines.length * 5) + 2;

        // Siapkan data tabel untuk AutoTable
        const tableCols = ["Waktu", "ID", "Pembeli", "Kls", "No. WA", "Jadwal Ambil", "Waktu Pengambilan", "Daftar Belanja", "Subtotal", "Fee QRIS", "Total Dibayar"];
        const wrapText = (text, maxLen = 22) => {
            const raw = String(text || '').trim();
            if (!raw) return '-';
            const words = raw.split(/\s+/);
            const lines = [];
            let line = '';
            words.forEach(word => {
                if (word.length > maxLen) {
                    if (line) {
                        lines.push(line);
                        line = '';
                    }
                    for (let i = 0; i < word.length; i += maxLen) {
                        lines.push(word.slice(i, i + maxLen));
                    }
                    return;
                }
                const next = line ? `${line} ${word}` : word;
                if (next.length > maxLen) {
                    if (line) lines.push(line);
                    line = word;
                } else {
                    line = next;
                }
            });
            if (line) lines.push(line);
            return lines.join('\n');
        };

        const tableRows = this.pdfDataCandidate.map(order => {
            const dateObj = this.parseOrderDate(order);
            const shortDate = dateObj
                ? new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(dateObj).replace(/\./g, ':')
                : '-';

            const orderItems = Array.isArray(order.items) ? order.items : [];
            const itemsList = orderItems.map((item) => {
                const safeQty = Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : 0;
                const safeName = String(item?.product_name ?? '-');
                return `${safeQty}x ${safeName}`;
            }).join('\n');

            const safeAmount = Number.isFinite(Number(order?.total_amount)) ? Number(order.total_amount) : 0;
            const safeFee = Number.isFinite(Number(order?.fee)) ? Number(order.fee) : 0;
            const safeNetAmount = safeAmount;
            const safeTotalPaid = safeAmount + safeFee;
            const safeOrderId = String(order.id || '-');
            const safeCustomerName = wrapText(String(order.customer_name || '-'), 14);
            const safeCustomerClass = wrapText(String(order.customer_class || '-'), 8);
            const safeWa = wrapText(String(order.wa_number || '-'), 12);
            const safePickup = wrapText(String(order.pickup_time || '-'), 14);
            const pickedUpAtDate = typeof this.parsePickupDate === 'function' ? this.parsePickupDate(order) : null;
            const pickedUpAtLabel = pickedUpAtDate && typeof this.formatAdminDateTime === 'function'
                ? this.formatAdminDateTime(pickedUpAtDate, { withSeconds: true, month: 'short' })
                : '-';

            return [
                shortDate,
                safeOrderId,
                safeCustomerName,
                safeCustomerClass,
                safeWa,
                safePickup,
                wrapText(pickedUpAtLabel, 16),
                itemsList || '-',
                formatCurrency(safeNetAmount),
                formatCurrency(safeFee),
                formatCurrency(safeTotalPaid)
            ];
        });

        // Generate AutoTable (layout tabel otomatis)
        const tableOptions = {
            startY: tableStartY,
            head: [tableCols],
            body: tableRows,
            theme: 'grid',
            headStyles: {
                fillColor: [59, 130, 246], // Tailwind blue-500
                textColor: [255, 255, 255],
                lineColor: [148, 163, 184],
                lineWidth: 0.25,
                halign: 'center',
                valign: 'middle'
            },
            bodyStyles: {
                lineColor: [203, 213, 225],
                lineWidth: 0.2
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252]
            },
            styles: {
                fontSize: 6.5,
                cellPadding: 1.3,
                valign: 'top',
                overflow: 'linebreak',
                cellWidth: 'auto',
                lineColor: [203, 213, 225],
                lineWidth: 0.2
            },
            columnStyles: {
                0: { cellWidth: 20, overflow: 'linebreak' }, // Waktu
                1: { cellWidth: 25, overflow: 'linebreak' }, // ID
                2: { cellWidth: 21, overflow: 'linebreak' }, // Pembeli
                3: { cellWidth: 10, overflow: 'linebreak' }, // Kelas
                4: { cellWidth: 23, overflow: 'linebreak' }, // No WA
                5: { cellWidth: 23, overflow: 'linebreak' }, // Jadwal Ambil
                6: { cellWidth: 20, overflow: 'linebreak' }, // Waktu Pengambilan
                7: { cellWidth: 60, overflow: 'linebreak' }, // Daftar Belanja
                8: { cellWidth: 18, halign: 'right', overflow: 'linebreak' }, // Subtotal
                9: { cellWidth: 16, halign: 'right', overflow: 'linebreak' }, // Fee QRIS
                10: { cellWidth: 22, halign: 'right', overflow: 'linebreak' } // Total Dibayar
            },
            tableWidth: targetTableWidth,
            pageBreak: 'auto',
            margin: { left: horizontalMargin, right: horizontalMargin }
        };

        if (typeof doc.autoTable === 'function') {
            doc.autoTable(tableOptions);
        } else if (typeof pdfLibraries?.autoTable === 'function') {
            pdfLibraries.autoTable(doc, tableOptions);
        } else {
            throw new Error('Plugin jsPDF AutoTable belum tersedia');
        }

        const lastTable = doc.lastAutoTable;
        const tableEndY = lastTable && typeof lastTable.finalY === 'number' ? lastTable.finalY : tableStartY;
        const noteY = tableEndY + 6;
        const pageHeight = doc.internal.pageSize.getHeight();
        if (noteY > pageHeight - 10) {
            doc.addPage();
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text('Catatan: Semua waktu pada laporan menggunakan zona waktu WIB (Asia/Jakarta).', 14, 12);
            doc.text('Fee QRIS adalah biaya layanan/payment gateway yang dibayar pembeli (bukan pendapatan bersih koperasi).', 14, 16);
        } else {
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text('Catatan: Semua waktu pada laporan menggunakan zona waktu WIB (Asia/Jakarta).', 14, noteY);
            doc.text('Fee QRIS adalah biaya layanan/payment gateway yang dibayar pembeli (bukan pendapatan bersih koperasi).', 14, noteY + 4);
        }

        // Simpan PDF
        doc.save(this.buildPdfFilename(now, context));

        // Tutup modal otomatis saat selesai
        this.closePdfModal();
    } catch (error) {
        logger.error('Gagal memeriksa data sebelum ekspor PDF', error);
        modal.alert("Terjadi kesalahan saat mengekspor ke PDF. Pastikan jaringan stabil untuk memuat library JS.");
    }
};

AdminApp.prototype.buildCsvFilename = function buildCsvFilename(now, context) {
    const dateStamp = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);

    return `Laporan_Transaksi_Koperasi_TWOSRA_${dateStamp}.csv`;
};

AdminApp.prototype.exportOrdersToCSV = function exportOrdersToCSV() {
    const modal = this.getModalApi();
    const logger = this.getAppLogger();

    if (!this.pdfDataCandidate || this.pdfDataCandidate.length === 0) {
        modal.alert('Tidak ada data pesanan tervalidasi untuk diekspor.');
        return;
    }

    try {
        const context = this.getPdfFilterContext();
        const now = new Date();
        const wibDateOpts = { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric' };
        const wibTimeOpts = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
        const datePart = new Intl.DateTimeFormat('id-ID', wibDateOpts).format(now);
        const timePart = new Intl.DateTimeFormat('id-ID', wibTimeOpts).format(now).replace(/\./g, ':');
        const generatedAt = `${datePart} pukul ${timePart}`;

        // Bersihkan nilai: hapus newline dan semicolon agar tidak merusak kolom
        const clean = (value) => {
            return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/;/g, ',');
        };

        // Format tanggal order: "25 Mar 2026 10:15" (tanpa koma)
        const formatDate = (dateObj) => {
            if (!dateObj) return '-';
            return new Intl.DateTimeFormat('id-ID', {
                timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short',
                year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
            }).format(dateObj).replace(/\./g, ':').replace(',', '');
        };

        // Separator: semicolon (;) agar Excel langsung mengenali kolom tanpa tanda kutip
        const SEP = ';';

        // Baris header info laporan
        const totalItemsSold = this.pdfDataCandidate.reduce((sum, order) => {
            const items = Array.isArray(order?.items) ? order.items : [];
            const orderQty = items.reduce((itemSum, item) => itemSum + (Number(item?.quantity) || 0), 0);
            return sum + orderQty;
        }, 0);

        const infoRows = [
            ['Laporan Riwayat Transaksi - Koperasi TWOSRA'],
            [`Dicetak pada: ${generatedAt} WIB`],
            [`Rentang Waktu: ${clean(context.dateFilterText)}${clean(context.customContext)} | Urutan: ${clean(context.sortOrderText)}`],
            [`Total Transaksi: ${this.pdfDataCandidate.length}`],
            [`Total Produk Terjual: ${totalItemsSold}`],
            []
        ];

        // Header kolom
        const headers = [
            'Waktu Transaksi',
            'ID Transaksi',
            'Nama Pembeli',
            'Kelas',
            'No. WhatsApp',
            'Jadwal Pengambilan',
            'Status Pengambilan',
            'Waktu Pengambilan Aktual',
            'Status Pembayaran',
            'Jumlah Jenis Produk',
            'Total Qty',
            'Daftar Belanja',
            'Pendapatan Bersih (Subtotal)',
            'Fee QRIS',
            'Pendapatan Kotor (Total Dibayar)'
        ];

        // Baris data
        const dataRows = this.pdfDataCandidate.map(order => {
            const dateObj = this.parseOrderDate(order);
            const shortDate = formatDate(dateObj);
            const pickupDateObj = typeof this.parsePickupDate === 'function' ? this.parsePickupDate(order) : null;
            const pickedUpAt = pickupDateObj ? formatDate(pickupDateObj) : '-';

            const orderItems = Array.isArray(order.items) ? order.items : [];
            const productTypeCount = orderItems.length;
            const totalQty = orderItems.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
            const itemsList = orderItems.map(item => {
                const qty = Number(item?.quantity) || 0;
                const name = String(item?.product_name ?? '-');
                return `${qty}x ${name}`;
            }).join(' / ');

            const safeAmount = Number.isFinite(Number(order?.total_amount)) ? Number(order.total_amount) : 0;
            const safeFee = Number.isFinite(Number(order?.fee)) ? Number(order.fee) : 0;
            const totalPaid = safeAmount + safeFee;
            const pickupStatus = String(order?.pickup_status || 'BELUM_DIAMBIL');
            const paymentStatus = String(order?.payment_status || 'PAID');

            return [
                clean(shortDate),
                clean(order.id || '-'),
                clean(order.customer_name || '-'),
                clean(order.customer_class || '-'),
                '="' + String(order.wa_number || '-') + '"',
                clean(order.pickup_time || '-'),
                clean(pickupStatus),
                clean(pickedUpAt),
                clean(paymentStatus),
                productTypeCount,
                totalQty,
                clean(itemsList || '-'),
                safeAmount,
                safeFee,
                totalPaid
            ];
        });

        // Baris ringkasan total
        const totalAmount = this.pdfDataCandidate.reduce((sum, o) => sum + (Number.isFinite(Number(o?.total_amount)) ? Number(o.total_amount) : 0), 0);
        const totalFee = this.pdfDataCandidate.reduce((sum, o) => sum + (Number.isFinite(Number(o?.fee)) ? Number(o.fee) : 0), 0);
        const totalPaid = totalAmount + totalFee;

        const summaryRows = [
            [],
            ['', '', '', '', '', '', '', '', '', '', '', 'TOTAL', totalAmount, totalFee, totalPaid],
            [],
            ['Catatan: Semua waktu pada laporan menggunakan zona waktu WIB (Asia/Jakarta).'],
            ['Catatan: Fee QRIS adalah biaya layanan/payment gateway yang dibayar pembeli (bukan pendapatan bersih koperasi).']
        ];

        // Gabungkan semua baris dengan separator semicolon
        const allRows = [
            ...infoRows.map(r => r.join(SEP)),
            headers.join(SEP),
            ...dataRows.map(r => r.join(SEP)),
            ...summaryRows.map(r => r.join(SEP))
        ];

        // UTF-8 BOM agar Excel mengenali encoding Indonesia dengan benar
        const BOM = '\uFEFF';
        const csvContent = BOM + allRows.join('\n');

        // Trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = this.buildCsvFilename(now, context);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.closePdfModal();
    } catch (error) {
        logger.error('Gagal menyiapkan file ekspor', error);
        modal.alert('Terjadi kesalahan saat mengekspor ke CSV.');
    }
};
