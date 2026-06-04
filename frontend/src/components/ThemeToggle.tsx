"use client";

import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const [themePref, setThemePref] = useState('system');
  const [isDark, setIsDark] = useState(false);

  const applyTheme = (pref: string) => {
    let dark = false;
    if (pref === 'dark') dark = true;
    else if (pref === 'system') dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (dark) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
    
    setIsDark(dark);
  };

  useEffect(() => {
    const saved = localStorage.getItem('theme_preference') || 'system';
    setThemePref(saved);
    applyTheme(saved);

    const handleStorage = () => {
      const updated = localStorage.getItem('theme_preference') || 'system';
      setThemePref(updated);
      applyTheme(updated);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('themechange', handleStorage);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const mqHandler = () => {
      if (localStorage.getItem('theme_preference') === 'system' || !localStorage.getItem('theme_preference')) {
        applyTheme('system');
      }
    };
    mq.addEventListener('change', mqHandler);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('themechange', handleStorage);
      mq.removeEventListener('change', mqHandler);
    };
  }, []);

  const toggleTheme = (toDark: boolean) => {
    const pref = toDark ? 'dark' : 'light';
    localStorage.setItem('theme_preference', pref);
    setThemePref(pref);
    applyTheme(pref);
    window.dispatchEvent(new Event('themechange'));
  };

  if (themePref === 'system') return null;

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
      <Sun 
        size={20} 
        style={{ cursor: 'pointer', color: isDark ? 'var(--muted)' : 'var(--foreground)' }} 
        onClick={() => toggleTheme(false)} 
      />
      <Moon 
        size={20} 
        style={{ cursor: 'pointer', color: isDark ? 'var(--foreground)' : 'var(--muted)' }} 
        onClick={() => toggleTheme(true)} 
      />
    </div>
  );
}
