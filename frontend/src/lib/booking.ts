import type { Language } from './i18n';
import type { Mode } from './settings';

export type BookingTarget = { mode: Mode; origin: string; destination: string; dep: string; lang: Language };

// Mirrors build_booking_url in core/trains.py and core/flights.py. The page
// builds every link from the row rather than keeping the one the backend sent,
// so rows restored from storage and shared links never carry a link the
// operator has since broken. tests/booking_urls.json holds the expected links,
// and both test suites check their side against it.
export function bookingUrl(target: BookingTarget): string {
  const day = target.dep.slice(0, 10);
  if (target.mode === 'flights') {
    const q = `Flights to ${target.destination} from ${target.origin} on ${day} one-way`;
    return `https://www.google.com/travel/flights?${new URLSearchParams({ q, hl: target.lang })}`;
  }
  const [year, month, date] = day.split('-');
  const params = new URLSearchParams({
    isRoundTrip: 'false',
    departureStation: target.origin,
    arrivalStation: target.destination,
    departureDate: `${date}-${month}-${year}`,
    departureTime: `${target.dep.slice(11, 13)}:00`,
    noOfAdults: '1',
    noOfChildren: '0',
    searchSolutions: 'true',
    lang: target.lang,
  });
  return `https://www.lefrecce.it/Channels.Website.WEB/#/white-label/?${params}`;
}
