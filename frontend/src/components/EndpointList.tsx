"use client";

import { Plus, X } from 'lucide-react';
import AutocompleteInput from '@/components/AutocompleteInput';
import { useLanguage } from '@/lib/i18n';
import { MAX_ENDPOINTS } from '@/lib/searchForm';

interface EndpointListProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: string[];
  label: string;
  placeholder: string;
  addLabel: string;
}

// The origins, or the destinations, of a search: one field each, up to MAX_ENDPOINTS.
export default function EndpointList({ values, onChange, options, label, placeholder, addLabel }: EndpointListProps) {
  const { t } = useLanguage();

  return (
    <div className="endpoint-list">
      {values.map((value, idx) => (
        <div key={idx} className="endpoint-row">
          <div className="endpoint-field">
            <AutocompleteInput
              label={idx === 0 ? label : `${label} ${idx + 1}`}
              value={value}
              onChange={val => onChange(values.map((v, i) => (i === idx ? val : v)))}
              options={options}
              placeholder={placeholder}
            />
          </div>
          {values.length > 1 && (
            <button type="button" className="btn-outline field-btn" onClick={() => onChange(values.filter((_, i) => i !== idx))} title={t("remove")}>
              <X size={18} />
            </button>
          )}
        </div>
      ))}
      {values.length < MAX_ENDPOINTS && (
        <button type="button" className="btn-outline add-endpoint" onClick={() => onChange([...values, ''])}>
          <Plus size={14} /> {addLabel}
        </button>
      )}
    </div>
  );
}
