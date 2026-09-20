#!/usr/bin/env python3
"""Stage A2 - Sentinel-2 as ONE 4-band COG per year.

Band order (frontend plan §1.1):  [1]=B08 NIR  [2]=B04 Red  [3]=B03 Green  [4]=B02 Blue
  true colour = bands 2,3,4      false colour (CIR) = bands 1,2,3
One file, one fetch, one WebGL context; the composite is a client-side toggle.

DEFLATE, not JPEG: JPEG-in-TIFF is YCbCr 3-band and will not carry a 4th band.

The AOI usually straddles MGRS 17RLN and 17RLP, so each band is a 2-tile mosaic.
Scenes are picked from December (Florida dry season) by AOI COVERAGE FIRST, cloud
only as a tie-break - see pick(). A Sentinel-2 granule is clipped to its orbit
swath, so a date can be flawlessly clear and still leave half the AOI empty.
Output goes straight to the EPSG:3857 z13 delivery grid - this layer is
display-only and never enters the analysis.

Surface reflectance is UInt16 (scale 10000). We stretch to Byte per band using a
2-98 percentile stretch measured from the actual scene, so NIR (bright over
vegetation) does not saturate under an RGB-tuned stretch.
"""
import os, sys, json, time, subprocess, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal, ogr
gdal.UseExceptions()
ogr.UseExceptions()

BANDS = [("nir", "B08"), ("red", "B04"), ("green", "B03"), ("blue", "B02")]

def stac(year):
    """Every scene intersecting the AOI in the search window, newest API fields kept.

    Deliberately NOT filtered by grid:code. Which MGRS tiles are needed is a
    consequence of the AOI, not an input to it: a single tile sometimes covers
    the whole AOI on its own, and hard-coding a tile list turns that into a
    spurious "no scenes for 17RLP" failure.
    """
    body = json.dumps({
        "collections": [c.S2_COLLECTION], "bbox": list(c.AOI_4326),
        "datetime": f"{year}-{c.S2_MONTH:02d}-01T00:00:00Z/{year}-{c.S2_MONTH:02d}-31T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": c.S2_MAX_CLOUD}},
        "limit": 200}).encode()
    req = urllib.request.Request(c.STAC, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        feats = json.load(r)["features"]
    by_date = {}
    for f in feats:
        p = f["properties"]
        tile = p["grid:code"].replace("MGRS-", "")
        # Duplicate (date, tile) rows happen — same granule reprocessed. Keep
        # the cleaner one.
        prev = by_date.setdefault(p["datetime"][:10], {}).get(tile)
        if prev is None or p["eo:cloud_cover"] < prev[0]:
            by_date[p["datetime"][:10]][tile] = (p["eo:cloud_cover"], f["geometry"], f["assets"])
    return by_date

def aoi_cover(geoms):
    """Fraction of the AOI covered by the union of these granule footprints.

    The STAC footprint is the real data footprint, not the tile square: when an
    orbit swath clips a granule the polygon is clipped with it. That is the only
    field that sees a swath edge, and it agrees with a warp probe to within
    0.5%, so coverage can be gated here for free instead of downloading first.
    """
    x0, y0, x1, y1 = c.AOI_4326
    aoi = ogr.CreateGeometryFromWkt(
        f"POLYGON(({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))")
    union = None
    for g in geoms:
        p = ogr.CreateGeometryFromJson(json.dumps(g))
        union = p if union is None else union.Union(p)
    if union is None: return 0.0
    return union.Intersection(aoi).GetArea() / aoi.GetArea()

def pick(year):
    """Pick the date whose granules actually cover the AOI, then prefer clear sky.

    Coverage is the hard gate and cloud only breaks ties. Ranking on cloud alone
    is what put a swath-clipped scene in the 2017 mosaic: 2017-12-13 was 0.1%
    cloud on both tiles and beat 2017-12-10's 0.2%, but its orbit edge cut
    diagonally across the AOI and left 45% of it empty.
    """
    by_date = stac(year)
    if not by_date: raise SystemExit(f"no {year} scenes in the search window")
    scored = []
    for d, tiles in by_date.items():
        cover = aoi_cover([g for (_, g, _) in tiles.values()])
        scored.append((d, cover, max(cc for (cc, _, _) in tiles.values()), tiles))
    scored.sort(key=lambda s: (-round(s[1], 3), s[2]))
    print(f"  {len(scored)} candidate dates (coverage-gated):", flush=True)
    for d, cover, cc, tiles in scored[:6]:
        print(f"     {d}  cover={cover*100:5.1f}%  maxcloud={cc:4.1f}%  "
              f"{','.join(sorted(tiles))}", flush=True)

    full = [s for s in scored if s[1] >= c.S2_MIN_COVER]
    if not full:
        best = scored[0]
        raise SystemExit(
            f"no {year} date covers the AOI (best {best[0]} at {best[1]*100:.1f}%). "
            f"Widen S2_MONTH or raise S2_MAX_CLOUD.")
    d, cover, _, tiles = full[0]
    chosen = {t: (d, cc, assets) for t, (cc, _, assets) in tiles.items()}
    print(f"  -> {d}  cover={cover*100:.1f}%  tiles={','.join(sorted(chosen))}", flush=True)
    for t, (d_, cc, _) in sorted(chosen.items()):
        print(f"     {t}  {d_}  cloud={cc:.1f}%", flush=True)
    return chosen

def build(year):
    dst = c.OUT / f"s2_{year}.tif"
    if dst.exists() and dst.stat().st_size > 0:
        d = gdal.Open(str(dst))
        if d.RasterCount == 4:
            # Measured on an overview, so this costs milliseconds. Checked on
            # every run because a swath-clipped mosaic is still a valid 4-band
            # COG - nothing but the pixels themselves reveals it.
            ov = d.GetRasterBand(1).GetOverview(min(2, d.GetRasterBand(1).GetOverviewCount() - 1))
            filled = float((ov.ReadAsArray() != 0).mean()) if ov else 1.0
            if filled >= c.S2_MIN_COVER_ONDISK:
                print(f"[{year}] 4-band exists, {filled*100:.1f}% filled, skipping", flush=True)
                d = None; return
            print(f"[{year}] rebuilding: only {filled*100:.1f}% of the AOI is filled", flush=True)
            d = None
            for _, code in BANDS:                  # stale partial warps must go too
                p = c.RAW / f"s2_{year}_{code}.tif"
                if p.exists(): p.unlink()
        else:
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
