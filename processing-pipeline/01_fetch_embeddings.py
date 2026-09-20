#!/usr/bin/env python3
"""Stage A - fetch AlphaEarth embeddings for the AOI, both years.

Mosaics the 2 tiles/year that straddle the 29.61 seam onto the 20 m EPSG:32617
analysis grid. Reads the .vrt (never the .tiff: source COGs are bottom-up).
Resampling is NEAREST on purpose - GDAL picks the 20 m overview level, whose
pixels are means already renormalised to unit length. Averaging at full res
would produce non-unit vectors and corrupt the cosine.
"""
import os, sys, time, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c

def fetch(year):
    dst = c.RAW / f"emb_{year}.tif"
    if dst.exists() and dst.stat().st_size > 0:
        print(f"[{year}] exists, skipping -> {dst.name}", flush=True); return dst
    xmin, ymin, xmax, ymax = c.AOI_UTM
    cmd = ["gdalwarp", "-overwrite",
           "-t_srs", f"EPSG:{c.ANALYSIS_EPSG}",
           "-te", str(xmin), str(ymin), str(xmax), str(ymax),
           "-tr", str(c.ANALYSIS_RES), str(c.ANALYSIS_RES),
           "-r", "near",
           "-srcnodata", str(c.AEF_NODATA), "-dstnodata", str(c.AEF_NODATA),
           "-of", "GTiff", "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
           "-co", "NUM_THREADS=ALL_CPUS", "-co", "BIGTIFF=IF_SAFER",
           "-wo", "NUM_THREADS=ALL_CPUS",
           *c.aef_vrt(year), str(dst)]
    print(f"[{year}] mosaicking {len(c.AEF_TILES[year])} tiles -> {dst.name}", flush=True)
    t0 = time.time()
    r = subprocess.run(cmd, env={**os.environ, **c.GDAL_ENV},
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        print(f"[{year}] FAILED rc={r.returncode}\n{r.stdout[-3000:]}", flush=True)
        raise SystemExit(1)
    mb = dst.stat().st_size / 1e6
    print(f"[{year}] done in {time.time()-t0:.0f}s  {mb:.0f} MB", flush=True)
    return dst

if __name__ == "__main__":
    years = [int(a) for a in sys.argv[1:]] or [c.BEFORE, c.AFTER]
    t0 = time.time()
    for y in years: fetch(y)
    print(f"ALL DONE in {time.time()-t0:.0f}s", flush=True)
