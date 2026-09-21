"use client";

import { useEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme_preference';
const THEME_EVENT = 'themechange';

function subscribe(listener: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener('storage', listener);
  window.addEventListener(THEME_EVENT, listener);
  media.addEventListener('change', listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(THEME_EVENT, listener);
    media.removeEventListener('change', listener);
  };
}

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePreference(preference: ThemePreference) {
  localStorage.setItem(THEME_KEY, preference);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function readIsDark() {
  const preference = readThemePreference();
  return preference === 'dark' || (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export default function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, readThemePreference, () => 'system' as ThemePreference);
  const isDark = useSyncExternalStore(subscribe, readIsDark, () => false);

  useEffect(() => {
    document.body.classList.toggle('dark', isDark);
  }, [isDark]);

  // Following the system theme leaves nothing to toggle.
  if (preference === 'system') return null;

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
      <Sun
        size={20}
        style={{ cursor: 'pointer', color: isDark ? 'var(--muted)' : 'var(--foreground)' }}
        onClick={() => setThemePreference('light')}
      />
      <Moon
        size={20}
        style={{ cursor: 'pointer', color: isDark ? 'var(--foreground)' : 'var(--muted)' }}
        onClick={() => setThemePreference('dark')}
      />
    </div>
  );
}
