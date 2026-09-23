import type { ResultRow } from './api';
import type { Language } from './i18n';

export const localeOf = (language: Language) => (language === 'it' ? 'it-IT' : 'en-GB');

// Train times are Italian (or Swiss) local time, so they are shown in that zone
// whatever the browser's. Flight times carry no zone: they are airport-local already.
export const formatDateTime = (iso: string, train: boolean, locale: string) =>
  new Date(iso).toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(train ? { timeZone: 'Europe/Rome' } : {}),
  });

export const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export const formatEuro = (amount: number, locale: string) =>
  `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// Translation keys of the result columns, in the order rowCells returns them.
export const RESULT_COLUMNS = ['route', 'departure', 'arrival', 'duration', 'price', 'adj_cost'] as const;

// One source for the table and its Markdown copy, so the two always read the same.
export const rowCells = (r: ResultRow, train: boolean, locale: string): string[] => [
  `${r.origin} → ${r.destination}`,
  formatDateTime(r.dep, train, locale),
  formatDateTime(r.arr, train, locale),
  formatDuration(r.duration_min),
  formatEuro(r.price_eur, locale),
  formatEuro(r.adjusted_cost, locale),
];

export const markdownTable = (headers: string[], rows: string[][]) => {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |\n`;
  return line(headers) + `|${headers.map(() => '---').join('|')}|\n` + rows.map(line).join('');
};
