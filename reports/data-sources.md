# Data Sources

**Study area:** `-82.55, 29.48, -82.15, 29.82`. 39.2 km by 37.2 km.
**Years compared:** 2017 and 2024.

Every dataset below is public. Access needs no API key, no account, and no payment. The
pipeline runs from a clean copy of the repository with `./processing-pipeline/run_all.sh`.

For the method, read [`methods.md`](methods.md).

---

## 1. Summary

| # | Dataset | Provider | Use | Licence |
|---|---|---|---|---|
| 1 | AlphaEarth Foundations Satellite Embedding V1 | Google and Google DeepMind | Change detection and model input | CC-BY 4.0 |
| 2 | NASA GLOBE Observer, Land Cover | NASA GLOBE Program | Training labels | Open |
| 3 | Sentinel-2 L2A | ESA Copernicus, through AWS Earth Search | Images and independent test | Copernicus open data |
| 4 | PAD-US | United States Geological Survey | Protected area borders | Public domain |
| 5 | OpenStreetMap | OpenStreetMap contributors | Extra training labels | ODbL |
| 6 | Esri World Imagery | Esri, Maxar, Earthstar | Map background | Esri terms |
| 7 | Esri Dark Gray Canvas | Esri | Map background | Esri terms |

**Curriculum used:** EMERGE Textbook 2 (Geospatial AI), Chapter 5, Lesson 1: "Mapping Land
Cover From GLOBE Data and Satellite Embeddings".

**We did not use the `geoemerge` package.** We wrote the lesson method again in Python. The
new code does not need an Earth Engine account. See section 9.

---

## 2. AlphaEarth Foundations Satellite Embedding V1

This is the main dataset. It gives 64 numbers for each 10 m pixel for each year. The numbers
describe one year of satellite observation.

| Item | Value |
|---|---|
| Catalogue | https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL |
| Access used | https://source.coop/tge-labs/aef (public mirror, anonymous S3) |
| Licence | CC-BY 4.0 |
| Years used | 2017 and 2024 |
| Projection | EPSG:32617 (UTM zone 17N) |
| Resolution | 10 m, 64 bands (`A00` to `A63`), 8-bit integers |
| Volume read | 4 files. Approximately 214 MB for each year after we cut to the study area. |

**Required credit:** "The AlphaEarth Foundations Satellite Embedding dataset is produced by
Google and Google DeepMind."

**Why we use the mirror.** The lesson reads these values from Earth Engine. Earth Engine needs
an approved account. We have no account. The mirror holds the same data as Cloud-Optimized
GeoTIFF files. Access needs no account.

### Two properties you must handle

1. **The files store rows from the bottom up.** The `.tiff` file gives flipped data with a
   positive y resolution. The `.vrt` file beside it gives the correct row order. The pipeline
   reads the `.vrt` file.
2. **The values are 8-bit integers.** Apply `((v / 127.5) ** 2) * sign(v)` before any
   calculation. The no-data value is −128. If one band holds −128, all 64 bands hold −128.
   We measured the vector lengths after this step. They were 0.9915 to 1.0092, with a mean of
   1.0001.

The file names hold no position data. An index file (`aef_index.csv`, approximately 800 MB)
maps files to areas. The pipeline reads this file one time. It keeps the 621 Florida rows as a
151 KB file.

---

## 3. NASA GLOBE Observer, Land Cover

Volunteers photograph a site in four directions. They then classify the land cover with MUC
codes.

| Item | Value |
|---|---|
| API | `https://api.globe.gov/search/v1/measurement/protocol/measureddate/lat/lon/` |
| Protocol | `land_covers` |
| Query | 2017-01-01 to today, Florida area |
| Records returned | **691** for Florida |
| Records with a usable MUC code | **148** |
| Records inside the study area | **29** (11 sites, 7 people) |
| Usable records inside the study area | **0** |

**This dataset is both an input and the main finding.** The study area holds 29 land cover
observations from 11 sites and 7 people, across 2025 and 2026. Not one holds a usable land
cover code.

The problem is not the number of people. People do go out. They take photographs, record
ground conditions, and write notes. Several 2026 notes describe change directly: "New building
to north", "LCMS change", "Student Health Care building finished in 2022". The missing part is
always the MUC classification step. That step is the only part that makes a label a model can
use.

MUC codes carry an `M` prefix, for example `M91` and `M1121`. Remove the `M` before you read
the first digit.

We also queried the `mosquito_habitat_mapper` protocol. It gives 633 records for Florida and
3 for Alachua County. This is too few to model. We did not use it.

---

## 4. Sentinel-2 Level-2A

We use this dataset two times.

