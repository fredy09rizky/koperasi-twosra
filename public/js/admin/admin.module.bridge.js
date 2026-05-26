// Vendor bridge admin memakai loader UMD di config.js karena jalur itu memasang
// Subresource Integrity. Dynamic import() remote tidak mendukung SRI browser.
import { ensureChartLibrary, ensureJsPdfLibraries } from '../config.js';

const ensureChartVendorWithSri = async () => ensureChartLibrary();

const ensurePdfVendorsWithSri = async () => ensureJsPdfLibraries();

export const AdminVendorBridge = {
    source: 'umd-sri',
    ensureChartVendorWithSri,
    ensurePdfVendorsWithSri
};

if (typeof window !== 'undefined') {
    window.AdminVendorBridge = AdminVendorBridge;
}
