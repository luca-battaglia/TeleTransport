"use client";

import { ArrowLeftRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import type { SavedSearch } from '@/lib/searchForm';

interface SavedSearchesProps {
  searches: SavedSearch[];
  onApply: (search: SavedSearch) => void;
  onRemove: (index: number) => void;
}

export default function SavedSearches({ searches, onApply, onRemove }: SavedSearchesProps) {
  const { t } = useLanguage();
  if (searches.length === 0) return null;

  return (
    <div className="saved-searches">
      {searches.map((s, i) => (
        <div key={i} className="chip saved-chip" onClick={() => onApply(s)}>
          <span>{s.origins.join(', ')} <ArrowLeftRight size={12} className="chip-arrow" /> {s.destinations.join(', ')}</span>
          <button type="button" className="chip-remove" onClick={(e) => { e.stopPropagation(); onRemove(i); }} title={t("remove")}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
