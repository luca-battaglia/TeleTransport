"use client";

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchTrains, fetchFlights, fetchConfig } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import { Search, Train, Plane, Loader2, Calendar, ArrowLeftRight, Square, Copy, X, Plus, Bookmark, Clock, ArrowDownNarrowWide, CalendarDays, CalendarPlus, Undo2, RotateCcw } from 'lucide-react';
import AutocompleteInput from '@/components/AutocompleteInput';
import HistoryModal, { HistoryEntry } from '@/components/HistoryModal';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { it } from 'date-fns/locale/it';
import { addDays } from 'date-fns';

registerLocale('it', it);

// Months rendered in the date popup, which scrolls vertically (see globals.css).
const MONTHS_SHOWN = 12;
// Total days a search may cover, counted across every stretch in the pool.
// Mirrors MAX_SEARCH_DAYS in the backend, which rejects anything above it.
const MAX_RANGE_DAYS = 14;

type SortOrder = 'best' | 'day';

// How many results to show is remembered per mode and per view, because the
// number means different things: a whole-table total when ranked by best, a
// per-day count when grouped by day.
type ResultCountKey = `${'trains' | 'flights'}-${SortOrder}`;

const DEFAULT_RESULT_COUNTS: Record<ResultCountKey, number> = {
  'trains-best': 10,
  'trains-day': 3,
  'flights-best': 10,
  'flights-day': 3,
};

// One stretch of days in a search pool, as yyyy-mm-dd so it survives a JSON
// round-trip through sessionStorage unchanged.
type DateRange = { start: string; end: string };

const formatDateKey = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseDateKey = (key: string) => new Date(`${key}T00:00:00`);

const rangeFromPicker = (picker: [Date | null, Date | null]): DateRange | null => {
  const [start, end] = picker;
  if (!start) return null;
  return { start: formatDateKey(start), end: formatDateKey(end || start) };
};

