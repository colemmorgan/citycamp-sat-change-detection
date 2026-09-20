import { useEffect, useState } from 'react';
import type { MapHandle } from './createMap';

/**
 * Module-level access to the live map.
 *
 * Tools (Stream C) and compare mode (Stream D) need the OL Map instance, but it
 * is created inside a React effect. Rather than thread it through props or
 * context — which would re-render consumers on every map change — it is
 * published here once and subscribed to.
 *
 * Returns null until the map exists, so every consumer must handle that.
 */
let current: MapHandle | null = null;
const listeners = new Set<(h: MapHandle | null) => void>();

export function setMapHandle(handle: MapHandle | null): void {
  current = handle;
  for (const fn of listeners) fn(handle);
}

export function getMapHandle(): MapHandle | null {
  return current;
}

export function subscribeMapHandle(fn: (h: MapHandle | null) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/** React binding. Re-renders once when the map becomes available. */
export function useMapHandle(): MapHandle | null {
  const [handle, setHandle] = useState<MapHandle | null>(current);
  useEffect(() => subscribeMapHandle(setHandle), []);
  return handle;
}
