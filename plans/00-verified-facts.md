# Verified Technical Facts (probed live, 2026-09-20)

Everything below was tested against live endpoints from this machine. Do not re-research.

## 1. AlphaEarth embeddings WITHOUT Earth Engine  ✅ CONFIRMED

No EE account needed. Public COG mirror, anonymous S3, CC-BY 4.0.

- **Bucket:** `s3://us-west-2.opendata.source.coop/tge-labs/aef/v1/annual/{year}/{utmzone}/{id}-{yoff}-{xoff}.tiff`
- **HTTPS mirror:** `https://data.source.coop/tge-labs/aef/...`
- **Access:** `AWS_NO_SIGN_REQUEST=YES AWS_REGION=us-west-2`, read via `/vsis3/`
- **Years:** 2017–2025. **Bands:** 64 (`A00`–`A63`), int8. **Res:** 10 m. **CRS:** per-UTM-zone.
- **Attribution (REQUIRED):** "The AlphaEarth Foundations Satellite Embedding dataset is produced by Google and Google DeepMind."

### ⚠️ Two landmines
1. **COGs are BOTTOM-UP.** Reading `.tiff` directly gives vertically flipped data with positive y-res.
   **Always open the sibling `.vrt`**, which corrects it on the fly. Verified: VRT reports `Pixel Size = (10, -10)`.
2. **Values are quantized int8.** De-quantize before ANY math:
   ```python
   deq = ((v / 127.5) ** 2) * np.sign(v)
   ```
   Verified: post-de-quantization vector norms = 0.9915–1.0092 (mean 1.0001). Unit length ⇒ **cosine == dot product**.
   NoData = `-128`; if present in one band it is present in all 64.

