#!/usr/bin/env bash
# Mirror pipeline outputs into the app's public/data so Vite serves them verbatim.
# Re-run after any pipeline run. Safe to run repeatedly.
#
# rsync (not a fixed file list) so newly added artefacts are picked up without
# editing this script. Model weights and training dumps are excluded: they are
# large and the app never reads them.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/../../processing-pipeline/data/out" && pwd)/"
DST="$(cd "$(dirname "$0")/.." && pwd)/public/data/"

mkdir -p "$DST"

rsync -a --delete \
  --exclude '*.joblib' \
  --exclude 'training_points*' \
  --exclude '*_utm.tif' \
  --exclude '*_3857.tif' \
  "$SRC" "$DST"

echo "synced -> public/data"
ls -1S "$DST" | head -20 | while read -r f; do
  printf '  %-30s %s\n' "$f" "$(du -h "$DST$f" | cut -f1)"
done
echo "total: $(du -sh "$DST" | cut -f1)"
