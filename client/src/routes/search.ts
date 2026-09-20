import { z } from 'zod';
import type { LayerRowId } from '@/data/types';

/**
 * Map state lives in the URL, so every view is a shareable link:
 *   ?c=-82.31,29.66&z=13.4&t=0.41&task=TASK-0007
 *
 * Two rules keep this from becoming a feedback loop (see plans/04 §3):
 *  1. ONE-WAY WRITE, ONE-TIME READ. Hydrate the store from search params once
 *     on mount; after that only the store writes to the URL.
 *  2. THROTTLE AND REPLACE. Commit centre/zoom on OL's `moveend`, never per
 *     frame, and always with `replace: true` or the back button becomes useless.
 */

/**
 * NOTE: `c` stays a STRING in the schema — do not add a .transform() that
 * decodes it to [lon, lat].
 *
 * A zod transform makes the schema's input and output types differ, and
 * TanStack Router's `navigate({ search })` is typed against the INPUT shape.
 * A transformed field therefore typechecks on read and fails on every write.
 * Decode at the call site with parseCenter() instead.
 */
const lonLatString = z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);

export const searchSchema = z.object({
  /** Centre as "lon,lat" in EPSG:4326. Decode with parseCenter(). */
  c: lonLatString.optional(),
  /** Zoom, 1 decimal place. */
  z: z.coerce.number().min(1).max(20).optional(),
  /** Change threshold, raw cosine units. */
  t: z.coerce.number().min(0).max(2).optional(),
  /** Basemap. */
  b: z.enum(['dark', 'sat']).optional(),
  /** Visible layer rows, comma separated. */
  l: z.string().optional(),
  /** Selected task id. */
  task: z.string().regex(/^TASK-\d+$/).optional(),
  /** Compare mode — owned by Stream D. */
  cmp: z.enum(['off', 'swipe', 'sideBySide']).optional(),
  /** Compare divider position, 0–1. */
  cpos: z.coerce.number().min(0).max(1).optional(),
});

export type MapSearch = z.infer<typeof searchSchema>;

export const encodeLayers = (ids: LayerRowId[]): string => ids.join(',');

export const decodeLayers = (s: string | undefined): LayerRowId[] =>
  s ? (s.split(',').filter(Boolean) as LayerRowId[]) : [];

export const encodeCenter = (lon: number, lat: number): string =>
  `${lon.toFixed(4)},${lat.toFixed(4)}`;

/** Decode the `c` search param. Returns null when absent or malformed. */
export function parseCenter(c: string | undefined): [number, number] | null {
  if (!c) return null;
  const parts = c.split(',').map(Number);
  const [lon, lat] = parts;
  if (parts.length !== 2 || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon as number, lat as number];
}
