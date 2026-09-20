#!/usr/bin/env python3
"""Stage D - L4 confirmed transitions, protected-area intersect, task queue.

L4 = (cosine change >= p99) AND (class flipped) AND (both years confident).
The cosine term is computed from embeddings and is independent of the
classifier, so it suppresses classifier flicker; the class flip supplies the
plain-language from->to description the cosine layer cannot give.

Tasks are ranked by CATEGORY first, then magnitude - see config.categorise().
"""
import os, sys, json, math, time, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal, ogr, osr
gdal.UseExceptions(); ogr.UseExceptions()

def fetch_padus():
    cache = c.RAW / "padus.geojson"
    if cache.exists(): return json.loads(cache.read_text())
    w, s, e, n = c.AOI_4326
    q = urllib.parse.urlencode({
        "geometry": json.dumps({"xmin": w, "ymin": s, "xmax": e, "ymax": n,
                                "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryEnvelope", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
        "returnGeometry": "true", "outSR": 4326, "f": "geojson"})
    with urllib.request.urlopen(f"{c.PADUS_URL}?{q}", timeout=120) as r:
        gj = json.loads(r.read())
    cache.write_text(json.dumps(gj)); return gj

def main():
    t0 = time.time()
    ch  = gdal.Open(str(c.RAW / "change_utm.tif"))
    a   = gdal.Open(str(c.RAW / f"lulc_{c.BEFORE}_utm.tif")).ReadAsArray()
    b   = gdal.Open(str(c.RAW / f"lulc_{c.AFTER}_utm.tif")).ReadAsArray()
    pa  = gdal.Open(str(c.RAW / f"prob_{c.BEFORE}_utm.tif")).ReadAsArray()
    pb  = gdal.Open(str(c.RAW / f"prob_{c.AFTER}_utm.tif")).ReadAsArray()
    cha = ch.ReadAsArray()
    stats = json.loads((c.OUT / "stats.json").read_text())
    _v = np.isfinite(cha) & (a != 255) & (b != 255)
    thr = float(np.percentile(cha[_v], c.L4_CHANGE_PCTL))
    stats["change"]["l4_threshold"] = thr
    stats["change"]["l4_percentile"] = c.L4_CHANGE_PCTL
    stats["change"]["slider_default"] = thr     # app opens aligned with the L4 layer

    valid = (a != 255) & (b != 255) & np.isfinite(cha)
    gate = valid & (cha >= thr) & (a != b) & (np.minimum(pa, pb) >= c.L4_PROB_MIN)
    trans = np.where(gate, a.astype(np.int16) * 10 + b.astype(np.int16), 0).astype(np.uint8)
    trans[~valid] = 255
    print(f"L4: {int(gate.sum()):,} px ({gate.mean()*100:.2f}%) above thr={thr:.3f}", flush=True)

    drv = gdal.GetDriverByName("GTiff")
    o = drv.Create(str(c.RAW / "transitions_utm.tif"), ch.RasterXSize, ch.RasterYSize, 1,
                   gdal.GDT_Byte, ["COMPRESS=DEFLATE", "TILED=YES"])
    o.SetGeoTransform(ch.GetGeoTransform()); o.SetProjection(ch.GetProjection())
    o.GetRasterBand(1).WriteArray(trans); o.GetRasterBand(1).SetNoDataValue(255)
    o.FlushCache(); o = None

    xmin, ymin, xmax, ymax = c.AOI_3857
    gdal.Warp(str(c.RAW / "transitions_3857.tif"), str(c.RAW / "transitions_utm.tif"),
              dstSRS=f"EPSG:{c.DELIVERY_EPSG}", outputBounds=(xmin, ymin, xmax, ymax),
              xRes=c.Z13_RES, yRes=c.Z13_RES, resampleAlg="near",
              srcNodata=255, dstNodata=255)
    gdal.Translate(str(c.OUT / "transitions.tif"), str(c.RAW / "transitions_3857.tif"),
                   format="COG", creationOptions=["COMPRESS=DEFLATE", "BLOCKSIZE=512",
                                                  "OVERVIEWS=NONE", "NUM_THREADS=ALL_CPUS"])

    # ---- polygonize L4 (UTM, so areas are true) ----
    mem = ogr.GetDriverByName("MEM").CreateDataSource("m")
    srs = osr.SpatialReference(); srs.ImportFromWkt(ch.GetProjection())
    lyr = mem.CreateLayer("t", srs, ogr.wkbPolygon)
    lyr.CreateField(ogr.FieldDefn("code", ogr.OFTInteger))
    src = drv.Create("/vsimem/t.tif", ch.RasterXSize, ch.RasterYSize, 1, gdal.GDT_Byte)
    src.SetGeoTransform(ch.GetGeoTransform()); src.SetProjection(ch.GetProjection())
    src.GetRasterBand(1).WriteArray(np.where(gate, trans, 0))
    mask = drv.Create("/vsimem/m.tif", ch.RasterXSize, ch.RasterYSize, 1, gdal.GDT_Byte)
    mask.SetGeoTransform(ch.GetGeoTransform()); mask.SetProjection(ch.GetProjection())
    mask.GetRasterBand(1).WriteArray(gate.astype(np.uint8) * 255)
    gdal.Polygonize(src.GetRasterBand(1), mask.GetRasterBand(1), lyr, 0)
    print(f"polygonized: {lyr.GetFeatureCount():,} raw patches", flush=True)

    # ---- PAD-US ----
    padus = fetch_padus()
    to4326 = osr.SpatialReference(); to4326.ImportFromEPSG(4326)
    to4326.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    fwd = osr.CoordinateTransformation(to4326, srs)     # 4326 -> UTM
    rev = osr.CoordinateTransformation(srs, to4326)     # UTM  -> 4326
    prot = []
    for f in padus.get("features", []):
        if not f.get("geometry"): continue
        try:
            g = ogr.CreateGeometryFromJson(json.dumps(f["geometry"])); g.Transform(fwd)
        except Exception: continue
        p = f.get("properties", {})
        prot.append({"geom": g, "buf": g.Buffer(c.ADJACENT_M),
                     "name": p.get("Unit_Nm") or p.get("Loc_Nm") or "Unnamed protected area",
                     "manager": p.get("Mang_Name") or p.get("Mang_Type") or "",
                     "own": p.get("Own_Type") or ""})
    print(f"PAD-US units: {len(prot)}", flush=True)

    # ---- build tasks ----
    cand = []
    gt = ch.GetGeoTransform(); px_ha = abs(gt[1] * gt[5]) / 1e4
    for feat in lyr:
        code = feat.GetField("code")
        if not code: continue
        g = feat.GetGeometryRef().Clone()
        ha = g.GetArea() / 1e4
        if ha < c.MIN_PATCH_HA: continue
        fr, to = divmod(code, 10)
        if fr not in c.CLASSES or to not in c.CLASSES or fr == to: continue
        cat, base = c.categorise(fr, to)
        cen = g.Centroid()
        status, pname, pmgr, dist = "outside", None, None, None
        for p in prot:
            if p["geom"].Intersects(g): status, pname, pmgr, dist = "inside", p["name"], p["manager"], 0; break
        if status == "outside":
            for p in prot:
                if p["buf"].Intersects(g):
                    status, pname, pmgr = "adjacent", p["name"], p["manager"]
                    dist = int(round(g.Distance(p["geom"]))); break
        # mean change inside the patch
        x0 = int((g.GetEnvelope()[0] - gt[0]) / gt[1]); x1 = int((g.GetEnvelope()[1] - gt[0]) / gt[1])
        y0 = int((g.GetEnvelope()[3] - gt[3]) / gt[5]); y1 = int((g.GetEnvelope()[2] - gt[3]) / gt[5])
        sub = cha[max(0,y0):max(y0+1,y1+1), max(0,x0):max(x0+1,x1+1)]
        subg = gate[max(0,y0):max(y0+1,y1+1), max(0,x0):max(x0+1,x1+1)]
        cm = float(np.nanmean(sub[subg])) if subg.any() else float(thr)
        cx = float(np.nanmax(sub[subg])) if subg.any() else float(thr)
        boost = 25 if status == "inside" else (10 if status == "adjacent" else 0)
        score = base + boost + 40 * (cm - thr) / max(1e-6, 1 - thr) + 8 * math.log10(1 + ha)
        gg = g.Clone(); gg.Transform(rev); cc = cen.Clone(); cc.Transform(rev)
        cand.append({"geom": gg, "lon": cc.GetX(), "lat": cc.GetY(), "area_ha": round(ha, 2),
                     "from": fr, "to": to, "code": code, "cat": cat, "score": score,
                     "cmean": round(cm, 4), "cmax": round(cx, 4),
                     "status": status, "pname": pname, "pmgr": pmgr, "dist": dist})
    cand.sort(key=lambda d: -d["score"])

    # Quota selection. Pure category-first ranking made all 40 tasks vegetation_loss,
    # which hides the development findings and leaves the UI category filter with
    # nothing to filter. Quotas guarantee every real category is represented; ranking
    # WITHIN and ACROSS the selection is still severity-ordered.
    QUOTA = {"vegetation_loss": 24, "development": 6, "revegetation": 6, "hydrologic": 4}
    picked, used = [], {k: 0 for k in QUOTA}
    for d in cand:
        q = QUOTA.get(d["cat"], 0)
        if used.get(d["cat"], 0) < q:
            picked.append(d); used[d["cat"]] = used.get(d["cat"], 0) + 1
    for d in cand:                      # backfill if a category was short
        if len(picked) >= 40: break
        if d not in picked: picked.append(d)
    top = sorted(picked, key=lambda d: -d["score"])[:40]
    from collections import Counter as _C
    print(f"candidates {len(cand):,} -> top {len(top)}  {dict(_C(d['cat'] for d in top))}", flush=True)

    # export ALL candidates so stage F can validate every category, not just shipped tasks
    (c.OUT / "candidates.geojson").write_text(json.dumps({"type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": json.loads(d["geom"].ExportToJson()),
                      "properties": {"change_category": d["cat"], "area_ha": d["area_ha"],
                                     "change_mean": d["cmean"], "from_class": d["from"],
                                     "to_class": d["to"], "severity_score": round(d["score"], 1),
                                     "protected_status": d["status"]}}
                     for d in cand]}))

    feats = []
    for i, d in enumerate(top, 1):
        where = (f"inside {d['pname']}" if d["status"] == "inside" else
                 f"{d['dist']} m from {d['pname']}" if d["status"] == "adjacent" else
                 "outside protected land")
        feats.append({"type": "Feature",
            "geometry": json.loads(d["geom"].ExportToJson()),
            "properties": {
                "task_id": f"TASK-{i:04d}", "rank": i,
                "centroid": [round(d["lon"], 6), round(d["lat"], 6)],
                "area_ha": d["area_ha"], "change_mean": d["cmean"], "change_max": d["cmax"],
                "from_class": d["from"], "to_class": d["to"],
                "from_label": c.CLASSES[d["from"]], "to_label": c.CLASSES[d["to"]],
                "transition_code": d["code"],
                "change_category": d["cat"],
                "category_label": c.CATEGORY_LABELS[d["cat"]],
                "severity_score": round(d["score"], 1),
                "protected_status": d["status"], "protected_name": d["pname"],
                "protected_manager": d["pmgr"], "distance_to_protected_m": d["dist"],
                "summary": (f"{c.CLASSES[d['from']]} to {c.CLASSES[d['to']]}, "
                            f"{d['area_ha']} ha, {where}"),
            }})
    (c.OUT / "tasks.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": feats}, indent=1))

    pf = []
    for p in prot:
        g = p["geom"].Clone(); g.Transform(rev)
        pf.append({"type": "Feature", "geometry": json.loads(g.ExportToJson()),
                   "properties": {"unit_name": p["name"], "manager": p["manager"],
                                  "own_type": p["own"]}})
    (c.OUT / "protected.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": pf}))

    present = sorted({d["code"] for d in cand})
    legend = {}
    for code in present:
        fr, to = divmod(code, 10)
        cat, base = c.categorise(fr, to)
        legend[str(code)] = {"from": c.CLASSES[fr], "to": c.CLASSES[to],
                             "label": f"{c.CLASSES[fr]} → {c.CLASSES[to]}",
                             "category": cat, "category_label": c.CATEGORY_LABELS[cat],
                             "color": c.CATEGORY_COLORS[cat], "priority": 1000 - base}
    (c.OUT / "transitions_legend.json").write_text(json.dumps(legend, indent=2))

    from collections import Counter
    catc = Counter(d["cat"] for d in cand)
    print("\ncandidates by category:")
    for k, v in catc.most_common(): print(f"   {v:5d}  {c.CATEGORY_LABELS[k]}")
    print("\ntop 10 tasks:")
    for f in feats[:10]:
        p = f["properties"]
        print(f"   {p['rank']:2d}. [{p['category_label']:22s}] {p['summary']}")

    m = json.loads((c.OUT / "metrics.json").read_text())
    stats["model"] = {"n_train": m["n_train"], "n_test": m["n_test"],
                      "accuracy": m["accuracy"], "baseline_majority": m["baseline_majority"],
                      "n_globe": m["n_globe"], "n_osm": m["n_osm"],
                      "note": m["method"]}
    stats["counts"] = {"tasks": len(feats), "globe_in_aoi": None,
                       "transition_px": int(gate.sum()),
                       "candidates": len(cand),
                       "by_category": {k: v for k, v in catc.items()}}
    stats["categories"] = {k: {"label": c.CATEGORY_LABELS[k], "color": c.CATEGORY_COLORS[k]}
                           for k in c.CATEGORY_LABELS}
    (c.OUT / "stats.json").write_text(json.dumps(stats, indent=2))
    print(f"\ndone in {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
