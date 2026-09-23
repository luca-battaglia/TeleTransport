import { useEffect, useState } from 'react';
import { fetchDemoStatus, type DemoStatus } from '@/lib/api';
import { useLanguage } from '@/lib/i18n';
import type { Mode } from '@/lib/settings';

// The shared SerpApi quota that flight searches fall back on without a key of
// one's own, and the notice that tells how much of it is left.
export function useDemoQuota(mode: Mode, hasOwnKey: boolean) {
  const { t } = useLanguage();
  const [demo, setDemo] = useState<DemoStatus | null>(null);

  useEffect(() => {
    if (mode !== 'flights' || hasOwnKey) return;
    let cancelled = false;
    fetchDemoStatus().then(status => {
      if (!cancelled) setDemo(status);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, hasOwnKey]);

  const notice = mode === 'flights' && !hasOwnKey && demo
    ? !demo.enabled ? t('demo_unavailable')
      : demo.searches_left > 0 ? t('demo_banner', { left: demo.searches_left })
      : t('demo_none_left')
    : null;

  // update takes the quota a search response reports.
  return { notice, update: setDemo };
}
