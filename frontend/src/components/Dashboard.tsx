"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Train, Plane, Loader2, Calendar, ArrowLeftRight, Square, Copy, X, Plus, Bookmark, Clock, ArrowDownNarrowWide, CalendarDays, CalendarPlus, Undo2, RotateCcw } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { it } from 'date-fns/locale/it';
import AutocompleteInput from '@/components/AutocompleteInput';
import HistoryModal, { HistoryEntry } from '@/components/HistoryModal';
import {
  ApiError,
  fetchConfig,
  fetchDemoStatus,
  isResultRow,
  search,
  type AppConfig,
  type DateRange,
  type DemoStatus,
  type ResultRow,
} from '@/lib/api';
import {
  collectRanges,
  countDays,
  formatDateKey,
  formatRangeLabel,
  futureRanges,
  pickerFromRange,
  rangeFromPicker,
  type PickerValue,
} from '@/lib/dates';
import { localizeFlightPlace, useLanguage } from '@/lib/i18n';
import { useSettings, type Mode } from '@/lib/settings';
import { readJson, writeJson, writeNewest } from '@/lib/storage';

registerLocale('it', it);

// Months rendered in the date popup, which scrolls vertically (see globals.css).
const MONTHS_SHOWN = 12;
// Total days a search may cover, counted across every stretch in the pool.
// Mirrors MAX_SEARCH_DAYS in the backend, which rejects anything above it.
const MAX_RANGE_DAYS = 14;
// Origins x destinations x days, mirroring MAX_ROUTE_DAYS in the backend.
const MAX_ROUTE_DAYS = 30;
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

// The backend sends local times (trains with their offset, flights as airport
// time), so the date written in the string is the day the traveller sees.
const dayOf = (r: ResultRow) => r.dep.slice(0, 10);

// Duration breaks cost ties, mirroring the backend ranking, so 'best' reproduces
// the order the API already returned.
const compareRows = (a: ResultRow, b: ResultRow, order: SortOrder) => {
  if (order === 'day') {
    const byDay = dayOf(a).localeCompare(dayOf(b));
    if (byDay !== 0) return byDay;
  }
  return (a.adjusted_cost - b.adjusted_cost) || (a.duration_min - b.duration_min);
};

type StoredDashboard = {
  mode?: Mode;
  origins?: string[];
  destinations?: string[];
  resultCounts?: Record<string, unknown>;
  sortOrder?: SortOrder;
  byMode?: Record<Mode, Omit<ModeState, 'loading'>>;
  depRangePool?: DateRange[];
  depDateRange?: [string | null, string | null];
};

const toPicker = (stored?: [string | null, string | null]): PickerValue =>
  stored ? [stored[0] ? new Date(stored[0]) : null, stored[1] ? new Date(stored[1]) : null] : [null, null];

type DateSelection = { picker: PickerValue; pool: DateRange[]; pristine: boolean };

// The picker opens on today; the first range picked replaces it rather than extending it.
const FRESH_DATES = (): DateSelection => ({ picker: [new Date(), null], pool: [], pristine: true });

// Restored dates lose the days that have passed. With several stretches left
// they go to the pool and the picker starts empty; with none, it starts fresh.
const restoreDates = (restored: DateRange[]): DateSelection => {
  const ranges = futureRanges(restored);
  if (ranges.length === 0) return FRESH_DATES();
  if (ranges.length === 1) return { picker: pickerFromRange(ranges[0]), pool: [], pristine: false };
  return { picker: [null, null], pool: ranges, pristine: false };
};

// Results saved by an older version of the page may no longer fit the current
// row shape. Then the mode starts clean, as if nothing had been searched.
const restoreModeState = (saved?: Partial<ModeState>): ModeState => {
  const rows: unknown[] = Array.isArray(saved?.results) ? saved.results : [];
  if (!rows.every(isResultRow)) return EMPTY_MODE_STATE;
  const excluded = Array.isArray(saved?.excluded) ? saved.excluded : [];
  return { ...EMPTY_MODE_STATE, ...saved, results: rows, excluded, loading: false };
};

const loadHistory = (key: string): HistoryEntry[] => {
  const entries = readJson<unknown>('local', key, []);
  if (!Array.isArray(entries)) return [];
  return entries
    .map(entry => ({ ...entry, results: Array.isArray(entry?.results) ? entry.results.filter(isResultRow) : [] }))
    .filter((entry): entry is HistoryEntry => typeof entry.depStartStr === 'string' && entry.results.length > 0);
};

