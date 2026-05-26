const PICKUP_SLOT_LABELS: Record<string, string> = {
	FIRST_BREAK: 'Istirahat Pertama (09.15)',
	SECOND_BREAK: 'Istirahat Kedua (11.45)'
};

type PickupOption = {
	dateKey: string;
	label: string;
	slots: string[];
};

type PickupResolutionOptions = {
	now?: Date;
};

function getWIBDate(now: Date = new Date()): Date {
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Jakarta',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		hour12: false
	});
	const parts = formatter.formatToParts(now);

	let year = 0;
	let month = 0;
	let day = 0;
	let hour = 0;
	let minute = 0;
	let second = 0;

	parts.forEach((part) => {
		if (part.type === 'year') year = parseInt(part.value, 10);
		if (part.type === 'month') month = parseInt(part.value, 10);
		if (part.type === 'day') day = parseInt(part.value, 10);
		if (part.type === 'hour') hour = parseInt(part.value, 10);
		if (part.type === 'minute') minute = parseInt(part.value, 10);
		if (part.type === 'second') second = parseInt(part.value, 10);
	});

	return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function formatPickupDateKey(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function formatPickupDateLabel(date: Date): string {
	return date.toLocaleDateString('id-ID', {
		timeZone: 'UTC',
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

export function buildPickupOptions(now: Date = new Date()): PickupOption[] {
	const wibNow = getWIBDate(now);
	const currentTime = wibNow.getUTCHours() + wibNow.getUTCMinutes() / 60;
	const cutoff0915 = 9 + 15 / 60;
	const cutoff1220 = 12 + 20 / 60;
	const options: PickupOption[] = [];

	let dayOffset = 0;
	while (options.length < 3 && dayOffset < 14) {
		const checkDate = new Date(wibNow);
		checkDate.setUTCDate(checkDate.getUTCDate() + dayOffset);

		const dayOfWeek = checkDate.getUTCDay();
		if (dayOfWeek >= 1 && dayOfWeek <= 5) {
			if (dayOffset === 0 && currentTime > cutoff1220) {
				dayOffset++;
				continue;
			}

			let labelPrefix = '';
			if (dayOffset === 0) {
				labelPrefix = 'Hari Ini';
			} else if (dayOffset === 1) {
				labelPrefix = 'Besok';
			} else if (dayOffset === 2) {
				labelPrefix = 'Lusa';
			}

			const fullDateLabel = formatPickupDateLabel(checkDate);
			const label = labelPrefix ? `${labelPrefix} (${fullDateLabel})` : fullDateLabel;

			let slots = ['FIRST_BREAK', 'SECOND_BREAK'];
			if (dayOffset === 0) {
				if (currentTime < cutoff0915) {
					slots = ['FIRST_BREAK', 'SECOND_BREAK'];
				} else if (currentTime <= cutoff1220) {
					slots = ['SECOND_BREAK'];
				} else {
					slots = [];
				}
			}

			if (slots.length > 0) {
				options.push({
					dateKey: formatPickupDateKey(checkDate),
					label,
					slots
				});
			}
		}

		dayOffset++;
	}

	return options;
}

export function resolvePickupTime(
	pickupDate: string,
	pickupSlot: string,
	options: PickupResolutionOptions = {}
): { ok: boolean; pickupTime?: string; message?: string } {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
		return { ok: false, message: 'Tanggal pengambilan tidak valid' };
	}

	if (!PICKUP_SLOT_LABELS[pickupSlot]) {
		return { ok: false, message: 'Slot pengambilan tidak valid' };
	}

	const availableOptions = buildPickupOptions(options.now);
	const selectedOption = availableOptions.find((option) => option.dateKey === pickupDate);

	if (!selectedOption) {
		return {
			ok: false,
			message: 'Hari pengambilan tidak tersedia atau sudah melewati batas waktu'
		};
	}

	if (!selectedOption.slots.includes(pickupSlot)) {
		return {
			ok: false,
			message: 'Jam pengambilan tidak tersedia untuk hari yang dipilih'
		};
	}

	return {
		ok: true,
		pickupTime: `${selectedOption.label} - ${PICKUP_SLOT_LABELS[pickupSlot]}`
	};
}
