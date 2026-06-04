"use client";

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GuideModal({ isOpen, onClose }: GuideModalProps) {
  const { t } = useLanguage();

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

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000,
      display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px'
    }}>
      <div className="glass-panel" style={{
        width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto',
        padding: '24px', position: 'relative'
      }}>
        <button 
          onClick={onClose} 
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)' }}
        >
          <X size={24} />
        </button>
        
        <h2 style={{ marginBottom: '16px', paddingRight: '32px' }}>{t('guide_title')}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
          {t('guide_intro')}
        </p>

        <h3 style={{ color: 'var(--accent)', marginBottom: '12px' }}>{t('guide_trains')} &amp; {t('guide_flights')}</h3>
        <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          <li>
            <strong>{t('time_value')}:</strong> {t('time_value_desc')}
          </li>
          <li>
            <strong>{t('early_penalty')}:</strong> {t('early_penalty_desc')}
          </li>
          <li>
            <strong>{t('late_penalty')}:</strong> {t('late_penalty_desc')}
          </li>
          <li>
            <strong>{t('change_penalty')}:</strong> {t('change_penalty_desc')}
          </li>
          <li>
            <strong>{t('airport_extras')}:</strong> {t('airport_extras_desc')}
          </li>
          <li>
            <strong>{t('companions_time')}:</strong> {t('companions_time_desc')}
          </li>
        </ul>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-primary" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  );
}
