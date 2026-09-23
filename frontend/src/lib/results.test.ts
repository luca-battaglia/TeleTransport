import { describe, expect, it } from 'vitest';
import type { ResultRow } from './api';
import { DEFAULT_RESULT_COUNTS, EMPTY_MODE_STATE, pageOf, restoreModeState, restoreResultCounts } from './results';

const row = (dep: string, adjusted_cost: number, duration_min = 120): ResultRow => ({
  origin: 'Milano Centrale',
  destination: 'Roma Termini',
  dep,
  arr: dep,
  duration_min,
  changes: 0,
  price_eur: 30,
  adjusted_cost,
  booking_url: 'https://www.lefrecce.it/',
});

const results = [
  row('2026-10-02T09:00:00+02:00', 90),
  row('2026-10-01T07:00:00+02:00', 120),
  row('2026-10-01T12:00:00+02:00', 100, 180),
  row('2026-10-01T15:00:00+02:00', 100, 150),
  row('2026-10-02T18:00:00+02:00', 110),
];

const indexes = (rows: { index: number }[]) => rows.map(r => r.index);

describe('pageOf', () => {
  it('ranks by adjusted cost, then by duration, and keeps the first ones', () => {
    expect(indexes(pageOf(results, [], 'best', 3))).toEqual([0, 3, 2]);
  });

  it('pulls the next row into view when one is excluded', () => {
    expect(indexes(pageOf(results, [3], 'best', 3))).toEqual([0, 2, 4]);
  });

  it('applies the count to each day when grouped by day', () => {
    expect(indexes(pageOf(results, [], 'day', 2))).toEqual([3, 2, 0, 4]);
  });
});

describe('restoreModeState', () => {
  it('starts clean when the saved rows predate the current shape', () => {
    const legacy = { ...row('2026-10-01T07:00', 100), dep: undefined, out_dep: '2026-10-01T07:00' };
    expect(restoreModeState({ results: [legacy] as unknown as ResultRow[], searched: true })).toEqual(EMPTY_MODE_STATE);
  });

  it('never restores a search as still loading', () => {
    const restored = restoreModeState({ loading: true, searched: true, results: [results[0]], excluded: [0] });
    expect(restored).toMatchObject({ loading: false, searched: true, excluded: [0] });
  });
});

describe('restoreResultCounts', () => {
  it('keeps positive numbers only', () => {
    expect(restoreResultCounts({ 'trains-best': 5, 'trains-day': 0, 'flights-best': '20' })).toEqual({
      ...DEFAULT_RESULT_COUNTS,
      'trains-best': 5,
    });
  });
});