| Item | Value |
|---|---|
| STAC API | https://earth-search.aws.element84.com/v1 (Element 84) |
| Collection | `sentinel-2-l2a` |
| Storage | `s3://sentinel-cogs/`, public, anonymous |
| Scenes used | **2017-12-13** and **2024-12-03** |
| Cloud cover | 0.1% and 0.0%, on both tiles |
| Tiles | 17RLN and 17RLP |
| Bands | B08 (near infrared), B04 (red), B03 (green), B02 (blue) |

**Credit:** "Contains modified Copernicus Sentinel data, processed by ESA." Element 84 gives
the COG access.

We chose December scenes. The Florida dry season is the only reliable clear period. Both years
gave a date that is clear on both tiles. The two images therefore hold no seasonal edge.

**Use 1: images.** One 4-band file for each year. True colour uses bands 2, 3, and 4. False
colour uses bands 1, 2, and 3. We stretch the values to 8 bits for the map.

**Use 2: independent test.** We calculate NDVI as `(B08 − B04) / (B08 + B04)` from the raw
16-bit values. NDVI shares no input with the AlphaEarth data or the Random Forest. It is
therefore a separate test of each change category.

| Category | n | Mean ΔNDVI | Prediction | Agreement |
|---|---|---|---|---|
| Vegetation loss | 61 | −0.4050 | down | **61 / 61** |
| New development | 6 | −0.3237 | down | **6 / 6** |
| Revegetation | 28 | +0.3485 | up | **28 / 28** |
| Water and wetland change | 7 | −0.0758 | none | — |

**95 of 95 agree.** The area-wide mean change is −0.0194. The category values are 17 to 21
times this background value.

We do not calculate NDVI from the 8-bit map file. That file uses a different stretch for each
year. Cross-year NDVI from that file has no meaning.

---

## 5. PAD-US, Protected Areas Database of the United States

| Item | Value |
|---|---|
| Service | `https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name/FeatureServer/0` |
| Provider | United States Geological Survey |
| Licence | Public domain |
| Features used | **216** units that touch the study area |

Each detected change gets a status: `inside`, `adjacent` (within 500 m), or `outside`. This
status changes the rank of the site.

Named units include Lochloosa Wildlife Conservation Area, Newnans Lake Conservation Area,
Santa Fe Springs Conservation Area, Longleaf Flatwoods Reserve, Paynes Prairie Preserve State
Park, and the Georgia Pacific-Lochloosa Conservation Easement.

A second PAD-US service (`USA_Protected_Areas_State`) needs a token. We did not use it.

---

## 6. OpenStreetMap

| Item | Value |
|---|---|
| API | https://overpass-api.de/api/interpreter |
| Second server | https://overpass.kumi.systems/ |
| Licence | **ODbL**. © OpenStreetMap contributors. https://www.openstreetmap.org/copyright |

GLOBE gives too few points for two of the four classes. OpenStreetMap gives extra labels for
those classes. Each point carries `source: "osm_derived"`. The map shows these points with a
different symbol.

| Query file | Elements | Tags used | Class |
|---|---|---|---|
| `osm_water.json` | 4,729 | `natural=water`, and `natural=wetland` with `marsh`, `wet_meadow`, or `bog` | Water / Wetland |
| | | `natural=wetland` with `wetland=swamp` | **Woody**. See below. |
| `osm_wood.json` | 3,023 | `natural=wood`, `landuse=forest` | Woody |
| `osm_herb.json` | 2,395 | `landuse=farmland/meadow/grass/orchard`, `natural=grassland` | Herbaceous |
| `osm_urban.json` | 1,342 | `landuse=industrial/retail/commercial/quarry/landfill`, `amenity=parking` | Urban / Barren |

### Two tag decisions that changed the result

**`wetland=swamp` maps to Woody, not Water.** In north Florida, swamp means cypress and tupelo
trees with a closed canopy. 2,727 of 3,776 wetland polygons carry this tag. We first sampled
them as water. The model then called 22% of the county water. The Herbaceous class fell to
0.2% of the map.

**We do not use `landuse=residential`.** Gainesville houses sit under trees. These points teach
the model that trees are urban. We use only surfaces with no vegetation. Urban recall rose
from 0.62 to 0.93.

**Final training set: 466 points. 148 from GLOBE volunteers. 318 from OpenStreetMap.**

| Class | GLOBE | OpenStreetMap | Total |
|---|---|---|---|
| Water / Wetland | 3 | 84 | 87 |
| Woody | 23 | 90 | 113 |
| Herbaceous | 44 | 90 | 134 |
| Urban / Barren | 78 | 54 | 132 |

---

## 7. Map application sources

