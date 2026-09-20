/**
 * Types for every pipeline artefact.
 *
 * These were written against the REAL files in processing-pipeline/data/out
 * (generated 2026-09-20T16:58Z), not against plans/02-frontend-data-contract.md.
 * Where the two disagree, the real data wins and the divergence is commented.
 */

// ─── class codes (frozen) ────────────────────────────────────────────────────
// NOTE: code 3's label is "Urban / Barren" in the real pipeline, not "Urban".
// Labels always come from stats.classes; never hardcode them.
export type ClassCode = 0 | 1 | 2 | 3;

export type ChangeCategory =
  | 'vegetation_loss'
  | 'development'
  | 'hydrologic'
  | 'revegetation'
  | 'other';

// ─── stats.json ──────────────────────────────────────────────────────────────
export interface ChangeStats {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
  mean: number;
  min: number;
  /** Slider initial position. Equals l4_threshold — the gate that built L4. */
  slider_default: number;
  slider_min: number;
  slider_max: number;
  /** NOT IN CONTRACT. The cosine value L4 was gated at. */
  l4_threshold: number;
  /** NOT IN CONTRACT. 97, not the 99 the contract assumed. */
  l4_percentile: number;
}

export interface CategoryMeta {
  label: string;
  color: string;
}

export interface Stats {
  generated_utc: string;
  aoi_4326: [number, number, number, number];
  resolution_m: number;
  zoom_level: number;
  analysis_epsg: number;
  analysis_res_m: number;
  years: { before: number; after: number };
  change: ChangeStats;
  classes: Record<string, string>;
  model: {
    n_train: number;
    n_test: number;
    accuracy: number | null;
    baseline_majority: number;
    n_globe: number;
    n_osm: number;
    note: string;
  };
  counts: {
    tasks: number;
    /** Always null in practice — use globe_total_in_aoi instead. */
    globe_in_aoi: number | null;
    transition_px: number | null;
    candidates: number;
    by_category: Partial<Record<ChangeCategory, number>>;
    points_total: number;
    globe_trained_in_aoi: number;
    globe_unusable_in_aoi: number;
    globe_total_in_aoi: number;
    globe_trained_statewide: number;
    osm_supplements: number;
  };
  /** NOT IN CONTRACT. Attribution strings — must be displayed. */
  credits: { alphaearth: string; sentinel2: string; globe: string };
  /** NOT IN CONTRACT. Note `development` has zero occurrences in the real run. */
  categories: Record<ChangeCategory, CategoryMeta>;
  /** NOT IN CONTRACT. Pre-built headline; use `statement` verbatim. */
  headline: {
    globe_obs_in_study_area: number;
    globe_usable_in_study_area: number;
    distinct_sites_in_study_area: number;
    statement: string;
  };
  /** NOT IN CONTRACT. Second AOI at native 10 m over UF campus. */
  campus: {
    aoi_4326: [number, number, number, number];
    resolution_m: number;
    zoom_level: number;
    reitz_union: [number, number]; // [lat, lon] — note the order is reversed
    p50: number;
    p90: number;
    p99: number;
    max: number;
    note: string;
  };
}

// ─── transitions_legend.json ─────────────────────────────────────────────────
/**
 * Keyed by `from_code * 10 + to_code` as a decimal string, NOT zero-padded:
 * water-origin transitions are single digits ("1", not "01"). Parse as integers.
 * Only transitions that actually occur are present — 6 in the real run, not 12.
 */
export interface TransitionLegendEntry {
  from: string;
  to: string;
  label: string;
  category: ChangeCategory;
  category_label: string;
  color: string;
  /** Lower = more important. Real values are ~900-980, not 1-12. Sort ascending. */
  priority: number;
}
export type TransitionLegend = Record<string, TransitionLegendEntry>;

// ─── tasks.geojson ───────────────────────────────────────────────────────────
export interface TaskProps {
  task_id: string;
  rank: number;
  /** [lon, lat] in EPSG:4326 — needs fromLonLat() before use as a map target. */
  centroid: [number, number];
  /** Pre-computed in UTM. NEVER recompute from Web Mercator geometry. */
  area_ha: number;
  change_mean: number;
  change_max: number;
  from_class: ClassCode;
  to_class: ClassCode;
  from_label: string;
  to_label: string;
  transition_code: number;
  /** CONTRACT DIVERGENCE: the field is `change_category`, not `category`. */
  change_category: ChangeCategory;
  category_label: string;
  /** NOT IN CONTRACT. Drives rank. Higher = more urgent. */
  severity_score: number;
  protected_status: 'inside' | 'adjacent' | 'outside';
  /** null when protected_status is 'outside'; always populated when 'adjacent'. */
  protected_name: string | null;
  protected_manager: string | null;
  /** 0 when inside, a real distance when adjacent, null when outside. */
  distance_to_protected_m: number | null;
  /** Pre-built plain-language sentence. Render verbatim. */
  summary: string;

  /**
   * Independent NDVI check from Sentinel-2 surface reflectance.
   *
   * NDVI shares no input with the AlphaEarth embeddings or the Random Forest,
   * so agreement is a genuine out-of-band confirmation, not a restatement.
   * Across the shipped tasks: 32 true, 0 false, 8 null.
   *
   * `ndvi_agrees` is null for hydrologic categories (no direction is predicted)
   * and for patches too small to sample. Render NOTHING for null — never "false".
   */
  ndvi_before: number | null;
  ndvi_after: number | null;
  ndvi_delta: number | null;
  ndvi_agrees: boolean | null;
}

