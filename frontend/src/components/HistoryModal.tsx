"use client";

import { useEffect } from 'react';
import { X, Clock, Train, Plane } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/lib/i18n';

export interface HistoryEntry {
  timestamp: number;
  origin: string;
  destination: string;
  depStartStr: string;
  depEndStr?: string;
  retStartStr?: string;
  retEndStr?: string;
  oneWay: boolean;
  results: any[];
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'trains' | 'flights';
  history: HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
}

export default function HistoryModal({ isOpen, onClose, mode, history, onSelect }: HistoryModalProps) {
  const { t, language } = useLanguage();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(language === 'it' ? 'it-IT' : 'en-US', { day: 'numeric', month: 'short' });
  };

  const timeAgo = (ms: number) => {
    const seconds = Math.floor((Date.now() - ms) / 1000);
    if (seconds < 60) return language === 'it' ? 'Pochi secondi fa' : 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} ${language === 'it' ? 'min fa' : 'min ago'}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${language === 'it' ? 'ore fa' : 'hours ago'}`;
    const days = Math.floor(hours / 24);
    if (days === 1) return language === 'it' ? 'Ieri' : 'Yesterday';
    return `${days} ${language === 'it' ? 'giorni fa' : 'days ago'}`;
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
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}
        >
          <X size={24} />
        </button>

        <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={24} color="var(--primary)" />
          {language === 'it' ? 'Cronologia' : 'History'} ({mode === 'trains' ? t('trains_btn') : t('flights_btn')})
        </h2>
        
        {history.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
            {language === 'it' ? 'Nessuna ricerca recente.' : 'No recent searches.'}
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
                    {!entry.oneWay && entry.retStartStr && (
                      <>
                        {' '} | {t("return_label")}: {formatDate(entry.retStartStr)}
                        {entry.retEndStr && entry.retEndStr !== entry.retStartStr && ` - ${formatDate(entry.retEndStr)}`}
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{timeAgo(entry.timestamp)}</span>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--accent)', background: 'rgba(38, 139, 210, 0.1)', padding: '2px 8px', borderRadius: '12px' }}>
                    {entry.results.length} {language === 'it' ? 'soluzioni' : 'results'}
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
