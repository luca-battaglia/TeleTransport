"use client";

import { useLanguage } from '@/lib/i18n';
import { RESULT_COUNT_CHOICES, type SortOrder } from '@/lib/results';

interface ResultCountPickerProps {
  sortOrder: SortOrder;
  value: number;
  onChange: (count: number) => void;
}

// Grouped by day the count applies to each day, so the label says so.
export default function ResultCountPicker({ sortOrder, value, onChange }: ResultCountPickerProps) {
  const { t } = useLanguage();

  return (
    <div className="result-count">
      <span>{sortOrder === 'day' ? t("results_per_day") : t("results_to_show")}</span>
      <select value={value} onChange={e => onChange(Number(e.target.value))}>
        {RESULT_COUNT_CHOICES.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}
