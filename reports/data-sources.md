# Data Sources and Datasets

**Project:** Satellite change detection + GLOBE Observer tasking for Alachua County, Florida
**Track:** NASA and Environmental Data — CityCamp Gainesville Hack Day, 20 September 2026
**Study area:** `-82.55, 29.48, -82.15, 29.82` (WGS84) — 39.2 × 37.2 km
**Comparison years:** 2017 → 2024

Every dataset below is **public and anonymously accessible**. The project uses no API keys, no
Earth Engine account, no paid tiers, and no credentialed endpoints. Everything is reproducible
from a clean checkout with `./processing-pipeline/run_all.sh`.

---

## 1. Summary

| # | Dataset | Provider | Role | Licence |
|---|---|---|---|---|
| 1 | AlphaEarth Foundations Satellite Embedding V1 | Google / Google DeepMind | change detection + classifier features | CC-BY 4.0 |
| 2 | NASA GLOBE Observer — Land Cover | NASA GLOBE Program | training labels; the project's central evidence | Open (NASA GLOBE) |
| 3 | Sentinel-2 L2A (COG) | ESA Copernicus, via AWS Earth Search | before/after imagery + independent validation | Copernicus open data |
| 4 | PAD-US (Protected Areas Database of the US) | USGS | conservation boundaries, task ranking | Public domain (US Gov) |
| 5 | OpenStreetMap | OSM contributors, via Overpass | supplementary land-cover labels | ODbL |
| 6 | Esri World Imagery | Esri / Maxar / Earthstar | app satellite basemap | Esri terms, attribution required |
| 7 | Esri Dark Gray Canvas | Esri | app reference basemap | Esri terms, attribution required |

**Curriculum used:** EMERGE **Textbook 2 — Geospatial AI**, **Chapter 5, Lesson 1**,
*"Mapping Land Cover From GLOBE Data and Satellite Embeddings."*

**`geoemerge` package: not used.** The curriculum method was reimplemented directly against the
public COG mirror so that it runs **without an Earth Engine account** — see §9.

---

## 2. AlphaEarth Foundations Satellite Embedding V1

The core dataset. A 64-dimensional learned embedding per 10 m pixel per year, summarising a full
year of satellite observation.

| | |
|---|---|
| **Canonical catalogue** | https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL |
| **Access used** | https://source.coop/tge-labs/aef — public COG mirror, anonymous S3 (`us-west-2.opendata.source.coop`) |
| **Licence** | CC-BY 4.0 |
| **Required attribution** | *"The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind."* |
| **Coverage used** | 2017 and 2024, UTM zone 17N, EPSG:32617 |
| **Native resolution** | 10 m, 64 bands (`A00`–`A63`), int8 |
| **Volume read** | 4 tiles (2 per year); ~214 MB per year after windowing to the study area |

**Why the mirror and not Earth Engine.** The curriculum lesson sources these embeddings from
Earth Engine, which requires an approved account. We had none, and approval is not something to
depend on during a one-day event. The Source Cooperative mirror is the identical dataset,
published as Cloud-Optimized GeoTIFFs, readable anonymously.

**Two properties that must be handled correctly:**

1. **The COGs are stored bottom-up.** Reading the `.tiff` directly yields vertically flipped data
   with a positive y-resolution. The sibling `.vrt` corrects this on the fly and is what the
   pipeline reads.
2. **Values are quantised int8** and must be de-quantised before any arithmetic:
   `((v / 127.5) ** 2) * sign(v)`. NoData is `-128`, and if present in one band it is present in
   all 64. After de-quantisation, vector norms measured 0.9915–1.0092 (mean 1.0001), confirming
   unit length — which is why cosine similarity reduces to a dot product.

A companion index (`aef_index.csv`, ~800 MB) maps tiles to geography, since filenames encode
nothing spatial. The pipeline streams it once, filters to Florida (621 tiles), and caches the
151 KB result.

