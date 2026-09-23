// Browser storage that never throws. A write fails when the quota is full, which
// a few big searches are enough for, or when the user turned storage off; thrown
// from an effect, that error would take the whole page down.

type Area = 'local' | 'session';

function storageOf(area: Area): Storage | null {
  try {
    return area === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function writeRaw(area: Area, key: string, text: string): boolean {
  try {
    const storage = storageOf(area);
    if (!storage) return false;
    storage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export function readJson<T>(area: Area, key: string, fallback: T): T {
  try {
    const raw = storageOf(area)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Returns whether the browser kept the value.
export function writeJson(area: Area, key: string, value: unknown): boolean {
  return writeRaw(area, key, JSON.stringify(value));
}

// Stores as many entries from the head of the list as fit, dropping from the
// tail, and returns how many were kept.
export function writeNewest(area: Area, key: string, entries: unknown[]): number {
  const parts = entries.map(entry => JSON.stringify(entry));
  for (let n = parts.length; n > 0; n--) {
    if (writeRaw(area, key, `[${parts.slice(0, n).join(',')}]`)) return n;
  }
  writeRaw(area, key, '[]');
  return 0;
}
