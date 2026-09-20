#!/usr/bin/env bash
# Full pipeline, cold start to shipped artifacts. Idempotent: every stage skips
# work that already exists, so re-running is cheap.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "== creating venv (system site-packages for GDAL bindings) =="
  python3 -m venv --system-site-packages .venv
  ./.venv/bin/pip install --quiet scikit-learn joblib
fi
PY=./.venv/bin/python
mkdir -p logs data/raw data/out

echo "== A0  OpenStreetMap label polygons (cached after first run) =="
$PY 00_fetch_osm.py        2>&1 | tee logs/00.log

echo "== A1  AlphaEarth embeddings (2 tiles/yr -> 20 m UTM grid) ~7 min =="
$PY 01_fetch_embeddings.py 2>&1 | tee logs/01.log

echo "== A2  Sentinel-2 true colour (z13 delivery grid) ~20 s =="
$PY 02_fetch_sentinel2.py  2>&1 | tee logs/02.log

echo "== C1  GLOBE labels + embedding sampling ~2.5 min =="
$PY 03_globe_training.py   2>&1 | tee logs/03.log

echo "== B   cosine change + stats ~5 s =="
$PY 04_change.py           2>&1 | tee logs/04.log

echo "== C2  OSM label augmentation ~10 s =="
$PY 05_augment_labels.py   2>&1 | tee logs/05.log

echo "== C3  train RF + classify both years ~15 s =="
$PY 06_train_classify.py   2>&1 | tee logs/06.log

echo "== D1  L4 transitions + PAD-US + task queue ~5 s =="
$PY 07_transitions_tasks.py 2>&1 | tee logs/07.log

echo "== D2  observation points GeoJSON =="
$PY 08_globe_points.py     2>&1 | tee logs/08.log

echo "== E   10 m campus demo layer =="
$PY 09_campus_demo.py      2>&1 | tee logs/09.log

echo "== F   independent NDVI validation =="
$PY 10_validate_ndvi.py    2>&1 | tee logs/10.log

echo
echo "== SHIPPED to data/out =="
ls -la data/out/*.tif data/out/*.geojson data/out/stats.json data/out/transitions_legend.json \
  | awk '{printf "  %-42s %8.2f MB\n", $9, $5/1e6}'
