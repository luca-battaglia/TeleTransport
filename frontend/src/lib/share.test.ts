import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ResultRow } from './api';
import { bookingUrl, decodeTrip, encodeTrip, shareMessage, tripOf, viewOf, type SharedTrip } from './share';

const train: SharedTrip = {
  mode: 'trains',
  lang: 'it',
  origin: 'Firenze S. M. Novella',
  destination: 'Zürich HB',
  dep: '2026-11-09T07:05:00+01:00',
  arr: '2026-11-09T12:25:00+01:00',
  duration_min: 320,
  changes: 1,
  price_eur: 48.5,
  legs: ['FR 9527', 'EC 17'],
};

const nightFlight: SharedTrip = {
  mode: 'flights',
  lang: 'en',
  origin: 'ZRH',
  destination: 'FCO',
  dep: '2026-09-27T22:45:00',
  arr: '2026-09-28T20:25:00',
  duration_min: 1300,
  changes: 2,
  price_eur: 411,
  legs: [],
};

const tokenOf = (fields: unknown[]) => btoa(JSON.stringify(fields)).replace(/=+$/, '');

describe('encodeTrip and decodeTrip', () => {
  it('bring back the same trip, accents included', () => {
    expect(decodeTrip(encodeTrip(train))).toEqual(train);
    expect(decodeTrip(encodeTrip(nightFlight))).toEqual(nightFlight);
  });

  it('only use characters that are safe in a URL path', () => {
    expect(encodeTrip(train)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reject anything that is not a trip', () => {
    expect(decodeTrip('not-base64!')).toBeNull();
    expect(decodeTrip(tokenOf({ origin: 'Roma' } as never))).toBeNull();
    expect(decodeTrip(tokenOf([2, 't', 'A', 'B', '2026-11-09T07:05', '2026-11-09T08:05', 60, 0, 10, 'it', []]))).toBeNull();
  });

  it('reject fields a real result could not have', () => {
    const valid = [1, 't', 'A', 'B', '2026-11-09T07:05', '2026-11-09T08:05', 60, 0, 10, 'it', ['FR 9527']];
    expect(decodeTrip(tokenOf(valid))).not.toBeNull();
    const broken = (index: number, value: unknown) => tokenOf(valid.map((v, i) => (i === index ? value : v)));
    expect(decodeTrip(broken(1, 'bus'))).toBeNull();
    expect(decodeTrip(broken(2, 'x'.repeat(81)))).toBeNull();
    expect(decodeTrip(broken(4, 'tomorrow'))).toBeNull();
    expect(decodeTrip(broken(8, -5))).toBeNull();
    expect(decodeTrip(broken(9, 'de'))).toBeNull();
    expect(decodeTrip(broken(10, 'FR 9527'))).toBeNull();
    expect(decodeTrip(broken(10, ['x'.repeat(41)]))).toBeNull();
    expect(decodeTrip(broken(10, Array(7).fill('FR 9527')))).toBeNull();
  });
});

describe('tripOf', () => {
  const row: ResultRow = { ...train, adjusted_cost: 180, booking_url: 'https://www.lefrecce.it/' };

  it('keeps legs a link can carry and leaves out the rest', () => {
    expect(tripOf(row, 'trains', 'it').legs).toEqual(['FR 9527', 'EC 17']);
    expect(tripOf({ ...row, legs: undefined }, 'trains', 'it').legs).toEqual([]);
    expect(tripOf({ ...row, legs: Array(7).fill('RE 2159') }, 'trains', 'it').legs).toEqual([]);
  });
});

type BookingCase =Parameters<typeof bookingUrl>[0] & { url: string };

// Shared with tests/test_booking_urls.py, which checks the backend against the
// same links, so a change on either side fails a test until the other follows.
const bookingCases: BookingCase[] = JSON.parse(readFileSync(new URL('../../../tests/booking_urls.json', import.meta.url), 'utf-8'));

describe('bookingUrl', () => {
  it.each(bookingCases)('builds what the backend builds for $origin → $destination', ({ url, ...trip }) => {
    expect(bookingUrl(trip)).toBe(url);
  });
});

describe('viewOf', () => {
  it('reads day and clock from the string, whatever the zone', () => {
    const view = viewOf(train);
    expect(view.longDay).toBe('lunedì 9 novembre 2026');
    expect([view.depTime, view.arrTime, view.arrDayOffset]).toEqual(['07:05', '12:25', 0]);
  });

  it('counts the days an arrival falls after the departure', () => {
    expect(viewOf(nightFlight).arrDayOffset).toBe(1);
  });
});

describe('shareMessage', () => {
  it('writes a train in Italian', () => {
    expect(shareMessage(train)).toBe(
      '🚆 Firenze S. M. Novella → Zürich HB\n' +
      '📅 lun 9 nov · 07:05 → 12:25\n' +
      '⏱️ 5h 20m · 1 cambio (FR 9527, EC 17)\n' +
      '💶 48,50 €'
    );
  });

  it('writes an overnight flight in English', () => {
    expect(shareMessage(nightFlight)).toBe(
      '✈️ ZRH → FCO\n' +
      '📅 Sun 27 Sept · 22:45 → 20:25 (+1)\n' +
      '⏱️ 21h 40m · 2 stops\n' +
      '💶 411.00 €'
    );
  });
});
