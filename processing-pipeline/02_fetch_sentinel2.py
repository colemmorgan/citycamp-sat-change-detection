#!/usr/bin/env python3
"""Stage A2 - Sentinel-2 as ONE 4-band COG per year.

Band order (frontend plan §1.1):  [1]=B08 NIR  [2]=B04 Red  [3]=B03 Green  [4]=B02 Blue
  true colour = bands 2,3,4      false colour (CIR) = bands 1,2,3
One file, one fetch, one WebGL context; the composite is a client-side toggle.

DEFLATE, not JPEG: JPEG-in-TIFF is YCbCr 3-band and will not carry a 4th band.

The AOI straddles MGRS 17RLN and 17RLP, so each band is a 2-tile mosaic. Scenes are
picked from December (Florida dry season), preferring a date clear on BOTH tiles so
the mosaic carries no seasonal seam. Output goes straight to the EPSG:3857 z13
delivery grid - this layer is display-only and never enters the analysis.

Surface reflectance is UInt16 (scale 10000). We stretch to Byte per band using a
2-98 percentile stretch measured from the actual scene, so NIR (bright over
vegetation) does not saturate under an RGB-tuned stretch.
"""
import os, sys, json, time, subprocess, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal
gdal.UseExceptions()

BANDS = [("nir", "B08"), ("red", "B04"), ("green", "B03"), ("blue", "B02")]

def stac(tile, year):
    body = json.dumps({
        "collections": [c.S2_COLLECTION], "bbox": list(c.AOI_4326),
        "datetime": f"{year}-{c.S2_MONTH:02d}-01T00:00:00Z/{year}-{c.S2_MONTH:02d}-31T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": c.S2_MAX_CLOUD}, "grid:code": {"eq": f"MGRS-{tile}"}},
        "limit": 50}).encode()
    req = urllib.request.Request(c.STAC, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        feats = json.load(r)["features"]
    return {f["properties"]["datetime"][:10]: (f["properties"]["eo:cloud_cover"], f["assets"])
            for f in feats}

def pick(year):
    per = {t: stac(t, year) for t in c.S2_MGRS}
    for t in c.S2_MGRS:
        print(f"  {t}: {len(per[t])} candidate scenes", flush=True)
        if not per[t]: raise SystemExit(f"no {year} scenes for {t}")
    common = set.intersection(*(set(v) for v in per.values()))
    if common:
        d = min(common, key=lambda d: max(per[t][d][0] for t in c.S2_MGRS))
        chosen = {t: (d, per[t][d][0], per[t][d][1]) for t in c.S2_MGRS}
        print(f"  -> shared date {d} (no seasonal seam)", flush=True)
    else:
        chosen = {}
        for t in c.S2_MGRS:
            d = min(per[t], key=lambda d: per[t][d][0])
            chosen[t] = (d, per[t][d][0], per[t][d][1])
        print("  -> no shared date; best per tile (possible seam)", flush=True)
    for t, (d, cc, _) in chosen.items():
        print(f"     {t}  {d}  cloud={cc:.1f}%", flush=True)
    return chosen

def build(year):
    dst = c.OUT / f"s2_{year}.tif"
    if dst.exists() and dst.stat().st_size > 0:
        d = gdal.Open(str(dst))
        if d.RasterCount == 4:
            print(f"[{year}] 4-band exists, skipping", flush=True); return
        print(f"[{year}] rebuilding ({d.RasterCount}-band -> 4-band)", flush=True)
    print(f"[{year}] querying STAC...", flush=True)
    chosen = pick(year)
    xmin, ymin, xmax, ymax = c.AOI_3857
    env = {**os.environ, **c.GDAL_ENV}
    t0 = time.time(); parts = []
    for key, code in BANDS:
        srcs = [f"/vsicurl/{assets[key]['href']}" for (_, _, assets) in chosen.values()]
        out = str(c.RAW / f"s2_{year}_{code}.tif")
        if not (os.path.exists(out) and os.path.getsize(out) > 0):
            subprocess.run(["gdalwarp", "-q", "-overwrite",
                "-t_srs", f"EPSG:{c.DELIVERY_EPSG}",
                "-te", *map(str, (xmin, ymin, xmax, ymax)),
                "-tr", str(c.Z13_RES), str(c.Z13_RES), "-r", "cubic",
                "-srcnodata", "0", "-dstnodata", "0", "-ot", "UInt16",
                "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
                "-co", "NUM_THREADS=ALL_CPUS", "-wo", "NUM_THREADS=ALL_CPUS",
                *srcs, out], env=env, check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        parts.append(out)
        print(f"  {code} ({key}) warped", flush=True)

    # per-band 2-98 percentile stretch, measured from the scene itself
    scales = []
    for p, (key, code) in zip(parts, BANDS):
        a = gdal.Open(p).ReadAsArray()
        v = a[a > 0]
        lo, hi = (float(np.percentile(v, 2)), float(np.percentile(v, 98))) if v.size else (0.0, 3000.0)
        scales.append((code, key, lo, hi))
        print(f"  {code} stretch {lo:.0f}-{hi:.0f}", flush=True)

    vrt = str(c.RAW / f"s2_{year}_stack.vrt")
    subprocess.run(["gdalbuildvrt", "-q", "-separate", vrt, *parts], env=env, check=True)
    cmd = ["gdal_translate", vrt, str(dst), "-of", "COG", "-ot", "Byte",
           "-a_nodata", "0",
           "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=2", "-co", "BLOCKSIZE=512",
           "-co", "OVERVIEWS=AUTO", "-co", "NUM_THREADS=ALL_CPUS"]
    for i, (code, key, lo, hi) in enumerate(scales, 1):
        cmd += ["-b", str(i), "-scale_" + str(i), str(lo), str(hi), "1", "255"]
    subprocess.run(cmd, env=env, check=True)

    d = gdal.Open(str(dst))
    for i, (code, key, lo, hi) in enumerate(scales, 1):
        d.GetRasterBand(i).SetDescription(f"{code} ({key})")
    d = None
    dates = sorted({dd for (dd, _, _) in chosen.values()})
    (c.OUT / f"s2_{year}_meta.json").write_text(json.dumps({
        "year": year, "dates": dates,
        "band_order": [f"{code} ({key})" for code, key, _, _ in scales],
        "true_colour_bands": [2, 3, 4], "false_colour_bands": [1, 2, 3],
        "stretch": {code: [lo, hi] for code, key, lo, hi in scales},
        "tiles": {t: {"date": d_, "cloud": cc} for t, (d_, cc, _) in chosen.items()},
        "collection": c.S2_COLLECTION,
        "credit": ("Contains modified Copernicus Sentinel data, processed by ESA. "
                   "COGs via AWS Earth Search (Element 84)."),
    }, indent=2))
    print(f"[{year}] done in {time.time()-t0:.0f}s  {dst.stat().st_size/1e6:.1f} MB  "
          f"4-band  dates={dates}", flush=True)

if __name__ == "__main__":
    years = [int(a) for a in sys.argv[1:]] or [c.BEFORE, c.AFTER]
    for y in years: build(y)
    print("S2 DONE", flush=True)
