import { useEffect, useRef } from 'react';
import type { Mode } from '@/lib/settings';

type Handlers = { search: () => void; switchMode: (mode: Mode) => void };

// Ctrl+Enter searches, Alt+1 and Alt+2 pick trains or flights. The listener is
// registered once, so it reads the latest handlers through a ref.
export function useShortcuts(handlers: Handlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') latest.current.search();
      if (e.altKey && e.key === '1') latest.current.switchMode('trains');
      if (e.altKey && e.key === '2') latest.current.switchMode('flights');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
