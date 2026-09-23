import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, writeJson, writeNewest } from './storage';

// A Storage that refuses values longer than `quota` characters, the way a full browser store does.
function limitedStorage(quota: number): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => {
      items.delete(key);
    },
    setItem: (key, value) => {
      if (value.length > quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      items.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage', () => {
  it('keeps the newest entries that fit', () => {
    vi.stubGlobal('window', { localStorage: limitedStorage(30) });
    const entries = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)];
    expect(writeNewest('local', 'history', entries)).toBe(2);
    expect(readJson('local', 'history', [])).toEqual(entries.slice(0, 2));
  });

  it('reports a refused write instead of throwing', () => {
    vi.stubGlobal('window', { sessionStorage: limitedStorage(0) });
    expect(writeJson('session', 'state', { results: [1, 2, 3] })).toBe(false);
  });

  it('falls back when storage is turned off', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    expect(readJson('local', 'settings', 'fallback')).toBe('fallback');
    expect(writeJson('local', 'settings', {})).toBe(false);
  });
});
