// What the search form may send, save and open elsewhere.

import type { DateRange } from './api';
import { countDays, formatDateKey } from './dates';
import type { Mode } from './settings';
import { readJson } from './storage';

// Total days a search may cover, counted across every stretch in the pool.
// Mirrors MAX_SEARCH_DAYS in the backend, which rejects anything above it.
export const MAX_RANGE_DAYS = 14;
// Origins x destinations x days, mirroring MAX_ROUTE_DAYS in the backend.
export const MAX_ROUTE_DAYS = 30;
export const MAX_ENDPOINTS = 5;

export type SearchProblem = { key: string; params?: Record<string, number> };

// The first reason the backend would refuse this search, as a translation key.
export function checkSearch(
  ranges: DateRange[],
  origins: string[],
  destinations: string[],
  today = formatDateKey(new Date())
): SearchProblem | null {
  const days = countDays(ranges);
  const routeDays = origins.length * destinations.length * days;
  if (ranges.length === 0) return { key: 'err_no_dates' };
  // A page left open overnight still holds yesterday's selection.
  if (ranges[0].start < today) return { key: 'err_past_dates' };
  if (days > MAX_RANGE_DAYS) return { key: 'err_max_range', params: { days: MAX_RANGE_DAYS } };
  if (routeDays > MAX_ROUTE_DAYS) return { key: 'err_too_many_route_days', params: { route_days: routeDays, max: MAX_ROUTE_DAYS } };
  return null;
}

export type SavedSearch = { origins: string[]; destinations: string[] };

export const SAVED_SEARCHES_KEY = 'teletransport_saved_searches';
const MAX_SAVED_SEARCHES = 10;

export const loadSavedSearches = (): Record<Mode, SavedSearch[]> => ({
  trains: [],
  flights: [],
  ...readJson('local', SAVED_SEARCHES_KEY, {}),
});

// The list with this search added, or the same list when there is nothing new to
// save. Past the cap the oldest one goes.
export function withSavedSearch(saved: SavedSearch[], origins: string[], destinations: string[]): SavedSearch[] {
  const cleanOrigins = origins.filter(o => o.trim());
  const cleanDestinations = destinations.filter(d => d.trim());
  if (cleanOrigins.length === 0 || cleanDestinations.length === 0) return saved;

  const isDuplicate = saved.some(s =>
    JSON.stringify(s.origins) === JSON.stringify(cleanOrigins) &&
    JSON.stringify(s.destinations) === JSON.stringify(cleanDestinations)
  );
  if (isDuplicate) return saved;
  return [...saved, { origins: cleanOrigins, destinations: cleanDestinations }].slice(-MAX_SAVED_SEARCHES);
}

export const TRENITALIA_URL = 'https://www.trenitalia.com/';

export function googleFlightsUrl(origin: string, destination: string, date: Date | null, mapping: Record<string, string>) {
  // A city mapped to several airports stays a name: the text query reads
  // "Rome" reliably, a list like "FCO,CIA" not necessarily.
  const toCode = (name: string) => {
    const lowered = name.toLowerCase();
    const hit = Object.entries(mapping).find(([key]) => lowered.includes(key.toLowerCase()));
    return hit && /^[A-Z]{3}$/.test(hit[1]) ? hit[1] : name;
  };
  const dep = date ? formatDateKey(date) : '';
  const query = `Flights to ${toCode(destination)} from ${toCode(origin)} on ${dep} one-way`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}