export default function Dashboard() {
  const { t, language } = useLanguage();
  const settings = useSettings();
  const [stored] = useState(() => readJson<StoredDashboard>('session', STATE_KEY, {}));
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
  const [initialDates] = useState(() =>
    stored.depDateRange || stored.depRangePool
      ? restoreDates(collectRanges(Array.isArray(stored.depRangePool) ? stored.depRangePool : [], toPicker(stored.depDateRange)))
      : FRESH_DATES()
  );
  const [depDateRange, setDepDateRange] = useState<PickerValue>(initialDates.picker);
  const [depDatePristine, setDepDatePristine] = useState(initialDates.pristine);
  const [depRangePool, setDepRangePool] = useState<DateRange[]>(initialDates.pool);
  const [resultCounts, setResultCounts] = useState<Record<ResultCountKey, number>>(() => ({
    ...DEFAULT_RESULT_COUNTS,
    // Only positive numbers survive, so a stale or hand-edited entry cannot leave a slot undefined.
    ...Object.fromEntries(Object.entries(stored.resultCounts ?? {}).filter(([, v]) => typeof v === 'number' && v > 0)),
  }));
  const [sortOrder, setSortOrder] = useState<SortOrder>(stored.sortOrder === 'day' ? 'day' : 'best');
  const [byMode, setByMode] = useState<Record<Mode, ModeState>>(() => ({
    trains: restoreModeState(stored.byMode?.trains),
    flights: restoreModeState(stored.byMode?.flights),
  }));
  const [savedSearches, setSavedSearches] = useState<Record<Mode, SavedSearch[]>>(() => ({
    trains: [],
    flights: [],
    ...readJson('local', SAVED_SEARCHES_KEY, {}),
  }));
  const [history, setHistory] = useState<Record<Mode, HistoryEntry[]>>(() => ({
    trains: loadHistory(HISTORY_KEYS.trains),
    flights: loadHistory(HISTORY_KEYS.flights),
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
    writeJson('local', SAVED_SEARCHES_KEY, savedSearches);
  }, [savedSearches]);

  // Every search keeps its full results, so a few big ones fill the storage
  // quota: the oldest entries are the ones left out.
  useEffect(() => {
    writeNewest('local', HISTORY_KEYS.trains, history.trains);
  }, [history.trains]);
  useEffect(() => {
    writeNewest('local', HISTORY_KEYS.flights, history.flights);
  }, [history.flights]);

  useEffect(() => {
    const persisted: StoredDashboard = {
      mode, origins, destinations, resultCounts, sortOrder,
      byMode: {
        trains: { ...byMode.trains },
        flights: { ...byMode.flights },
      },
      depRangePool,
      depDateRange: [depDateRange[0]?.toISOString() ?? null, depDateRange[1]?.toISOString() ?? null],
    };
    // Results are nearly all of it: without room for them, the form still survives a reload.
    if (!writeJson('session', STATE_KEY, persisted)) {
      writeJson('session', STATE_KEY, { ...persisted, byMode: undefined });
    }
  }, [mode, origins, destinations, resultCounts, sortOrder, byMode, depRangePool, depDateRange]);

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

  const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

  const formatEuro = (amount: number) =>
    `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  const routeOf = (r: ResultRow) => `${r.origin} → ${r.destination}`;

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
    const train = mode === 'trains';
    pageRows.forEach(({ row: r }) => {
      text += `| ${routeOf(r)} | ${formatDateTime(r.dep, train)} | ${formatDateTime(r.arr, train)} | ${formatDuration(r.duration_min)} | ${formatEuro(r.price_eur)} | ${formatEuro(r.adjusted_cost)} |\n`;
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
    const cleanOrigins = origins.map(o => o.trim()).filter(Boolean);
    const cleanDestinations = destinations.map(d => d.trim()).filter(Boolean);
    const days = countDays(depRanges);
    const routeDays = cleanOrigins.length * cleanDestinations.length * days;

    const invalid =
      depRanges.length === 0 ? t('err_no_dates')
      // A page left open overnight still holds yesterday's selection.
      : depRanges[0].start < formatDateKey(new Date()) ? t('err_past_dates')
      : days > MAX_RANGE_DAYS ? t('err_max_range', { days: MAX_RANGE_DAYS })
      : routeDays > MAX_ROUTE_DAYS ? t('err_too_many_route_days', { route_days: routeDays, max: MAX_ROUTE_DAYS })
      : null;
    if (invalid) {
      patchMode(searchMode, { error: invalid, searched: false, results: [] });
      return;
    }

    controllers.current[searchMode]?.abort();
    const controller = new AbortController();
    controllers.current[searchMode] = controller;
    patchMode(searchMode, { loading: true, searched: false, error: null, results: [], excluded: [] });

    try {
      const res = await search(searchMode, {
        origins: cleanOrigins,
        destinations: cleanDestinations,
        dep_ranges: depRanges,
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
          depRanges,
          results: res.data,
        };
        setHistory(prev => ({ ...prev, [searchMode]: [entry, ...prev[searchMode]].slice(0, HISTORY_SIZE) }));
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
    // A city mapped to several airports stays a name: the text query reads
    // "Rome" reliably, a list like "FCO,CIA" not necessarily.
    const toCode = (name: string) => {
      const lowered = name.toLowerCase();
      const hit = Object.entries(mapping).find(([key]) => lowered.includes(key.toLowerCase()));
      return hit && /^[A-Z]{3}$/.test(hit[1]) ? hit[1] : name;
    };
    const dep = depDateRange[0] ? formatDateKey(depDateRange[0]) : '';
    const query = `Flights to ${toCode(destinations[0] || '')} from ${toCode(origins[0] || '')} on ${dep} one-way`;
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
      <div className="range-pool">
        {pool.map(r => (
          <div key={`${r.start}_${r.end}`} className="chip">
            <span>{formatRangeLabel(r)}</span>
            <button
              type="button"
              className="chip-remove"
              onClick={() => setPool(prev => prev.filter(x => !(x.start === r.start && x.end === r.end)))}
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
    <div className="endpoint-list">
      {values.map((value, idx) => (
        <div key={idx} className="endpoint-row">
          <div className="endpoint-field">
            <AutocompleteInput
              label={idx === 0 ? label : `${label} ${idx + 1}`}
              value={value}
              onChange={val => setValues(values.map((v, i) => (i === idx ? val : v)))}
              options={options}
              placeholder={placeholder}
            />
          </div>
          {values.length > 1 && (
            <button type="button" className="btn-outline field-btn" onClick={() => setValues(values.filter((_, i) => i !== idx))} title={t("remove")}>
              <X size={18} />
            </button>
          )}
        </div>
      ))}
      {values.length < MAX_ENDPOINTS && (
        <button type="button" className="btn-outline add-endpoint" onClick={() => setValues([...values, ''])}>
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
    <div className="dashboard">

      <div className="mode-toggle">
        {(['trains', 'flights'] as const).map(m => (
          <button
            key={m}
            type="button"
            className={`${mode === m ? 'btn-primary' : 'btn-outline'} with-icon mode-btn`}
            title={`${t(`${m}_btn`)} (Alt+${m === 'trains' ? 1 : 2})`}
            onClick={() => switchMode(m)}
          >
            {m === 'trains' ? <Train size={18} /> : <Plane size={18} />} {t(`${m}_btn`)}
          </button>
        ))}
      </div>

      {reminders.length > 0 && (
        <div className="reminders">
          {reminders.map((r, i) => (
            <div key={i} className="reminder">
              <span className="reminder-icon">💡</span>
              {r.text}
            </div>
          ))}
        </div>
      )}

      {demoNotice && <div className="notice">{demoNotice}</div>}

      <motion.form
        ref={formRef}
        onSubmit={handleSearch}
        className="glass-panel search-form"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="form-grid">
          {savedSearches[mode].length > 0 && (
            <div className="saved-searches">
              {savedSearches[mode].map((s, i) => (
                <div
                  key={i}
                  className="chip saved-chip"
                  onClick={() => { setOrigins(s.origins); setDestinations(s.destinations); }}
                >
                  <span>{s.origins.join(', ')} <ArrowLeftRight size={12} className="chip-arrow" /> {s.destinations.join(', ')}</span>
                  <button type="button" className="chip-remove" onClick={(e) => { e.stopPropagation(); removeSavedSearch(i); }} title={t("remove")}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="endpoints">
            {renderEndpoints(origins, setOrigins, t("origin"), mode === 'trains' ? t("origin_placeholder_train") : t("origin_placeholder_flight"), t("add_origin"))}

            <div className="swap">
              <button
                type="button"
                className="btn-outline field-btn"
                onClick={() => {
                  setOrigins(destinations);
                  setDestinations(origins);
                }}
                title={t("swap_btn")}
              >
                <ArrowLeftRight size={18} />
              </button>
            </div>

            {renderEndpoints(destinations, setDestinations, t("destination"), mode === 'trains' ? t("dest_placeholder_train") : t("dest_placeholder_flight"), t("add_dest"))}
          </div>
          <div className="form-group date-field">
            <label className="form-label">{t("dates_label")}</label>
            <div>
              <div className="date-picker-row">
                <Calendar size={18} className="date-picker-icon" />
                <DatePicker
                  selectsRange={true}
                  monthsShown={MONTHS_SHOWN}
                  locale={language === 'it' ? 'it' : undefined}
                  minDate={new Date()}
                  startDate={depDateRange[0] || undefined}
                  endDate={depDateRange[1] || undefined}
                  onChange={(update: PickerValue) => {
                    setDepDateRange(depDatePristine && update[0] && update[1] ? [update[1], null] : update);
                    setDepDatePristine(false);
                  }}
                  dateFormat="dd/MM/yyyy"
                  placeholderText={t("dates_placeholder")}
                  className="date-input"
                  isClearable={true}
                />
                <button
                  type="button"
                  className="btn-outline field-btn"
                  onClick={() => addRangeToPool(depDateRange, setDepDateRange, setDepRangePool)}
                  disabled={!depDateRange[0]}
                  title={t("add_range")}
                >
                  <CalendarPlus size={18} />
                </button>
              </div>
              <div className="hint">{t("start_end")}</div>
              {renderRangePool(depRangePool, setDepRangePool)}
            </div>
          </div>

        </div>

        <div className="form-actions">
          <button type="button" className="btn-outline with-icon" onClick={handleSaveSearch} title={t("save_destinations")}>
            <Bookmark size={16} /> {t("save_btn")}
          </button>

          <button type="button" className="btn-outline with-icon" onClick={openOperatorSite}>
            {mode === 'trains' ? t("open_trenitalia") : t("open_google_flights")}
          </button>

          <button type="button" className="btn-outline icon-btn" onClick={() => setIsHistoryOpen(true)} title={t('history')}>
            <Clock size={18} />
          </button>

          <button type="submit" className="btn-primary with-icon" disabled={current.loading} title={`${t("search_solutions")} (Ctrl+Enter)`}>
            {current.loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {current.loading ? t("searching") : t("search_solutions")}
          </button>
          {current.loading && (
            <button type="button" className="stop-btn" onClick={handleStop} title={t("stop_search")}>
              <Square size={20} fill="currentColor" />
            </button>
          )}
        </div>
      </motion.form>

      {current.error && (
        <div role="alert" className="search-error">
          {current.error}
        </div>
      )}

      {!current.loading && current.searched && !current.error && current.results.length === 0 && (
        <div className="no-results">
          {t("no_solutions")}
        </div>
      )}

      <AnimatePresence>
        {current.results.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="toolbar">
              <div className="toolbar-group">
                <button
                  type="button"
                  className={`${sortOrder === 'best' ? 'btn-primary' : 'btn-outline'} tool-btn`}
                  onClick={() => setSortOrder('best')}
                  title={t("sort_best")}
                  aria-pressed={sortOrder === 'best'}
                >
                  <ArrowDownNarrowWide size={18} />
                </button>
                <button
                  type="button"
                  className={`${sortOrder === 'day' ? 'btn-primary' : 'btn-outline'} tool-btn`}
                  onClick={() => setSortOrder('day')}
                  title={t("sort_day")}
                  aria-pressed={sortOrder === 'day'}
                >
                  <CalendarDays size={18} />
                </button>
              </div>
              <div className="toolbar-group">
                <AnimatePresence>
                  {current.excluded.length > 0 && (
                    <motion.div
                      className="toolbar-group"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                    >
                      <button
                        type="button"
                        className="btn-outline tool-btn"
                        onClick={() => patchMode(mode, { excluded: current.excluded.slice(0, -1) })}
                        title={t("restore_last")}
                      >
                        <Undo2 size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn-outline tool-btn"
                        onClick={() => patchMode(mode, { excluded: [] })}
                        title={t("restore_all")}
                      >
                        <RotateCcw size={18} />
                        <span className="tool-count">{current.excluded.length}</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  type="button"
                  className="btn-outline tool-btn"
                  onClick={handleCopyTable}
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
                    <th className="row-action-col" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {pageRows.map(({ row: r, index }, i) => {
                      const train = mode === 'trains';
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
                          </td>
                          <td>{formatDateTime(r.dep, train)}</td>
                          <td>{formatDateTime(r.arr, train)}</td>
                          <td>{formatDuration(r.duration_min)}</td>
                          <td className="price">{formatEuro(r.price_eur)}</td>
                          <td className="adjusted-cost">{formatEuro(r.adjusted_cost)}</td>
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
        <div className="result-count">
          <span>{sortOrder === 'day' ? t("results_per_day") : t("results_to_show")}</span>
          <select
            value={itemsPerPage}
            onChange={e => setResultCounts(prev => ({ ...prev, [resultCountKey]: Number(e.target.value) }))}
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
          // Older entries have no pool, so they fall back to their single span.
          const dates = restoreDates(entry.depRanges ?? [{ start: entry.depStartStr, end: entry.depEndStr ?? entry.depStartStr }]);
          setDepRangePool(dates.pool);
          setDepDateRange(dates.picker);
          setDepDatePristine(dates.pristine);
          patchMode(mode, { results: entry.results, searched: true, error: null, excluded: [] });
        }}
      />
    </div>
  );
}
