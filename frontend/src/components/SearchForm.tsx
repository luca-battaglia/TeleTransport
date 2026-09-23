"use client";

import type { Dispatch, ReactNode, Ref, SetStateAction } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftRight, Bookmark, Clock, Loader2, Search, Square } from 'lucide-react';
import DateRangeField from '@/components/DateRangeField';
import EndpointList from '@/components/EndpointList';
import type { DateSelection } from '@/lib/dates';
import { useLanguage } from '@/lib/i18n';
import type { Mode } from '@/lib/settings';

interface SearchFormProps {
  ref?: Ref<HTMLFormElement>;
  mode: Mode;
  // Place names the fields suggest.
  options: string[];
  origins: string[];
  destinations: string[];
  onOriginsChange: (origins: string[]) => void;
  onDestinationsChange: (destinations: string[]) => void;
  dates: DateSelection;
  onDatesChange: Dispatch<SetStateAction<DateSelection>>;
  loading: boolean;
  // Shown above the fields.
  savedSearches: ReactNode;
  onSearch: () => void;
  onStop: () => void;
  onSave: () => void;
  onOpenOperator: () => void;
  onOpenHistory: () => void;
}

export default function SearchForm({
  ref, mode, options, origins, destinations, onOriginsChange, onDestinationsChange, dates, onDatesChange,
  loading, savedSearches, onSearch, onStop, onSave, onOpenOperator, onOpenHistory,
}: SearchFormProps) {
  const { t } = useLanguage();
  const train = mode === 'trains';

  return (
    <motion.form
      ref={ref}
      onSubmit={e => {
        e.preventDefault();
        onSearch();
      }}
      className="glass-panel search-form"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="form-grid">
        {savedSearches}
        <div className="endpoints">
          <EndpointList
            values={origins}
            onChange={onOriginsChange}
            options={options}
            label={t("origin")}
            placeholder={train ? t("origin_placeholder_train") : t("origin_placeholder_flight")}
            addLabel={t("add_origin")}
          />

          <div className="swap">
            <button
              type="button"
              className="btn-outline field-btn"
              onClick={() => {
                onOriginsChange(destinations);
                onDestinationsChange(origins);
              }}
              title={t("swap_btn")}
            >
              <ArrowLeftRight size={18} />
            </button>
          </div>

          <EndpointList
            values={destinations}
            onChange={onDestinationsChange}
            options={options}
            label={t("destination")}
            placeholder={train ? t("dest_placeholder_train") : t("dest_placeholder_flight")}
            addLabel={t("add_dest")}
          />
        </div>
        <DateRangeField dates={dates} onChange={onDatesChange} />
      </div>

      <div className="form-actions">
        <button type="button" className="btn-outline with-icon" onClick={onSave} title={t("save_destinations")}>
          <Bookmark size={16} /> {t("save_btn")}
        </button>

        <button type="button" className="btn-outline with-icon" onClick={onOpenOperator}>
          {train ? t("open_trenitalia") : t("open_google_flights")}
        </button>

        <button type="button" className="btn-outline icon-btn" onClick={onOpenHistory} title={t('history')}>
          <Clock size={18} />
        </button>

        <button type="submit" className="btn-primary with-icon" disabled={loading} title={`${t("search_solutions")} (Ctrl+Enter)`}>
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
          {loading ? t("searching") : t("search_solutions")}
        </button>
        {loading && (
          <button type="button" className="stop-btn" onClick={onStop} title={t("stop_search")}>
            <Square size={20} fill="currentColor" />
          </button>
        )}
      </div>
    </motion.form>
  );
}
