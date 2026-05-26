import { toIsoUtcTimestamp } from '../utils/log.js';

export function parsePositiveInt(value: string | undefined, fallbackValue: number, minValue: number, maxValue: number) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallbackValue;
	const normalized = Math.trunc(parsed);
	if (normalized < minValue) return minValue;
	if (normalized > maxValue) return maxValue;
	return normalized;
}

function formatWibDatePart(date: Date): string {
	const shifted = new Date(date.getTime() + (7 * 60 * 60 * 1000));
	const year = shifted.getUTCFullYear();
	const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
	const day = String(shifted.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function toWibDateTime(datePart: string, hour: number, minute: number, second: number): string {
	return `${datePart} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function getWibStartOfDayUtc(date: Date): Date {
	const shifted = new Date(date.getTime() + (7 * 60 * 60 * 1000));
	const year = shifted.getUTCFullYear();
	const month = shifted.getUTCMonth();
	const day = shifted.getUTCDate();
	return new Date(Date.UTC(year, month, day, -7, 0, 0, 0));
}

function getWibDayOfWeek(date: Date): number {
	const shifted = new Date(date.getTime() + (7 * 60 * 60 * 1000));
	return shifted.getUTCDay();
}

export function resolveAdminOrdersDateRange(
	dateFilter: string,
	customStartDate: string,
	customEndDate: string
): { startWib: string | null; endWibExclusive: string | null } {
	const nowUtc = new Date();
	const startTodayUtc = getWibStartOfDayUtc(nowUtc);

	if (dateFilter === 'today') {
		const nextDayUtc = new Date(startTodayUtc.getTime() + (24 * 60 * 60 * 1000));
		return {
			startWib: toWibDateTime(formatWibDatePart(startTodayUtc), 0, 0, 0),
			endWibExclusive: toWibDateTime(formatWibDatePart(nextDayUtc), 0, 0, 0)
		};
	}

	if (dateFilter === 'yesterday') {
		const yesterdayUtc = new Date(startTodayUtc.getTime() - (24 * 60 * 60 * 1000));
		return {
			startWib: toWibDateTime(formatWibDatePart(yesterdayUtc), 0, 0, 0),
			endWibExclusive: toWibDateTime(formatWibDatePart(startTodayUtc), 0, 0, 0)
		};
	}

	if (dateFilter === 'this_week') {
		const dayOfWeek = getWibDayOfWeek(nowUtc);
		const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
		const mondayUtc = new Date(startTodayUtc.getTime() - (diffToMonday * 24 * 60 * 60 * 1000));
		return {
			startWib: toWibDateTime(formatWibDatePart(mondayUtc), 0, 0, 0),
			endWibExclusive: null
		};
	}

	if (dateFilter === 'this_month') {
		const shifted = new Date(nowUtc.getTime() + (7 * 60 * 60 * 1000));
		const year = shifted.getUTCFullYear();
		const month = shifted.getUTCMonth();
		const monthStartUtc = new Date(Date.UTC(year, month, 1, -7, 0, 0, 0));
		return {
			startWib: toWibDateTime(formatWibDatePart(monthStartUtc), 0, 0, 0),
			endWibExclusive: null
		};
	}

	if (dateFilter === 'this_year') {
		const shifted = new Date(nowUtc.getTime() + (7 * 60 * 60 * 1000));
		const year = shifted.getUTCFullYear();
		const yearStartUtc = new Date(Date.UTC(year, 0, 1, -7, 0, 0, 0));
		return {
			startWib: toWibDateTime(formatWibDatePart(yearStartUtc), 0, 0, 0),
			endWibExclusive: null
		};
	}

	if (dateFilter === 'custom') {
		const hasValidStart = /^\d{4}-\d{2}-\d{2}$/.test(customStartDate);
		const hasValidEnd = /^\d{4}-\d{2}-\d{2}$/.test(customEndDate);
		const startWib = hasValidStart ? `${customStartDate} 00:00:00` : null;
		let endWibExclusive: string | null = null;
		if (hasValidEnd) {
			// Gunakan WIB midnight (UTC+7) agar end date inklusif sampai akhir hari WIB.
			const endDateWib = new Date(`${customEndDate}T00:00:00.000+07:00`);
			if (!Number.isNaN(endDateWib.getTime())) {
				const nextDayWib = new Date(endDateWib.getTime() + (24 * 60 * 60 * 1000));
				const nextDay = formatWibDatePart(nextDayWib);
				endWibExclusive = `${nextDay} 00:00:00`;
			}
		}
		return { startWib, endWibExclusive };
	}

	return { startWib: null, endWibExclusive: null };
}

function buildItemsByOrderId(itemsRows: unknown[]) {
	const itemsByOrderId = new Map<string, any[]>();
	const rows = Array.isArray(itemsRows) ? itemsRows : [];

	rows.forEach((item: any) => {
		const orderId = String(item?.order_id || '');
		if (!orderId) return;
		const currentItems = itemsByOrderId.get(orderId) || [];
		currentItems.push(item);
		itemsByOrderId.set(orderId, currentItems);
	});

	return itemsByOrderId;
}

export function hydrateAdminOrders(ordersRows: unknown[], itemsRows: unknown[]) {
	const rows = Array.isArray(ordersRows) ? ordersRows : [];
	const itemsByOrderId = buildItemsByOrderId(itemsRows);

	return rows.map((order: any) => ({
		...order,
		pickup_status: String(order?.pickup_status || 'BELUM_DIAMBIL'),
		picked_up_at: order?.picked_up_at ? toIsoUtcTimestamp(order?.picked_up_at) : null,
		created_at: toIsoUtcTimestamp(order?.created_at),
		items: itemsByOrderId.get(String(order?.id || '')) || []
	}));
}
