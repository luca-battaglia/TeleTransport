"use client";

import type { Dispatch, SetStateAction } from 'react';
import { Calendar, CalendarPlus, X } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { it } from 'date-fns/locale/it';
import {
  addPickerToPool,
  formatRangeLabel,
  pickDates,
  removeFromPool,
  type DateSelection,
  type PickerValue,
} from '@/lib/dates';
import { useLanguage } from '@/lib/i18n';

registerLocale('it', it);

// Months rendered in the date popup, which scrolls vertically (see globals.css).
const MONTHS_SHOWN = 12;

interface DateRangeFieldProps {
  dates: DateSelection;
  onChange: Dispatch<SetStateAction<DateSelection>>;
}

// A range picker, plus the stretches already added to the search, shown as chips.
export default function DateRangeField({ dates, onChange }: DateRangeFieldProps) {
  const { t, language } = useLanguage();

  return (
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
            onChange={(update: PickerValue) => onChange(prev => pickDates(prev, update))}
            dateFormat="dd/MM/yyyy"
            placeholderText={t("dates_placeholder")}
            className="date-input"
            isClearable={true}
          />
          <button
            type="button"
            className="btn-outline field-btn"
            onClick={() => onChange(addPickerToPool)}
            disabled={!dates.picker[0]}
            title={t("add_range")}
          >
            <CalendarPlus size={18} />
          </button>
        </div>
        <div className="hint">{t("start_end")}</div>
        {dates.pool.length > 0 && (
          <div className="range-pool">
            {dates.pool.map(r => (
              <div key={`${r.start}_${r.end}`} className="chip">
                <span>{formatRangeLabel(r)}</span>
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => onChange(prev => removeFromPool(prev, r))}
                  title={t("remove")}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
