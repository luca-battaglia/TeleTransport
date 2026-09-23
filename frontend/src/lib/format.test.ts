import { describe, expect, it } from 'vitest';
import type { ResultRow } from './api';
import { formatDateTime, formatDuration, formatEuro, markdownTable, rowCells } from './format';

const train: ResultRow = {
  origin: 'Milano Centrale',
  destination: 'Roma Termini',
  dep: '2026-10-01T07:10:00+02:00',
  arr: '2026-10-01T10:15:00+02:00',
  duration_min: 185,
  changes: 0,
  price_eur: 49.9,
  adjusted_cost: 1234.5,
  booking_url: 'https://www.lefrecce.it/',
};

describe('formatDateTime', () => {
  it('shows train times in Italian time, whatever offset they carry', () => {
    expect(formatDateTime('2026-10-01T05:10:00Z', true, 'en-GB')).toBe('01/10/2026, 07:10');
  });

  it('shows flight times as written, since they are local to the airport', () => {
    expect(formatDateTime('2026-10-01T23:45', false, 'it-IT')).toBe('01/10/2026, 23:45');
  });
});

describe('formatDuration', () => {
  it('splits minutes into hours and minutes', () => {
    expect(formatDuration(185)).toBe('3h 5m');
    expect(formatDuration(45)).toBe('0h 45m');
  });
});

describe('formatEuro', () => {
  it('follows the interface language', () => {
    expect(formatEuro(12345.5, 'it-IT')).toBe('12.345,50 €');
    expect(formatEuro(12345.5, 'en-GB')).toBe('12,345.50 €');
  });
});

describe('markdownTable', () => {
  it('writes the same cells as the table', () => {
    const headers = ['Route', 'Departure', 'Arrival', 'Duration', 'Price', 'Adj Cost'];
    expect(markdownTable(headers, [rowCells(train, true, 'en-GB')])).toBe(
      '| Route | Departure | Arrival | Duration | Price | Adj Cost |\n' +
      '|---|---|---|---|---|---|\n' +
      '| Milano Centrale → Roma Termini | 01/10/2026, 07:10 | 01/10/2026, 10:15 | 3h 5m | 49.90 € | 1,234.50 € |\n'
    );
  });
});