## 3. NASA GLOBE Observer — Land Cover

Participatory science observations. Volunteers photograph a site in four directions and classify
land cover using MUC (Modified UNESCO Classification) codes.

| | |
|---|---|
| **API** | `https://api.globe.gov/search/v1/measurement/protocol/measureddate/lat/lon/` |
| **Protocol** | `land_covers` |
| **Query window** | 2017-01-01 to 2025-12-31, Florida bounding box |
| **Records returned** | **691** statewide |
| **Records with a usable MUC code** | **148** (543 have `MucCode: null`) |
| **Records inside the study area** | **10** |
| **Usable records inside the study area** | **0** |

**This dataset is both an input and the project's central finding.** Inside the study area there
are exactly 10 land-cover observations. All are from **one site** (`17RLN604829`), all fall within
a **six-week window in late 2025**, and **not one** carries a usable land-cover classification.
Zero volunteer observations from the study area could train the model.

That gap is the reason the project exists: change detection produces a ranked, finite list of
places worth visiting, which is what makes contributing an observation worth the effort.

> The `mosquito_habitat_mapper` protocol was also queried — 633 records statewide, **3** in
> Alachua County. Too sparse to model; reported as a finding, not used as an input.

MUC codes are prefixed `M` (e.g. `M91`, `M1121`); the Level-1 class is the first digit *after*
stripping that prefix.

## 4. Sentinel-2 Level-2A

Used twice, and the second use is the more important one.

| | |
|---|---|
| **STAC API** | https://earth-search.aws.element84.com/v1 (Element 84) |
| **Collection** | `sentinel-2-l2a` |
| **Storage** | `s3://sentinel-cogs/`, public, anonymous |
| **Licence / credit** | *"Contains modified Copernicus Sentinel data, processed by ESA."* COG access by Element 84. |
| **Scenes used** | **2017-12-13** and **2024-12-03** |
| **Cloud cover** | 0.1% and 0.0% — on **both** MGRS tiles |
| **Tiles** | 17RLN + 17RLP (the study area straddles both) |
| **Bands** | B08 (NIR), B04 (Red), B03 (Green), B02 (Blue) |

December scenes were chosen deliberately: Florida's dry season is the only reliably clear window,
and both years landed a date that is clear on both tiles, so the mosaics carry no seasonal seam
and the before/after comparison is phenologically honest.

**Use 1 — imagery.** Shipped as one 4-band COG per year (true colour = bands 2,3,4;
false-colour infrared = bands 1,2,3), stretched per band to 8-bit for display.

**Use 2 — independent validation.** NDVI, computed as `(B08 − B04) / (B08 + B04)` from the **raw
16-bit reflectance**, shares no input with the AlphaEarth embeddings or the Random Forest. It is
therefore a genuine out-of-band test of whether the detected change categories are real:

| Category | n | mean ΔNDVI | expected | agreement |
|---|---|---|---|---|
| Vegetation loss | 61 | −0.4050 | down | **61 / 61** |
| New development | 6 | −0.3237 | down | **6 / 6** |
| Revegetation | 28 | +0.3485 | up | **28 / 28** |
| Water / wetland change | 7 | −0.0758 | no direction predicted | n/a |

**95 / 95 directional agreement**, against an area-wide background drift of only −0.0194 — the
category signals are 17–21× background.

> NDVI is never computed from the shipped display COG. That file is stretched to 8-bit
> per scene with different per-year stretches, which would make cross-year NDVI meaningless.

## 5. PAD-US — Protected Areas Database of the United States

| | |
|---|---|
| **Service** | `https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name/FeatureServer/0` |
| **Provider** | USGS |
| **Licence** | Public domain (US Government) |
| **Features used** | **216** units intersecting the study area |

