import { describe, expect, it } from 'vitest';
import {
  addPickerToPool,
  collectRanges,
  countDays,
  futureRanges,
  parseDateKey,
  pickDates,
  restoreDates,
  type DateSelection,
} from './dates';

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

describe('restoreDates', () => {
  const today = '2026-10-01';

  it('puts a single stretch back in the picker', () => {
    expect(restoreDates([{ start: '2026-10-03', end: '2026-10-04' }], today)).toEqual({
      picker: [parseDateKey('2026-10-03'), parseDateKey('2026-10-04')],
      pool: [],
      pristine: false,
    });
  });

  it('moves several stretches to the pool', () => {
    const ranges = [{ start: '2026-10-03', end: '2026-10-03' }, { start: '2026-10-05', end: '2026-10-06' }];
    expect(restoreDates(ranges, today)).toEqual({ picker: [null, null], pool: ranges, pristine: false });
  });

  it('starts fresh when every stretch is over', () => {
    expect(restoreDates([{ start: '2026-09-20', end: '2026-09-21' }], today)).toMatchObject({ pool: [], pristine: true });
  });
});

describe('pickDates', () => {
  const fresh: DateSelection = { picker: [parseDateKey('2026-10-01'), null], pool: [], pristine: true };

  it('starts a new range where a fresh picker is first clicked', () => {
    const next = pickDates(fresh, [parseDateKey('2026-10-01'), parseDateKey('2026-10-05')]);
    expect(next).toEqual({ picker: [parseDateKey('2026-10-05'), null], pool: [], pristine: false });
  });

  it('extends the range once the picker has been used', () => {
    const used = { ...fresh, pristine: false };
    const range: [Date, Date] = [parseDateKey('2026-10-01'), parseDateKey('2026-10-05')];
    expect(pickDates(used, range).picker).toEqual(range);
  });
});

describe('addPickerToPool', () => {
  it('adds the picked range once, in date order, and clears the picker', () => {
    const dates: DateSelection = {
      picker: [parseDateKey('2026-10-01'), parseDateKey('2026-10-02')],
      pool: [{ start: '2026-10-10', end: '2026-10-10' }],
      pristine: false,
    };
    const next = addPickerToPool(dates);
    expect(next.pool).toEqual([{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-10', end: '2026-10-10' }]);
    expect(next.picker).toEqual([null, null]);
    expect(addPickerToPool({ ...next, picker: [parseDateKey('2026-10-10'), null] }).pool).toBe(next.pool);
  });

  it('leaves an empty picker alone', () => {
    const dates: DateSelection = { picker: [null, null], pool: [], pristine: false };
    expect(addPickerToPool(dates)).toBe(dates);
  });
});
