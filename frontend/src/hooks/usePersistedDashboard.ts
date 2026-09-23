import { useEffect } from 'react';
import type { DateRange } from '@/lib/api';
import { collectRanges, freshDates, restoreDates, type DateSelection, type PickerValue } from '@/lib/dates';
import { restoreModeState, restoreResultCounts, type ModeState, type ResultCountKey, type SortOrder } from '@/lib/results';
import type { Mode } from '@/lib/settings';
import { readJson, writeJson } from '@/lib/storage';

// Kept in sessionStorage, so a reload keeps the form and the results while a
// new tab starts clean.
const STATE_KEY = 'dashboard_state';

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

export type DashboardState = {
  mode: Mode;
  origins: string[];
  destinations: string[];
  dates: DateSelection;
  resultCounts: Record<ResultCountKey, number>;
  sortOrder: SortOrder;
  byMode: Record<Mode, ModeState>;
};

// Places are left out when the session has none, since their defaults depend
// on the settings and the language.
export type RestoredDashboard = Omit<DashboardState, 'origins' | 'destinations'> & {
  origins?: string[];
  destinations?: string[];
};

const toPicker = (stored?: [string | null, string | null]): PickerValue =>
  stored ? [stored[0] ? new Date(stored[0]) : null, stored[1] ? new Date(stored[1]) : null] : [null, null];

export function loadDashboard(): RestoredDashboard {
  const stored = readJson<StoredDashboard>('session', STATE_KEY, {});
  return {
    mode: stored.mode ?? 'trains',
    origins: stored.origins,
    destinations: stored.destinations,
    dates: stored.depDateRange || stored.depRangePool
      ? restoreDates(collectRanges(Array.isArray(stored.depRangePool) ? stored.depRangePool : [], toPicker(stored.depDateRange)))
      : freshDates(),
    resultCounts: restoreResultCounts(stored.resultCounts),
    sortOrder: stored.sortOrder === 'day' ? 'day' : 'best',
    byMode: {
      trains: restoreModeState(stored.byMode?.trains),
      flights: restoreModeState(stored.byMode?.flights),
    },
  };
}

export function usePersistedDashboard({ mode, origins, destinations, dates, resultCounts, sortOrder, byMode }: DashboardState) {
  useEffect(() => {
    const persisted: StoredDashboard = {
      mode, origins, destinations, resultCounts, sortOrder, byMode,
      depRangePool: dates.pool,
      depDateRange: [dates.picker[0]?.toISOString() ?? null, dates.picker[1]?.toISOString() ?? null],
    };
    // Results are nearly all of it: without room for them, the form still survives a reload.
    if (!writeJson('session', STATE_KEY, persisted)) {
      writeJson('session', STATE_KEY, { ...persisted, byMode: undefined });
    }
  }, [mode, origins, destinations, resultCounts, sortOrder, byMode, dates]);
}