Supplies the conservation framing: each detected change is tagged `inside`, `adjacent` (within
500 m), or `outside` protected land, and that status feeds the task ranking. Named units include
Lochloosa Wildlife Conservation Area, Newnans Lake Conservation Area, Santa Fe Springs
Conservation Area, Longleaf Flatwoods Reserve, Paynes Prairie Preserve State Park, and the
Georgia Pacific–Lochloosa Conservation Easement.

> An alternative PAD-US endpoint (`USA_Protected_Areas_State`) requires a token and was not used.

## 6. OpenStreetMap

| | |
|---|---|
| **API** | https://overpass-api.de/api/interpreter (fallback mirror: https://overpass.kumi.systems/) |
| **Licence** | **ODbL** — © OpenStreetMap contributors — https://www.openstreetmap.org/copyright |

Supplies supplementary training labels for the classes GLOBE could not support. **Disclosed, not
hidden:** every derived point is tagged `source: "osm_derived"` in the shipped data and is styled
separately in the app legend.

| Query | Elements | Tags used | Maps to |
|---|---|---|---|
| `osm_water.json` | 4,729 | `natural=water`; `natural=wetland` (`marsh`, `wet_meadow`, `bog`) | Water / Wetland |
| | | `natural=wetland` + `wetland=swamp` | **Woody** — see note |
| `osm_wood.json` | 3,023 | `natural=wood`, `landuse=forest` | Woody |
| `osm_herb.json` | 2,395 | `landuse=farmland/meadow/grass/orchard`, `natural=grassland` | Herbaceous |
| `osm_urban.json` | 1,342 | `landuse=industrial/retail/commercial/quarry/landfill`, `amenity=parking` | Urban / Barren |

**Two tagging decisions that materially changed the result:**

- **`wetland=swamp` is mapped to Woody, not Water.** In north Florida, swamp is cypress/tupelo
  *forest* — structurally woody. 2,727 of 3,776 wetland polygons carry this tag. Sampling them as
  water made the model classify 22% of the county as water and collapsed the Herbaceous class to
  0.2% of the map.
- **`landuse=residential` is deliberately excluded.** Gainesville's suburbs carry heavy tree
  canopy; sampling them would teach the model that tree cover means urban. Restricting urban
  labels to impervious surfaces lifted Urban recall from 0.62 to 0.93.

**Final training set: 466 points = 148 GLOBE volunteer + 318 OSM-derived.**

| Class | GLOBE | OSM | Total |
|---|---|---|---|
| Water / Wetland | 3 | 84 | 87 |
| Woody | 23 | 90 | 113 |
| Herbaceous | 44 | 90 | 134 |
| Urban / Barren | 78 | 54 | 132 |

## 7. Frontend-only sources

Everything the app displays is self-hosted **except the basemaps**. There is no client-side call
to any data API — all satellite and environmental data is pre-processed into local COGs.

