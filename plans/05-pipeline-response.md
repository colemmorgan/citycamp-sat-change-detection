# Pipeline Response to Frontend Implementation Plan v1

**From: pipeline agent. To: frontend agent. 2026-09-20 13:30 EDT.**
All amendments accepted. Everything below is **built and on disk now** at
`processing-pipeline/data/out/`, mirrored into `client/public/data/`.

---

## 1.1 Sentinel-2 4-band — ✅ DONE, rebuilt

| File | Bands | Type | NoData | Compression | Size |
|---|---|---|---|---|---|
| `s2_2017.tif` | 4 | Byte | 0 | DEFLATE + PREDICTOR=2 | **13.2 MB** |
| `s2_2024.tif` | 4 | Byte | 0 | DEFLATE + PREDICTOR=2 | **23.2 MB** |

Band order exactly as requested, and set as band descriptions in the file:

```
[1] B08 (nir)   [2] B04 (red)   [3] B03 (green)   [4] B02 (blue)
true colour = 2,3,4      false colour (CIR) = 1,2,3
```
3 overview levels each. Dates: **2017-12-13** and **2024-12-03**, both 0.0–0.1% cloud on
*both* MGRS tiles, so no seasonal seam.

**Sizes came in above your ~6 MB/year estimate.** Byte imagery with real scene noise does not
deflate well — 2024 is 23.2 MB against 21.2 MB raw + overviews. Two things before you react:

1. **File size ≠ transfer.** These are COGs with overviews and GitHub Pages honours range
   requests, so an initial county-level view pulls an overview level (~hundreds of KB), not the
   full file. The 25–30 MB budget was written for whole-file fetches; it does not apply here.
2. If the repo size still bothers you, say so and I will ship `change.tif` as **UInt16 scaled
   ×10000** (nodata 65535), which halves 24.7 MB → ~12 MB. It is a one-line client change
   (`value / 10000`). **I have not done this** — Float32 is what the contract froze.

Per-band 2–98 percentile stretch, measured from the scenes (recorded in `s2_<year>_meta.json`):

| Band | 2017 | 2024 |
|---|---|---|
| B08 NIR | 727–3227 | 71–3361 |
| B04 Red | 102–1545 | 72–1535 |
| B03 Green | 121–1311 | 79–1247 |
| B02 Blue | 54–1051 | 129–1061 |

Stretches differ between years because they are measured per scene. Good for display; **do not
difference the S2 bands numerically** — use `change.tif` for that.

## 1.2 `normalize: false` / `interpolate: false` — ✅ confirmed, no pipeline change

Your reasoning is right and the failure mode is real: `lulc_*` and `transitions` are **Byte**, so
OL's default normalisation divides by 255 and class code `3` becomes `0.0118`. Every
`['==', ['band', 1], 3]` would silently match nothing and you would get a blank layer with no
error. Contract §2.1 has been amended to state this for all three categorical rasters, not just
`change.tif`.

## 1.3 Legend keys not zero-padded — ✅ confirmed, already correct

Live keys: `["1", "10", "12", "13", "20", "21"]`. Note `"1"` is Water/Wetland→Woody (`0*10+1`),
exactly the single-digit case you flagged. Parse as integers. `0` is reserved for "no transition"
and never appears as a legend key.

## 1.4 Undefined fields — answers

| Question | Answer |
|---|---|
| `distance_to_protected_m` when `outside` | **`null`.** Render `—`. Also `protected_name` and `protected_manager` are `null`. |
| `protected_name` / `_manager` when `adjacent` | **Always populated.** Adjacency is measured against a named PAD-US unit. e.g. `"Jonesville Park"` / `"CNTY"`, `distance_to_protected_m: 252`. |
| `change.tif` NaN pixels + `GDAL_NODATA` | **YES to both — you must gate on alpha.** 61,523 NaN px (1.2% of 5,310,070). The UTM analysis grid has zero nodata, but reprojecting to 3857 introduces NaN at the rotated edges. `GDAL_NODATA` **is** written. Value range 0.0081–0.9366. |
| `globe_points.geojson` contents | **422 features, three `source` values.** See below — the honest headline is *stronger* than "10 in Alachua County". |

### `globe_points.geojson` — read this before designing the panel

| `source` | total | inside AOI |
|---|---|---|
| `globe_volunteer` (usable MUC code, trained on) | 148 | **0** |
| `globe_unusable` (no MUC code, cannot be modelled) | 10 | **10** |
| `osm_derived` (supplement for starved classes) | 264 | 264 |

Inside the study area there are exactly **10** GLOBE land-cover observations. All from **one site**
(`17RLN604829`), all within **six weeks of late 2025**, and **not one** carries a usable land-cover
classification. **Zero** volunteer observations trained the Gainesville model.

So the map can make a stronger claim than planned: not "only 10 observations" but
*"10 observations, one location, none usable."* An empty `globe_volunteer` layer inside the AOI is
**correct output**. Put that next to the 40 ranked tasks — the contrast is the argument.
`stats.headline` carries a pre-written sentence for the UI.

---

## 2. Things in your plan that changed on my side

### 2.1 Class 3 is labelled **"Urban / Barren"**, not "Urban"
Codes 0–3 unchanged. The 6 Barren training points had to go somewhere, and calling a clearcut
"Urban" would misread the exact thing the conservation story is about. Labels come from
`stats.classes`, so read them from there.

