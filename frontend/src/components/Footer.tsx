"use client";

import { useLanguage } from '@/lib/i18n';

const REPOSITORY_URL = 'https://github.com/luca-battaglia/TeleTransport';

export default function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="site-footer">
      <span>{t('footer_disclaimer')}</span>
      <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">{t('footer_source')}</a>
    </footer>
  );
}
