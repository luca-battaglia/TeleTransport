"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Train, Plane, Loader2, Calendar, ArrowLeftRight, Square, Copy, X, Plus, Bookmark, Clock, ArrowDownNarrowWide, CalendarDays, CalendarPlus, Undo2, RotateCcw } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { it } from 'date-fns/locale/it';
import { addDays } from 'date-fns';
import AutocompleteInput from '@/components/AutocompleteInput';
import HistoryModal, { HistoryEntry } from '@/components/HistoryModal';
import {
  ApiError,
  fetchConfig,
  fetchDemoStatus,
  search,
  type AppConfig,
  type DateRange,
  type DemoStatus,
  type FlightRow,
  type ResultRow,
} from '@/lib/api';
import { localizeFlightPlace, useLanguage } from '@/lib/i18n';
import { useSettings, type Mode } from '@/lib/settings';

registerLocale('it', it);

// Months rendered in the date popup, which scrolls vertically (see globals.css).
const MONTHS_SHOWN = 12;
// Total days a search may cover, counted across every stretch in the pool.
// Mirrors MAX_SEARCH_DAYS in the backend, which rejects anything above it.
const MAX_RANGE_DAYS = 14;
const MAX_ENDPOINTS = 5;
const HISTORY_SIZE = 10;

const STATE_KEY = 'dashboard_state';
const SAVED_SEARCHES_KEY = 'teletransport_saved_searches';
const HISTORY_KEYS: Record<Mode, string> = {
  trains: 'teletransport_train_history',
  flights: 'teletransport_flight_history',
};

// Used until the backend's /api/config answers, and if it never does.
const FALLBACK_DEFAULTS: Record<Mode, { origin: string; destination: string }> = {
  trains: { origin: 'Milano Centrale', destination: 'Roma Termini' },
  flights: { origin: 'Zurich', destination: 'Rome' },
};

type SortOrder = 'best' | 'day';

// How many results to show is remembered per mode and per view, because the
// number means different things: a whole-table total when ranked by best, a
// per-day count when grouped by day.
type ResultCountKey = `${Mode}-${SortOrder}`;

const DEFAULT_RESULT_COUNTS: Record<ResultCountKey, number> = {
  'trains-best': 10,
  'trains-day': 3,
  'flights-best': 10,
  'flights-day': 3,
};

type ModeState = {
  loading: boolean;
  searched: boolean;
  results: ResultRow[];
  error: string | null;
  // Positions in the unsorted results, newest exclusion last so undo can pop it.
  excluded: number[];
};

const EMPTY_MODE_STATE: ModeState = { loading: false, searched: false, results: [], error: null, excluded: [] };

type SavedSearch = { origins: string[]; destinations: string[] };
type PickerValue = [Date | null, Date | null];

const formatDateKey = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseDateKey = (key: string) => new Date(`${key}T00:00:00`);

const rangeFromPicker = (picker: PickerValue): DateRange | null => {
  const [start, end] = picker;
  if (!start) return null;
  return { start: formatDateKey(start), end: formatDateKey(end || start) };
};

// What the search actually covers: the saved stretches plus whatever the picker
// currently holds, so ignoring the pool leaves the original single-range flow intact.
const collectRanges = (pool: DateRange[], picker: PickerValue): DateRange[] => {
  const ranges = [...pool];
  const current = rangeFromPicker(picker);
  if (current && !ranges.some(r => r.start === current.start && r.end === current.end)) {
    ranges.push(current);
  }
  return ranges.sort((a, b) => a.start.localeCompare(b.start));
};

