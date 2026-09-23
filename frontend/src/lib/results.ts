import { isResultRow, type ResultRow } from './api';
import type { Mode } from './settings';

export type SortOrder = 'best' | 'day';

// How many results to show is remembered per mode and per view, because the
// number means different things: a whole-table total when ranked by best, a
// per-day count when grouped by day.
export type ResultCountKey = `${Mode}-${SortOrder}`;

export const DEFAULT_RESULT_COUNTS: Record<ResultCountKey, number> = {
  'trains-best': 10,
  'trains-day': 3,
  'flights-best': 10,
  'flights-day': 3,
};

export const RESULT_COUNT_CHOICES = [3, 5, 10, 15, 20, 50, 100];

// Only positive numbers survive, so a stale or hand-edited entry cannot leave a slot undefined.
export const restoreResultCounts = (stored?: Record<string, unknown>): Record<ResultCountKey, number> => ({
  ...DEFAULT_RESULT_COUNTS,
  ...Object.fromEntries(Object.entries(stored ?? {}).filter(([, v]) => typeof v === 'number' && v > 0)),
});

export type ModeState = {
  loading: boolean;
  searched: boolean;
  results: ResultRow[];
  error: string | null;
  // Positions in the unsorted results, newest exclusion last so undo can pop it.
  excluded: number[];
};

export const EMPTY_MODE_STATE: ModeState = { loading: false, searched: false, results: [], error: null, excluded: [] };

// Results saved by an older version of the page may no longer fit the current
// row shape. Then the mode starts clean, as if nothing had been searched.
export const restoreModeState = (saved?: Partial<ModeState>): ModeState => {
  const rows: unknown[] = Array.isArray(saved?.results) ? saved.results : [];
  if (!rows.every(isResultRow)) return EMPTY_MODE_STATE;
  const excluded = Array.isArray(saved?.excluded) ? saved.excluded : [];
  return { ...EMPTY_MODE_STATE, ...saved, results: rows, excluded, loading: false };
};

// The backend sends local times (trains with their offset, flights as airport
// time), so the date written in the string is the day the traveller sees.
export const dayOf = (r: ResultRow) => r.dep.slice(0, 10);

// Duration breaks cost ties, mirroring the backend ranking, so 'best' reproduces
// the order the API already returned.
const compareRows = (a: ResultRow, b: ResultRow, order: SortOrder) => {
  if (order === 'day') {
    const byDay = dayOf(a).localeCompare(dayOf(b));
    if (byDay !== 0) return byDay;
  }
  return (a.adjusted_cost - b.adjusted_cost) || (a.duration_min - b.duration_min);
};

// A row with its position in the unsorted results, which is what exclusions refer to.
export type IndexedRow = { row: ResultRow; index: number };

// The cut happens after filtering, so excluding a row pulls the next one into
// view. Grouped by day the count applies per day rather than to the whole table.
export const pageOf = (results: ResultRow[], excluded: number[], order: SortOrder, count: number): IndexedRow[] => {
  const hidden = new Set(excluded);
  const visible = results
    .map((row, index) => ({ row, index }))
    .filter(entry => !hidden.has(entry.index))
    .sort((a, b) => compareRows(a.row, b.row, order));

  if (order === 'best') return visible.slice(0, count);
  const takenPerDay = new Map<string, number>();
  return visible.filter(({ row }) => {
    const day = dayOf(row);
    const taken = takenPerDay.get(day) ?? 0;
    if (taken >= count) return false;
    takenPerDay.set(day, taken + 1);
    return true;
  });
};
