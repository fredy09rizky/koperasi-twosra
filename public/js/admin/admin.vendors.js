// Modul AdminApp (Vendor Adapters) - adapter loading library eksternal untuk fitur admin.
import { AdminApp } from './admin.core.js';
import { AdminVendorBridge } from './admin.module.bridge.js';

AdminApp.prototype.ensureChartVendor = async function ensureChartVendor() {
    const bridge = AdminVendorBridge;
    if (bridge && typeof bridge.ensureChartVendorWithSri === 'function') {
        return bridge.ensureChartVendorWithSri();
    }

    if (typeof window.Chart === 'function') {
        return window.Chart;
    }

    throw new Error('Loader Chart.js dengan SRI tidak tersedia.');
};

AdminApp.prototype.ensurePdfVendors = async function ensurePdfVendors() {
    const bridge = AdminVendorBridge;
    if (bridge && typeof bridge.ensurePdfVendorsWithSri === 'function') {
        return bridge.ensurePdfVendorsWithSri();
    }

    const jsPDF = window.jspdf?.jsPDF;
    if (typeof jsPDF !== 'function') {
        throw new Error('Loader PDF dengan SRI tidak tersedia.');
    }

    const autoTable = typeof window.jspdf?.jsPDF?.API?.autoTable === 'function'
        ? window.jspdf.jsPDF.API.autoTable
        : (typeof window.jspdfAutoTable === 'function' ? window.jspdfAutoTable : null);

    return { jsPDF, autoTable };
};
