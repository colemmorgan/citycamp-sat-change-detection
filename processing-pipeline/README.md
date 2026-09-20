# Processing Pipeline

Builds every data artifact the map app serves. No Earth Engine account, no API keys,
no backend — every source is anonymously accessible, and the whole thing runs from one script.

```bash
./run_all.sh          # cold start to shipped artifacts, ~10 min
```

Artifacts land in `data/out/`. The app reads that directory directly.

## Requirements

- **GDAL ≥ 3.8 with Python bindings** (`osgeo`) — `brew install gdal` on macOS
- **Python 3.11+**
- `run_all.sh` creates `.venv` with `--system-site-packages` (to inherit the GDAL bindings)
  and pip-installs `scikit-learn` + `joblib`. Nothing else.

## What it does

| Stage | Script | Output | ~Time |
|---|---|---|---|
| A0 | `00_fetch_osm.py` | OSM label polygons (cached; retries across mirrors) | 1 min |
| A1 | `01_fetch_embeddings.py` | AlphaEarth 64-band mosaics, 2017 & 2024, 20 m UTM | 7 min |
| A2 | `02_fetch_sentinel2.py` | `s2_2017.tif`, `s2_2024.tif` true colour | 20 s |
| C1 | `03_globe_training.py` | GLOBE labels + embeddings sampled at each point | 2.5 min |
| B | `04_change.py` | `change.tif` (L3), `stats.json` | 5 s |
| C2 | `05_augment_labels.py` | OSM supplements for starved classes | 10 s |
| C3 | `06_train_classify.py` | `lulc_2017.tif`, `lulc_2024.tif` (L1/L2), `metrics.json` | 15 s |
| D1 | `07_transitions_tasks.py` | `transitions.tif` (L4), `tasks.geojson`, `protected.geojson` | 5 s |
| D2 | `08_globe_points.py` | `globe_points.geojson` | 1 s |
| E | `09_campus_demo.py` | `campus_change.tif` at native 10 m, `campus_targets.geojson` | 30 s |
| F | `10_validate_ndvi.py` | independent NDVI validation, writes `ndvi_*` onto every task | 5 s |

All stages are **idempotent** — each skips work already on disk, so re-running costs nothing
and a failed run resumes rather than restarting.

## Method

### Change detection (L3)
`change = 1 − cos(e₂₀₁₇, e₂₀₂₄)` over AlphaEarth's 64-dimensional embeddings.
The vectors are unit-length after de-quantization, so cosine is the dot product —
the approach Google's own documentation prescribes for this dataset.

Computed on the **native EPSG:32617 grid**. Reprojecting embeddings first would interpolate
their components and break unit length, silently corrupting the cosine.

### Land cover (L1/L2)
Follows **EMERGE Textbook 2 (Geospatial AI), Chapter 5 Lesson 1 —
"Mapping Land Cover From GLOBE Data and Satellite Embeddings"**:
sample satellite embeddings at participatory-science observation points, train a Random Forest
on all 64 bands, apply it to the region.

**Deviations from the lesson, and why:**

1. **Embeddings from the public COG mirror, not Earth Engine.** The lesson requires an
   Earth Engine account. We had none and approval is not something to gamble a hackathon on,
   so we read the same data from Source Cooperative over anonymous S3.
   *This makes the lesson runnable by anyone with no EE account.*
2. **10 MUC Level-1 classes collapsed to 4.** Statewide Florida yields 148 labelled points;
   4 of the 10 classes have fewer than 5 examples. The lesson's own reported accuracy is
   **43.75%**, which is *below* its 48.6% majority-class baseline.
3. **`sklearn.RandomForestClassifier`** in place of `ee.Classifier.smileRandomForest`.
4. **Sparse classes augmented from OSM** — see below.

**Result: 81.9% accuracy against a 28.8% majority-class baseline** (2.85×), on 94 held-out
samples, 372 train / 94 test.

| Class | Precision | Recall | F1 |
|---|---|---|---|
| Water / Wetland | 1.00 | 0.82 | 0.90 |
| Woody | 0.80 | 0.87 | 0.83 |
| Herbaceous | 0.82 | 0.67 | 0.73 |
| Urban / Barren | 0.76 | 0.93 | 0.83 |

