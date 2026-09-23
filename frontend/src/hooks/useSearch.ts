import { useEffect, useRef, useState } from 'react';
import { ApiError, describeError, search, type DateRange, type DemoStatus, type ResultRow } from '@/lib/api';
import { HISTORY_KEYS, loadHistory, withEntry, type HistoryEntry } from '@/lib/history';
import { useLanguage } from '@/lib/i18n';
import type { ModeState } from '@/lib/results';
import { checkSearch } from '@/lib/searchForm';
import type { Mode } from '@/lib/settings';
import { writeNewest } from '@/lib/storage';

export type SearchRequest = { origins: string[]; destinations: string[]; ranges: DateRange[] };

// Each mode keeps its own search: a train search goes on running, and its
// results stay, while the flights are on screen.
export function useSearch(mode: Mode, initial: Record<Mode, ModeState>, onDemo: (status: DemoStatus) => void) {
  const { t, language } = useLanguage();
  const [byMode, setByMode] = useState(initial);
  const [history, setHistory] = useState<Record<Mode, HistoryEntry[]>>(() => ({
    trains: loadHistory('trains'),
    flights: loadHistory('flights'),
  }));
  const controllers = useRef<Record<Mode, AbortController | null>>({ trains: null, flights: null });

  // Every search keeps its full results, so a few big ones fill the storage
  // quota: the oldest entries are the ones left out.
  useEffect(() => {
    writeNewest('local', HISTORY_KEYS.trains, history.trains);
  }, [history.trains]);
  useEffect(() => {
    writeNewest('local', HISTORY_KEYS.flights, history.flights);
  }, [history.flights]);

  const patchMode = (m: Mode, patch: Partial<ModeState>) =>
    setByMode(prev => ({ ...prev, [m]: { ...prev[m], ...patch } }));

  const current = byMode[mode];

  const run = async (request: SearchRequest) => {
    const searchMode = mode;
    const origins = request.origins.map(o => o.trim()).filter(Boolean);
    const destinations = request.destinations.map(d => d.trim()).filter(Boolean);
    const { ranges } = request;

    const problem = checkSearch(ranges, origins, destinations);
    if (problem) {
      patchMode(searchMode, { error: t(problem.key, problem.params), searched: false, results: [] });
      return;
    }

    controllers.current[searchMode]?.abort();
    const controller = new AbortController();
    controllers.current[searchMode] = controller;
    patchMode(searchMode, { loading: true, searched: false, error: null, results: [], excluded: [] });

    try {
      const res = await search(searchMode, { origins, destinations, dep_ranges: ranges, lang: language }, controller.signal);

      patchMode(searchMode, { results: res.data, searched: true });
      if (res.demo) onDemo({ enabled: true, searches_left: res.demo.searches_left });
      if (res.data.length > 0) {
        const entry: HistoryEntry = {
          timestamp: Date.now(),
          origin: origins.join(', '),
          destination: destinations.join(', '),
          depStartStr: ranges[0].start,
          depEndStr: ranges[ranges.length - 1].end,
          depRanges: ranges,
          results: res.data,
        };
        setHistory(prev => ({ ...prev, [searchMode]: withEntry(prev[searchMode], entry) }));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      patchMode(searchMode, { error: describeError(err, t), searched: true });
      if (err instanceof ApiError && err.code === 'demo_exhausted') onDemo({ enabled: true, searches_left: 0 });
    } finally {
      if (controllers.current[searchMode] === controller) patchMode(searchMode, { loading: false });
    }
  };

  const stop = () => {
    controllers.current[mode]?.abort();
    patchMode(mode, { loading: false });
  };

  return {
    byMode,
    current,
    history: history[mode],
    run,
    stop,
    exclude: (index: number) =>
      patchMode(mode, { excluded: current.excluded.includes(index) ? current.excluded : [...current.excluded, index] }),
    restoreLast: () => patchMode(mode, { excluded: current.excluded.slice(0, -1) }),
    restoreAll: () => patchMode(mode, { excluded: [] }),
    // Puts a past search's results on screen, as if it had just run.
    show: (results: ResultRow[]) => patchMode(mode, { results, searched: true, error: null, excluded: [] }),
  };
}
