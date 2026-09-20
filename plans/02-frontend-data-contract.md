# Frontend Data Contract — v1 (FROZEN)

**Audience: the agent building the OpenLayers frontend, with no access to real data yet.**

This is the complete interface between pipeline and app.

**REAL DATA IS ALREADY BUILT — no fixtures needed.** Every file below exists now at
`processing-pipeline/data/out/`. Copy or symlink that directory to `app/data/` and develop
against the real thing:

```bash
mkdir -p app && ln -s ../processing-pipeline/data/out app/data
```
Numbers in this document are from the live build and are accurate as of 2026-09-20.

If something here is ambiguous, it is a contract bug — flag it rather than guessing.

---

## 0. Projections — non-negotiable

| Thing | CRS | Why |
|---|---|---|
| OpenLayers **view** | **EPSG:3857** | basemap is 3857-only |
| All shipped **rasters** | **EPSG:3857** | zero client reprojection |
| All shipped **vectors** | **EPSG:4326** | RFC 7946; OL reprojects cheaply |
| Internal analysis | EPSG:32617 | never exposed to the app |

```js
new GeoJSON().readFeatures(json, {
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857'
})
```

**Do not compute areas from geometry.** Web Mercator overstates area by 1.32× at this latitude.
Every area you need is a pre-computed attribute in hectares.

---

## 1. AOI and view

```js
// EPSG:4326
export const AOI_4326 = [-82.55, 29.48, -82.15, 29.82];
// EPSG:3857  (use this for view.fit / extent constraints)
export const AOI_3857 = [-9189424.0, 3436882.3, -9144896.2, 3480433.4];

export const VIEW = {
  projection: 'EPSG:3857',
  center: [-9167160.1, 3458657.9],
  zoom: 11, minZoom: 9, maxZoom: 16,
  extent: AOI_3857,          // constrain panning
};
```
Raster grid = **2330 x 2279 px**, native resolution **19.1093 m/px (z13)**. Above z13 OL upsamples — expected, not a bug.

