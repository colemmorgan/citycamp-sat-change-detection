import type { ClassCode, LayerRowState } from './types';

// ─── AOI / view ──────────────────────────────────────────────────────────────
// Verified against the pipeline's config.py and re-derived numerically.
export const AOI_4326: [number, number, number, number] = [-82.55, 29.48, -82.15, 29.82];
export const AOI_3857: [number, number, number, number] = [
  -9189424.0, 3436882.3, -9144896.2, 3480433.4,
];
export const AOI_CENTER_3857: [number, number] = [-9167160.1, 3458657.9];

export const VIEW = {
  projection: 'EPSG:3857',
  center: AOI_CENTER_3857,
  zoom: 11,
  minZoom: 9,
  /**
   * z19 so few-pixel changes can be inspected. Everything above z13 upsamples
   * the 19 m/px rasters, which is the point: a 3-px cluster is unclickable at
   * z16 and readable at z19.
   *
   * Safe above the Dark basemap's z16 ceiling because OL's TileGrid clamps
   * `getZForResolution` to the grid's max — the layer keeps stretching its z16
   * tiles instead of going blank. Satellite has real tiles to z19, so it is the
   * one to switch to when actually eyeballing a task.
   */
  maxZoom: 19,
  extent: AOI_3857,
  /**
   * REQUIRED. OL's default extent constraint demands the *viewport* fit inside
   * the extent. The AOI is 44.5 km wide; a 1200px viewport spans 45.9 km at z12
   * and 91.7 km at z11 — so the contract's own default zoom violates its own
   * extent. Constraining the centre only gives the intended "slight slack".
   */
  constrainOnlyCenter: true,
  showFullExtent: true,
} as const;

/** Native raster resolution is z13 (19.109 m/px in Web Mercator). */
export const NATIVE_ZOOM = 13;

// ─── basemaps ────────────────────────────────────────────────────────────────
export const BASEMAPS = {
  /**
   * Esri Dark Gray Canvas, not CARTO Dark Matter.
   *
   * CARTO's basemaps.cartocdn.com now watermarks every tile with
   * "API KEY REQUIRED" — verified in a browser, not just assumed. Esri's dark
   * canvas needs no key, is designed as a neutral base for data overlay, and
   * comes from the same provider as the satellite layer, so attribution stays
   * simple.
   */
  dark: {
    label: 'Dark',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
    maxZoom: 16,
  },
  sat: {
    label: 'Satellite',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
} as const;

// ─── land-cover palette (codes frozen; labels come from stats.classes) ───────
export const CLASS_COLORS: Record<ClassCode, string> = {
  0: '#4A80B5', // Water / Wetland
  1: '#2E6B3E', // Woody
  2: '#B8C96B', // Herbaceous
  3: '#B04A3F', // Urban / Barren
};

/**
 * Legend-swatch outline. Woody (#2E6B3E) on surface-1 (#0F1011) is close to
 * invisible at 12px, so every swatch gets a border. See plans/04 §8.
 */
export const SWATCH_BORDER = 'var(--border-1)';

// ─── change ramp ─────────────────────────────────────────────────────────────
/**
 * Alpha is 0–1 in OpenLayers colour arrays, NOT 0–255. The contract's
 * [255,237,160,180] would clamp to fully opaque and flatten the low-end ramp.
 */
export const CHANGE_RAMP = {
  low: [255, 237, 160, 0.7] as [number, number, number, number],
  high: [240, 59, 32, 0.9] as [number, number, number, number],
  /** Width of the ramp above the threshold, in cosine-change units. */
  span: 0.15,
};

// ─── default layer rows ──────────────────────────────────────────────────────
/**
 * `order` is position within the group; higher renders on top.
 * Seeded from plans/02 §6. Overlays are user-reorderable; reference is pinned.
 */
export const DEFAULT_LAYER_ROWS: LayerRowState[] = [
  // On at 35% so the change raster still reads over it — the imagery is
  // context for the overlays, not the subject.
  { id: 'imagery', group: 'overlay', label: 'Sentinel-2 imagery', visible: true, opacity: 0.35, order: 0, year: 2024 },
  { id: 'lulc', group: 'overlay', label: 'Land cover', visible: false, opacity: 0.65, order: 1, year: 2024 },
  { id: 'change', group: 'overlay', label: 'Change intensity', visible: true, opacity: 0.75, order: 2 },
  { id: 'transitions', group: 'overlay', label: 'Confirmed transitions', visible: true, opacity: 1, order: 3 },
  { id: 'protected', group: 'reference', label: 'Protected land', visible: false, opacity: 1, order: 0 },
  { id: 'globe', group: 'reference', label: 'GLOBE observations', visible: true, opacity: 1, order: 1 },
  { id: 'tasks', group: 'reference', label: 'Verification tasks', visible: true, opacity: 1, order: 2 },
  { id: 'aoi', group: 'reference', label: 'Analysis extent', visible: true, opacity: 1, order: 3 },
];

// ─── z-index bands ───────────────────────────────────────────────────────────
/** Groups occupy disjoint bands so intra-group reordering can never cross groups. */
export const Z_BAND = { basemap: 0, overlay: 100, reference: 300, tool: 500 } as const;

// ─── storage ─────────────────────────────────────────────────────────────────
/**
 * Namespaced: `username.github.io` is ONE origin shared by every Pages repo,
 * so a bare task_id key would collide across unrelated projects.
 */
export const STORAGE_PREFIX = 'spatial-awareness:';
export const VERIFIED_KEY = `${STORAGE_PREFIX}verified`;
