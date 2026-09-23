import { useEffect, useState } from 'react';
import { SAVED_SEARCHES_KEY, loadSavedSearches, withSavedSearch, type SavedSearch } from '@/lib/searchForm';
import type { Mode } from '@/lib/settings';
import { writeJson } from '@/lib/storage';

// The places saved for the current mode, kept in localStorage for later visits.
export function useSavedSearches(mode: Mode) {
  const [saved, setSaved] = useState<Record<Mode, SavedSearch[]>>(loadSavedSearches);

  useEffect(() => {
    writeJson('local', SAVED_SEARCHES_KEY, saved);
  }, [saved]);

  return {
    list: saved[mode],
    save: (origins: string[], destinations: string[]) =>
      setSaved(prev => {
        const list = withSavedSearch(prev[mode], origins, destinations);
        return list === prev[mode] ? prev : { ...prev, [mode]: list };
      }),
    remove: (index: number) => setSaved(prev => ({ ...prev, [mode]: prev[mode].filter((_, i) => i !== index) })),
  };
}