| Source | Use | Attribution required |
|---|---|---|
| [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | satellite basemap | Esri, Maxar, Earthstar Geographics |
| [Esri Dark Gray Canvas](https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer) | reference basemap | Esri |
| [Google Fonts](https://fonts.googleapis.com/) — Funnel Display, Funnel Sans | typography (not data) | SIL Open Font License |

## 8. Derived artifacts produced by this project

Generated by the pipeline and served by the app. All rasters are EPSG:3857 at
web-Mercator z13 (19.1093 m/px), 2330 × 2279 px; all vectors are EPSG:4326.

| File | Type | Contents |
|---|---|---|
| `change.tif` | Float32 COG | Cosine change `1 − cos(e₂₀₁₇, e₂₀₂₄)` |
| `lulc_2017.tif` / `lulc_2024.tif` | Byte COG | 4-class land cover per year |
| `transitions.tif` | Byte COG | Confirmed class transitions (gated) |
| `s2_2017.tif` / `s2_2024.tif` | 4-band Byte COG | Sentinel-2 NIR/R/G/B |
| `campus_change.tif` | Float32 COG | UF campus at native 10 m (z14) |
| `tasks.geojson` | Polygon | 40 ranked verification tasks |
| `candidates.geojson` | Polygon | all 113 detected changes |
| `protected.geojson` | Polygon | 216 PAD-US units |
| `globe_points.geojson` | Point | 476 observation points, 3 provenance classes |
| `campus_targets.geojson` | Point | 3 landmarks + 8 walkable targets |
| `stats.json`, `metrics.json`, `transitions_legend.json` | JSON | statistics, model metrics, legend |

Analysis is performed in **EPSG:32617** and only the results are reprojected. Embeddings are
never reprojected before the cosine is computed — resampling would interpolate the vector
components and break unit length, silently corrupting the result.

## 9. Curriculum and the `geoemerge` package

**Curriculum used:** EMERGE **Textbook 2 — Geospatial AI**, **Chapter 5, Lesson 1** —
*"Mapping Land Cover From GLOBE Data and Satellite Embeddings"*
https://geo-di-lab.github.io/emerge-geoai/docs/ch5/lesson1.html

The lesson's method is the spine of the land-cover component: sample satellite embeddings at
participatory-science observation points, train a Random Forest on all 64 bands, apply it to the
region. Documented deviations:

1. Embeddings read from the public COG mirror rather than Earth Engine.
2. The 10 MUC Level-1 classes collapsed to 4 (four classes had fewer than 5 examples statewide).
3. `sklearn.RandomForestClassifier` in place of `ee.Classifier.smileRandomForest`.
4. Sparse classes augmented from OpenStreetMap (§6).

Result: **0.8191 accuracy against a 0.2876 majority-class baseline** (2.85×), 372 train / 94 test.
For reference, the lesson reports 43.75% on 10 classes, below its own 48.6% baseline.

**`geoemerge` was not used.** The lesson's workflow depends on Earth Engine, and the point of this
implementation was to make it runnable by anyone without an Earth Engine account. The reimplementation
against the public COG mirror is offered back to EMERGE as a contribution in its own right.

## 10. Software

| Library | Use | Licence |
|---|---|---|
| [GDAL/OGR](https://gdal.org/) 3.13 (+ `osgeo` Python bindings) | all raster/vector I/O, warping, COG writing, polygonize, rasterize | MIT |
| [NumPy](https://numpy.org/) | cosine change, de-quantisation, zonal statistics | BSD-3-Clause |
| [scikit-learn](https://scikit-learn.org/) | Random Forest, train/test split, metrics | BSD-3-Clause |
| [joblib](https://joblib.readthedocs.io/) | model serialisation | BSD-3-Clause |
| [OpenLayers](https://openlayers.org/) | map rendering, COG reading via `ol/source/GeoTIFF` | BSD-2-Clause |
| [React](https://react.dev/), [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/) | application framework and build | MIT / MIT / Apache-2.0 |
| [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), [Radix UI](https://www.radix-ui.com/), [lucide](https://lucide.dev/) | styling and components | MIT |
| [TanStack Router](https://tanstack.com/router), [zustand](https://zustand.docs.pmnd.rs/), [zod](https://zod.dev/) | routing, state, validation | MIT |

The pipeline uses the Python standard library for all HTTP. No `requests`, `geopandas`,
`rasterio` or `shapely` — point-in-polygon, polygon area and the Overpass client are implemented
directly, keeping the dependency surface at GDAL + NumPy + scikit-learn.

## 11. Reproducibility

```bash
./processing-pipeline/run_all.sh     # cold start to shipped artifacts, ~10 min
```

Requires GDAL ≥ 3.8 with Python bindings and Python 3.11+. The script creates its own virtual
environment and installs the two remaining dependencies. Every stage is idempotent, so a failed
run resumes rather than restarting, and no stage requires credentials.

Method notes, known limitations and per-class metrics: `processing-pipeline/README.md`.
Live-probed source facts, including access patterns and data-format hazards:
`plans/00-verified-facts.md`.
