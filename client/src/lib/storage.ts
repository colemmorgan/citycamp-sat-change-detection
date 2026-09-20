/**
 * localStorage with a total-failure fallback.
 *
 * Private browsing throws on access (not just on write), and the API can also
 * come back empty or throw when site data is blocked. Every path here is
 * wrapped, and an in-memory Map stands in when storage is unavailable so the
 * UI behaves identically either way — it just doesn't survive a reload.
 */
const memory = new Map<string, string>();
let usable: boolean | null = null;

function storageWorks(): boolean {
  if (usable !== null) return usable;
  try {
    const probe = '__sa_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    usable = true;
  } catch {
    usable = false;
  }
  return usable;
}

export function readString(key: string): string | null {
  try {
    return storageWorks() ? window.localStorage.getItem(key) : (memory.get(key) ?? null);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    if (storageWorks()) window.localStorage.setItem(key, value);
    else memory.set(key, value);
  } catch {
    memory.set(key, value);
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    /* value was not serialisable; drop it rather than break the UI */
  }
}

/** True when changes will survive a reload. Surfaced in the UI so the user knows. */
export const storageIsPersistent = (): boolean => storageWorks();
