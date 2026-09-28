// A shared solution travels inside its own link, so the share page needs no
// database and no backend call: the link is the whole record. The page and its
// preview image render on the server and read it back from there.

import type { ResultRow } from './api';
import { formatDuration, formatEuro, localeOf } from './format';
import type { Language } from './i18n';
import type { Mode } from './settings';

export type SharedTrip = Pick<ResultRow, 'origin' | 'destination' | 'dep' | 'arr' | 'duration_min' | 'changes' | 'price_eur'> & {
  mode: Mode;
  lang: Language;
  legs: string[];
  // Empty when the row names no city, as for trains.
  origin_city: string;
  destination_city: string;
};

// Whatever the link would refuse is left out rather than breaking it.
const cityOf = (city: string | null | undefined) => (city && isCity(city) ? city : '');

export const tripOf = (r: ResultRow, mode: Mode, lang: Language): SharedTrip => ({
  mode,
  lang,
  origin: r.origin,
  destination: r.destination,
  dep: r.dep,
  arr: r.arr,
  duration_min: r.duration_min,
  changes: r.changes,
  price_eur: r.price_eur,
  legs: isLegList(r.legs) ? r.legs : [],
  origin_city: cityOf(r.origin_city),
  destination_city: cityOf(r.destination_city),
});

// Bumped whenever the field list below changes, so older links fail cleanly
// instead of being read with the wrong fields.
const FORMAT_VERSION = 2;

