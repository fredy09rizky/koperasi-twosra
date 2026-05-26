/**
 * Format angka ke format Rupiah (IDR)
 */
export const formatRupiah = (number: number): string => {
	return new Intl.NumberFormat('id-ID', {
		style: 'currency',
		currency: 'IDR',
		minimumFractionDigits: 0
	}).format(number);
};

/**
 * Format Date ke timestamp SQL `YYYY-MM-DD HH:MM:SS`.
 */
export function formatSqlTimestamp(date: Date): string {
	return date.toISOString().slice(0, 19).replace('T', ' ');
}