### Tile index
`https://data.source.coop/tge-labs/aef/v1/annual/aef_index.csv` (798 MB — stream it, don't load).
Filenames encode nothing spatial; the index has `wgs84_west/south/east/north` + `path` + `year`.
Cached locally during planning as `aef_index.csv` in the scratchpad.

### Tiles covering our area (already resolved)
Alachua County bbox `-82.66, 29.40, -82.05, 29.95` needs exactly **2 tiles per year**:

| Year | Tile | Covers |
|---|---|---|
| 2017 | `17N/xvsg3n7fhmfjagaa9-0000000000-0000000000` | lat 29.610–30.358 |
| 2017 | `17N/xmf40mpety1i4sreo-0000008192-0000000000` | lat 28.871–29.618 |
| 2024 | `17N/xu06dgi8n1s75ik92-0000000000-0000000000` | lat 29.610–30.358 |
| 2024 | `17N/xo1fyt05mcmguib6w-0000008192-0000000000` | lat 28.871–29.618 |

All EPSG:32617, 8192×8192, tiles overlap slightly at ~29.61.

### Measured throughput (this machine, this network)
| Read | Time |
|---|---|
| 978×898 px, 64 bands, 10 m | **~45 s** |
| same extent at 30 m (uses overviews) | **~22 s** |

Overview pixels are means renormalized to unit length ⇒ **downsampled reads are valid embeddings**.
Scale estimate: ~39×38 km AOI at 10 m ≈ 12 min/year. **Start fetches early, in background.**

## 2. Change detection math  ✅ VALIDATED ON REAL PIXELS

Test AOI `-82.40, 29.62, -82.30, 29.70` (978×898, 878k valid px), 2017→2024, `change = 1 - cos`:

| stat | value |
|---|---|
| p50 | 0.0416 |
| p75 | 0.0561 |
| p90 | 0.0834 |
| p95 | 0.1193 |
| **p99** | **0.2845** |
| p99.9 | 0.4777 |
| max | 0.6908 |

Well-separated long tail. **p99 ≈ 0.28 isolates ~1% of pixels ≈ 88 ha** — a usable hotspot threshold.
Zero nodata pixels in the test AOI.

## 3. GLOBE Observer data  ✅ CONFIRMED — AND SPARSE

API (no key): `https://api.globe.gov/search/v1/measurement/protocol/measureddate/lat/lon/`
Params: `protocols`, `startdate`, `enddate`, `minlat/maxlat/minlon/maxlon`, `geojson`, `sample`

| Scope (2017–2025) | land_covers | mosquito_habitat_mapper |
|---|---|---|
| **Alachua County** | **10** | **3** |
| Florida statewide | **691** | 633 |

Land cover by year statewide: 2017:5 2018:2 2019:38 2020:133 2021:43 2022:168 2023:89 2024:49 2025:164

**Implication:** cannot train locally. **Train on Florida statewide (691), infer over Gainesville.**
The 10-in-9-years number is the project's headline evidence, not a problem to hide.

## 4. Protected areas (conservation framing)  ✅ CONFIRMED

PAD-US `Manager_Name` FeatureServer, anonymous, returns real Alachua units:
```
https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Manager_Name/FeatureServer/0/query
```
Query with `geometry={"xmin":..,"ymin":..,"xmax":..,"ymax":..,"spatialReference":{"wkid":4326}}`,
`geometryType=esriGeometryEnvelope`, `inSR=4326`, `f=geojson`, `returnGeometry=true`.

Confirmed units returned: Osceola National Forest, **Lochloosa Wildlife Conservation Area**,
**Newnans Lake Conservation Area**, Orange Creek Restoration Area, **Longleaf Flatwoods Reserve**,
Graham CA, Pareners Branch CA, Santa Fe Springs CA.

❌ `USA_Protected_Areas_State` FeatureServer requires a token — do not use.

## 5. Curriculum  ✅ CONFIRMED

**Textbook 2: Geospatial AI — Ch5, Lesson 1: "Mapping Land Cover From GLOBE Data and Satellite Embeddings"**
https://geo-di-lab.github.io/emerge-geoai/docs/ch5/lesson1.html

Lesson method (what we must reproduce):
1. Load GLOBE Land Cover, filter by MucCode → 10 Level-1 classes
2. Study region = Florida
3. Load AlphaEarth annual embeddings
4. Sample embeddings at GLOBE points
5. 80/20 train/test split
6. Train Random Forest (lesson: `smileRandomForest`, 50 trees) on all 64 bands, label = Level-1 class
7. Evaluate, apply to region

**Lesson's own reported accuracy: 43.75%** on 10 classes. Plan to beat it by collapsing classes.

### ⚠️ Label availability — measured, not assumed
`landcoversMucCode` is **null on 543 of 691** Florida records. The lesson's `dropna(subset=['MucCode'])`
therefore leaves **148 trainable points**, not 691.

MUC codes are prefixed `M` (e.g. `M91`, `M1121`) — **strip the `M` before taking the Level-1 digit.**

Lesson's Level-1 mapping (verbatim from Ch5 L1):
```python
muc_level1_map = {'0':'Closed Forest','1':'Woodland','2':'Shrubland or Thicket',
                  '3':'Dwarf-Shrubland or Dwarf-Thicket','4':'Herbaceous Vegetation',
                  '5':'Barren','6':'Wetland','7':'Open Water','8':'Cultivated Land','9':'Urban'}
```

Measured Florida distribution (n=148, all 10 classes present):

| Class | n |
|---|---|
| Urban | 72 |
| Herbaceous Vegetation | 33 |
| Woodland | 18 |
| Dwarf-Shrubland | 6 |
| Barren | 6 |
| Cultivated Land | 5 |
| Closed Forest | 3 |
| Shrubland or Thicket | 2 |
| Wetland | 2 |
| Open Water | 1 |

- 80/20 split → train 119 / **test 29**
- **Majority-class baseline = 48.6%** (always guess Urban)
- **The lesson's reported 43.75% is below that baseline.** Do not reproduce verbatim — see spec C2.
- Classes with <5 examples (unlearnable as-is): Closed Forest, Shrubland, Wetland, Open Water
- Label years are spread 2017–2025 → **sample each point's embedding from its own observation year**

Lesson libraries: `ee`, `geemap`, `geopandas`, `pandas`. We substitute `rasterio`/GDAL + `sklearn.RandomForestClassifier`
— same method, no EE dependency. **This port is itself a contribution back to EMERGE.**

## 6. Local environment
- GDAL **3.13.3** + `osgeo` Python bindings ✅
- numpy **2.5.3** ✅
- `rasterio` ❌ `geopandas` ❌ — need install, or use `osgeo.gdal`/`ogr` directly (works fine, zero install)
- `timeout` command not available (macOS) — use alternatives
