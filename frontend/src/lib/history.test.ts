import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResultRow } from './api';
import { loadHistory, rangesOf, withEntry, type HistoryEntry } from './history';

const row: ResultRow = {
  origin: 'Zurich',
  destination: 'Rome',
  dep: '2026-10-01T07:00',
  arr: '2026-10-01T08:35',
  duration_min: 95,
  changes: 0,
  price_eur: 89,
  adjusted_cost: 150,
  booking_url: 'https://www.google.com/travel/flights',
};

const entry = (timestamp: number, results: unknown[] = [row]) =>
  ({ timestamp, origin: 'Zurich', destination: 'Rome', depStartStr: '2026-10-01', results }) as HistoryEntry;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadHistory', () => {
  it('drops rows in an older shape, and entries left with no rows', () => {
    const legacyRow = { ...row, dep: undefined, out_dep: row.dep };
    const stored = [entry(3, [row, legacyRow]), entry(2, [legacyRow]), { timestamp: 1 }];
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify(stored) } });
    expect(loadHistory('flights')).toEqual([entry(3, [row])]);
  });

  it('ignores anything that is not a list', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{"a":1}' } });
    expect(loadHistory('trains')).toEqual([]);
  });
});

describe('withEntry', () => {
  it('puts the newest first and keeps ten', () => {
    const history = Array.from({ length: 10 }, (_, i) => entry(10 - i));
    const next = withEntry(history, entry(11));
    expect(next.map(e => e.timestamp)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
});

describe('rangesOf', () => {
  it('falls back to the single span of entries saved before pools', () => {
    expect(rangesOf({ ...entry(1), depEndStr: '2026-10-03' })).toEqual([{ start: '2026-10-01', end: '2026-10-03' }]);
    expect(rangesOf(entry(1))).toEqual([{ start: '2026-10-01', end: '2026-10-01' }]);
  });
});