// Compact enough for a chip; the picker itself still shows full dates.
const formatRangeLabel = (r: DateRange) => {
  const short = (key: string) => {
    const d = parseDateKey(key);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  return r.start === r.end ? short(r.start) : `${short(r.start)} – ${short(r.end)}`;
};

// Distinct days, so overlapping stretches are not counted twice against the cap.
const countDays = (ranges: DateRange[]) => {
  const days = new Set<string>();
  ranges.forEach(r => {
    const end = parseDateKey(r.end);
    for (let d = parseDateKey(r.start); d <= end; d = addDays(d, 1)) {
      days.add(formatDateKey(d));
    }
  });
  return days.size;
};

const isFlightRow = (r: ResultRow): r is FlightRow => 'out_dep' in r;
const departureOf = (r: ResultRow) => (isFlightRow(r) ? r.out_dep : r.dep);
const durationOf = (r: ResultRow) => (isFlightRow(r) ? r.total_duration_min : r.duration_min);

// The backend sends local times (trains with their offset, flights as airport
// time), so the date written in the string is the day the traveller sees.
const dayOf = (r: ResultRow) => departureOf(r).slice(0, 10);

// Duration breaks cost ties, mirroring the backend ranking, so 'best' reproduces
// the order the API already returned.
const compareRows = (a: ResultRow, b: ResultRow, order: SortOrder) => {
  if (order === 'day') {
    const byDay = dayOf(a).localeCompare(dayOf(b));
    if (byDay !== 0) return byDay;
  }
  return (a.adjusted_cost - b.adjusted_cost) || (durationOf(a) - durationOf(b));
};

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

type StoredDashboard = {
  mode?: Mode;
  origins?: string[];
  destinations?: string[];
  resultCounts?: Record<string, unknown>;
  oneWay?: boolean;
  sortOrder?: SortOrder;
  byMode?: Record<Mode, Omit<ModeState, 'loading'>>;
  depRangePool?: DateRange[];
  retRangePool?: DateRange[];
  depDateRange?: [string | null, string | null];
  retDateRange?: [string | null, string | null];
};

const toPicker = (stored?: [string | null, string | null]): PickerValue | null =>
  stored ? [stored[0] ? new Date(stored[0]) : null, stored[1] ? new Date(stored[1]) : null] : null;

export default function Dashboard() {
  const { t, language } = useLanguage();
  const settings = useSettings();
  const [stored] = useState(() => readJson<StoredDashboard>(sessionStorage, STATE_KEY, {}));
  const [serverConfig, setServerConfig] = useState<AppConfig | null>(null);

  const defaultsFor = (m: Mode) => {
    const local = (place: string) => (m === 'flights' ? localizeFlightPlace(place, language) : place);
    return {
      origin: settings.ui?.[m]?.default_origin || local(serverConfig?.[m].default_origin || FALLBACK_DEFAULTS[m].origin),
      destination: settings.ui?.[m]?.default_destination || local(serverConfig?.[m].default_destination || FALLBACK_DEFAULTS[m].destination),
    };
  };

  const [mode, setMode] = useState<Mode>(stored.mode ?? 'trains');
  const [origins, setOrigins] = useState<string[]>(() => stored.origins ?? [defaultsFor(stored.mode ?? 'trains').origin]);
  const [destinations, setDestinations] = useState<string[]>(() => stored.destinations ?? [defaultsFor(stored.mode ?? 'trains').destination]);
  const [depDateRange, setDepDateRange] = useState<PickerValue>(() => toPicker(stored.depDateRange) ?? [new Date(), null]);
  // The picker opens on today; the first range picked replaces it rather than extending it.
  const [depDatePristine, setDepDatePristine] = useState(!stored.depDateRange);
  const [retDateRange, setRetDateRange] = useState<PickerValue>(() => toPicker(stored.retDateRange) ?? [null, null]);
  const [depRangePool, setDepRangePool] = useState<DateRange[]>(stored.depRangePool ?? []);
  const [retRangePool, setRetRangePool] = useState<DateRange[]>(stored.retRangePool ?? []);
  const [resultCounts, setResultCounts] = useState<Record<ResultCountKey, number>>(() => ({
    ...DEFAULT_RESULT_COUNTS,
    // Only positive numbers survive, so a stale or hand-edited entry cannot leave a slot undefined.
    ...Object.fromEntries(Object.entries(stored.resultCounts ?? {}).filter(([, v]) => typeof v === 'number' && v > 0)),
  }));
  const [oneWay, setOneWay] = useState(stored.oneWay ?? true);
  const [sortOrder, setSortOrder] = useState<SortOrder>(stored.sortOrder === 'day' ? 'day' : 'best');
  const [byMode, setByMode] = useState<Record<Mode, ModeState>>(() => ({
    trains: { ...EMPTY_MODE_STATE, ...stored.byMode?.trains, loading: false },
    flights: { ...EMPTY_MODE_STATE, ...stored.byMode?.flights, loading: false },
  }));
  const [savedSearches, setSavedSearches] = useState<Record<Mode, SavedSearch[]>>(() => ({
    trains: [],
    flights: [],
    ...readJson(localStorage, SAVED_SEARCHES_KEY, {}),
  }));
  const [history, setHistory] = useState<Record<Mode, HistoryEntry[]>>(() => ({
    trains: readJson(localStorage, HISTORY_KEYS.trains, []),
    flights: readJson(localStorage, HISTORY_KEYS.flights, []),
  }));
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [demo, setDemo] = useState<DemoStatus | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const controllers = useRef<Record<Mode, AbortController | null>>({ trains: null, flights: null });

  const current = byMode[mode];
  const patchMode = (m: Mode, patch: Partial<ModeState>) =>
    setByMode(prev => ({ ...prev, [m]: { ...prev[m], ...patch } }));

  const hasOwnKey = Boolean(settings.serpapiKey);
  const customOptions = settings.ui?.[mode]?.options;
  const options = customOptions?.length ? customOptions : t(`options_${mode}`).split(',');
  const reminders = Object.values(settings.reminders ?? {}).filter(r => r.text && (r.target === mode || r.target === 'both'));

  const resultCountKey: ResultCountKey = `${mode}-${sortOrder}`;
  const itemsPerPage = resultCounts[resultCountKey];

  const visibleRows = useMemo(() => {
    const hidden = new Set(current.excluded);
    return current.results
      .map((row, index) => ({ row, index }))
      .filter(entry => !hidden.has(entry.index))
      .sort((a, b) => compareRows(a.row, b.row, sortOrder));
  }, [current.results, current.excluded, sortOrder]);

  // The cut happens after filtering, so excluding a row pulls the next one into
  // view. Grouped by day the count applies per day rather than to the whole table.
  const pageRows = useMemo(() => {
    if (sortOrder === 'best') return visibleRows.slice(0, itemsPerPage);
    const takenPerDay = new Map<string, number>();
    return visibleRows.filter(({ row }) => {
      const day = dayOf(row);
      const taken = takenPerDay.get(day) ?? 0;
      if (taken >= itemsPerPage) return false;
      takenPerDay.set(day, taken + 1);
      return true;
    });
  }, [visibleRows, itemsPerPage, sortOrder]);

  // A fresh session starts on the server's defaults unless the user set their own.
  // Decided once, from the state at mount.
  const serverDefaultsFor = useRef(
    !stored.origins && !settings.ui?.[stored.mode ?? 'trains']?.default_origin ? stored.mode ?? 'trains' : null
  );

  useEffect(() => {
    fetchConfig().then(cfg => {
      if (!cfg) return;
      setServerConfig(cfg);
      const initialMode = serverDefaultsFor.current;
      if (initialMode) {
        setOrigins([cfg[initialMode].default_origin]);
        setDestinations([cfg[initialMode].default_destination]);
      }
    });
  }, []);

  useEffect(() => {
    if (mode !== 'flights' || hasOwnKey) return;
    let cancelled = false;
    fetchDemoStatus().then(status => {
      if (!cancelled) setDemo(status);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, hasOwnKey]);

  useEffect(() => {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(savedSearches));
  }, [savedSearches]);

  useEffect(() => {
    const persisted: StoredDashboard = {
      mode, origins, destinations, resultCounts, oneWay, sortOrder,
      byMode: {
        trains: { ...byMode.trains },
        flights: { ...byMode.flights },
      },
      depRangePool, retRangePool,
      depDateRange: [depDateRange[0]?.toISOString() ?? null, depDateRange[1]?.toISOString() ?? null],
      retDateRange: [retDateRange[0]?.toISOString() ?? null, retDateRange[1]?.toISOString() ?? null],
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(persisted));
  }, [mode, origins, destinations, resultCounts, oneWay, sortOrder, byMode, depRangePool, retRangePool, depDateRange, retDateRange]);

  const switchMode = (m: Mode) => {
    setMode(m);
    const defaults = defaultsFor(m);
    setOrigins([defaults.origin]);
    setDestinations([defaults.destination]);
  };

  // The keyboard handler is registered once, so it reads the latest switchMode through a ref.
  const switchModeRef = useRef(switchMode);
  useEffect(() => {
    switchModeRef.current = switchMode;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') formRef.current?.requestSubmit();
      if (e.altKey && e.key === '1') switchModeRef.current('trains');
      if (e.altKey && e.key === '2') switchModeRef.current('flights');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const locale = language === 'it' ? 'it-IT' : 'en-GB';

  // Train times are Italian (or Swiss) local time, so they are shown in that zone
  // whatever the browser's. Flight times carry no zone: they are airport-local already.
  const formatDateTime = (iso: string, train: boolean) =>
    new Date(iso).toLocaleString(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      ...(train ? { timeZone: 'Europe/Rome' } : {}),
    });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

  const formatEuro = (amount: number) =>
    `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  const routeOf = (r: ResultRow) => (isFlightRow(r) ? `${r.origin} → ${r.destination}` : r.route.replace(' -> ', ' → '));

  const errorMessage = (err: unknown): string => {
    if (err instanceof ApiError) {
      const key = `err_${err.code}`;
      const text = t(key, { ...err.params, message: err.message });
      return text === key ? err.message : text;
    }
    return err instanceof Error && err.message ? err.message : t('err_generic');
  };

  const handleCopyTable = () => {
    if (pageRows.length === 0) return;
    let text = `| ${t('route')} | ${t('departure')} | ${t('arrival')} | ${t('duration')} | ${t('price')} | ${t('adj_cost')} |\n`;
    text += "|---|---|---|---|---|---|\n";
    pageRows.forEach(({ row: r }) => {
      const train = !isFlightRow(r);
      const arrival = isFlightRow(r) ? r.out_arr : r.arr;
      text += `| ${routeOf(r)} | ${formatDateTime(departureOf(r), train)} | ${formatDateTime(arrival, train)} | ${formatDuration(durationOf(r))} | ${formatEuro(r.price_eur)} | ${formatEuro(r.adjusted_cost)} |\n`;
    });
    navigator.clipboard.writeText(text).catch(err => console.error('Clipboard error', err));
  };

  const handleStop = () => {
    controllers.current[mode]?.abort();
    patchMode(mode, { loading: false });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const searchMode = mode;

    const depRanges = collectRanges(depRangePool, depDateRange);
    const retRanges = oneWay ? [] : collectRanges(retRangePool, retDateRange);

    const invalid =
      depRanges.length === 0 ? t('err_outbound')
      : !oneWay && retRanges.length === 0 ? t('err_return')
      : countDays(depRanges) > MAX_RANGE_DAYS || countDays(retRanges) > MAX_RANGE_DAYS ? t('err_max_range', { days: MAX_RANGE_DAYS })
      : null;
    if (invalid) {
      patchMode(searchMode, { error: invalid, searched: false, results: [] });
      return;
    }

    controllers.current[searchMode]?.abort();
    const controller = new AbortController();
    controllers.current[searchMode] = controller;
    patchMode(searchMode, { loading: true, searched: false, error: null, results: [], excluded: [] });

    const cleanOrigins = origins.map(o => o.trim()).filter(Boolean);
    const cleanDestinations = destinations.map(d => d.trim()).filter(Boolean);

    try {
      const res = await search(searchMode, {
        origins: cleanOrigins,
        destinations: cleanDestinations,
        dep_ranges: depRanges,
        ret_ranges: retRanges,
        one_way: oneWay,
        lang: language,
      }, controller.signal);

      patchMode(searchMode, { results: res.data, searched: true });
      if (res.demo) setDemo({ enabled: true, searches_left: res.demo.searches_left });
      if (res.data.length > 0) {
        const entry: HistoryEntry = {
          timestamp: Date.now(),
          origin: cleanOrigins.join(', '),
          destination: cleanDestinations.join(', '),
          depStartStr: depRanges[0].start,
          depEndStr: depRanges[depRanges.length - 1].end,
          retStartStr: retRanges[0]?.start,
          retEndStr: retRanges[retRanges.length - 1]?.end,
          depRanges, retRanges, oneWay,
          results: res.data,
        };
        setHistory(prev => {
          const next = [entry, ...prev[searchMode]].slice(0, HISTORY_SIZE);
          localStorage.setItem(HISTORY_KEYS[searchMode], JSON.stringify(next));
          return { ...prev, [searchMode]: next };
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      patchMode(searchMode, { error: errorMessage(err), searched: true });
      if (err instanceof ApiError && err.code === 'demo_exhausted') setDemo({ enabled: true, searches_left: 0 });
    } finally {
      if (controllers.current[searchMode] === controller) patchMode(searchMode, { loading: false });
    }
  };

  const handleSaveSearch = () => {
    const cleanOrigins = origins.filter(o => o.trim());
    const cleanDestinations = destinations.filter(d => d.trim());
    if (cleanOrigins.length === 0 || cleanDestinations.length === 0) return;

    const existing = savedSearches[mode];
    const isDuplicate = existing.some(s =>
      JSON.stringify(s.origins) === JSON.stringify(cleanOrigins) &&
      JSON.stringify(s.destinations) === JSON.stringify(cleanDestinations)
    );
    if (isDuplicate) return;
    setSavedSearches(prev => ({
      ...prev,
      [mode]: [...prev[mode], { origins: cleanOrigins, destinations: cleanDestinations }].slice(-10),
    }));
  };

  const removeSavedSearch = (idx: number) =>
    setSavedSearches(prev => ({ ...prev, [mode]: prev[mode].filter((_, i) => i !== idx) }));

  const openOperatorSite = () => {
    if (mode === 'trains') {
      window.open('https://www.trenitalia.com/', '_blank', 'noopener');
      return;
    }
    const mapping = settings.ui?.flights?.iata_mapping ?? serverConfig?.flights.iata_mapping ?? {};
    const toCode = (name: string) => {
      const lowered = name.toLowerCase();
      const hit = Object.entries(mapping).find(([key]) => lowered.includes(key.toLowerCase()));
      return hit ? hit[1] : name;
    };
    const dep = depDateRange[0] ? formatDateKey(depDateRange[0]) : '';
    const ret = retDateRange[0] ? formatDateKey(retDateRange[0]) : '';
    let query = `Flights to ${toCode(destinations[0] || '')} from ${toCode(origins[0] || '')} on ${dep}`;
    query += !oneWay && ret ? ` through ${ret}` : ' one-way';
    window.open(`https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`, '_blank', 'noopener');
  };

  const addRangeToPool = (
    picker: PickerValue,
    setPicker: (value: PickerValue) => void,
    setPool: React.Dispatch<React.SetStateAction<DateRange[]>>
  ) => {
    const entry = rangeFromPicker(picker);
    if (!entry) return;
    setPool(prev => (
      prev.some(r => r.start === entry.start && r.end === entry.end)
        ? prev
        : [...prev, entry].sort((a, b) => a.start.localeCompare(b.start))
    ));
    // Clearing the picker keeps the added stretch from also counting as the
    // current selection, which would show it twice.
    setPicker([null, null]);
  };

  const renderRangePool = (pool: DateRange[], setPool: React.Dispatch<React.SetStateAction<DateRange[]>>) => {
    if (pool.length === 0) return null;
    return (
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
        {pool.map(r => (
          <div
            key={`${r.start}_${r.end}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '4px 10px', borderRadius: '16px', fontSize: '13px' }}
          >
            <span>{formatRangeLabel(r)}</span>
            <button
              type="button"
              onClick={() => setPool(prev => prev.filter(x => !(x.start === r.start && x.end === r.end)))}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, display: 'flex' }}
              title={t("remove")}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderEndpoints = (
    values: string[],
    setValues: (values: string[]) => void,
    label: string,
    placeholder: string,
    addLabel: string
  ) => (
    <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {values.map((value, idx) => (
        <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <AutocompleteInput
              label={idx === 0 ? label : `${label} ${idx + 1}`}
              value={value}
              onChange={val => setValues(values.map((v, i) => (i === idx ? val : v)))}
              options={options}
              placeholder={placeholder}
            />
          </div>
          {values.length > 1 && (
            <button type="button" className="btn-outline" onClick={() => setValues(values.filter((_, i) => i !== idx))} style={{ padding: '10px', height: '42px', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t("remove")}>
              <X size={18} />
            </button>
          )}
        </div>
      ))}
      {values.length < MAX_ENDPOINTS && (
        <button type="button" className="btn-outline" onClick={() => setValues([...values, ''])} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Plus size={14} /> {addLabel}
        </button>
      )}
    </div>
  );

  const demoNotice = mode === 'flights' && !hasOwnKey && demo
    ? !demo.enabled ? t('demo_unavailable')
      : demo.searches_left > 0 ? t('demo_banner', { left: demo.searches_left })
      : t('demo_none_left')
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

      <div className="flex justify-center" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'inline-flex', gap: '12px' }}>
          {(['trains', 'flights'] as const).map(m => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'btn-primary' : 'btn-outline'}
              title={`${t(`${m}_btn`)} (Alt+${m === 'trains' ? 1 : 2})`}
              onClick={() => switchMode(m)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', border: mode === m ? 'none' : '1px solid var(--card-border)', padding: '10px 24px' }}
            >
              {m === 'trains' ? <Train size={18} /> : <Plane size={18} />} {t(`${m}_btn`)}
            </button>
          ))}
        </div>
      </div>

      {reminders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {reminders.map((r, i) => (
            <div key={i} style={{ padding: '12px 16px', background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '8px', color: '#ca8a04', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>💡</span>
              {r.text}
            </div>
          ))}
        </div>
      )}

      {demoNotice && <div className="notice">{demoNotice}</div>}

      <motion.form
        ref={formRef}
        onSubmit={handleSearch}
        className="glass-panel"
        style={{ padding: '32px' }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="form-grid">
          {savedSearches[mode].length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
              {savedSearches[mode].map((s, i) => (
                <div
                  key={i}
                  onClick={() => { setOrigins(s.origins); setDestinations(s.destinations); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '6px 12px', borderRadius: '16px', fontSize: '13px', transition: 'all 0.2s' }}
                >
                  <span>{s.origins.join(', ')} <ArrowLeftRight size={12} style={{ display: 'inline', margin: '0 4px' }} /> {s.destinations.join(', ')}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeSavedSearch(i); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0', display: 'flex', marginLeft: '4px' }} title={t("remove")}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
              {renderEndpoints(origins, setOrigins, t("origin"), mode === 'trains' ? t("origin_placeholder_train") : t("origin_placeholder_flight"), t("add_origin"))}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    setOrigins(destinations);
                    setDestinations(origins);
                  }}
                  style={{ padding: '10px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title={t("swap_btn")}
                >
                  <ArrowLeftRight size={18} />
                </button>
              </div>

              {renderEndpoints(destinations, setDestinations, t("destination"), mode === 'trains' ? t("dest_placeholder_train") : t("dest_placeholder_flight"), t("add_dest"))}
            </div>
          </div>
          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <label className="form-label" style={{ marginBottom: '8px' }}>{t("outbound_range")}</label>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                <Calendar size={18} style={{ position: 'absolute', left: '10px', color: 'var(--muted)', zIndex: 1 }} />
                <DatePicker
                  selectsRange={true}
                  monthsShown={MONTHS_SHOWN}
                  locale={language === 'it' ? 'it' : undefined}
                  startDate={depDateRange[0] || undefined}
                  endDate={depDateRange[1] || undefined}
                  onChange={(update: PickerValue) => {
                    setDepDateRange(depDatePristine && update[0] && update[1] ? [update[1], null] : update);
                    setDepDatePristine(false);
                  }}
                  dateFormat="dd/MM/yyyy"
                  placeholderText={t("outbound_placeholder")}
                  className="w-full pl-8"
                  isClearable={true}
                  customInput={<input style={{ paddingLeft: '36px' }} />}
                />
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => addRangeToPool(depDateRange, setDepDateRange, setDepRangePool)}
                  disabled={!depDateRange[0]}
                  style={{ padding: '10px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: depDateRange[0] ? 1 : 0.4 }}
                  title={t("add_range")}
                >
                  <CalendarPlus size={18} />
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', paddingLeft: '4px' }}>{t("start_end")}</div>
              {renderRangePool(depRangePool, setDepRangePool)}
            </div>
          </div>

          <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>{t("return_range")}</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={!oneWay}
                  onChange={e => setOneWay(!e.target.checked)}
                  style={{ width: 'auto', cursor: 'pointer' }}
                />
                {t("include_return")}
              </label>
            </div>
            <div style={{ opacity: oneWay ? 0.5 : 1, pointerEvents: oneWay ? 'none' : 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                <Calendar size={18} style={{ position: 'absolute', left: '10px', color: 'var(--muted)', zIndex: 1 }} />
                <DatePicker
                  selectsRange={true}
                  monthsShown={MONTHS_SHOWN}
                  locale={language === 'it' ? 'it' : undefined}
                  startDate={retDateRange[0] || undefined}
                  endDate={retDateRange[1] || undefined}
                  onChange={(update: PickerValue) => setRetDateRange(update)}
                  dateFormat="dd/MM/yyyy"
                  placeholderText={t("return_placeholder")}
                  className="w-full pl-8"
                  disabled={oneWay}
                  isClearable={true}
                  customInput={<input style={{ paddingLeft: '36px' }} />}
                />
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => addRangeToPool(retDateRange, setRetDateRange, setRetRangePool)}
                  disabled={!retDateRange[0]}
                  style={{ padding: '10px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: retDateRange[0] ? 1 : 0.4 }}
                  title={t("add_range")}
                >
                  <CalendarPlus size={18} />
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', paddingLeft: '4px' }}>{t("start_end")}</div>
              {renderRangePool(retRangePool, setRetRangePool)}
            </div>
          </div>
        </div>

        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
          <button type="button" className="btn-outline" onClick={handleSaveSearch} title={t("save_destinations")} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bookmark size={16} /> {t("save_btn")}
          </button>

          <button type="button" className="btn-outline" onClick={openOperatorSite} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {mode === 'trains' ? t("open_trenitalia") : t("open_google_flights")}
          </button>

          <button type="button" className="btn-outline" onClick={() => setIsHistoryOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px' }} title={t('history')}>
            <Clock size={18} />
          </button>

          <button type="submit" className="btn-primary" disabled={current.loading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title={`${t("search_solutions")} (Ctrl+Enter)`}>
            {current.loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {current.loading ? t("searching") : t("search_solutions")}
          </button>
          {current.loading && (
            <button
              type="button"
              onClick={handleStop}
              title={t("stop_search")}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', padding: '8px', color: 'var(--primary)' }}
            >
              <Square size={20} fill="currentColor" />
            </button>
          )}
        </div>
      </motion.form>

      {current.error && (
        <div role="alert" style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171' }}>
          {current.error}
        </div>
      )}

      {!current.loading && current.searched && !current.error && current.results.length === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', background: 'var(--card-bg)', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
          {t("no_solutions")}
        </div>
      )}

      <AnimatePresence>
        {current.results.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className={sortOrder === 'best' ? 'btn-primary' : 'btn-outline'}
                  onClick={() => setSortOrder('best')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '6px' }}
                  title={t("sort_best")}
                  aria-pressed={sortOrder === 'best'}
                >
                  <ArrowDownNarrowWide size={18} />
                </button>
                <button
                  type="button"
                  className={sortOrder === 'day' ? 'btn-primary' : 'btn-outline'}
                  onClick={() => setSortOrder('day')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '6px' }}
                  title={t("sort_day")}
                  aria-pressed={sortOrder === 'day'}
                >
                  <CalendarDays size={18} />
                </button>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <AnimatePresence>
                  {current.excluded.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      style={{ display: 'flex', gap: '4px' }}
                    >
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => patchMode(mode, { excluded: current.excluded.slice(0, -1) })}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '6px' }}
                        title={t("restore_last")}
                      >
                        <Undo2 size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => patchMode(mode, { excluded: [] })}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', borderRadius: '6px' }}
                        title={t("restore_all")}
                      >
                        <RotateCcw size={18} />
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{current.excluded.length}</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={handleCopyTable}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '6px' }}
                  title={t("copy_table")}
                >
                  <Copy size={18} />
                </button>
              </div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>{t("route")}</th>
                    <th>{t("departure")}</th>
                    <th>{t("arrival")}</th>
                    <th>{t("duration")}</th>
                    <th>{t("price")}</th>
                    <th>{t("adj_cost")}</th>
                    <th style={{ width: '48px' }} />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {pageRows.map(({ row: r, index }, i) => {
                      const train = !isFlightRow(r);
                      return (
                        <motion.tr
                          key={index}
                          className={sortOrder === 'day' && i > 0 && dayOf(r) !== dayOf(pageRows[i - 1].row) ? 'day-start' : undefined}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18 }}
                        >
                          <td>
                            {/*
                              A named target rather than _blank, so every click reuses one
                              operator tab instead of piling up a tab per solution: the tab
                              keeps whatever it holds in sessionStorage, including the state
                              LeFrecce parks under its own `session` key.
                              This is why there is no rel here. Per spec `noopener` forces a
                              fresh browsing context and drops the name, which would defeat
                              the reuse, and `noreferrer` implies `noopener`. The cost is that
                              the operator gets a window.opener handle on this tab; the only
                              two destinations are Trenitalia and Google.
                            */}
                            <a
                              href={r.booking_url}
                              target={train ? 'trenitalia' : 'googleflights'}
                              className="route-link"
                              title={train ? t("open_row_trenitalia") : t("open_row_flights")}
                            >
                              {routeOf(r)}
                            </a>
                            {isFlightRow(r) && r.in_dep && r.in_arr && (
                              <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '4px' }}>
                                {t("return_label")}: {r.destination} → {r.origin} · {formatDateTime(r.in_dep, false)} → {formatTime(r.in_arr)}
                              </div>
                            )}
                          </td>
                          <td>{formatDateTime(departureOf(r), train)}</td>
                          <td>{formatDateTime(isFlightRow(r) ? r.out_arr : r.arr, train)}</td>
                          <td>{formatDuration(durationOf(r))}</td>
                          <td style={{ fontWeight: 600 }}>{formatEuro(r.price_eur)}</td>
                          <td style={{ color: 'var(--accent)' }}>{formatEuro(r.adjusted_cost)}</td>
                          <td>
                            <button
                              type="button"
                              className="row-action"
                              onClick={() => patchMode(mode, { excluded: current.excluded.includes(index) ? current.excluded : [...current.excluded, index] })}
                              title={t("exclude_row")}
                            >
                              <X size={16} />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {current.results.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
          <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{sortOrder === 'day' ? t("results_per_day") : t("results_to_show")}</span>
          <select
            value={itemsPerPage}
            onChange={e => setResultCounts(prev => ({ ...prev, [resultCountKey]: Number(e.target.value) }))}
            style={{ width: '80px', padding: '6px 10px', background: 'var(--card-bg)' }}
          >
            {[3, 5, 10, 15, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        mode={mode}
        history={history[mode]}
        onSelect={(entry) => {
          setOrigins(entry.origin.split(', '));
          setDestinations(entry.destination.split(', '));
          // With a pool, the picker starts empty and the chips carry the dates;
          // older entries have no pool, so they fall back to their single span.
          const hasPool = (entry.depRanges?.length || 0) > 1 || (entry.retRanges?.length || 0) > 1;
          setDepRangePool(hasPool ? entry.depRanges || [] : []);
          setRetRangePool(hasPool ? entry.retRanges || [] : []);
          setDepDateRange(hasPool ? [null, null] : [entry.depStartStr ? parseDateKey(entry.depStartStr) : null, entry.depEndStr ? parseDateKey(entry.depEndStr) : null]);
          setRetDateRange(hasPool ? [null, null] : [entry.retStartStr ? parseDateKey(entry.retStartStr) : null, entry.retEndStr ? parseDateKey(entry.retEndStr) : null]);
          setOneWay(entry.oneWay);
          patchMode(mode, { results: entry.results, searched: true, error: null, excluded: [] });
        }}
      />
    </div>
  );
}
