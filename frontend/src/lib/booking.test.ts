import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bookingUrl, type BookingTarget } from './booking';

type BookingCase = BookingTarget & { url: string };

// Shared with tests/test_booking_urls.py, which checks the backend against the
// same links, so a change on either side fails a test until the other follows.
const bookingCases: BookingCase[] = JSON.parse(readFileSync(new URL('../../../tests/booking_urls.json', import.meta.url), 'utf-8'));

describe('bookingUrl', () => {
  it.each(bookingCases)('builds what the backend builds for $origin → $destination', ({ url, ...target }) => {
    expect(bookingUrl(target)).toBe(url);
  });
});
