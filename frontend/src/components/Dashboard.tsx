"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Train, Plane, Loader2, Calendar, ArrowLeftRight, Square, Copy, X, Plus, Bookmark, Clock, ArrowDownNarrowWide, CalendarDays, CalendarPlus, Undo2, RotateCcw } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { it } from 'date-fns/locale/it';
import AutocompleteInput from '@/components/AutocompleteInput';
import HistoryModal from '@/components/HistoryModal';
import { loadDashboard, usePersistedDashboard } from '@/hooks/usePersistedDashboard';
import { useSearch } from '@/hooks/useSearch';
import { useShortcuts } from '@/hooks/useShortcuts';
import { fetchConfig, fetchDemoStatus, type AppConfig, type DemoStatus } from '@/lib/api';
import {
  addPickerToPool,
  collectRanges,
  formatRangeLabel,
  pickDates,
  removeFromPool,
  restoreDates,
  type DateSelection,
  type PickerValue,
} from '@/lib/dates';
import { RESULT_COLUMNS, localeOf, markdownTable, rowCells } from '@/lib/format';
import { rangesOf } from '@/lib/history';
import { localizeFlightPlace, useLanguage } from '@/lib/i18n';
import { RESULT_COUNT_CHOICES, dayOf, pageOf, type ResultCountKey, type SortOrder } from '@/lib/results';
import {
  MAX_ENDPOINTS,
  TRENITALIA_URL,
  googleFlightsUrl,
  loadSavedSearches,
  withSavedSearch,
  SAVED_SEARCHES_KEY,
  type SavedSearch,
} from '@/lib/searchForm';
import { useSettings, type Mode } from '@/lib/settings';
import { writeJson } from '@/lib/storage';

registerLocale('it', it);

// Months rendered in the date popup, which scrolls vertically (see globals.css).
const MONTHS_SHOWN = 12;

// Used until the backend's /api/config answers, and if it never does.
const FALLBACK_DEFAULTS: Record<Mode, { origin: string; destination: string }> = {
  trains: { origin: 'Milano Centrale', destination: 'Roma Termini' },
  flights: { origin: 'Zurich', destination: 'Rome' },
};

