import { describe, it, expect } from 'vitest';
import { AdminApp } from '../public/js/admin/admin.core.js';
import '../public/js/admin/admin.orders.list.js';

class FakeElement {
	id: string;
	textContent = '';

	constructor(id: string) {
		this.id = id;
	}
}

class FakeDocument {
	private readonly elements: Map<string, FakeElement>;

	constructor(elements: FakeElement[]) {
		this.elements = new Map(elements.map((element) => [element.id, element]));
	}

	getElementById(id: string) {
		return this.elements.get(id) || null;
	}
}

function createFakeDocument() {
	return new FakeDocument([
		new FakeElement('orders-summary-total'),
		new FakeElement('orders-summary-pending'),
		new FakeElement('orders-summary-page-value'),
		new FakeElement('orders-summary-store-status'),
	]);
}

describe('Admin orders quick summary', () => {
	it('shows pending pickup count from the full filtered result, not only the current page', () => {
		const fakeDocument = createFakeDocument();
		const previousDocument = (globalThis as Record<string, unknown>).document;
		(globalThis as Record<string, unknown>).document = fakeDocument;

		try {
			const app = Object.create(AdminApp.prototype) as AdminApp & { renderOrdersQuickSummary: () => void };
			app.filteredOrders = [
				{ id: 'INV-001', total_amount: 12000, fee: 500, pickup_status: 'BELUM_DIAMBIL' }
			];
			app.totalOrderRows = 3;
			app.totalPendingPickupRows = 2;
			app.storeStatusData = { accepting_orders: true };
			app.formatCurrency = (amount: number) => `Rp${amount}`;

			app.renderOrdersQuickSummary();

			expect(fakeDocument.getElementById('orders-summary-total')?.textContent).toBe('3');
			expect(fakeDocument.getElementById('orders-summary-pending')?.textContent).toBe('2');
			expect(fakeDocument.getElementById('orders-summary-page-value')?.textContent).toBe('Rp12500');
		} finally {
			(globalThis as Record<string, unknown>).document = previousDocument;
		}
	});
});
