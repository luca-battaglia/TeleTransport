import { useSyncExternalStore } from 'react';
import { writeJson } from './storage';

export type Mode = 'trains' | 'flights';
export type ReminderTarget = Mode | 'both' | 'disabled';

export type Reminder = { text: string; target: ReminderTarget };

export type TrainScoring = {
  time_value_eur_per_hour: number;
  early_departure_ref_hour: number;
  early_departure_penalty_eur_per_hour: number;
  late_arrival_start_hour: number;
  overnight_end_hour: number;
  late_arrival_penalty_eur_per_hour: number;
  change_penalty_eur: number;
};

export type FlightScoring = Omit<TrainScoring, 'change_penalty_eur'> & {
  connection_penalty_eur: number;
  companions_time_value_eur_per_hour: number;
};

export type AirportExtra = {
  fuel_eur: number;
  personal_drive_hours: number;
  companions_drive_hours: number;
};

export type ModeUi = {
  default_origin?: string;
  default_destination?: string;
  options?: string[];
};

export type Settings = {
  serpapiKey?: string;
  reminders?: Record<string, Reminder>;
  ui?: {
    trains?: ModeUi;
    flights?: ModeUi & { iata_mapping?: Record<string, string> };
  };
  trains?: { scoring?: Partial<TrainScoring> };
  flights?: { scoring?: Partial<FlightScoring>; airport_extras?: Record<string, AirportExtra> };
};

export const SETTINGS_KEY = 'teletransport_settings';

export const DEFAULT_TRAIN_SCORING: TrainScoring = {
  time_value_eur_per_hour: 20,
  early_departure_ref_hour: 9,
  early_departure_penalty_eur_per_hour: 20,
  late_arrival_start_hour: 22,
  overnight_end_hour: 5,
  late_arrival_penalty_eur_per_hour: 15,
  change_penalty_eur: 5,
};

export const DEFAULT_FLIGHT_SCORING: FlightScoring = {
  time_value_eur_per_hour: 20,
  early_departure_ref_hour: 9,
  early_departure_penalty_eur_per_hour: 20,
  late_arrival_start_hour: 22,
  overnight_end_hour: 5,
  late_arrival_penalty_eur_per_hour: 15,
  connection_penalty_eur: 5,
  companions_time_value_eur_per_hour: 8,
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Earlier versions stored everything under Italian keys ('treni', 'voli').
const LEGACY_MODE_KEYS: Record<string, Mode> = { treni: 'trains', voli: 'flights' };

const migrateTarget = (target: unknown): ReminderTarget => {
  if (typeof target !== 'string') return 'flights';
  const mapped = LEGACY_MODE_KEYS[target] ?? target;
  return (['trains', 'flights', 'both', 'disabled'] as const).includes(mapped as ReminderTarget)
    ? (mapped as ReminderTarget)
    : 'flights';
};

const renameLegacyKeys = (source: Json): Json => {
  const out: Json = { ...source };
  for (const [legacy, current] of Object.entries(LEGACY_MODE_KEYS)) {
    if (legacy in out) {
      if (!(current in out)) out[current] = out[legacy];
      delete out[legacy];
    }
  }
  return out;
};

export function migrateSettings(raw: unknown): Settings {
  if (!isObject(raw)) return {};
  const settings = renameLegacyKeys(raw);
  if (isObject(settings.ui)) settings.ui = renameLegacyKeys(settings.ui);

  if (isObject(settings.reminders)) {
    const reminders: Record<string, Reminder> = {};
    for (const [id, value] of Object.entries(settings.reminders)) {
      // A bare string is the oldest format and always meant flights.
      reminders[id] = typeof value === 'string'
        ? { text: value, target: 'flights' }
        : { text: String(isObject(value) ? value.text ?? '' : ''), target: migrateTarget(isObject(value) ? value.target : undefined) };
    }
    settings.reminders = reminders;
  }
  return settings as Settings;
}

const SETTINGS_EVENT = 'teletransport-settings';
const NO_SETTINGS: Settings = {};
let cachedRaw: string | null | undefined;
let cachedSettings: Settings = NO_SETTINGS;

// Parsed once per distinct stored value, so repeated reads return the same object,
// as useSyncExternalStore requires of a snapshot.
export function loadSettings(): Settings {
  if (typeof window === 'undefined') return NO_SETTINGS;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {
    return NO_SETTINGS;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedSettings = raw ? migrateSettings(JSON.parse(raw)) : NO_SETTINGS;
    } catch {
      cachedSettings = NO_SETTINGS;
    }
  }
  return cachedSettings;
}

// Returns whether the browser kept the settings.
export function saveSettings(settings: Settings): boolean {
  if (!writeJson('local', SETTINGS_KEY, settings)) return false;
  window.dispatchEvent(new Event(SETTINGS_EVENT));
  return true;
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(SETTINGS_EVENT, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(SETTINGS_EVENT, listener);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, loadSettings, () => NO_SETTINGS);
}

const IATA_CODE = /^[A-Z]{3}$/;
// A city with several airports maps to all of them, e.g. rome=FCO,CIA.
export const AIRPORT_LIST = /^[A-Z]{3}(,[A-Z]{3}){0,7}$/;
const MAX_PLACE_LENGTH = 80;

const knownNumbers = (values: object | undefined, known: object) =>
  Object.fromEntries(
    Object.entries(values ?? {}).filter(([k, v]) => k in known && typeof v === 'number' && Number.isFinite(v))
  );

// What the backend accepts in the X-Config header. Anything else is rejected there,
// so entries a hand-edited or imported file may carry are dropped here first.
export function configOverrides(settings: Settings, mode: Mode): Json | null {
  if (mode === 'trains') {
    const scoring = knownNumbers(settings.trains?.scoring, DEFAULT_TRAIN_SCORING);
    return Object.keys(scoring).length ? { trains: { scoring } } : null;
  }

  const flights: Json = {};
  const scoring = knownNumbers(settings.flights?.scoring, DEFAULT_FLIGHT_SCORING);
  if (Object.keys(scoring).length) flights.scoring = scoring;
  if (settings.flights?.airport_extras) {
    flights.airport_extras = Object.fromEntries(
      Object.entries(settings.flights.airport_extras).filter(([code]) => IATA_CODE.test(code))
    );
  }

  const out: Json = {};
  if (Object.keys(flights).length) out.flights = flights;
  const mapping = Object.entries(settings.ui?.flights?.iata_mapping ?? {}).filter(
    ([place, codes]) => place.trim() && place.trim().length <= MAX_PLACE_LENGTH && AIRPORT_LIST.test(codes)
  );
  if (mapping.length) {
    out.ui = { flights: { iata_mapping: Object.fromEntries(mapping) } };
  }
  return Object.keys(out).length ? out : null;
}
