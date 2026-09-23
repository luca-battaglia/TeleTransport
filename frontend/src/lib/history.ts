import { isResultRow, type DateRange, type ResultRow } from './api';
import type { Mode } from './settings';
import { readJson } from './storage';

export interface HistoryEntry {
  timestamp: number;
  origin: string;
  destination: string;
  depStartStr: string;
  depEndStr?: string;
  // Every stretch the search covered. Absent on entries saved before pools
  // existed, where the depStartStr/depEndStr span is the whole search.
  depRanges?: DateRange[];
  results: ResultRow[];
}

export const HISTORY_KEYS: Record<Mode, string> = {
  trains: 'teletransport_train_history',
  flights: 'teletransport_flight_history',
};

const HISTORY_SIZE = 10;

// Entries without a usable result are dropped, and so are rows in an older shape.
export const loadHistory = (mode: Mode): HistoryEntry[] => {
  const entries = readJson<unknown>('local', HISTORY_KEYS[mode], []);
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => ({ ...entry, results: Array.isArray(entry?.results) ? entry.results.filter(isResultRow) : [] }))
    .filter((entry): entry is HistoryEntry => typeof entry.depStartStr === 'string' && entry.results.length > 0);
};

export const withEntry = (history: HistoryEntry[], entry: HistoryEntry) => [entry, ...history].slice(0, HISTORY_SIZE);

// Every stretch an entry's search covered. Older entries have no pool, so they
// fall back to their single span.
export const rangesOf = (entry: HistoryEntry): DateRange[] =>
  entry.depRanges ?? [{ start: entry.depStartStr, end: entry.depEndStr ?? entry.depStartStr }];