The map holds all data files on its own server. It calls no data API. Only the background
maps and the fonts come from outside.

| Source | Use | Required credit |
|---|---|---|
| [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | Satellite background | Esri, Maxar, Earthstar Geographics |
| [Esri Dark Gray Canvas](https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer) | Plain background | Esri |
| [Google Fonts](https://fonts.googleapis.com/): Funnel Display, Funnel Sans | Type | SIL Open Font License |

---

## 8. Files this project produces

The pipeline writes these files. The map reads them. All image files use EPSG:3857 at 19.1093
m for each pixel, 2330 by 2279 pixels. All vector files use EPSG:4326.

| File | Type | Contents |
|---|---|---|
| `change.tif` | Float32 COG | Cosine change between 2017 and 2024 |
| `lulc_2017.tif`, `lulc_2024.tif` | Byte COG | Land cover, 4 classes, for each year |
| `transitions.tif` | Byte COG | Class changes that pass the filter |
| `s2_2017.tif`, `s2_2024.tif` | 4-band Byte COG | Sentinel-2 images |
| `campus_change.tif` | Float32 COG | Campus area at 10 m |
| `tasks.geojson` | Polygon | 40 ranked sites |
| `candidates.geojson` | Polygon | All 113 detected changes |
| `protected.geojson` | Polygon | 216 PAD-US units |
| `globe_points.geojson` | Point | Observation and label points |
| `campus_targets.geojson` | Point | 3 landmarks and 8 nearby sites |
| `stats.json`, `metrics.json`, `transitions_legend.json` | JSON | Numbers, model results, legend |

The pipeline calculates on the EPSG:32617 grid. It reprojects only the output. It never
reprojects the 64 embedding values. Reprojection mixes the values of adjacent pixels. A mixed
vector is no longer valid.

---

## 9. Curriculum and the `geoemerge` package

**Curriculum:** EMERGE Textbook 2 (Geospatial AI), Chapter 5, Lesson 1: "Mapping Land Cover
From GLOBE Data and Satellite Embeddings".
https://geo-di-lab.github.io/emerge-geoai/docs/ch5/lesson1.html

The lesson method is the base of our land cover model. It samples embeddings at observation
points. It trains a Random Forest on all 64 values. It then classifies the region.

We changed four things.

1. We read embeddings from the public mirror, not from Earth Engine.
2. We use 4 classes, not 10. Four of the ten classes had fewer than 5 examples.
3. We use `sklearn.RandomForestClassifier`, not `ee.Classifier.smileRandomForest`.
4. We added labels from OpenStreetMap for two classes. See section 6.

Result: **0.8191 accuracy against a 0.2876 majority-class baseline.** This is 2.85 times the
baseline. The set has 372 training points and 94 test points. The lesson reports 43.75% on 10
classes, against its own baseline of 48.6%.

**We did not use `geoemerge`.** The lesson workflow needs Earth Engine. Our aim was a version
that runs without an Earth Engine account. We offer this version back to EMERGE.

---

## 10. Software

| Library | Use | Licence |
|---|---|---|
| [GDAL/OGR](https://gdal.org/) 3.13 with `osgeo` Python bindings | All image and vector input and output | MIT |
| [NumPy](https://numpy.org/) | Cosine calculation, de-quantization, area statistics | BSD-3-Clause |
| [scikit-learn](https://scikit-learn.org/) | Random Forest, data split, test results | BSD-3-Clause |
| [joblib](https://joblib.readthedocs.io/) | Model storage | BSD-3-Clause |
| [OpenLayers](https://openlayers.org/) | Map drawing and COG reading | BSD-2-Clause |
| [React](https://react.dev/), [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/) | Application and build | MIT and Apache-2.0 |
| [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), [Radix UI](https://www.radix-ui.com/), [lucide](https://lucide.dev/) | Style and components | MIT |
| [TanStack Router](https://tanstack.com/router), [zustand](https://zustand.docs.pmnd.rs/), [zod](https://zod.dev/) | Routing, state, validation | MIT |

The pipeline uses the Python standard library for all HTTP calls. It does not use `requests`,
`geopandas`, `rasterio`, or `shapely`. The point-in-polygon test, the polygon area
calculation, and the Overpass client are in the pipeline code. The pipeline therefore needs
only GDAL, NumPy, and scikit-learn.

---

## 11. How to run it again

```bash
./processing-pipeline/run_all.sh
```

This needs GDAL 3.8 or later with the Python bindings, and Python 3.11 or later. The script
makes its own virtual environment. It installs the two other libraries. Each stage is
idempotent. A stopped run continues from the point of failure. No stage needs an account.
