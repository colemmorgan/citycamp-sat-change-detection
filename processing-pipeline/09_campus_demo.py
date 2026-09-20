#!/usr/bin/env python3
"""Stage E - 10 m campus change layer + walkable ground-truth targets.

The county layer runs at 20 m, which dilutes building-scale change: the
Wertheim Lab (built 2020) reads only 88th percentile at 20 m but 98.6th at
10 m. This stage recomputes a small campus AOI at native 10 m so a judge - or
a volunteer standing at the Reitz Union - can see a change they can walk to.

Reitz Union (unchanged since 1967) doubles as the control: if the model calls
it stable and calls the building next door changed, the method explains itself.
"""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal, osr
gdal.UseExceptions()

CAMPUS_4326 = (-82.362, 29.634, -82.333, 29.662)
REITZ = (29.6462237, -82.347875)
LANDMARKS = {
    "Wertheim Laboratory for Engineering Excellence": (29.6471314, -82.3479672, 2020),
    "J. Wayne Reitz Union":                           (29.6462237, -82.347875, 1967),
    "Scott Family Hall":                              (29.6514416, -82.3444246, 2017),
}

def fetch_campus():
    """Pull the campus window at native 10 m if it is not already cached."""
    import subprocess
    os.makedirs("data/campus", exist_ok=True)
    w, s_, e, n = CAMPUS_4326
    for year in (c.BEFORE, c.AFTER):
        dst = f"data/campus/emb_{year}.tif"
        if os.path.exists(dst) and os.path.getsize(dst) > 0: continue
        subprocess.run(["gdalwarp", "-q", "-overwrite",
            "-te", str(w), str(s_), str(e), str(n), "-te_srs", "EPSG:4326",
            "-t_srs", f"EPSG:{c.ANALYSIS_EPSG}", "-tr", "10", "10", "-r", "near",
            "-srcnodata", str(c.AEF_NODATA), "-dstnodata", str(c.AEF_NODATA),
            "-co", "COMPRESS=DEFLATE", "-co", "TILED=YES",
            c.aef_vrt(year)[0], dst],
            env={**os.environ, **c.GDAL_ENV}, check=True)
        print(f"  campus {year} fetched at 10 m", flush=True)

