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
      backgroundColor: 'var(--modal-overlay)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px'
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
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px', whiteSpace: 'pre-wrap' }}>
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

        <h3 style={{ color: 'var(--accent)', marginBottom: '12px' }}>{t('guide_dates_title')}</h3>
        <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          <li>
            <strong>{t('guide_date_pool')}:</strong> {t('guide_date_pool_desc')}
          </li>
          <li>
            <strong>{t('guide_sort_order')}:</strong> {t('guide_sort_order_desc')}
          </li>
          <li>
            <strong>{t('guide_results_count')}:</strong> {t('guide_results_count_desc')}
          </li>
          <li>
            <strong>{t('guide_exclude')}:</strong> {t('guide_exclude_desc')}
          </li>
          <li>
            <strong>{t('guide_row_link')}:</strong> {t('guide_row_link_desc')}
          </li>
          <li>
            <strong>{t('guide_operator_login')}:</strong> {t('guide_operator_login_desc')}
          </li>
        </ul>

        <h3 style={{ color: 'var(--accent)', marginBottom: '12px' }}>{t('guide_serpapi_title')}</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px', lineHeight: '1.6' }}>
          {t('guide_serpapi_desc1')} <a href="https://serpapi.com/users/sign_up" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>serpapi.com</a>{t('guide_serpapi_desc2')}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-primary" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  );
}
