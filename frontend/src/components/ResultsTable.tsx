"use client";

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { RESULT_COLUMNS, localeOf, rowCells } from '@/lib/format';
import { useLanguage } from '@/lib/i18n';
import { dayOf, type IndexedRow, type SortOrder } from '@/lib/results';
import type { Mode } from '@/lib/settings';

interface ResultsTableProps {
  rows: IndexedRow[];
  mode: Mode;
  sortOrder: SortOrder;
  onExclude: (index: number) => void;
}

export default function ResultsTable({ rows, mode, sortOrder, onExclude }: ResultsTableProps) {
  const { t, language } = useLanguage();
  const train = mode === 'trains';
  const locale = localeOf(language);

  return (
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
            {rows.map(({ row: r, index }, i) => {
              const [route, dep, arr, duration, price, adjustedCost] = rowCells(r, train, locale);
              return (
                <motion.tr
                  key={index}
                  className={sortOrder === 'day' && i > 0 && dayOf(r) !== dayOf(rows[i - 1].row) ? 'day-start' : undefined}
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
                    <button type="button" className="row-action" onClick={() => onExclude(index)} title={t("exclude_row")}>
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
  );
}