def main():
    fetch_campus()
    A = gdal.Open("data/campus/emb_2017.tif"); B = gdal.Open("data/campus/emb_2024.tif")
    H, W, NB = A.RasterYSize, A.RasterXSize, A.RasterCount
    dot = np.zeros((H, W), np.float32); na = np.zeros((H, W), np.float32); nb = np.zeros((H, W), np.float32)
    for i in range(1, NB + 1):
        fa = c.dequantize(A.GetRasterBand(i).ReadAsArray().astype(np.int16))
        fb = c.dequantize(B.GetRasterBand(i).ReadAsArray().astype(np.int16))
        dot += fa * fb; na += fa * fa; nb += fb * fb
    ch = (1 - dot / (np.sqrt(na) * np.sqrt(nb) + 1e-9)).astype(np.float32)
    gt = A.GetGeoTransform()

    drv = gdal.GetDriverByName("GTiff")
    o = drv.Create(str(c.RAW / "campus_change_utm.tif"), W, H, 1, gdal.GDT_Float32,
                   ["COMPRESS=DEFLATE", "TILED=YES"])
    o.SetGeoTransform(gt); o.SetProjection(A.GetProjection())
    o.GetRasterBand(1).WriteArray(ch); o.GetRasterBand(1).SetNoDataValue(float("nan"))
    o.FlushCache(); o = None

    # z14 (9.5546 m/px) - native 10 m data belongs one zoom deeper than the county layer
    z14 = 156543.03392804097 / 2**14
    s = osr.SpatialReference(); s.ImportFromEPSG(4326); s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    t = osr.SpatialReference(); t.ImportFromEPSG(3857); t.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tr = osr.CoordinateTransformation(s, t)
    x0, y0, _ = tr.TransformPoint(CAMPUS_4326[0], CAMPUS_4326[1])
    x1, y1, _ = tr.TransformPoint(CAMPUS_4326[2], CAMPUS_4326[3])
    gdal.Warp(str(c.RAW / "campus_change_3857.tif"), str(c.RAW / "campus_change_utm.tif"),
              dstSRS="EPSG:3857", outputBounds=(x0, y0, x1, y1), xRes=z14, yRes=z14,
              resampleAlg="bilinear", srcNodata=float("nan"), dstNodata=float("nan"))
    gdal.Translate(str(c.OUT / "campus_change.tif"), str(c.RAW / "campus_change_3857.tif"),
                   format="COG", creationOptions=["COMPRESS=DEFLATE", "BLOCKSIZE=512",
                                                  "OVERVIEWS=AUTO", "NUM_THREADS=ALL_CPUS"])

    fwd = osr.CoordinateTransformation(s, osr.SpatialReference(wkt=A.GetProjection()))
    u = osr.SpatialReference(); u.ImportFromEPSG(32617); u.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    fwd = osr.CoordinateTransformation(s, u); rev = osr.CoordinateTransformation(u, s)
    def at(lat, lon):
        X, Y, _ = fwd.TransformPoint(lon, lat)
        return int((X - gt[0]) / gt[1]), int((Y - gt[3]) / gt[5]), X, Y
    pct = lambda v: float((ch < v).mean() * 100)

    feats = []
    for nm, (la, lo, built) in LANDMARKS.items():
        x, y, _, _ = at(la, lo)
        w = ch[max(0,y-1):y+2, max(0,x-1):x+2]
        feats.append({"type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lo, la]},
            "properties": {"name": nm, "built": built, "kind": "landmark",
                           "change": round(float(ch[y, x]), 4),
                           "change_peak": round(float(w.max()), 4),
                           "percentile": round(pct(w.max()), 1)}})
    # walkable hotspots
    rx, ry, RX, RY = at(*REITZ)
    order = np.argsort(ch.ravel())[::-1]; seen = []
    for idx in order:
        iy, ix = np.unravel_index(idx, ch.shape); v = float(ch[iy, ix])
        X = gt[0] + ix * gt[1]; Y = gt[3] + iy * gt[5]
        dd = math.hypot(X - RX, Y - RY)
        if dd > 1000: continue
        if any(math.hypot(X - a, Y - b) < 80 for a, b in seen): continue
        seen.append((X, Y)); lon, lat, _ = rev.TransformPoint(X, Y)
        brg = (math.degrees(math.atan2(X - RX, Y - RY)) + 360) % 360
        cp = ["N","NE","E","SE","S","SW","W","NW"][int((brg + 22.5) // 45) % 8]
        feats.append({"type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {"name": f"Hotspot {len(seen)}", "kind": "walkable_target",
                           "change": round(v, 4), "percentile": round(pct(v), 1),
                           "walk_m": int(round(dd)), "bearing": cp,
                           "walk_min": max(1, int(round(dd / 80)))}})
        if len(seen) >= 8: break
    (c.OUT / "campus_targets.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": feats}, indent=1))

    st = json.loads((c.OUT / "stats.json").read_text())
    st["campus"] = {"aoi_4326": list(CAMPUS_4326), "resolution_m": 10, "zoom_level": 14,
                    "reitz_union": list(REITZ),
                    "p50": float(np.percentile(ch, 50)), "p90": float(np.percentile(ch, 90)),
                    "p99": float(np.percentile(ch, 99)), "max": float(ch.max()),
                    "note": "native 10 m; county layer is 20 m and dilutes building-scale change"}
    (c.OUT / "stats.json").write_text(json.dumps(st, indent=2))
    print(f"campus_change.tif {(c.OUT/'campus_change.tif').stat().st_size/1e6:.2f} MB")
    for f in feats:
        p = f["properties"]
        if p["kind"] == "landmark":
            print(f"  {p['name'][:46]:48s} built {p['built']}  change {p['change_peak']:.3f}  {p['percentile']:.1f}pct")
    print("  --- walkable ---")
    for f in feats:
        p = f["properties"]
        if p["kind"] == "walkable_target":
            print(f"  {p['name']:12s} {p['change']:.3f} ({p['percentile']:.1f}pct) "
                  f"{p['walk_m']:4d}m {p['bearing']:2s} ~{p['walk_min']}min")

if __name__ == "__main__":
    main()
