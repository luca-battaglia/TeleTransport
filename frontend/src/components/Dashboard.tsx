"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import HistoryModal from '@/components/HistoryModal';
import ModeToggle from '@/components/ModeToggle';
import ResultCountPicker from '@/components/ResultCountPicker';
import ResultsTable from '@/components/ResultsTable';
import ResultsToolbar from '@/components/ResultsToolbar';
import SavedSearches from '@/components/SavedSearches';
import SearchForm from '@/components/SearchForm';
import { useDemoQuota } from '@/hooks/useDemoQuota';
import { loadDashboard, usePersistedDashboard } from '@/hooks/usePersistedDashboard';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { useSearch } from '@/hooks/useSearch';
import { useShortcuts } from '@/hooks/useShortcuts';
import { fetchConfig, type AppConfig } from '@/lib/api';
import { collectRanges, restoreDates, type DateSelection } from '@/lib/dates';
import { RESULT_COLUMNS, localeOf, markdownTable, rowCells } from '@/lib/format';
import { rangesOf } from '@/lib/history';
import { localizeFlightPlace, useLanguage } from '@/lib/i18n';
import { pageOf, type ResultCountKey, type SortOrder } from '@/lib/results';
import { TRENITALIA_URL, googleFlightsUrl } from '@/lib/searchForm';
import { useSettings, type Mode } from '@/lib/settings';

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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const demo = useDemoQuota(mode, Boolean(settings.serpapiKey));
  const search = useSearch(mode, restored.byMode, demo.update);
  const saved = useSavedSearches(mode);
  const { current } = search;

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

  usePersistedDashboard({ mode, origins, destinations, dates, resultCounts, sortOrder, byMode: search.byMode });

  const switchMode = (m: Mode) => {
    setMode(m);
    const defaults = defaultsFor(m);
    setOrigins([defaults.origin]);
    setDestinations([defaults.destination]);
  };

  useShortcuts({ search: () => formRef.current?.requestSubmit(), switchMode });

  const copyTable = () => {
    if (pageRows.length === 0) return;
    const cells = pageRows.map(({ row }) => rowCells(row, mode === 'trains', localeOf(language)));
    navigator.clipboard
      .writeText(markdownTable(RESULT_COLUMNS.map(key => t(key)), cells))
      .catch(err => console.error('Clipboard error', err));
  };

  const openOperatorSite = () => {
    const mapping = settings.ui?.flights?.iata_mapping ?? serverConfig?.flights.iata_mapping ?? {};
    const url = mode === 'trains'
      ? TRENITALIA_URL
      : googleFlightsUrl(origins[0] || '', destinations[0] || '', dates.picker[0], mapping);
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="dashboard">
      <ModeToggle mode={mode} onChange={switchMode} />

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

      {demo.notice && <div className="notice">{demo.notice}</div>}

      <SearchForm
        ref={formRef}
        mode={mode}
        options={options}
        origins={origins}
        destinations={destinations}
        onOriginsChange={setOrigins}
        onDestinationsChange={setDestinations}
        dates={dates}
        onDatesChange={setDates}
        loading={current.loading}
        savedSearches={
          <SavedSearches
            searches={saved.list}
            onApply={s => { setOrigins(s.origins); setDestinations(s.destinations); }}
            onRemove={saved.remove}
          />
        }
        onSearch={() => search.run({ origins, destinations, ranges: collectRanges(dates.pool, dates.picker) })}
        onStop={search.stop}
        onSave={() => saved.save(origins, destinations)}
        onOpenOperator={openOperatorSite}
        onOpenHistory={() => setIsHistoryOpen(true)}
      />

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
            <ResultsToolbar
              sortOrder={sortOrder}
              onSortChange={setSortOrder}
              excludedCount={current.excluded.length}
              onRestoreLast={search.restoreLast}
              onRestoreAll={search.restoreAll}
              onCopy={copyTable}
            />
            <ResultsTable rows={pageRows} mode={mode} sortOrder={sortOrder} onExclude={search.exclude} />
          </motion.div>
        )}
      </AnimatePresence>

      {current.results.length > 0 && (
        <ResultCountPicker
          sortOrder={sortOrder}
          value={itemsPerPage}
          onChange={count => setResultCounts(prev => ({ ...prev, [resultCountKey]: count }))}
        />
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
