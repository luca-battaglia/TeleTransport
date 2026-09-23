"use client";

import { Plane, Train } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import type { Mode } from '@/lib/settings';

export default function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const { t } = useLanguage();

  return (
    <div className="mode-toggle">
      {(['trains', 'flights'] as const).map(m => (
        <button
          key={m}
          type="button"
          className={`${mode === m ? 'btn-primary' : 'btn-outline'} with-icon mode-btn`}
          title={`${t(`${m}_btn`)} (Alt+${m === 'trains' ? 1 : 2})`}
          onClick={() => onChange(m)}
        >
          {m === 'trains' ? <Train size={18} /> : <Plane size={18} />} {t(`${m}_btn`)}
        </button>
      ))}
    </div>
  );
}
