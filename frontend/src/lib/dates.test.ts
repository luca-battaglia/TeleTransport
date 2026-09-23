import { describe, expect, it } from 'vitest';
import { collectRanges, countDays, futureRanges, parseDateKey } from './dates';

describe('futureRanges', () => {
  it('drops the ranges that are over and starts the one under way today', () => {
    const ranges = [
      { start: '2026-09-01', end: '2026-09-05' },
      { start: '2026-09-20', end: '2026-09-25' },
      { start: '2026-10-01', end: '2026-10-02' },
    ];
    expect(futureRanges(ranges, '2026-09-23')).toEqual([
      { start: '2026-09-23', end: '2026-09-25' },
      { start: '2026-10-01', end: '2026-10-02' },
    ]);
  });
});

describe('countDays', () => {
  it('counts a day shared by two ranges once', () => {
    expect(countDays([{ start: '2026-10-01', end: '2026-10-03' }, { start: '2026-10-03', end: '2026-10-04' }])).toBe(4);
  });

  it('counts across a change of daylight saving time', () => {
    expect(countDays([{ start: '2026-10-24', end: '2026-10-27' }])).toBe(4);
  });
});

describe('collectRanges', () => {
  it('adds the picker to the pool once, in date order', () => {
    const pool = [{ start: '2026-10-10', end: '2026-10-11' }];
    const picker: [Date, Date] = [parseDateKey('2026-10-01'), parseDateKey('2026-10-02')];
    expect(collectRanges(pool, picker)).toEqual([{ start: '2026-10-01', end: '2026-10-02' }, ...pool]);
    expect(collectRanges(pool, [parseDateKey('2026-10-10'), parseDateKey('2026-10-11')])).toEqual(pool);
  });
});