### Label augmentation — disclosed
GLOBE gives 3 Water/Wetland and 23 Woody points statewide. That cannot be learned, in a county
defined by Paynes Prairie, Newnans Lake and working timberland. We sampled supplementary labels
from OSM polygons for the starved classes only; Urban/Barren (78) and Herbaceous (44) stay pure
volunteer data. Every augmented point carries `source: "osm_derived"` and is styled separately
in the app legend.

Final training set: **466 points = 148 GLOBE volunteer + 318 OSM-derived.**

| Class | GLOBE | OSM source | total |
|---|---|---|---|
| Water / Wetland | 3 | `natural=water`, `wetland=marsh/wet_meadow/bog` | 87 |
| Woody | 23 | `natural=wood`, `landuse=forest`, `wetland=swamp` | 113 |
| Herbaceous | 44 | `landuse=farmland/meadow/grass/orchard`, `natural=grassland` | 134 |
| Urban / Barren | 78 | `landuse=industrial/retail/commercial/quarry/landfill`, `amenity=parking` | 132 |

**`landuse=residential` is deliberately excluded.** Gainesville suburbs carry heavy tree canopy;
sampling them teaches the model that canopy means urban — the exact Urban↔Herbaceous confusion
we were fixing. Restricting Urban labels to impervious surfaces lifted Urban recall
**0.62 → 0.93** and overall accuracy **0.795 → 0.819**.

> One correction worth recording: our first pass sampled all OSM `natural=wetland` polygons as
> Water/Wetland. In north Florida **2,727 of 3,776 of those are `wetland=swamp`** — forested
> wetland, structurally *woody*. That single mistake made the model call 22% of the county water
> and collapsed Herbaceous to 0.2% of the map. `wetland=swamp` is now mapped to **Woody**.

### Confirmed transitions (L4)
```
L4 = (change ≥ p97) ∧ (class₂₀₁₇ ≠ class₂₀₂₄) ∧ (min confidence ≥ 0.5) ∧ (patch ≥ 1 ha)
```
16.5% of pixels flip class, but the flips are near-symmetric — 81,038 Herbaceous→Woody against
92,096 Woody→Herbaceous (ratio 0.88). Balanced two-way exchange across a decision boundary is the
signature of classifier flicker; real landscape change is directional. Cosine change is computed
from the embeddings with no shared parameters with the classifier, so it suppresses that flicker,
and the 1 ha contiguity filter removes the rest because real land change is contiguous while
flicker is salt-and-pepper.

The gate demonstrably works: after gating, the same pair becomes 6,167 Woody→Herbaceous against
2,945 Herbaceous→Woody — ratio 0.48. A filter removing pixels at random would preserve the 0.88
symmetry; instead a balanced exchange becomes a 2:1 directional bias toward vegetation loss.

Full method, validation and limitations: `reports/methods.md`.

### Task ranking
Ranked by **category first**, then magnitude, area, and protected-area status.

| Category | Base | Meaning |
|---|---|---|
| `vegetation_loss` | 100 | Woody → Herbaceous / Urban — the conservation alarm |
| `development` | 70 | Herbaceous → Urban |
| `revegetation` | 30 | → Woody |
| `hydrologic` | 20 | anything involving Water/Wetland |

Paynes Prairie is a natural wet prairie whose flooding swings year to year — a genuine class
flip. Ranking on magnitude alone would put natural hydrology at #1 and bury actual forest loss.
Category is what keeps the queue honest.

**Quota selection.** Pure category-first ranking made all 40 shipped tasks `vegetation_loss`,
which hid the 6 development findings and left the UI category filter with nothing to filter.
The shipped 40 are quota-selected — 24 / 6 / 6 / 4 — and severity-ordered within and across.
All 113 candidates ship in `candidates.geojson`.

### Independent validation (Stage F)

The task queue is built from AlphaEarth embeddings and a Random Forest. NDVI is computed from
Sentinel-2 surface reflectance (B08, B04) and shares **no input** with either. If the categories
are real, NDVI must move the way each one predicts.

| Category | n | mean ΔNDVI | expected | agreement |
|---|---|---|---|---|
| `vegetation_loss` | 61 | **−0.4050** | down | **61/61** |
| `development` | 6 | **−0.3237** | down | **6/6** |
| `revegetation` | 28 | **+0.3485** | up | **28/28** |
| `hydrologic` | 7 | −0.0758 | either | n/a |

