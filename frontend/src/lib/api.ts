// Requests go to /api on this origin; src/proxy.ts forwards them to the backend,
// so the browser never talks to the backend directly and needs no CORS.

import { configOverrides, loadSettings, type Mode } from './settings';

export type DateRange = { start: string; end: string };

export type SearchPayload = {
  origins: string[];
  destinations: string[];
  dep_ranges: DateRange[];
  lang: 'it' | 'en';
};

// One shape for trains and flights. Train times carry their UTC offset; flight
// times carry none, being local to their airport already.
export type ResultRow = {
  origin: string;
  destination: string;
  // A flight's airports are codes; these name their cities, in English, when
  // SerpApi does. Null for trains.
  origin_city?: string | null;
  destination_city?: string | null;
  dep: string;
  arr: string;
  duration_min: number;
  changes: number;
  // The trains or flights taken, e.g. "FR 9633" or "SWISS LX 1726".
  legs?: string[];
  price_eur: number;
  adjusted_cost: number;
  booking_url: string;
};

// Rows saved before the optional fields existed have none of them.
type OptionalField = 'origin_city' | 'destination_city' | 'legs';

const ROW_FIELDS: Record<Exclude<keyof ResultRow, OptionalField>, 'string' | 'number'> = {
  origin: 'string',
  destination: 'string',
  dep: 'string',
  arr: 'string',
  duration_min: 'number',
  changes: 'number',
  price_eur: 'number',
  adjusted_cost: 'number',
  booking_url: 'string',
};

// Rows restored from browser storage may predate the current shape: flight rows
// saved before round trips were dropped have out_dep instead of dep.
export const isResultRow = (value: unknown): value is ResultRow => {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  const isOptionalText = (field: unknown) => field === undefined || field === null || typeof field === 'string';
  const legsOk = fields.legs === undefined || (Array.isArray(fields.legs) && fields.legs.every(leg => typeof leg === 'string'));
  return legsOk && isOptionalText(fields.origin_city) && isOptionalText(fields.destination_city) &&
    Object.entries(ROW_FIELDS).every(([key, type]) => typeof fields[key] === type);
};

export type SearchResponse = {
  data: ResultRow[];
  demo?: { searches_left: number };
};

export type AppConfig = {
  trains: { default_origin: string; default_destination: string };
  flights: { default_origin: string; default_destination: string; iata_mapping: Record<string, string> };
};

export type DemoStatus = { enabled: boolean; searches_left: number };

// The backend answers errors with a stable code the UI translates, plus an
// English message used when a code has no translation.
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly params: Record<string, string | number> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

// The translation of the error's code when there is one, else its own message.
export function describeError(err: unknown, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (err instanceof ApiError) {
    const key = `err_${err.code}`;
    const text = t(key, { ...err.params, message: err.message });
    return text === key ? err.message : text;
  }
  return err instanceof Error && err.message ? err.message : t('err_generic');
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const detail = body?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.code === 'string') {
    const { code, message, ...params } = detail;
    return new ApiError(String(message ?? code), code, params);
  }
  return new ApiError(typeof detail === 'string' ? detail : `HTTP ${res.status}`, 'generic');
}

export async function fetchConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch('/api/config');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function fetchDemoStatus(): Promise<DemoStatus | null> {
  try {
    const res = await fetch('/api/flights/demo');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function search(mode: Mode, payload: SearchPayload, signal?: AbortSignal): Promise<SearchResponse> {
  const settings = loadSettings();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const overrides = configOverrides(settings, mode);
  if (overrides) headers['X-Config'] = JSON.stringify(overrides);
  if (mode === 'flights' && settings.serpapiKey) headers['X-SerpApi-Key'] = settings.serpapiKey;

  const res = await fetch(`/api/${mode}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}
