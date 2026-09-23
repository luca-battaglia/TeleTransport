import { addDays } from 'date-fns';
import type { DateRange } from './api';

export type PickerValue = [Date | null, Date | null];

export const formatDateKey = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const parseDateKey = (key: string) => new Date(`${key}T00:00:00`);

export const rangeFromPicker = (picker: PickerValue): DateRange | null => {
  const [start, end] = picker;
  if (!start) return null;
  return { start: formatDateKey(start), end: formatDateKey(end || start) };
};

export const pickerFromRange = (range: DateRange): PickerValue => [parseDateKey(range.start), parseDateKey(range.end)];

// What the search actually covers: the saved stretches plus whatever the picker
// currently holds, so ignoring the pool leaves the original single-range flow intact.
export const collectRanges = (pool: DateRange[], picker: PickerValue): DateRange[] => {
  const ranges = [...pool];
  const current = rangeFromPicker(picker);
  if (current && !ranges.some(r => r.start === current.start && r.end === current.end)) {
    ranges.push(current);
  }
  return ranges.sort((a, b) => a.start.localeCompare(b.start));
};

// Compact enough for a chip; the picker itself still shows full dates.
export const formatRangeLabel = (r: DateRange) => {
  const short = (key: string) => {
    const d = parseDateKey(key);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  return r.start === r.end ? short(r.start) : `${short(r.start)} – ${short(r.end)}`;
};

// Distinct days, so overlapping stretches are not counted twice against the cap.
export const countDays = (ranges: DateRange[]) => {
  const days = new Set<string>();
  ranges.forEach(r => {
    const end = parseDateKey(r.end);
    for (let d = parseDateKey(r.start); d <= end; d = addDays(d, 1)) {
      days.add(formatDateKey(d));
    }
  });
  return days.size;
};

// Dates restored from an earlier session or from the history may have passed
// since. The picker cannot select those days and the backend rejects them, so
// they are cut off: a range that is over disappears, one under way starts today.
export const futureRanges = (ranges: DateRange[], today = formatDateKey(new Date())): DateRange[] =>
  ranges
    .filter(r => r.end >= today)
    .map(r => (r.start < today ? { ...r, start: today } : r));

// What the date field holds: the picker's current range, the stretches already
// added to the pool, and whether the picker still shows the day it opened on.
export type DateSelection = { picker: PickerValue; pool: DateRange[]; pristine: boolean };

// The picker opens on today; the first range picked replaces it rather than extending it.
export const freshDates = (): DateSelection => ({ picker: [new Date(), null], pool: [], pristine: true });

// Restored dates lose the days that have passed. With several stretches left
// they go to the pool and the picker starts empty; with none, it starts fresh.
export const restoreDates = (restored: DateRange[], today?: string): DateSelection => {
  const ranges = futureRanges(restored, today);
  if (ranges.length === 0) return freshDates();
  if (ranges.length === 1) return { picker: pickerFromRange(ranges[0]), pool: [], pristine: false };
  return { picker: [null, null], pool: ranges, pristine: false };
};

// On a fresh picker the click that would end a range at today starts one instead.
export const pickDates = (dates: DateSelection, update: PickerValue): DateSelection => ({
  ...dates,
  picker: dates.pristine && update[0] && update[1] ? [update[1], null] : update,
  pristine: false,
});

// Clearing the picker keeps the added stretch from also counting as the
// current selection, which would show it twice.
export const addPickerToPool = (dates: DateSelection): DateSelection => {
  const entry = rangeFromPicker(dates.picker);
  if (!entry) return dates;
  const pool = dates.pool.some(r => r.start === entry.start && r.end === entry.end)
    ? dates.pool
    : [...dates.pool, entry].sort((a, b) => a.start.localeCompare(b.start));
  return { ...dates, pool, picker: [null, null] };
};

export const removeFromPool = (dates: DateSelection, range: DateRange): DateSelection => ({
  ...dates,
  pool: dates.pool.filter(r => !(r.start === range.start && r.end === range.end)),
});