**95/95 directional agreement**, against an AOI-wide background drift of only −0.0194 — the
category signals are 17–21× background. Every task carries `ndvi_before`, `ndvi_after`,
`ndvi_delta` and `ndvi_agrees`.

> NDVI is computed from the **raw UInt16 reflectance** in `data/raw/`, never from the shipped
> display COG. That COG is stretched to Byte per scene with different per-year stretches, which
> would make cross-year NDVI meaningless.

## Known limitations

- **Herbaceous recall is 0.67** — the weakest class after the urban fix. Some herbaceous ground
  is called Urban/Barren, so `development` counts are an upper bound.
- **Only 6 `development` candidates.** Real, and all 6 confirmed by NDVI, but a small sample.
- **20 m dilutes building-scale change.** The Wertheim Lab (built 2020) reads 88th percentile
  at 20 m but **98.6th at 10 m**. Stage E rebuilds campus at native 10 m for this reason.
- **Embedding change means "this place looks different to the model"** — not "a tree was cut
  down." That ambiguity is why a human has to go look, which is the point of the product.
- The classifier trained on **zero** volunteer observations from inside the study area.
  See below.

## The finding

Inside the study area there are exactly **10 GLOBE land-cover observations**. All from **one
site** (`17RLN604829`), all within **six weeks of late 2025**, and **not one** carries a usable
land-cover classification. Zero volunteer points trained the Gainesville model.

That is not a data-quality footnote. It is the reason the task queue exists.

## Data sources and credits

| Source | Use | Licence / credit |
|---|---|---|
| [AlphaEarth Foundations Satellite Embedding](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL) via [Source Cooperative `tge-labs/aef`](https://source.coop/tge-labs/aef) | change detection + classifier features | CC-BY 4.0 — "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind." |
| [NASA GLOBE Observer](https://api.globe.gov/) land cover | training labels, and the project's central evidence | NASA GLOBE Program |
| [Sentinel-2 L2A](https://earth-search.aws.element84.com/v1) COGs via AWS Earth Search | before/after imagery | Contains modified Copernicus Sentinel data, processed by ESA. COG access by Element 84. |
| [PAD-US](https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name/FeatureServer/0) | protected-area boundaries | USGS Protected Areas Database of the United States |
| [OpenStreetMap](https://www.openstreetmap.org/) via [Overpass API](https://overpass-api.de/) (mirror: [Kumi Systems](https://overpass.kumi.systems/)) | supplementary land-cover labels for classes GLOBE could not support | © OpenStreetMap contributors, **ODbL** — https://www.openstreetmap.org/copyright |
| [EMERGE Textbook 2, Ch5 L1](https://geo-di-lab.github.io/emerge-geoai/docs/ch5/lesson1.html) | the classification method | EMERGE / GeoDI Lab, University of Florida |
| [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | app basemap (the only layer we do not own) | Esri, Maxar, Earthstar Geographics |

`geoemerge` was **not** used — the curriculum method was reimplemented directly against the
COG mirror so it runs without an Earth Engine account.

## Software and libraries

| Library | Use | Licence |
|---|---|---|
| [GDAL/OGR](https://gdal.org/) 3.13 + `osgeo` Python bindings | all raster/vector I/O, warping, COG writing, polygonize, rasterize | MIT |
| [NumPy](https://numpy.org/) | cosine change, de-quantization, zonal statistics | BSD-3-Clause |
| [scikit-learn](https://scikit-learn.org/) | `RandomForestClassifier`, train/test split, metrics | BSD-3-Clause |
| [joblib](https://joblib.readthedocs.io/) | model serialisation | BSD-3-Clause |
| [OpenLayers](https://openlayers.org/) | map rendering in the app (COG via `ol/source/GeoTIFF`) | BSD-2-Clause |

Standard library only for HTTP — no `requests`, no `geopandas`, no `rasterio`, no `shapely`.
Point-in-polygon, shoelace area and the Overpass client are ~40 lines in
`05_augment_labels.py` / `00_fetch_osm.py`, which keeps the dependency surface to
GDAL + NumPy + scikit-learn.

## Reuse

`config.py` holds every constant. To move the analysis somewhere else, change `AOI_4326`,
re-derive `AOI_UTM` / `AOI_3857`, and look up the covering tiles in `aef_index.csv`
(see `plans/00-verified-facts.md`). Nothing else is Gainesville-specific.
