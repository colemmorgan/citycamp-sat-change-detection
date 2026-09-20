/**
 * Every data URL goes through here.
 *
 * Vite's BASE_URL is '/citycamp-sat-change-detection/' in production and '/' in
 * dev, so paths must never be hardcoded as 'data/...'. GeoTIFF sources need an
 * absolute-from-origin path because OL resolves them against the document, not
 * the module.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const dataUrl = (file: string): string => `${BASE}/data/${file}`;

export const ASSETS = {
  change: 'change.tif',
  campusChange: 'campus_change.tif',
  transitions: 'transitions.tif',
  lulc2017: 'lulc_2017.tif',
  lulc2024: 'lulc_2024.tif',
  s2_2017: 's2_2017.tif',
  s2_2024: 's2_2024.tif',
  s2_2017_meta: 's2_2017_meta.json',
  s2_2024_meta: 's2_2024_meta.json',
  tasks: 'tasks.geojson',
  candidates: 'candidates.geojson',
  protectedAreas: 'protected.geojson',
  globePoints: 'globe_points.geojson',
  campusTargets: 'campus_targets.geojson',
  stats: 'stats.json',
  legend: 'transitions_legend.json',
  metrics: 'metrics.json',
} as const;

export type AssetKey = keyof typeof ASSETS;
