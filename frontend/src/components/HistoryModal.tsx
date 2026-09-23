"use client";

import { useEffect, useState } from 'react';
import { X, Clock, Train, Plane } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/lib/i18n';
import type { DateRange, ResultRow } from '@/lib/api';
import { parseDateKey } from '@/lib/dates';
import type { Mode } from '@/lib/settings';

export interface HistoryEntry {
  timestamp: number;
  origin: string;
  destination: string;
  depStartStr: string;
  depEndStr?: string;
  // Every stretch the search covered. Absent on entries saved before pools
  // existed, where the depStartStr/depEndStr span is the whole search.
  depRanges?: DateRange[];
  results: ResultRow[];
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: Mode;
  history: HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
}

export default function HistoryModal({ isOpen, onClose, ...props }: HistoryModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Mounted only while open, so the list's notion of "now" is taken when it opens.
  return isOpen ? <HistoryList onClose={onClose} {...props} /> : null;
}

function HistoryList({ onClose, mode, history, onSelect }: Omit<HistoryModalProps, 'isOpen'>) {
  const { t, language } = useLanguage();
  const [now] = useState(Date.now);

  const formatDate = (dateKey: string) =>
    parseDateKey(dateKey).toLocaleDateString(language === 'it' ? 'it-IT' : 'en-GB', { day: 'numeric', month: 'short' });

  const timeAgo = (ms: number) => {
    const minutes = Math.floor((now - ms) / 60_000);
    if (minutes < 1) return t('just_now');
    if (minutes < 60) return t('minutes_ago', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('hours_ago', { n: hours });
    const days = Math.floor(hours / 24);
    return days === 1 ? t('yesterday') : t('days_ago', { n: days });
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'var(--modal-overlay)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px'
    }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel"
        style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', padding: '32px', position: 'relative' }}
      >
        <button
          onClick={onClose}
          aria-label={t('close')}
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}
        >
          <X size={24} />
        </button>

        <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={24} color="var(--primary)" />
          {t('history')} ({mode === 'trains' ? t('trains_btn') : t('flights_btn')})
        </h2>

        {history.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
            {t('history_empty')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {history.map((entry, i) => (
              <div
                key={i}
                onClick={() => {
                  onSelect(entry);
                  onClose();
                }}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '16px', borderRadius: '8px', border: '1px solid var(--card-border)',
                  background: 'var(--bg)', cursor: 'pointer', transition: 'background 0.2s ease'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'var(--card-hover)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'var(--bg)'}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontWeight: 600, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {mode === 'trains' ? <Train size={16} /> : <Plane size={16} />}
                    {entry.origin} → {entry.destination}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                    {formatDate(entry.depStartStr)}
                    {entry.depEndStr && entry.depEndStr !== entry.depStartStr && ` - ${formatDate(entry.depEndStr)}`}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{timeAgo(entry.timestamp)}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--accent)', background: 'rgba(38, 139, 210, 0.1)', padding: '2px 8px', borderRadius: '12px' }}>
                    {t('results_count', { n: entry.results.length })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