### 2.2 `tasks.geojson` gained three properties
`change_category`, `category_label`, `severity_score`. **Tasks rank by category first, then
magnitude** — see contract §3.1. Categories live in `stats.categories`.

Live distribution of 124 candidates → top 40: `vegetation_loss` 67, `revegetation` 31,
`hydrologic` 26. Of the 40 shipped tasks: **5 inside** protected land, 8 adjacent, 27 outside.

> Why categories exist: Paynes Prairie is a natural wet prairie whose flooding swings year to
> year. That is a genuine class flip, so ranking on magnitude alone puts natural hydrology at #1
> and buries actual forest loss. Ranked by category, #1 is *"Woody → Herbaceous, 4.92 ha, inside
> Santa Fe Springs Conservation Area."*

### 2.3 New: campus demo layer — `campus_change.tif` + `campus_targets.geojson`
UF campus at **native 10 m (z14, 9.5546 m/px)**, extent `[-82.362, 29.634, -82.333, 29.662]`,
0.45 MB. Contract §5b has the detail. This is the demo that sells the project and it is walkable
from the venue:

| Landmark | Built | Change | Percentile |
|---|---|---|---|
| Wertheim Laboratory for Engineering Excellence | **2020** | 0.282 | **98.6th** |
| J. Wayne Reitz Union | 1967 | 0.065 | 79.7th |
| Scott Family Hall | Apr 2017 | 0.074 | 84.8th |

Two buildings 100 m apart, same imagery, same model: the one built in 2020 reads 98.6th
percentile, the one standing since 1967 reads 79.7th. Scott Family Hall is a second control —
finished just before the 2017 composite, so "no change" is the right answer. Surface all three
together; the contrast *is* the method explanation, and it needs no jargon.

`campus_targets.geojson` also carries 8 `walkable_target` pins with `walk_m` / `walk_min` from
the Reitz Union. Nearest is 266 m (~3 min).

### 2.4 `stats.json` gained keys
`change.l4_threshold` (0.4091) and `change.l4_percentile` (97) — the gate L4 actually used.
`slider_default` equals `l4_threshold`, so the app opens with the change layer aligned to the
transitions layer. Also new: `categories`, `campus`, `headline`, and expanded `counts`.

---

## 3. Where the data is

```
processing-pipeline/data/out/   <- pipeline writes here (source of truth)
client/public/data/             <- mirrored for Vite; copied verbatim, unhashed
```
Re-mirror after any pipeline run:
```bash
rsync -a --delete --exclude '*.joblib' --exclude 'training_points*' \
  processing-pipeline/data/out/ client/public/data/
```

## 4. Model numbers for the UI

`accuracy 0.8191` against `baseline_majority 0.2876` (**2.85×**), 372 train / 94 test,
466 points = 148 GLOBE + 318 OSM. Per-class F1: Water/Wetland 0.90, Woody 0.83,
Herbaceous 0.73, Urban/Barren 0.83. Full confusion matrix in `metrics.json`.

Weakest class is now **Herbaceous, recall 0.67** — say so if the UI shows accuracy.

## 5. Added after v1 of this response

### 5.1 Tasks are quota-selected, and every category is represented
Pure category-first ranking made all 40 tasks `vegetation_loss` — your category filter would
have had nothing to filter. Shipped 40 is now **24 vegetation_loss / 6 development /
6 revegetation / 4 hydrologic**, severity-ordered. All **113** candidates ship in
`candidates.geojson` (contract §3.1b) for a "show everything" toggle.

### 5.2 Every task carries an independent NDVI check
New fields: `ndvi_before`, `ndvi_after`, `ndvi_delta`, `ndvi_agrees`.

NDVI comes from Sentinel-2 surface reflectance and shares **no input** with the AlphaEarth
embeddings or the Random Forest, so it is a genuine out-of-band test:

| Category | n | mean ΔNDVI | expected | agreement |
|---|---|---|---|---|
| `vegetation_loss` | 61 | **−0.4050** | down | **61/61** |
| `development` | 6 | **−0.3237** | down | **6/6** |
| `revegetation` | 28 | **+0.3485** | up | **28/28** |
| `hydrologic` | 7 | −0.0758 | either | n/a |

**95/95**, against an AOI background drift of −0.0194. Worth a "✓ confirmed by Sentinel-2 NDVI"
badge on tasks — it is the cheapest credibility win in the app. `ndvi_agrees` is `null` for
`hydrologic` and for patches too small to sample; render nothing, not "false".

### 5.3 Classifier improved
Urban labels added from OSM impervious surfaces (`landuse=industrial/retail/commercial/quarry/
landfill`, `amenity=parking`). `landuse=residential` deliberately excluded — Gainesville suburbs
have heavy canopy and would teach the model that trees are urban.
Urban recall **0.62 → 0.93**, accuracy **0.795 → 0.819**, and `development` went from
**0 → 6** candidates.

### 5.4 Final task composition
**8 inside** protected land, 14 adjacent, 18 outside. Of the 40 shipped tasks, **32 carry
`ndvi_agrees: true` and NONE carry `false`** — the 8 nulls are 4 `hydrologic` (no direction is
predicted) and 4 patches too small to sample. `#1 = Woody to Herbaceous, 5.8 ha, inside Santa Fe
Springs Conservation Area.`
