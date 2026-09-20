import { ASSETS, dataUrl, type AssetKey } from './paths';
import type { AppData, AssetAvailability, Stats, TransitionLegend } from './types';

/**
 * Probe whether an asset exists WITHOUT downloading it.
 *
 * Never use fetch() on a .tif to read pixels — ol/source/GeoTIFF issues HTTP
 * range requests and a full fetch would pull the entire 24 MB file. A HEAD
 * request is safe: it transfers no body.
 *
 * Any failure is treated as "absent" rather than thrown, so one missing raster
 * degrades to a disabled panel row instead of breaking the map.
 */
async function probe(file: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl(file), { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Probe every asset in parallel. */
export async function probeAssets(): Promise<AssetAvailability> {
  const keys = Object.keys(ASSETS) as AssetKey[];
  const results = await Promise.all(keys.map((k) => probe(ASSETS[k])));
  return Object.fromEntries(keys.map((k, i) => [k, results[i] ?? false]));
}

async function loadJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Load everything the app needs before the map is constructed.
 * stats.json and transitions_legend.json are hard requirements — without them
 * there are no thresholds and no transition labels, so failure is fatal and
 * surfaced to the user rather than swallowed.
 */
export async function loadAppData(): Promise<AppData> {
  const [stats, legend, available] = await Promise.all([
    loadJson<Stats>(ASSETS.stats),
    loadJson<TransitionLegend>(ASSETS.legend),
    probeAssets(),
  ]);
  return { stats, legend, available };
}

/** Render `—` for nulls. Never show "null" or "NaN" to a user. */
export function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString();
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * Which percentile a cosine-change value sits at, interpolated from the
 * breakpoints in stats. Lets the threshold slider report "≈ p97" alongside the
 * raw number, which is what makes the value legible to a non-expert.
 */
export function percentileOf(v: number, c: Stats['change']): number {
  const pts: Array<[number, number]> = [
    [c.min, 0],
    [c.p50, 50],
    [c.p75, 75],
    [c.p90, 90],
    [c.p95, 95],
    [c.p99, 99],
    [c.p999, 99.9],
    [c.max, 100],
  ];
  if (v <= pts[0]![0]) return 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x0, y0] = pts[i - 1]!;
    if (v <= x1) {
      const t = x1 === x0 ? 0 : (v - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return 100;
}