const toBase64Url = (text: string) => {
  const binary = Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (token: string) => {
  const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
};

// A positional array rather than an object, to keep the link short.
export const encodeTrip = (trip: SharedTrip): string =>
  toBase64Url(JSON.stringify([
    FORMAT_VERSION, trip.mode === 'trains' ? 't' : 'f', trip.origin, trip.destination,
    trip.dep, trip.arr, trip.duration_min, trip.changes, trip.price_eur, trip.lang, trip.legs,
    trip.origin_city, trip.destination_city,
  ]));

// Place names are capped like the backend's Place, and legs and cities to what
// a real itinerary needs, so a crafted link cannot overflow the card.
const isPlace = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80;
const isCity = (value: unknown): value is string => typeof value === 'string' && value.length <= 40;
const isLegList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 6 &&
  value.every(leg => typeof leg === 'string' && leg.length > 0 && leg.length <= 40);
const isLocalTime = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/.test(value);
const isWithin = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

// Anyone can write a link by hand, so everything in it is checked before use.
export function decodeTrip(token: string): SharedTrip | null {
  let fields: unknown;
  try {
    fields = JSON.parse(fromBase64Url(token));
  } catch {
    return null;
  }
  if (!Array.isArray(fields) || fields.length !== 13 || fields[0] !== FORMAT_VERSION) return null;

  const [, modeCode, origin, destination, dep, arr, duration_min, changes, price_eur, lang, legs, origin_city, destination_city] = fields;
  const mode: Mode | null = modeCode === 't' ? 'trains' : modeCode === 'f' ? 'flights' : null;
  if (!mode || (lang !== 'it' && lang !== 'en')) return null;
  if (!isPlace(origin) || !isPlace(destination) || !isLocalTime(dep) || !isLocalTime(arr)) return null;
  if (!isWithin(duration_min, 7 * 24 * 60) || !isWithin(changes, 20) || !isWithin(price_eur, 100_000)) return null;
  if (!isLegList(legs) || !isCity(origin_city) || !isCity(destination_city)) return null;
  return { mode, lang, origin, destination, dep, arr, duration_min, changes, price_eur, legs, origin_city, destination_city };
}

// Mirrors build_booking_url in core/trains.py and core/flights.py, so the link
// does not have to carry the operator's long URL. tests/booking_urls.json holds
// the expected links, and both test suites check their side against it.
export function bookingUrl(trip: Pick<SharedTrip, 'mode' | 'origin' | 'destination' | 'dep' | 'lang'>): string {
  const day = trip.dep.slice(0, 10);
  if (trip.mode === 'flights') {
    const q = `Flights to ${trip.destination} from ${trip.origin} on ${day} one-way`;
    return `https://www.google.com/travel/flights?${new URLSearchParams({ q, hl: trip.lang })}`;
  }
  const [year, month, date] = day.split('-');
  const params = new URLSearchParams({
    isRoundTrip: 'false',
    departureStation: trip.origin,
    arrivalStation: trip.destination,
    departureDate: `${date}-${month}-${year}`,
    departureTime: `${trip.dep.slice(11, 13)}:00`,
    noOfAdults: '1',
    noOfChildren: '0',
    searchSolutions: 'true',
    lang: trip.lang,
  });
  return `https://www.lefrecce.it/Channels.Website.WEB/#/white-label/MINISITI/?${params}`;
}

// The share page and its image render on the server, where the app's dictionary
// (a client module) cannot be read, so the few words they need live here.
const WORDS = {
  en: {
    trains: 'Train',
    flights: 'Flight',
    changes: ['direct', '1 change', '{n} changes'],
    stops: ['nonstop', '1 stop', '{n} stops'],
    book_trains: 'Book on Trenitalia',
    book_flights: 'Open in Google Flights',
    price_note: 'Price when it was searched',
    search_own: 'Search your own trips',
  },
  it: {
    trains: 'Treno',
    flights: 'Volo',
    changes: ['diretto', '1 cambio', '{n} cambi'],
    stops: ['diretto', '1 scalo', '{n} scali'],
    book_trains: 'Prenota su Trenitalia',
    book_flights: 'Apri su Google Flights',
    price_note: 'Prezzo al momento della ricerca',
    search_own: 'Cerca i tuoi viaggi',
  },
} satisfies Record<Language, unknown>;

export const shareWords = (lang: Language) => WORDS[lang];

export type TripView = {
  kind: string;
  // "Zurich ZRH" for an airport whose city is known, else the name as searched.
  from: string;
  to: string;
  route: string;
  longDay: string;
  shortDay: string;
  depTime: string;
  arrTime: string;
  // Days between departure and arrival, e.g. 1 for an overnight trip.
  arrDayOffset: number;
  duration: string;
  changes: string;
  // Empty when the row came without them.
  legs: string;
  price: string;
};

// The backend writes each time in the traveller's local time (see dayOf in
// results.ts), so the day and the clock are read off the string, whatever zone
// this code runs in.
const calendarDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export function viewOf(trip: SharedTrip): TripView {
  const words = WORDS[trip.lang];
  const locale = localeOf(trip.lang);
  const day = calendarDay(trip.dep);
  const dayLabel = (options: Intl.DateTimeFormatOptions) => day.toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
  const [none, one, many] = trip.mode === 'trains' ? words.changes : words.stops;
  const from = trip.origin_city ? `${trip.origin_city} ${trip.origin}` : trip.origin;
  const to = trip.destination_city ? `${trip.destination_city} ${trip.destination}` : trip.destination;

  return {
    kind: words[trip.mode],
    from,
    to,
    route: `${from} → ${to}`,
    longDay: dayLabel({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    shortDay: dayLabel({ weekday: 'short', day: 'numeric', month: 'short' }),
    depTime: trip.dep.slice(11, 16),
    arrTime: trip.arr.slice(11, 16),
    arrDayOffset: Math.round((calendarDay(trip.arr).getTime() - day.getTime()) / 86_400_000),
    duration: formatDuration(trip.duration_min),
    changes: trip.changes === 0 ? none : trip.changes === 1 ? one : many.replace('{n}', String(trip.changes)),
    legs: trip.legs.join(', '),
    price: formatEuro(trip.price_eur, locale),
  };
}

export const arrivalLabel = (view: TripView) =>
  view.arrDayOffset > 0 ? `${view.arrTime} (+${view.arrDayOffset})` : view.arrTime;

export const changesLabel = (view: TripView) => (view.legs ? `${view.changes} (${view.legs})` : view.changes);

// Plain text with emoji rather than WhatsApp's *bold*, which Telegram would show
// as literal asterisks.
export function shareMessage(trip: SharedTrip): string {
  const view = viewOf(trip);
  return [
    `${trip.mode === 'trains' ? '🚆' : '✈️'} ${view.route}`,
    `📅 ${view.shortDay} · ${view.depTime} → ${arrivalLabel(view)}`,
    `⏱️ ${view.duration} · ${changesLabel(view)}`,
    `💶 ${view.price}`,
  ].join('\n');
}