Basemap: `Esri World Imagery`
`https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
Attribution required: `Esri, Maxar, Earthstar Geographics`

---

## 2. Rasters — all `data/*.tif`, COG, EPSG:3857, tiled 512×512, with overviews

| File | Bands | Type | NoData | Meaning |
|---|---|---|---|---|
| `s2_2017.tif` | **4**: NIR,R,G,B | Byte | 0 | Sentinel-2, 2017-12-13. TC = bands 2,3,4; CIR = 1,2,3 |
| `s2_2024.tif` | **4**: NIR,R,G,B | Byte | 0 | Sentinel-2, 2024-12-03. Same band order |
| `change.tif` | 1 | **Float32** | **NaN** | **L3** cosine change, `1 − cos`, range `0.0–1.0` |
| `lulc_2017.tif` | 1 | Byte | 255 | **L1** class code |
| `lulc_2024.tif` | 1 | Byte | 255 | **L2** class code |
| `transitions.tif` | 1 | Byte | 255 | **L4** confirmed transition code |
| `campus_change.tif` | 1 | **Float32** | **NaN** | UF campus at native 10 m (z14) — demo layer |

### 2.1 `change.tif` (L3) — the slider layer
Raw pixel values are the cosine distance directly. **No scaling.** **61,523 NaN pixels (1.2%) occur at the reprojected edges — gate on alpha.** Observed distribution:
`p50≈0.042  p90≈0.083  p95≈0.119  p99≈0.285  max≈0.69`.
Read live breaks from `stats.json`; do not hardcode.

```js
const change = new GeoTIFF({
  sources: [{ url: 'data/change.tif', nodata: NaN }],
  normalize: false,          // REQUIRED — keep raw cosine values
  interpolate: false,
});
// threshold styling, `t` from the slider
color: ['case',
  ['<', ['band', 1], t], [0,0,0,0],
  ['interpolate', ['linear'], ['band', 1],
     t,        [255, 237, 160, 180],
     t + 0.15, [240,  59,  32, 230]]
]
```

> **`normalize: false` AND `interpolate: false` are required on `change.tif`, `lulc_*.tif` and
> `transitions.tif` alike.** OL's default normalisation divides Byte data by 255, so class code
> `3` becomes `0.0118` and every `['==', ['band', 1], 3]` silently matches nothing — a blank
> layer with no error. `interpolate: false` is required on the categorical rasters or resampling
> invents class codes that do not exist.

### 2.2 `lulc_*.tif` (L1/L2) — class codes

| Code | Class | Colour |
|---|---|---|
| `0` | Water / Wetland | `#4A80B5` |
| `1` | Woody | `#2E6B3E` |
| `2` | Herbaceous | `#B8C96B` |
| `3` | Urban / Barren | `#B04A3F` |
| `255` | no data | transparent |

Codes are stable. Colours follow land-cover convention — adjust for contrast if needed, but keep
water blue / woody green / urban red-brown or a geographer judge will find it jarring.

### 2.3 `transitions.tif` (L4) — the headline layer
Value = `from_code * 10 + to_code`. `0` = no confirmed transition. `255` = nodata.
Only off-diagonal pairs occur. Names come from `transitions_legend.json` — **do not hardcode**.

A pixel is non-zero only if `change ≥ p99` **and** class flipped **and** both-year confidence ≥ 0.5.
It is intentionally sparse — expect roughly 0.1–1% of pixels lit. An almost-empty layer is correct,
not a loading failure. Render it on top of everything with full opacity.

---

## 3. Vectors — all `data/*.geojson`, EPSG:4326

### 3.1 `tasks.geojson` — drives the task queue panel
`FeatureCollection` of `Polygon`, pre-sorted by `rank` ascending. ~40 features.

```jsonc
{
  "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[[-82.31,29.66], ...]] },
  "properties": {
    "task_id": "TASK-0001",        // stable; localStorage key
    "rank": 1,                      // 1 = highest priority
    "centroid": [-82.3104, 29.6612],// [lon,lat] — fly-to target
    "area_ha": 12.4,                // computed in UTM
    "change_mean": 0.41,            // mean cosine change in polygon
    "change_max": 0.63,
    "from_class": 1, "to_class": 3,
    "from_label": "Woody", "to_label": "Urban",
    "transition_code": 13,
    "protected_status": "inside",   // "inside" | "adjacent" | "outside"
    "protected_name": "Lochloosa Wildlife Conservation Area",  // null if outside
    "protected_manager": "RWD",     // null if outside
    "distance_to_protected_m": 0,   // 0 when inside
    "change_category": "vegetation_loss",   // see category table below
    "category_label": "Vegetation loss",
    "severity_score": 138.4,        // ranking score; higher = more urgent
    "ndvi_before": 0.7421,          // independent Sentinel-2 check (may be null)
    "ndvi_after": 0.3110,
    "ndvi_delta": -0.4311,
    "ndvi_agrees": true,            // did NDVI move the way this category predicts?
    "summary": "Woody to Urban / Barren, 12.4 ha, inside Lochloosa Wildlife Conservation Area"
  }
}
```
`summary` is a pre-built, non-expert-readable sentence. Use it verbatim in the panel.

**`change_category`** — tasks are ranked by category FIRST, then magnitude. Group or filter by it.

| value | `category_label` | colour | meaning |
|---|---|---|---|
| `vegetation_loss` | Vegetation loss | `#D7301F` | Woody → Herbaceous or Urban/Barren — the conservation alarm |
| `development` | New development | `#EF6548` | Herbaceous → Urban/Barren |
| `hydrologic` | Water / wetland change | `#4A80B5` | anything involving Water/Wetland |
| `revegetation` | Revegetation | `#3E8E5A` | → Woody |
| `other` | Other change | `#999999` | everything else |

> Why this exists: Paynes Prairie is a natural wet prairie whose flooding swings
> year to year. That is a genuine class flip, so ranking on magnitude alone puts
> natural hydrology above actual forest loss. Category keeps the queue honest.
> Read the live list from `stats.categories`, not this table.

**`ndvi_*` — independent corroboration, worth surfacing.** NDVI comes from Sentinel-2
reflectance and shares no input with the embeddings or the classifier. Across all 113 candidates
the directional agreement is **95/95**. Showing a small "✓ confirmed by Sentinel-2 NDVI" badge on
a task is a strong, cheap credibility signal. `ndvi_agrees` is `null` for `hydrologic` (no
direction is predicted) and for patches too small to sample — render nothing, not "false".

### 3.1b `candidates.geojson` — all 113, not just the shipped 40

Same geometry, lighter properties: `change_category`, `area_ha`, `change_mean`, `from_class`,
`to_class`, `severity_score`, `protected_status`, plus the `ndvi_*` fields. Use it if you want a
"show everything" toggle or a category histogram. **`tasks.geojson` is the curated queue** —
quota-selected 24 / 6 / 6 / 4 so every category is represented, then severity-ordered.

### 3.2 `protected.geojson`
`Polygon`/`MultiPolygon`. Properties: `unit_name` (string), `manager` (string), `own_type` (string).
Render as outline only, no fill.

### 3.3 `globe_points.geojson`
`Point`, 422 features. Properties: `globe_id`, `observed_date` (`YYYY-MM-DD`), `muc_code`,
`class_code` (0–3, **may be null**), `class_label` (**may be null**), `used_in_training` (bool),
`source`, `osm_tag`, `in_aoi` (bool), and on unusable points `site_name` + `why_unusable`.

`source` has **three** values — style each distinctly and name all three in the legend:

| `source` | n | meaning |
|---|---|---|
| `globe_volunteer` | 148 | GLOBE observation with a usable MUC code — trained on |
| `globe_unusable` | 10 | GLOBE observation with **no** MUC code — cannot be modelled |
| `osm_derived` | 264 | supplementary label for a class GLOBE could not support |

> **This layer carries the project's argument, so render it deliberately.**
> Filter on `in_aoi` and you get **10 points, all `globe_unusable`, all at ONE site**
> (`17RLN604829`), all within six weeks of late 2025. **Zero** volunteer observations
> in the study area were usable for modelling. An empty "trained on" layer inside the
> AOI is the correct, intended result — not a loading bug. Put that contrast next to
> the 40 ranked tasks; it is the reason the task queue exists.

---

## 4. `data/stats.json`

```jsonc
{
  "generated_utc": "2026-09-20T14:00:00Z",
  "aoi_4326": [-82.55, 29.48, -82.15, 29.82],
  "resolution_m": 19.1093,
  "zoom_level": 13,
  "years": { "before": 2017, "after": 2024 },
  "s2_dates": { "before": "2017-12-13", "after": "2024-12-13" },
  "change": {
    "p50": 0.0648, "p75": 0.1177, "p90": 0.2741,
    "p95": 0.3598, "p99": 0.5010, "p999": 0.6934,
    "max": 0.9446, "mean": 0.1087,
    "l4_threshold": 0.4091,          // the gate L4 actually used
    "l4_percentile": 97,
    "slider_default": 0.4091,        // == l4_threshold, so the app opens aligned with L4
    "slider_min": 0.2741, "slider_max": 0.9446
  },
  "categories": { "vegetation_loss": { "label": "Vegetation loss", "color": "#D7301F" } },
  "campus": { "aoi_4326": [-82.362, 29.634, -82.333, 29.662], "resolution_m": 10,
              "zoom_level": 14, "reitz_union": [29.6462237, -82.347875] },
  "headline": { "globe_obs_in_study_area": 10, "globe_usable_in_study_area": 0,
                "statement": "10 GLOBE land-cover observations exist in the study area; 0 are usable for modelling." },
  "classes": { "0": "Water / Wetland", "1": "Woody", "2": "Herbaceous", "3": "Urban / Barren" },
  "model": {
    "n_train": 372, "n_test": 94, "accuracy": 0.8191,
    "baseline_majority": 0.2876, "n_globe": 148, "n_osm": 318, "note": "..."
  },
  "validation": { "aoi_mean_ndvi_delta": -0.0194,
    "by_category": { "vegetation_loss": { "n": 61, "mean_ndvi_delta": -0.405,
                                          "expected": "down", "agree": 61, "of": 61 } } },
  "counts": { "tasks": 40, "candidates": 124, "transition_px": 15417,
              "globe_trained_in_aoi": 0, "globe_unusable_in_aoi": 10,
              "points_total": 422, "by_category": { "vegetation_loss": 67 } }
}
```
`null` = not yet computed. **Render "—", never "null" or "NaN".**

## 5. `data/transitions_legend.json`
```jsonc
{ "13": { "from": "Woody", "to": "Urban / Barren", "label": "Woody → Urban / Barren",
          "category": "vegetation_loss", "category_label": "Vegetation loss",
          "color": "#D7301F", "priority": 900 } }
```
Live build has **6** entries: `1, 10, 12, 13, 20, 21` (code = `from*10 + to`).
Iterate this to build the L4 legend. Sort by `priority` ascending. Entries exist only for
transitions that actually occur — **do not assume a fixed count.**

---

## 5b. Campus demo layer (`campus_change.tif` + `campus_targets.geojson`)

A second, smaller change raster over UF campus at **native 10 m (z14, 9.5546 m/px)**, covering
`[-82.362, 29.634, -82.333, 29.662]`. The county layer is 20 m, which dilutes building-scale
change; this one resolves it. Show it when the view is zoomed into campus, or behind a
"Campus demo" toggle.

`campus_targets.geojson` — `Point` features, two kinds via `kind`:

| `kind` | properties | use |
|---|---|---|
| `landmark` | `name`, `built`, `change`, `change_peak`, `percentile` | the self-validating demo pair |
| `walkable_target` | `name`, `change`, `percentile`, `walk_m`, `walk_min`, `bearing` | "go verify this" pins |

The demo that sells the whole project, and it is walkable from the venue:

| Landmark | Built | Change | Percentile |
|---|---|---|---|
| Wertheim Laboratory for Engineering Excellence | **2020** | 0.282 | **98.6th** |
| J. Wayne Reitz Union | 1967 | 0.065 | 79.7th |
| Scott Family Hall | Apr 2017 | 0.074 | 84.8th |

Same imagery, same model, 100 m apart: the building that went up reads 98.6th percentile, the one
that did not reads 79.7th. Scott Family Hall is a second control — finished just before the 2017
composite, so "no change" is the right answer. Surface these three together; the contrast IS the
explanation of the method.

## 6. Layer order (bottom → top)

1. Esri World Imagery basemap
2. `s2_2017` / `s2_2024` — swipe or toggle, **mutually exclusive**
3. `lulc_2017` / `lulc_2024` — opacity ~0.65, mutually exclusive, off by default
4. `change` (L3) — opacity ~0.75, **on by default**
5. `transitions` (L4) — full opacity, **on by default**
5b. `campus_change` — only when zoomed to campus / behind a toggle
6. `protected` outlines
7. `globe_points`
8. task pins (numbered by `rank`)
9. `campus_targets` pins — when the campus layer is active

---

## 7. Required UI

- **Threshold slider** — bound to `stats.change.slider_min/max`, initialised at `slider_default`.
  Restyle L3 client-side. This is the demo moment; make it smooth.
- **Year swipe** — 2017 vs 2024 for whichever raster pair is active.
- **Task queue panel** — ranked list; click → `view.animate` to `centroid` + highlight polygon;
  show `summary`, `area_ha`, `change_mean`, `protected_name`.
- **"Mark verified"** — `localStorage`, keyed on `task_id`. **Wrap every read/write in try/catch**
  (private browsing throws). Must render correctly when storage is empty or unavailable.
- **Legend** — classes, transitions, GLOBE point sources.
- **"What am I looking at"** box — plain language, always visible. Non-expert legibility is scored.

## 8. Ground rules

- **No build step.** Plain HTML/JS + OL from CDN.
- All paths **relative** (`data/...`) — deploys to a GitHub Pages subpath.
- **Never fetch a `.tif` with `fetch()`.** `ol/source/GeoTIFF` issues HTTP range requests; a full
  fetch pulls the entire file.
- Every raster may legitimately be absent during development — degrade gracefully, show a placeholder,
  never let one missing layer break the map.
- Total payload ≈ 25–30 MB. Raw sizes at 2330x2279: `change.tif` 21.2 MB raw (~12 MB deflated),
  each S2 COG 15.9 MB raw (~4 MB JPEG-compressed), each `lulc` 5.3 MB raw (<1 MB deflated).

## 9. Contract stability

Frozen: class codes, transition encoding, all property names, file paths, both CRS choices.
May change: exact percentile values, task count, `transitions_legend.json` length, accuracy numbers.
**Read every number from `stats.json`.**
