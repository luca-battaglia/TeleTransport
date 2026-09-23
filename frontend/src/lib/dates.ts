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
