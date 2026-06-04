"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Settings, Train, Info } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import GuideModal from './GuideModal';
import { useLanguage } from '@/lib/i18n';

export default function Navbar() {
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const { t } = useLanguage();

  return (
    <nav style={{ marginBottom: '32px', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="flex items-center gap-4">
        <Link href="/" style={{ textDecoration: 'none', color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div>
            <Train size={24} color="var(--primary)" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 600, fontSize: '18px', letterSpacing: '-0.5px', lineHeight: '1' }}>{t('teletransport')}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.2px', marginTop: '2px' }}>{t('subtitle')}</span>
          </div>
        </Link>
      </div>
      
      <div className="flex gap-4 items-center">
        <ThemeToggle />
        
        <button 
          onClick={() => setIsGuideOpen(true)}
          className="btn-outline" 
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', padding: '8px', borderRadius: '50%', background: 'transparent' }} 
          title={t('guide_title')}
        >
          <Info size={22} color="var(--primary)" />
        </button>

        <Link href="/settings" className="btn-outline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', border: 'none', padding: '8px', borderRadius: '50%' }} title={t('settings')}>
          <Settings size={22} />
        </Link>
      </div>

      <GuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </nav>
  );
}