// What the search actually covers: the saved stretches plus whatever the picker
// currently holds, so ignoring the pool leaves the original single-range flow intact.
const collectRanges = (pool: DateRange[], picker: [Date | null, Date | null]): DateRange[] => {
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

// The fields the two backends have in common: trains send dep/arr/duration_min,
// flights send out_dep/out_arr/total_duration_min.
type SolutionRow = {
  dep?: string;
  arr?: string;
  out_dep?: string;
  out_arr?: string;
  duration_min?: number;
  total_duration_min?: number;
  adjusted_cost?: number;
};

const departureOf = (r: SolutionRow) => new Date(r.out_dep || r.dep || '');
const durationOf = (r: SolutionRow) => r.duration_min ?? r.total_duration_min ?? 0;

// Local midnight of the departure, so groups match the date printed in the row.
const dayStartOf = (r: SolutionRow) => {
  const d = departureOf(r);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// Duration breaks cost ties, mirroring the backend ranking, so 'best' reproduces
// the order the API already returned.
const compareRows = (a: SolutionRow, b: SolutionRow, order: SortOrder) => {
  if (order === 'day') {
    const byDay = dayStartOf(a) - dayStartOf(b);
    if (byDay !== 0) return byDay;
  }
  return ((a.adjusted_cost || 0) - (b.adjusted_cost || 0)) || (durationOf(a) - durationOf(b));
};

export default function Dashboard() {
  const { t, language } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<'trains' | 'flights'>('trains');
  
  const [appConfig, setAppConfig] = useState<any>(null);
  const appConfigRef = useRef<any>(null);
  const [origins, setOrigins] = useState<string[]>(['']);
  const [destinations, setDestinations] = useState<string[]>(['']);
  const [depDateRange, setDepDateRange] = useState<[Date | null, Date | null]>([new Date(), null]);
  const [depDatePristine, setDepDatePristine] = useState(true);
  const [retDateRange, setRetDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [depRangePool, setDepRangePool] = useState<DateRange[]>([]);
  const [retRangePool, setRetRangePool] = useState<DateRange[]>([]);
  const [resultCounts, setResultCounts] = useState<Record<ResultCountKey, number>>(DEFAULT_RESULT_COUNTS);
  const [oneWay, setOneWay] = useState(true);
  const [savedSearches, setSavedSearches] = useState<{trains: {origins: string[], destinations: string[]}[], flights: {origins: string[], destinations: string[]}[]}>({ trains: [], flights: [] });
  
  const [trainLoading, setTrainLoading] = useState(false);
  const [flightLoading, setFlightLoading] = useState(false);
  const [trainSearched, setTrainSearched] = useState(false);
  const [flightSearched, setFlightSearched] = useState(false);
  const [trainResults, setTrainResults] = useState<any[]>([]);
  const [flightResults, setFlightResults] = useState<any[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [flightError, setFlightError] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('best');
  // Positions in the unsorted result arrays, newest exclusion last so undo can pop it.
  const [trainExcluded, setTrainExcluded] = useState<number[]>([]);
  const [flightExcluded, setFlightExcluded] = useState<number[]>([]);
  const [reminders, setReminders] = useState<{key: string, text: string, target?: string}[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const trainAbortControllerRef = useRef<AbortController | null>(null);
  const flightAbortControllerRef = useRef<AbortController | null>(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [trainHistory, setTrainHistory] = useState<HistoryEntry[]>([]);
  const [flightHistory, setFlightHistory] = useState<HistoryEntry[]>([]);

  const results = mode === 'trains' ? trainResults : flightResults;
  const excluded = mode === 'trains' ? trainExcluded : flightExcluded;
  const setExcluded = mode === 'trains' ? setTrainExcluded : setFlightExcluded;

  const resultCountKey: ResultCountKey = `${mode}-${sortOrder}`;
  const itemsPerPage = resultCounts[resultCountKey];

  const visibleRows = useMemo(() => {
    const hidden = new Set(excluded);
    return results
      .map((row, index) => ({ row, index }))
      .filter(entry => !hidden.has(entry.index))
      .sort((a, b) => compareRows(a.row, b.row, sortOrder));
  }, [results, excluded, sortOrder]);

  // The cut happens after filtering, so excluding a row pulls the next one into
  // view. Grouped by day the count applies per day rather than to the whole table.
  const pageRows = useMemo(() => {
    if (sortOrder === 'best') return visibleRows.slice(0, itemsPerPage);
    const takenPerDay = new Map<number, number>();
    return visibleRows.filter(({ row }) => {
      const day = dayStartOf(row);
      const taken = takenPerDay.get(day) ?? 0;
      if (taken >= itemsPerPage) return false;
      takenPerDay.set(day, taken + 1);
      return true;
    });
  }, [visibleRows, itemsPerPage, sortOrder]);

  const addRangeToPool = (
    picker: [Date | null, Date | null],
    setPicker: (value: [Date | null, Date | null]) => void,
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

  const renderRangePool = (
    pool: DateRange[],
    setPool: React.Dispatch<React.SetStateAction<DateRange[]>>
  ) => {
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        if (formRef.current) formRef.current.requestSubmit();
      }
      if (e.altKey && e.key === '1') {
        setMode('trains');
        const cfg = appConfigRef.current?.treni || {};
        setOrigins([cfg.default_origin || 'Zurigo HB']);
        setDestinations([cfg.default_destination || 'Alessandria']);
      }
      if (e.altKey && e.key === '2') {
        setMode('flights');
        const cfg = appConfigRef.current?.voli || {};
        setOrigins([cfg.default_origin || 'Zurigo']);
        setDestinations([cfg.default_destination || 'Bari']);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

    const handleCopyTable = () => {
    if (pageRows.length === 0) return;

    let text = "| Route | Departure | Arrival | Duration | Price | Adj Cost |\n";
    text += "|---|---|---|---|---|---|\n";
    pageRows.forEach(({ row: r }) => {
      const route = r.route || `${r.origin} -> ${r.destination}`;
      const depTime = r.out_dep || r.dep;
      const arrTime = r.out_arr || r.arr;
      const dep = depTime ? new Date(depTime).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      const arr = arrTime ? new Date(arrTime).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'N/A';
      const durMin = r.duration_min || r.total_duration_min || 0;
      const dur = `${Math.floor(durMin / 60)}h ${durMin % 60}m`;
      const price = `${r.price_eur || 0} €`;
      const adj = `${r.adjusted_cost || 0} €`;
      text += `| ${route} | ${dep} | ${arr} | ${dur} | ${price} | ${adj} |\n`;
    });
    
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(err => console.error("Clipboard error", err));
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback copy failed', err);
      }
      document.body.removeChild(textArea);
    }
  };

  const handleStop = () => {
    if (mode === 'trains') {
      if (trainAbortControllerRef.current) trainAbortControllerRef.current.abort();
      setTrainLoading(false);
    } else {
      if (flightAbortControllerRef.current) flightAbortControllerRef.current.abort();
      setFlightLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const controller = new AbortController();
    if (mode === 'trains') {
      if (trainAbortControllerRef.current) trainAbortControllerRef.current.abort();
      trainAbortControllerRef.current = controller;
      setTrainLoading(true);
    } else {
      if (flightAbortControllerRef.current) flightAbortControllerRef.current.abort();
      flightAbortControllerRef.current = controller;
      setFlightLoading(true);
    }
    if (mode === 'trains') {
      setTrainSearched(false);
      setTrainError(null);
      setTrainResults([]);
      setTrainExcluded([]);
    } else {
      setFlightSearched(false);
      setFlightError(null);
      setFlightResults([]);
      setFlightExcluded([]);
    }

    const depRanges = collectRanges(depRangePool, depDateRange);
    const retRanges = oneWay ? [] : collectRanges(retRangePool, retDateRange);

    const depStartStr = depRanges[0]?.start || '';
    const depEndStr = depRanges[depRanges.length - 1]?.end || '';
    const retStartStr = retRanges[0]?.start || '';
    const retEndStr = retRanges[retRanges.length - 1]?.end || '';

    if (depRanges.length === 0) {
      if (mode === 'trains') setTrainError(t("err_outbound")); else setFlightError(t("err_outbound"));
      mode === 'trains' ? setTrainLoading(false) : setFlightLoading(false);
      return;
    }

    if (!oneWay && retRanges.length === 0) {
      if (mode === 'trains') setTrainError(t("err_return")); else setFlightError(t("err_return"));
      mode === 'trains' ? setTrainLoading(false) : setFlightLoading(false);
      return;
    }

    const rangeError = t("err_max_range").replace('{days}', String(MAX_RANGE_DAYS));

    if (countDays(depRanges) > MAX_RANGE_DAYS || countDays(retRanges) > MAX_RANGE_DAYS) {
      if (mode === 'trains') setTrainError(rangeError); else setFlightError(rangeError);
      mode === 'trains' ? setTrainLoading(false) : setFlightLoading(false);
      return;
    }

    if (mode === 'flights') {
      try {
        const localData = localStorage.getItem('teletransport_settings');
        const parsedLocal = localData ? JSON.parse(localData) : {};
        if (!parsedLocal.serpapiKey) {
          setFlightError(t("err_api_key"));
          setFlightLoading(false);
          return;
        }
      } catch (e) {}
    }

    try {
      const payload = {
        origins: origins.filter(Boolean),
        destinations: destinations.filter(Boolean),
        dep_ranges: depRanges,
        ret_ranges: retRanges.length > 0 ? retRanges : undefined,
        // The span enclosing the pool, for a backend still on the single-range
        // payload: it searches a superset rather than failing.
        dep_start: depStartStr,
        dep_end: depEndStr || depStartStr,
        ret_start: retStartStr || undefined,
        ret_end: (retEndStr || retStartStr) || undefined,
        one_way: oneWay,
        lang: language
      };

      const res = mode === 'trains' 
        ? await fetchTrains(payload, controller.signal) 
        : await fetchFlights(payload, controller.signal);
        
      if (mode === 'trains') {
        setTrainResults(res.data || []);
        setTrainSearched(true);
        if (res.data && res.data.length > 0) {
          const entry: HistoryEntry = {
            timestamp: Date.now(), origin: origins[0], destination: destinations[0],
            depStartStr, depEndStr, retStartStr, retEndStr,
            depRanges, retRanges, oneWay, results: res.data
          };
          setTrainHistory(prev => {
            const next = [entry, ...prev].slice(0, 10);
            localStorage.setItem('teletransport_train_history', JSON.stringify(next));
            return next;
          });
        }
      } else {
        setFlightResults(res.data || []);
        setFlightSearched(true);
        if (res.data && res.data.length > 0) {
          const entry: HistoryEntry = {
            timestamp: Date.now(), origin: origins[0], destination: destinations[0],
            depStartStr, depEndStr, retStartStr, retEndStr,
            depRanges, retRanges, oneWay, results: res.data
          };
          setFlightHistory(prev => {
            const next = [entry, ...prev].slice(0, 10);
            localStorage.setItem('teletransport_flight_history', JSON.stringify(next));
            return next;
          });
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (mode === 'trains') {
        setTrainError(err.message || t("err_generic"));
        setTrainSearched(true);
      } else {
        setFlightError(err.message || t("err_generic"));
        setFlightSearched(true);
      }
    } finally {
      if (mode === 'trains' && trainAbortControllerRef.current === controller) {
        setTrainLoading(false);
      } else if (mode === 'flights' && flightAbortControllerRef.current === controller) {
        setFlightLoading(false);
      }
    }
  };

  useEffect(() => {
    try {
      const settings = localStorage.getItem('teletransport_settings');
      if (settings) {
        const parsed = JSON.parse(settings);
        if (parsed.reminders) {
           setReminders(Object.entries(parsed.reminders).map(([k, v]: [string, any]) => {
             if (typeof v === 'string') return { key: k, text: v, target: 'voli' };
             return { key: k, text: String(v.text || ''), target: v.target || 'voli' };
           }));
        }
      }
    } catch (e) {}

    try {
      const localSaved = localStorage.getItem('teletransport_saved_searches');
      if (localSaved) {
        setSavedSearches(JSON.parse(localSaved));
      }
      const savedTrain = localStorage.getItem('teletransport_train_history');
      if (savedTrain) setTrainHistory(JSON.parse(savedTrain));
      const savedFlight = localStorage.getItem('teletransport_flight_history');
      if (savedFlight) setFlightHistory(JSON.parse(savedFlight));
    } catch (e) {}

    try {
      const state = sessionStorage.getItem('dashboard_state');
      if (state) {
        const parsed = JSON.parse(state);
        if (parsed.mode) setMode(parsed.mode);
        if (parsed.origins) setOrigins(parsed.origins);
        if (parsed.destinations) setDestinations(parsed.destinations);
        // Merged over the defaults so a key added later still has a value.
        if (parsed.resultCounts) {
          const restored = Object.fromEntries(
            Object.entries(parsed.resultCounts).filter(([, v]) => typeof v === 'number' && v > 0)
          );
          setResultCounts(prev => ({ ...prev, ...restored }));
        }
        if (parsed.oneWay !== undefined) setOneWay(parsed.oneWay);
        if (parsed.trainSearched !== undefined) setTrainSearched(parsed.trainSearched);
        if (parsed.flightSearched !== undefined) setFlightSearched(parsed.flightSearched);
        if (parsed.trainResults) setTrainResults(parsed.trainResults);
        if (parsed.flightResults) setFlightResults(parsed.flightResults);
        if (parsed.trainError !== undefined) setTrainError(parsed.trainError);
        if (parsed.flightError !== undefined) setFlightError(parsed.flightError);
        if (parsed.sortOrder === 'best' || parsed.sortOrder === 'day') setSortOrder(parsed.sortOrder);
        if (parsed.trainExcluded) setTrainExcluded(parsed.trainExcluded);
        if (parsed.flightExcluded) setFlightExcluded(parsed.flightExcluded);
        if (parsed.depRangePool) setDepRangePool(parsed.depRangePool);
        if (parsed.retRangePool) setRetRangePool(parsed.retRangePool);

        if (parsed.depDateRange) {
          setDepDateRange([
            parsed.depDateRange[0] ? new Date(parsed.depDateRange[0]) : null,
            parsed.depDateRange[1] ? new Date(parsed.depDateRange[1]) : null
          ]);
          setDepDatePristine(false);
        }
        if (parsed.retDateRange) {
          setRetDateRange([
            parsed.retDateRange[0] ? new Date(parsed.retDateRange[0]) : null,
            parsed.retDateRange[1] ? new Date(parsed.retDateRange[1]) : null
          ]);
        }
      }
    } catch (e) {}

    fetchConfig().then(baseCfg => {
      let cfg = baseCfg || {};
      try {
        const localData = localStorage.getItem('teletransport_settings');
        if (localData) {
          const parsedLocal = JSON.parse(localData);
          if (parsedLocal.ui) {
            cfg = {
              ...cfg,
              treni: { ...(cfg.treni || {}), ...parsedLocal.ui.treni },
              voli: { ...(cfg.voli || {}), ...parsedLocal.ui.voli }
            };
          }
        }
      } catch (e) {}

      if (Object.keys(cfg).length > 0) {
        setAppConfig(cfg);
        appConfigRef.current = cfg;
        const state = sessionStorage.getItem('dashboard_state');
        if (!state) {
          setOrigins([cfg.treni?.default_origin || 'Zurigo HB']);
          setDestinations([cfg.treni?.default_destination || 'Alessandria']);
        }
      } else {
        const state = sessionStorage.getItem('dashboard_state');
        if (!state) {
          setOrigins(['Zurigo HB']);
          setDestinations(['Alessandria']);
        }
      }
      setMounted(true);
    });
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem('teletransport_saved_searches', JSON.stringify(savedSearches));
  }, [savedSearches, mounted]);

  const handleSaveSearch = () => {
    const current = savedSearches[mode] || [];
    const cleanOrigins = origins.filter(o => o.trim());
    const cleanDestinations = destinations.filter(d => d.trim());
    if (cleanOrigins.length === 0 || cleanDestinations.length === 0) return;

    const isDuplicate = current.some(s => 
      JSON.stringify(s.origins) === JSON.stringify(cleanOrigins) && 
      JSON.stringify(s.destinations) === JSON.stringify(cleanDestinations)
    );

    if (isDuplicate) return;

    const newSaved = [...current, { origins: cleanOrigins, destinations: cleanDestinations }];
    if (newSaved.length > 10) newSaved.shift();

    setSavedSearches(prev => ({ ...prev, [mode]: newSaved }));
  };

  const removeSavedSearch = (idx: number) => {
    setSavedSearches(prev => {
      const newMode = [...prev[mode]];
      newMode.splice(idx, 1);
      return { ...prev, [mode]: newMode };
    });
  };

  useEffect(() => {
    if (!mounted) return;
    const stateToSave = {
      mode, origins, destinations, resultCounts, oneWay,
      trainSearched, flightSearched,
      trainResults, flightResults,
      trainError, flightError,
      sortOrder, trainExcluded, flightExcluded,
      depRangePool, retRangePool,
      depDateRange: [
        depDateRange[0] ? depDateRange[0].toISOString() : null,
        depDateRange[1] ? depDateRange[1].toISOString() : null
      ],
      retDateRange: [
        retDateRange[0] ? retDateRange[0].toISOString() : null,
        retDateRange[1] ? retDateRange[1].toISOString() : null
      ]
    };
    sessionStorage.setItem('dashboard_state', JSON.stringify(stateToSave));
  }, [mounted, mode, origins, destinations, resultCounts, oneWay, trainSearched, flightSearched, trainResults, flightResults, trainError, flightError, sortOrder, trainExcluded, flightExcluded, depRangePool, retRangePool, depDateRange, retDateRange]);

  if (!mounted) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '64px' }}><Loader2 className="animate-spin" size={32} /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* Type Toggle */}
      <div className="flex justify-center" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'inline-flex', gap: '12px' }}>
          <button 
            type="button"
            className={mode === 'trains' ? 'btn-primary' : 'btn-outline'} 
            title={`${t("trains_btn")} (Alt+1)`}
            onClick={() => { 
              setMode('trains'); 
              const cfg = appConfig?.treni || {};
              setOrigins([cfg.default_origin || 'Zurigo HB']); 
              setDestinations([cfg.default_destination || 'Alessandria']); 
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', border: mode === 'trains' ? 'none' : '1px solid var(--card-border)', padding: '10px 24px' }}
          >
            <Train size={18} /> {t("trains_btn")}
          </button>
          <button 
            type="button"
            className={mode === 'flights' ? 'btn-primary' : 'btn-outline'} 
            title={`${t("flights_btn")} (Alt+2)`}
            onClick={() => { 
              setMode('flights'); 
              const cfg = appConfig?.voli || {};
              setOrigins([cfg.default_origin || 'Zurigo']); 
              setDestinations([cfg.default_destination || 'Bari']); 
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', border: mode === 'flights' ? 'none' : '1px solid var(--card-border)', padding: '10px 24px' }}
          >
            <Plane size={18} /> {t("flights_btn")}
          </button>
        </div>
      </div>

      {(() => {
        const activeReminders = reminders.filter(r => 
          r.target === 'both' || 
          (mode === 'flights' && r.target === 'voli') || 
          (mode === 'trains' && r.target === 'treni')
        );
        if (activeReminders.length === 0) return null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activeReminders.map((r, i) => (
              <div key={i} style={{ padding: '12px 16px', background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '8px', color: '#ca8a04', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>💡</span>
                {r.text}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Search Form */}
      <motion.form 
        ref={formRef}
        onSubmit={handleSearch} 
        className="glass-panel" 
        style={{ padding: '32px' }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="form-grid">
          {savedSearches[mode] && savedSearches[mode].length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', gridColumn: '1 / -1' }}>
              {savedSearches[mode].map((s, i) => (
                <div 
                  key={i} 
                  onClick={() => { setOrigins(s.origins); setDestinations(s.destinations); }} 
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', background: 'var(--card-bg)', border: '1px solid var(--card-border)', padding: '6px 12px', borderRadius: '16px', fontSize: '13px', transition: 'all 0.2s' }}
                >
                  <span>{s.origins.join(', ')} <ArrowLeftRight size={12} style={{display: 'inline', margin: '0 4px'}} /> {s.destinations.join(', ')}</span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeSavedSearch(i); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '0', display: 'flex', marginLeft: '4px' }} title={t("remove")}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {origins.map((orig, idx) => (
                  <div key={`orig-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <AutocompleteInput 
                        label={idx === 0 ? t("origin") : `${t("origin")} ${idx + 1}`}
                        value={orig}
                        onChange={(val) => {
                          const newOrigins = [...origins];
                          newOrigins[idx] = val;
                          setOrigins(newOrigins);
                        }}
                        options={t(mode === 'trains' ? 'options_trains' : 'options_flights').split(',')}
                        placeholder={mode === 'trains' ? t("origin_placeholder_train") : t("origin_placeholder_flight")}
                      />
                    </div>
                    {origins.length > 1 && (
                      <button type="button" className="btn-outline" onClick={() => setOrigins(origins.filter((_, i) => i !== idx))} style={{ padding: '10px', height: '42px', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t("remove")}>
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
                {origins.length < 5 && (
                  <button type="button" className="btn-outline" onClick={() => setOrigins([...origins, ''])} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={14} /> {t("add_origin")}
                  </button>
                )}
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0' }}>
                <button 
                  type="button" 
                  className="btn-outline"
                  onClick={() => {
                    const temp = [...origins];
                    setOrigins(destinations);
                    setDestinations(temp);
                  }}
                  style={{ padding: '10px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title={t("swap_btn")}
                >
                  <ArrowLeftRight size={18} />
                </button>
              </div>

              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {destinations.map((dest, idx) => (
                  <div key={`dest-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <AutocompleteInput 
                        label={idx === 0 ? t("destination") : `${t("destination")} ${idx + 1}`}
                        value={dest}
                        onChange={(val) => {
                          const newDests = [...destinations];
                          newDests[idx] = val;
                          setDestinations(newDests);
                        }}
                        options={t(mode === 'trains' ? 'options_trains' : 'options_flights').split(',')}
                        placeholder={mode === 'trains' ? t("dest_placeholder_train") : t("dest_placeholder_flight")}
                      />
                    </div>
                    {destinations.length > 1 && (
                      <button type="button" className="btn-outline" onClick={() => setDestinations(destinations.filter((_, i) => i !== idx))} style={{ padding: '10px', height: '42px', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={t("remove")}>
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
                {destinations.length < 5 && (
                  <button type="button" className="btn-outline" onClick={() => setDestinations([...destinations, ''])} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Plus size={14} /> {t("add_dest")}
                  </button>
                )}
              </div>
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
                  onChange={(update: [Date | null, Date | null]) => {
                    if (depDatePristine && update[0] && update[1]) {
                      setDepDateRange([update[1], null]);
                    } else {
                      setDepDateRange(update);
                    }
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
                  onChange={(update: [Date | null, Date | null]) => setRetDateRange(update)}
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
          <button 
            type="button" 
            className="btn-outline"
            onClick={handleSaveSearch}
            title={t("save_destinations")}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Bookmark size={16} /> {t("save_btn")}
          </button>
          
          <button 
            type="button" 
            className="btn-outline"
            onClick={() => {
              if (mode === 'trains') {
                window.open('https://www.trenitalia.com/it.html', '_blank');
              } else {
                const mapIata = (n: string) => {
                  n = n.toLowerCase();
                  const mapping = appConfig?.voli?.iata_mapping || {
                    "zurigo": "ZRH", "zurich": "ZRH", "bari": "BRI", "brindisi": "BDS",
                    "torino": "TRN", "linate": "LIN", "malpensa": "MXP", "milan": "MIL",
                    "roma": "ROM", "rome": "ROM", "napol": "NAP", "naples": "NAP",
                    "catania": "CTA", "palermo": "PMO", "venezia": "VCE", "venice": "VCE",
                    "bologna": "BLQ"
                  };
                  for (const key in mapping) {
                    if (n.includes(key)) return mapping[key];
                  }
                  return n;
                };
                const o = mapIata(origins[0] || '');
                const d = mapIata(destinations[0] || '');
                
                const formatDate = (date: Date | null) => {
                  if (!date) return '';
                  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                };
                const depStr = formatDate(depDateRange[0]);
                const retStr = formatDate(retDateRange[0]);
                
                let url = `https://www.google.com/travel/flights?q=Flights%20to%20${d}%20from%20${o}%20on%20${depStr}`;
                if (!oneWay && retStr) {
                  url += `%20through%20${retStr}`;
                } else {
                  url += `%20one-way`;
                }
                window.open(url, '_blank');
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {mode === 'trains' ? t("open_trenitalia") : t("open_google_flights")}
          </button>
          
          <button type="button" className="btn-outline" onClick={() => setIsHistoryOpen(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px' }} title={language === 'it' ? 'Cronologia' : 'History'}>
            <Clock size={18} />
          </button>
          
          <button type="submit" className="btn-primary" disabled={mode === 'trains' ? trainLoading : flightLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title={`${t("search_solutions")} (Ctrl+Enter)`}>
            {(mode === 'trains' ? trainLoading : flightLoading) ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {(mode === 'trains' ? trainLoading : flightLoading) ? t("searching") : t("search_solutions")}
          </button>
          {(mode === 'trains' ? trainLoading : flightLoading) && (
            <div 
              onClick={handleStop}
              title={t("stop_search")}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '8px', color: 'var(--primary)' }}
            >
              <Square size={20} fill="currentColor" />
            </div>
          )}
        </div>
      </motion.form>

      {/* Results */}
      {(mode === 'trains' ? trainError : flightError) && (
        <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', color: '#f87171' }}>
          {mode === 'trains' ? trainError : flightError}
        </div>
      )}

      {!(mode === 'trains' ? trainLoading : flightLoading) && (mode === 'trains' ? trainSearched : flightSearched) && !(mode === 'trains' ? trainError : flightError) && (mode === 'trains' ? trainResults : flightResults).length === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', background: 'var(--card-bg)', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
          {t("no_solutions")}
        </div>
      )}

      <AnimatePresence>
        {(mode === 'trains' ? trainResults : flightResults).length > 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
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
                  {excluded.length > 0 && (
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
                        onClick={() => setExcluded(prev => prev.slice(0, -1))}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '6px' }}
                        title={t("restore_last")}
                      >
                        <Undo2 size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => setExcluded([])}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', borderRadius: '6px' }}
                        title={t("restore_all")}
                      >
                        <RotateCcw size={18} />
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{excluded.length}</span>
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
                {pageRows.map(({ row: r, index }, i) => (
                  <motion.tr
                    key={index}
                    className={sortOrder === 'day' && i > 0 && dayStartOf(r) !== dayStartOf(pageRows[i - 1].row) ? 'day-start' : undefined}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <td>
                      {r.booking_url ? (
                        <a
                          href={r.booking_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="route-link"
                          title={mode === 'trains' ? t("open_row_trenitalia") : t("open_row_flights")}
                        >
                          {r.route || `${r.origin} → ${r.destination}`}
                        </a>
                      ) : (
                        <span style={{ fontWeight: 500 }}>
                          {r.route || `${r.origin} → ${r.destination}`}
                        </span>
                      )}
                      {!oneWay && r.in_dep && <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '4px' }}>{t("return_label")}: {r.destination} → {r.origin}</div>}
                    </td>
                    <td>{new Date(r.out_dep || r.dep).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{new Date(r.out_arr || r.arr).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{Math.floor((r.duration_min || r.total_duration_min) / 60)}h {(r.duration_min || r.total_duration_min) % 60}m</td>
                    <td style={{ fontWeight: 600 }}>{r.price_eur} €</td>
                    <td style={{ color: 'var(--accent)' }}>{r.adjusted_cost} €</td>
                    <td>
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => setExcluded(prev => prev.includes(index) ? prev : [...prev, index])}
                        title={t("exclude_row")}
                      >
                        <X size={16} />
                      </button>
                    </td>
                  </motion.tr>
                ))}
                </AnimatePresence>
              </tbody>
            </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(mode === 'trains' ? trainResults : flightResults).length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
          <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{sortOrder === 'day' ? t("results_per_day") : t("results_to_show")}</span>
          <select
            value={itemsPerPage}
            onChange={e => setResultCounts(prev => ({ ...prev, [resultCountKey]: Number(e.target.value) }))}
            style={{ width: '80px', padding: '6px 10px', background: 'var(--card-bg)' }}
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={15}>15</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      )}
      
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        mode={mode}
        history={mode === 'trains' ? trainHistory : flightHistory}
        onSelect={(entry) => {
          setOrigins([entry.origin]);
          setDestinations([entry.destination]);
          // With a pool, the picker starts empty and the chips carry the dates;
          // older entries have no pool, so they fall back to their single span.
          const hasPool = (entry.depRanges?.length || 0) > 1 || (entry.retRanges?.length || 0) > 1;
          setDepRangePool(hasPool ? entry.depRanges || [] : []);
          setRetRangePool(hasPool ? entry.retRanges || [] : []);
          setDepDateRange(hasPool ? [null, null] : [entry.depStartStr ? new Date(entry.depStartStr) : null, entry.depEndStr ? new Date(entry.depEndStr) : null]);
          setRetDateRange(hasPool ? [null, null] : [entry.retStartStr ? new Date(entry.retStartStr) : null, entry.retEndStr ? new Date(entry.retEndStr) : null]);
          setOneWay(entry.oneWay);
          if (mode === 'trains') {
            setTrainResults(entry.results);
            setTrainSearched(true);
            setTrainError(null);
            setTrainExcluded([]);
          } else {
            setFlightResults(entry.results);
            setFlightSearched(true);
            setFlightError(null);
            setFlightExcluded([]);
          }
        }}
      />
    </div>
  );
}
