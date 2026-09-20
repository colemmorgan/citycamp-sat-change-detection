#!/usr/bin/env python3
"""Stage F - independent validation of the change categories using Sentinel-2 NDVI.

The task queue is built from AlphaEarth embeddings + a Random Forest. NDVI comes
from Sentinel-2 surface reflectance and touches NEITHER. If the categories are
real, NDVI must move the way each category predicts:

    vegetation_loss / development  ->  NDVI falls
    revegetation                   ->  NDVI rises
    hydrologic                     ->  no consistent direction

This is a genuine out-of-band check, not a restatement of the model.

IMPORTANT: NDVI is computed from the RAW UInt16 reflectance in data/raw/, never
from the shipped display COG. That COG is stretched to Byte per scene with
different per-year stretches, which makes cross-year NDVI meaningless.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal, ogr, osr
gdal.UseExceptions(); ogr.UseExceptions()

def ndvi(year):
    nir = gdal.Open(str(c.RAW / f"s2_{year}_B08.tif")).ReadAsArray().astype(np.float32)
    red = gdal.Open(str(c.RAW / f"s2_{year}_B04.tif")).ReadAsArray().astype(np.float32)
    bad = (nir <= 0) | (red <= 0)
    out = (nir - red) / (nir + red + 1e-6)
    out[bad] = np.nan
    return out

def main():
    ref = gdal.Open(str(c.RAW / "s2_2017_B08.tif"))
    n17, n24 = ndvi(c.BEFORE), ndvi(c.AFTER)
    d = n24 - n17
    print(f"NDVI {c.BEFORE}: mean {np.nanmean(n17):.3f} | {c.AFTER}: mean {np.nanmean(n24):.3f}")
    print(f"AOI-wide delta NDVI: mean {np.nanmean(d):+.4f}  sd {np.nanstd(d):.4f}\n")

    # validate EVERY candidate, so each category gets a real agreement rate -
    # the shipped top-40 is quota-selected and would not cover all categories evenly
    cands = json.loads((c.OUT / "candidates.geojson").read_text())
    tasks = json.loads((c.OUT / "tasks.geojson").read_text())
    # burn each task polygon with its 1-based index
    drv = gdal.GetDriverByName("MEM")
    mask = drv.Create("", ref.RasterXSize, ref.RasterYSize, 1, gdal.GDT_Int32)
    mask.SetGeoTransform(ref.GetGeoTransform()); mask.SetProjection(ref.GetProjection())
    vsrc = ogr.GetDriverByName("Memory").CreateDataSource("v")
    srs = osr.SpatialReference(); srs.ImportFromEPSG(4326)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    lyr = vsrc.CreateLayer("t", srs, ogr.wkbPolygon)
    lyr.CreateField(ogr.FieldDefn("idx", ogr.OFTInteger))
    for i, f in enumerate(cands["features"], 1):
        ft = ogr.Feature(lyr.GetLayerDefn())
        ft.SetGeometry(ogr.CreateGeometryFromJson(json.dumps(f["geometry"])))
        ft.SetField("idx", i); lyr.CreateFeature(ft)
    gdal.RasterizeLayer(mask, [1], lyr, options=["ATTRIBUTE=idx"])
    m = mask.ReadAsArray()

    by_cat = {}
    for i, f in enumerate(cands["features"], 1):
        sel = (m == i) & np.isfinite(d)
        p = f["properties"]
        if sel.sum() < 3:
            p["ndvi_delta"] = None; p["ndvi_before"] = None; p["ndvi_after"] = None
            p["ndvi_agrees"] = None
            continue
        dv = float(np.nanmean(d[sel]))
        p["ndvi_before"] = round(float(np.nanmean(n17[sel])), 4)
        p["ndvi_after"]  = round(float(np.nanmean(n24[sel])), 4)
        p["ndvi_delta"]  = round(dv, 4)
        cat = p["change_category"]
        expect = {"vegetation_loss": -1, "development": -1, "revegetation": +1}.get(cat, 0)
        p["ndvi_agrees"] = None if expect == 0 else bool(np.sign(dv) == expect)
        by_cat.setdefault(cat, []).append((dv, p["ndvi_agrees"]))

    print(f"{'category':22s} {'n':>3} {'mean dNDVI':>11} {'expected':>9} {'agree':>7}")
    summary = {}
    for cat, vals in sorted(by_cat.items()):
        dv = [v for v, _ in vals]
        ag = [a for _, a in vals if a is not None]
        exp = {"vegetation_loss": "down", "development": "down",
               "revegetation": "up"}.get(cat, "either")
        rate = f"{sum(ag)}/{len(ag)}" if ag else "n/a"
        print(f"{cat:22s} {len(dv):>3} {np.mean(dv):>+11.4f} {exp:>9} {rate:>7}")
        summary[cat] = {"n": len(dv), "mean_ndvi_delta": round(float(np.mean(dv)), 4),
                        "expected": exp,
                        "agree": (sum(ag) if ag else None), "of": (len(ag) if ag else None)}

    (c.OUT / "candidates.geojson").write_text(json.dumps(cands, indent=1))
    # copy NDVI fields onto the shipped tasks by geometry-centroid match
    idx = {}
    for f in cands["features"]:
        g = ogr.CreateGeometryFromJson(json.dumps(f["geometry"])).Centroid()
        idx[(round(g.GetX(), 5), round(g.GetY(), 5))] = f["properties"]
    hit = 0
    for f in tasks["features"]:
        g = ogr.CreateGeometryFromJson(json.dumps(f["geometry"])).Centroid()
        src = idx.get((round(g.GetX(), 5), round(g.GetY(), 5)))
        if src:
            hit += 1
            for k in ("ndvi_before", "ndvi_after", "ndvi_delta", "ndvi_agrees"):
                f["properties"][k] = src.get(k)
    print(f"NDVI fields attached to {hit}/{len(tasks['features'])} shipped tasks")
    (c.OUT / "tasks.geojson").write_text(json.dumps(tasks, indent=1))
    st = json.loads((c.OUT / "stats.json").read_text())
    st["validation"] = {
        "method": ("Independent check: NDVI from Sentinel-2 surface reflectance (B08, B04), "
                   "which shares no input with the AlphaEarth embeddings or the Random Forest."),
        "aoi_mean_ndvi_delta": round(float(np.nanmean(d)), 4),
        "by_category": summary}
    (c.OUT / "stats.json").write_text(json.dumps(st, indent=2))
    print("\nwrote ndvi_delta / ndvi_agrees onto every task + stats.validation")

if __name__ == "__main__":
    main()
