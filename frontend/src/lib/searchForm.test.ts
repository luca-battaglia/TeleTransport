import { describe, expect, it } from 'vitest';
import { checkSearch, googleFlightsUrl, withSavedSearch } from './searchForm';

const today = '2026-10-01';

describe('checkSearch', () => {
  it('asks for dates first', () => {
    expect(checkSearch([], ['A'], ['B'], today)).toEqual({ key: 'err_no_dates' });
  });

  it('refuses a selection left over from a previous day', () => {
    expect(checkSearch([{ start: '2026-09-30', end: '2026-10-02' }], ['A'], ['B'], today)).toEqual({ key: 'err_past_dates' });
  });

  it('caps the days, then the route-days', () => {
    const fifteenDays = [{ start: '2026-10-01', end: '2026-10-15' }];
    expect(checkSearch(fifteenDays, ['A'], ['B'], today)).toEqual({ key: 'err_max_range', params: { days: 14 } });

    const fourDays = [{ start: '2026-10-01', end: '2026-10-04' }];
    expect(checkSearch(fourDays, ['A', 'B', 'C'], ['D', 'E', 'F'], today)).toEqual({
      key: 'err_too_many_route_days',
      params: { route_days: 36, max: 30 },
    });
    expect(checkSearch(fourDays, ['A', 'B'], ['C'], today)).toBeNull();
  });
});

describe('withSavedSearch', () => {
  it('saves the non-empty places once', () => {
    const saved = withSavedSearch([], ['Milano Centrale', ' '], ['Roma Termini']);
    expect(saved).toEqual([{ origins: ['Milano Centrale'], destinations: ['Roma Termini'] }]);
    expect(withSavedSearch(saved, ['Milano Centrale'], ['Roma Termini'])).toBe(saved);
  });

  it('saves nothing without an origin and a destination', () => {
    const saved = [{ origins: ['A'], destinations: ['B'] }];
    expect(withSavedSearch(saved, [''], ['Roma Termini'])).toBe(saved);
  });

  it('drops the oldest past ten', () => {
    const saved = Array.from({ length: 10 }, (_, i) => ({ origins: [`O${i}`], destinations: ['D'] }));
    const next = withSavedSearch(saved, ['New'], ['D']);
    expect(next).toHaveLength(10);
    expect(next[0].origins).toEqual(['O1']);
    expect(next[9].origins).toEqual(['New']);
  });
});

describe('googleFlightsUrl', () => {
  it("uses a city's airport code only when it has a single airport", () => {
    const url = googleFlightsUrl('Zurich', 'Rome', new Date(2026, 9, 1), { zurich: 'ZRH', rome: 'FCO,CIA' });
    expect(decodeURIComponent(url.split('?q=')[1])).toBe('Flights to Rome from ZRH on 2026-10-01 one-way');
  });
});
