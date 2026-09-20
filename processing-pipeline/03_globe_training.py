#!/usr/bin/env python3
"""Stage C1 - build the training table: GLOBE labels + AlphaEarth embeddings.

Method follows EMERGE Textbook 2, Ch5 Lesson 1 (sample embeddings at GLOBE
observation points -> Random Forest on all 64 bands), with two deliberate
deviations: the embeddings come from the public COG mirror instead of Earth
Engine, and the 10 MUC Level-1 classes are collapsed to 4 for sample support.

Each point is sampled from the embedding of ITS OWN observation year.
Points are grouped by (year, tile) so each remote COG is opened once.
"""
import os, sys, json, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal, osr
gdal.UseExceptions()
_env = {**c.GDAL_ENV, "GDAL_HTTP_MULTIPLEX": "NO"}   # multiplexing is not thread-safe here
for k, v in _env.items(): gdal.SetConfigOption(k, v); os.environ[k] = v

AEF_INDEX_CSV = "https://data.source.coop/tge-labs/aef/v1/annual/aef_index.csv"

def ensure_tile_index():
    """Build data/fl_tile_index.json if absent.

    Tile filenames encode nothing spatial, so the published index is the only way to
    find which COG covers a point. The full index is ~800 MB, so we stream-filter it
    to Florida once (621 tiles, ~150 KB) and cache that. The slim index is committed,
    so this only runs on a truly clean checkout.
    """
    dst = c.ROOT / "data" / "fl_tile_index.json"
    if dst.exists() and dst.stat().st_size > 1000:
        return json.loads(dst.read_text())
    import csv, tempfile
    csv.field_size_limit(sys.maxsize)
    print("tile index missing - streaming the ~800 MB published index once...", flush=True)
    W, S, E, N = c.FL_BBOX
    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    with urllib.request.urlopen(AEF_INDEX_CSV, timeout=900) as r:
        while chunk := r.read(1 << 20):
            tmp.write(chunk)
    tmp.close()
    out = []
    with open(tmp.name, newline="") as f:
        for row in csv.DictReader(f):
            try:
                w = float(row["wgs84_west"]); e = float(row["wgs84_east"])
                s_ = float(row["wgs84_south"]); n = float(row["wgs84_north"])
            except (ValueError, TypeError):
                continue
            if w < E and e > W and s_ < N and n > S:
                out.append({"year": int(row["year"]), "crs": row["crs"],
                            "vrt": row["path"].replace("s3://", "/vsis3/").replace(".tiff", ".vrt"),
                            "w": w, "s": s_, "e": e, "n": n})
    os.unlink(tmp.name)
    dst.write_text(json.dumps(out))
    print(f"  built {dst.name}: {len(out)} Florida tiles", flush=True)
    return out

def fetch_globe(refresh=False):
    """Statewide GLOBE land-cover observations, cached to disk.

    The cache EXPIRES. It used to be kept forever, which quietly pinned the map
    to whatever existed the first time the pipeline ran - new field observations
    could never appear no matter how many times it was re-run. Pass --refresh to
    force, or just let it age out.
    """
    cache = c.RAW / "globe_fl_land_covers.json"
    if cache.exists() and not refresh:
        age = (time.time() - cache.stat().st_mtime) / 86400
        if age <= c.GLOBE_CACHE_MAX_AGE_DAYS:
            print(f"GLOBE: using cache ({age*24:.1f}h old)", flush=True)
            return json.loads(cache.read_text())["results"]
        print(f"GLOBE: cache is {age:.1f}d old, re-fetching", flush=True)
    w, s, e, n = c.FL_BBOX
    url = c.GLOBE_API.format(proto="land_covers", start=c.GLOBE_START, end=c.GLOBE_END, w=w, s=s, e=e, n=n)
    print("GLOBE: fetching statewide Florida...", flush=True)
    with urllib.request.urlopen(url, timeout=180) as r: raw = r.read()
    cache.write_bytes(raw)
    return json.loads(raw)["results"]

def label_points(results):
    pts = []
    for x in results:
        cl = c.muc_to_class(x["data"].get("landcoversMucCode"))
        if cl is None: continue
        pts.append({"globe_id": str(x.get("pid")), "lon": float(x["longitude"]),
                    "lat": float(x["latitude"]), "year": int(x["measuredDate"][:4]),
                    "observed_date": x["measuredDate"][:10],
                    "muc_code": x["data"]["landcoversMucCode"],
                    "class_code": cl, "class_label": c.CLASSES[cl],
                    "source": "globe_volunteer"})
    return pts

def assign_tiles(pts, index):
    by_year = defaultdict(list)
    for t in index: by_year[t["year"]].append(t)
    groups, unmatched = defaultdict(list), 0
    for p in pts:
        hit = next((t for t in by_year.get(p["year"], [])
                    if t["w"] <= p["lon"] <= t["e"] and t["s"] <= p["lat"] <= t["n"]), None)
        if hit is None: unmatched += 1; continue
        groups[(p["year"], hit["vrt"], hit["crs"])].append(p)
    return groups, unmatched

def sample_group(args):
    (year, vrt, crs), pts = args
    try:
        ds = gdal.Open(vrt)
    except Exception as ex:
        print(f"  ! open failed {vrt[-28:]}: {ex}", flush=True); return []
    gt = ds.GetGeoTransform()
    src = osr.SpatialReference(); src.ImportFromEPSG(4326)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst = osr.SpatialReference(); dst.ImportFromEPSG(int(crs.split(":")[1]))
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    tr = osr.CoordinateTransformation(src, dst)
    out = []
    for p in pts:
        X, Y, _ = tr.TransformPoint(p["lon"], p["lat"])
        px = int((X - gt[0]) / gt[1]); py = int((Y - gt[3]) / gt[5])
        if not (0 <= px < ds.RasterXSize and 0 <= py < ds.RasterYSize): continue
        try:
            a = ds.ReadAsArray(px, py, 1, 1)           # (64,1,1) int8
        except Exception:
            continue
        v = a.reshape(64).astype(np.int16)
        if (v == c.AEF_NODATA).any(): continue
        p = dict(p); p["emb"] = c.dequantize(v).tolist()
        out.append(p)
    ds = None
    return out

if __name__ == "__main__":
    t0 = time.time()
    results = fetch_globe("--refresh" in sys.argv)
    print(f"GLOBE: {len(results)} land_cover records statewide", flush=True)
    pts = label_points(results)
    print(f"labelled (MucCode present): {len(pts)} of {len(results)}", flush=True)
    index = ensure_tile_index()
    groups, unmatched = assign_tiles(pts, index)
    print(f"grouped into {len(groups)} (year,tile) reads; {unmatched} points unmatched", flush=True)
    sampled = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, res in enumerate(ex.map(sample_group, groups.items()), 1):
            sampled += res
            print(f"  [{i}/{len(groups)}] +{len(res)} (total {len(sampled)})", flush=True)
    from collections import Counter
    dist = Counter(p["class_label"] for p in sampled)
    print(f"\nSAMPLED {len(sampled)} training points in {time.time()-t0:.0f}s")
    for k, v in dist.most_common(): print(f"   {v:4d}  {k}")
    (c.OUT / "training_points.json").write_text(json.dumps(sampled))
    print(f"\nwrote {c.OUT/'training_points.json'}", flush=True)