export default function Dashboard() {
  const { t, language } = useLanguage();
  const settings = useSettings();
  const [restored] = useState(loadDashboard);
  const [serverConfig, setServerConfig] = useState<AppConfig | null>(null);

  const defaultsFor = (m: Mode) => {
    const local = (place: string) => (m === 'flights' ? localizeFlightPlace(place, language) : place);
    return {
      origin: settings.ui?.[m]?.default_origin || local(serverConfig?.[m].default_origin || FALLBACK_DEFAULTS[m].origin),
      destination: settings.ui?.[m]?.default_destination || local(serverConfig?.[m].default_destination || FALLBACK_DEFAULTS[m].destination),
    };
  };

  const [mode, setMode] = useState<Mode>(restored.mode);
  const [origins, setOrigins] = useState<string[]>(() => restored.origins ?? [defaultsFor(restored.mode).origin]);
  const [destinations, setDestinations] = useState<string[]>(() => restored.destinations ?? [defaultsFor(restored.mode).destination]);
  const [dates, setDates] = useState<DateSelection>(restored.dates);
  const [resultCounts, setResultCounts] = useState(restored.resultCounts);
  const [sortOrder, setSortOrder] = useState<SortOrder>(restored.sortOrder);
  const [savedSearches, setSavedSearches] = useState<Record<Mode, SavedSearch[]>>(loadSavedSearches);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [demo, setDemo] = useState<DemoStatus | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const search = useSearch(mode, restored.byMode, setDemo);
  const { current } = search;

  const hasOwnKey = Boolean(settings.serpapiKey);
  const customOptions = settings.ui?.[mode]?.options;
  const options = customOptions?.length ? customOptions : t(`options_${mode}`).split(',');
  const reminders = Object.values(settings.reminders ?? {}).filter(r => r.text && (r.target === mode || r.target === 'both'));

  const resultCountKey: ResultCountKey = `${mode}-${sortOrder}`;
  const itemsPerPage = resultCounts[resultCountKey];

  const pageRows = useMemo(
    () => pageOf(current.results, current.excluded, sortOrder, itemsPerPage),
    [current.results, current.excluded, sortOrder, itemsPerPage]
  );

  // A fresh session starts on the server's defaults unless the user set their own.
  // Decided once, from the state at mount.
  const serverDefaultsFor = useRef(
    !restored.origins && !settings.ui?.[restored.mode]?.default_origin ? restored.mode : null
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

  usePersistedDashboard({ mode, origins, destinations, dates, resultCounts, sortOrder, byMode: search.byMode });

  const switchMode = (m: Mode) => {
    setMode(m);
    const defaults = defaultsFor(m);
    setOrigins([defaults.origin]);
    setDestinations([defaults.destination]);
  };

  useShortcuts({ search: () => formRef.current?.requestSubmit(), switchMode });

  const locale = localeOf(language);

  const handleCopyTable = () => {
    if (pageRows.length === 0) return;
    const train = mode === 'trains';
    const text = markdownTable(RESULT_COLUMNS.map(key => t(key)), pageRows.map(({ row }) => rowCells(row, train, locale)));
    navigator.clipboard.writeText(text).catch(err => console.error('Clipboard error', err));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    search.run({ origins, destinations, ranges: collectRanges(dates.pool, dates.picker) });
  };

  const handleSaveSearch = () =>
    setSavedSearches(prev => {
      const list = withSavedSearch(prev[mode], origins, destinations);
      return list === prev[mode] ? prev : { ...prev, [mode]: list };
    });

  const removeSavedSearch = (idx: number) =>
    setSavedSearches(prev => ({ ...prev, [mode]: prev[mode].filter((_, i) => i !== idx) }));

  const openOperatorSite = () => {
    const mapping = settings.ui?.flights?.iata_mapping ?? serverConfig?.flights.iata_mapping ?? {};
    const url = mode === 'trains'
      ? TRENITALIA_URL
      : googleFlightsUrl(origins[0] || '', destinations[0] || '', dates.picker[0], mapping);
    window.open(url, '_blank', 'noopener');
  };

  const renderRangePool = () => {
    if (dates.pool.length === 0) return null;
    return (
      <div className="range-pool">
        {dates.pool.map(r => (
          <div key={`${r.start}_${r.end}`} className="chip">
            <span>{formatRangeLabel(r)}</span>
            <button
              type="button"
              className="chip-remove"
              onClick={() => setDates(prev => removeFromPool(prev, r))}
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
                  startDate={dates.picker[0] || undefined}
                  endDate={dates.picker[1] || undefined}
                  onChange={(update: PickerValue) => setDates(prev => pickDates(prev, update))}
                  dateFormat="dd/MM/yyyy"
                  placeholderText={t("dates_placeholder")}
                  className="date-input"
                  isClearable={true}
                />
                <button
                  type="button"
                  className="btn-outline field-btn"
                  onClick={() => setDates(addPickerToPool)}
                  disabled={!dates.picker[0]}
                  title={t("add_range")}
                >
                  <CalendarPlus size={18} />
                </button>
              </div>
              <div className="hint">{t("start_end")}</div>
              {renderRangePool()}
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
            <button type="button" className="stop-btn" onClick={search.stop} title={t("stop_search")}>
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
                        onClick={search.restoreLast}
                        title={t("restore_last")}
                      >
                        <Undo2 size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn-outline tool-btn"
                        onClick={search.restoreAll}
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
                    {RESULT_COLUMNS.map(key => <th key={key}>{t(key)}</th>)}
                    <th className="row-action-col" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {pageRows.map(({ row: r, index }, i) => {
                      const train = mode === 'trains';
                      const [route, dep, arr, duration, price, adjustedCost] = rowCells(r, train, locale);
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
                              {route}
                            </a>
                          </td>
                          <td>{dep}</td>
                          <td>{arr}</td>
                          <td>{duration}</td>
                          <td className="price">{price}</td>
                          <td className="adjusted-cost">{adjustedCost}</td>
                          <td>
                            <button
                              type="button"
                              className="row-action"
                              onClick={() => search.exclude(index)}
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
            {RESULT_COUNT_CHOICES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        mode={mode}
        history={search.history}
        onSelect={(entry) => {
          setOrigins(entry.origin.split(', '));
          setDestinations(entry.destination.split(', '));
          setDates(restoreDates(rangesOf(entry)));
          search.show(entry.results);
        }}
      />
    </div>
  );
}