/**
 * candidates.geojson — all 113 pre-quota candidates, for a "show everything"
 * toggle. Same shape as a task but without the queue's rank/quota selection.
 */
export type CandidateProps = Omit<TaskProps, 'rank'> & { rank: number | null };

// ─── globe_points.geojson ────────────────────────────────────────────────────
/**
 * CONTRACT DIVERGENCE: three sources, not two. `analyst_added` does not exist.
 *  - globe_volunteer (148): real GLOBE observations used for training
 *  - osm_derived    (264): OpenStreetMap-derived supplementary labels
 *  - globe_unusable  (10): the Alachua County observations — present but
 *                          missing MucCode, so unusable for modelling.
 *                          These 10 ARE the project's headline. Style them loudest.
 */
export type GlobePointSource = 'globe_volunteer' | 'osm_derived' | 'globe_unusable';

export interface GlobePointProps {
  globe_id: string;
  observed_date: string; // YYYY-MM-DD
  muc_code: string | null;
  class_code: ClassCode | null;
  class_label: string | null;
  used_in_training: boolean;
  source: GlobePointSource;
  osm_tag: string | null;
  /** Pre-computed AOI membership — no client-side filtering needed. */
  in_aoi: boolean;
  /**
   * GLOBE site id, e.g. "17RLN604829". All ten in-AOI observations share one
   * site AND one exact coordinate, so this is the only usable grouping key.
   */
  site_name: string | null;
  /** Why this observation could not be used for modelling. */
  why_unusable: string | null;
}

// ─── protected.geojson ───────────────────────────────────────────────────────
export interface ProtectedProps {
  unit_name: string;
  manager: string;
  own_type: string;
}

// ─── campus_targets.geojson ──────────────────────────────────────────────────
/**
 * NOT IN CONTRACT. Named UF buildings with measured change — a validation set,
 * plus walkable pins routed from the Reitz Union.
 *
 * The argument in three rows: Wertheim (built 2020) reads 98.6th percentile;
 * the Reitz Union (1967) reads 79.7th; Scott Family Hall (finished just before
 * the 2017 composite) reads 84.8th as a second control. Same imagery, same
 * model, 100 m apart. That contrast IS the method explanation.
 */
export interface CampusTargetProps {
  name: string;
  built: number | null;
  kind: 'landmark' | 'walkable_target' | string;
  change: number;
  change_peak: number;
  percentile: number;
  /** Present on walkable_target pins only. */
  walk_m?: number | null;
  walk_min?: number | null;
}

// ─── layer identity ──────────────────────────────────────────────────────────
/** One OpenLayers layer instance. */
export type LayerId =
  | 'basemap-dark'
  | 'basemap-sat'
  | 's2-2017'
  | 's2-2024'
  | 'lulc-2017'
  | 'lulc-2024'
  | 'change'
  | 'campus-change'
  | 'transitions'
  | 'protected'
  | 'globe'
  | 'tasks'
  | 'task-highlight'
  | 'aoi'
  | 'measure'
  | 'pins';

/** One row in the layer panel. A row may front two layer instances (year pairs). */
export type LayerRowId =
  | 'imagery'
  | 'lulc'
  | 'change'
  | 'transitions'
  | 'protected'
  | 'globe'
  | 'tasks'
  | 'aoi';

export type LayerGroup = 'overlay' | 'reference' | 'basemap';

export type BasemapId = 'dark' | 'sat';

export interface LayerRowState {
  id: LayerRowId;
  group: LayerGroup;
  label: string;
  visible: boolean;
  opacity: number;
  /** Position within the group. Lower renders below. */
  order: number;
  /** Only for year-paired rows (imagery, lulc). */
  year?: 2017 | 2024;
  /** True when the underlying file is absent; row renders disabled. */
  unavailable?: boolean;
}

// ─── availability probe ──────────────────────────────────────────────────────
export type AssetAvailability = Record<string, boolean>;

/**
 * Sidecar written by 02_fetch_sentinel2.py next to each S2 COG.
 *
 * `stretch` is the load-bearing field. The shipped COG is Byte, already
 * rescaled by `gdal_translate -scale lo hi 1 255`, so the raw reflectance is
 * NOT in the file the browser downloads. These bounds are the only way to get
 * back to it — see `s2Linear()` in map/styles.ts.
 */
export interface S2Meta {
  year: number;
  dates: string[];
  band_order: string[];
  true_colour_bands: number[];
  false_colour_bands: number[];
  /** Per band code ("B08", "B04", "B03", "B02") -> [lo, hi] in L2A reflectance. */
  stretch: Record<string, [number, number]>;
  tiles: Record<string, { date: string; cloud: number }>;
  collection: string;
  credit: string;
}

/** The two S2 sidecars, keyed by year. */
export interface S2MetaPair {
  2017: S2Meta;
  2024: S2Meta;
}

/** Everything loaded before the map is built. */
export interface AppData {
  stats: Stats;
  legend: TransitionLegend;
  available: AssetAvailability;
}
