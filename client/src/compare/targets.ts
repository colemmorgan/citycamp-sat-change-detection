import type { LayerId } from '@/data/types';
import type { CompareTarget } from '@/store/compareStore';
import * as registry from '@/map/layerRegistry';

/**
 * What a CompareTarget actually points at.
 *
 * `{kind:'layer'}` is literal — one layer id. `{kind:'year'}` is not: the store
 * interface says "year", not "which raster", so this module owns that mapping.
 *
 * A year means the Sentinel-2 true-colour scene for that year, because that is
 * the thing a human can visually compare. If that scene was not shipped, it
 * falls back to the land-cover classification for the same year, which is the
 * only other per-year raster. If neither exists the target is unresolvable and
 * that half of the comparison simply renders nothing — never a crash.
 *
 * Resolution always goes through the registry, so a target can only ever name a
 * layer that was really built. See layerRegistry: a missing file is never
 * registered.
 */

/** Per-year rasters, in preference order. */
const YEAR_LAYERS: Record<2017 | 2024, LayerId[]> = {
  2017: ['s2-2017', 'lulc-2017'],
  2024: ['s2-2024', 'lulc-2024'],
};

/** Rasters that can stand on one side of a comparison. */
export const COMPARABLE_LAYERS: LayerId[] = [
  's2-2017',
  's2-2024',
  'lulc-2017',
  'lulc-2024',
  'change',
  'transitions',
  'campus-change',
];

/** Every raster whose visibility compare mode takes over while it is active. */
export const MANAGED_RASTERS: LayerId[] = COMPARABLE_LAYERS;

export const LAYER_LABELS: Record<LayerId, string> = {
  'basemap-dark': 'Dark basemap',
  'basemap-sat': 'Satellite basemap',
  's2-2017': 'Sentinel-2 2017',
  's2-2024': 'Sentinel-2 2024',
  'lulc-2017': 'Land cover 2017',
  'lulc-2024': 'Land cover 2024',
  change: 'Change intensity',
  'campus-change': 'Campus change (10 m)',
  transitions: 'Confirmed transitions',
  protected: 'Protected land',
  globe: 'GLOBE observations',
  tasks: 'Verification tasks',
  'task-highlight': 'Task highlight',
  aoi: 'Analysis extent',
  measure: 'Measurement',
  pins: 'Pins',
};

/** The layer a target resolves to, or null when nothing backing it was built. */
export function resolveTargetLayer(target: CompareTarget): LayerId | null {
  if (target.kind === 'layer') {
    return registry.has(target.id) ? target.id : null;
  }
  for (const id of YEAR_LAYERS[target.year]) {
    if (registry.has(id)) return id;
  }
  return null;
}

/** Short label for the picker and the on-map pane badges. */
export function targetLabel(target: CompareTarget): string {
  if (target.kind === 'year') return String(target.year);
  return LAYER_LABELS[target.id] ?? target.id;
}

/**
 * The layer a year target is standing in for, when it is not the obvious one.
 * Drives the "via land cover" note on the pane badge so a fallback is never
 * silent.
 */
export function targetSubLabel(target: CompareTarget): string | null {
  if (target.kind !== 'year') return null;
  const resolved = resolveTargetLayer(target);
  if (!resolved) return 'unavailable';
  const preferred = YEAR_LAYERS[target.year][0];
  return resolved === preferred ? null : (LAYER_LABELS[resolved] ?? resolved);
}

// ─── serialisation, for the picker's value prop ─────────────────────────────
export type TargetKey = `year:${2017 | 2024}` | `layer:${LayerId}`;

export function targetKey(target: CompareTarget): TargetKey {
  return target.kind === 'year' ? `year:${target.year}` : `layer:${target.id}`;
}

export function parseTargetKey(key: string): CompareTarget | null {
  if (key === 'year:2017') return { kind: 'year', year: 2017 };
  if (key === 'year:2024') return { kind: 'year', year: 2024 };
  if (key.startsWith('layer:')) {
    const id = key.slice('layer:'.length) as LayerId;
    return COMPARABLE_LAYERS.includes(id) ? { kind: 'layer', id } : null;
  }
  return null;
}

export function sameTarget(a: CompareTarget, b: CompareTarget): boolean {
  return targetKey(a) === targetKey(b);
}

export interface TargetOption {
  key: TargetKey;
  target: CompareTarget;
  label: string;
  /** False when nothing backing it was built; the row renders disabled. */
  available: boolean;
}

/**
 * Picker contents. Computed from the live registry rather than from the
 * availability probe, so it can never offer a layer the map does not have.
 */
export function targetOptions(): { years: TargetOption[]; layers: TargetOption[] } {
  const option = (target: CompareTarget): TargetOption => ({
    key: targetKey(target),
    target,
    label: targetLabel(target),
    available: resolveTargetLayer(target) !== null,
  });

  return {
    years: ([2017, 2024] as const).map((year) => option({ kind: 'year', year })),
    layers: COMPARABLE_LAYERS.map((id) => option({ kind: 'layer', id })),
  };
}
