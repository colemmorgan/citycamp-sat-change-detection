# Gainesville Change Detection and Observation

This project finds land cover that changed in Alachua County, Florida between 2017 and 2024.
It shows the changes on a map. It ranks them. Volunteers can then go to a site and record it.

- Study area: `-82.55, 29.48, -82.15, 29.82`. This area is 39.2 km by 37.2 km.
- Detected changes: 113 sites, 452 hectares.
- Land cover model accuracy: 0.811. The majority-class baseline is 0.288.

**Track:** NASA and Environmental Data, CityCamp Gainesville Hack Day, 20 September 2026.
**Curriculum used:** EMERGE Textbook 2, Chapter 5, Lesson 1.

---

## 1. Recreation steps

### 1.1 Prerequisites

- GDAL 3.8 or later, with the Python bindings (`osgeo`). On macOS, run `brew install gdal`.
- Python 3.11 or later.
- Node.js 18 or later, for the map application.

### 1.2 Build the data

```bash
git clone <repository-url>
cd citycamp-sat-change-detection
./processing-pipeline/run_all.sh
```

The script makes its own virtual environment. It installs `scikit-learn` and `joblib`.
It needs no API key and no account. The run takes approximately 10 minutes.

Each stage writes to `processing-pipeline/data/out/`. Each stage is idempotent. If a stage
stops, run the script again. Completed stages do not run a second time.

### 1.3 Start the map

```bash
cd client
npm install
./scripts/sync-data.sh     # copies pipeline output into public/data
npm run dev
```

Open the address that Vite prints.

### 1.4 Build the map for deployment

```bash
npm run build
```

The output goes to `client/dist/`. Set the environment variable `VITE_BASE` to change the
base path.

### 1.5 Pipeline stages

| Stage | Script | Output |
|---|---|---|
| A0 | `00_fetch_osm.py` | OpenStreetMap label polygons |
| A1 | `01_fetch_embeddings.py` | AlphaEarth embeddings, 2017 and 2024 |
| A2 | `02_fetch_sentinel2.py` | Sentinel-2 images, both years |
| C1 | `03_globe_training.py` | GLOBE labels with embedding values |
| B | `04_change.py` | `change.tif` and `stats.json` |
| C2 | `05_augment_labels.py` | OpenStreetMap label points |
| C3 | `06_train_classify.py` | Land cover maps for both years |
| D1 | `07_transitions_tasks.py` | Detected changes and ranked sites |
| D2 | `08_globe_points.py` | Observation points |
| E | `09_campus_demo.py` | Campus area at 10 m |
| F | `10_validate_ndvi.py` | NDVI result for each change |

---

## 2. Methods

Read [`reports/methods.md`](reports/methods.md).

That report gives the reason for each choice. It covers the change measurement, the land cover
model, the filters, the ranking, and the NDVI result. It also gives the test results and the
limits of the model.

---

## 3. Data sources

Read [`reports/data-sources.md`](reports/data-sources.md).

That report lists every dataset. It gives the provider, the access address, the licence, and
the required credit for each one. It also lists the software libraries.

---

## Repository layout

| Path | Contents |
|---|---|
| `processing-pipeline/` | Python stages that build the data |
| `client/` | Map application (React, OpenLayers) |
| `reports/` | Methods report and data sources report |
| `plans/` | Planning documents and the pipeline-to-map data contract |

## Credit

This project uses data from Google and Google DeepMind, NASA GLOBE Observer, ESA Copernicus,
the United States Geological Survey, and OpenStreetMap contributors.
[`reports/data-sources.md`](reports/data-sources.md) gives the full credit and licence for each one.

Required credit for the embeddings: "The AlphaEarth Foundations Satellite Embedding dataset is
produced by Google and Google DeepMind."
