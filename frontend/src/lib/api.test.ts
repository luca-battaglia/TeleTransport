import { describe, expect, it } from 'vitest';
import { isResultRow } from './api';

const row = {
  origin: 'ZRH',
  destination: 'FCO',
  dep: '2026-10-08T11:00:00',
  arr: '2026-10-08T12:30:00',
  duration_min: 90,
  changes: 0,
  price_eur: 70,
  adjusted_cost: 100,
  booking_url: 'https://www.google.com/travel/flights?q=x',
};

describe('isResultRow', () => {
  it('accepts the current row shape', () => {
    expect(isResultRow(row)).toBe(true);
  });

  it('rejects flight rows saved before round trips were dropped', () => {
    const { dep, arr, duration_min, ...rest } = row;
    const legacy = { ...rest, out_dep: dep, out_arr: arr, total_duration_min: duration_min, in_dep: null, in_arr: null };
    expect(isResultRow(legacy)).toBe(false);
    expect(isResultRow(null)).toBe(false);
  });
});
