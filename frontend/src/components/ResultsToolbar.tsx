"use client";

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownNarrowWide, CalendarDays, Copy, RotateCcw, Undo2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import type { SortOrder } from '@/lib/results';

interface ResultsToolbarProps {
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
  excludedCount: number;
  onRestoreLast: () => void;
  onRestoreAll: () => void;
  onCopy: () => void;
}

export default function ResultsToolbar({ sortOrder, onSortChange, excludedCount, onRestoreLast, onRestoreAll, onCopy }: ResultsToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className={`${sortOrder === 'best' ? 'btn-primary' : 'btn-outline'} tool-btn`}
          onClick={() => onSortChange('best')}
          title={t("sort_best")}
          aria-pressed={sortOrder === 'best'}
        >
          <ArrowDownNarrowWide size={18} />
        </button>
        <button
          type="button"
          className={`${sortOrder === 'day' ? 'btn-primary' : 'btn-outline'} tool-btn`}
          onClick={() => onSortChange('day')}
          title={t("sort_day")}
          aria-pressed={sortOrder === 'day'}
        >
          <CalendarDays size={18} />
        </button>
      </div>
      <div className="toolbar-group">
        <AnimatePresence>
          {excludedCount > 0 && (
            <motion.div
              className="toolbar-group"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
            >
              <button type="button" className="btn-outline tool-btn" onClick={onRestoreLast} title={t("restore_last")}>
                <Undo2 size={18} />
              </button>
              <button type="button" className="btn-outline tool-btn" onClick={onRestoreAll} title={t("restore_all")}>
                <RotateCcw size={18} />
                <span className="tool-count">{excludedCount}</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <button type="button" className="btn-outline tool-btn" onClick={onCopy} title={t("copy_table")}>
          <Copy size={18} />
        </button>
      </div>
    </div>
  );
}
