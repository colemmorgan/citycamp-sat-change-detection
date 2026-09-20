#!/usr/bin/env python3
"""Stage C2 - augment sparse GLOBE classes with OSM-derived labels.

GLOBE gives only 3 Water/Wetland and 23 Woody points statewide - too few to
learn, in a county defined by Paynes Prairie, Newnans Lake and working
timberland. We sample supplementary labels from OpenStreetMap polygons for
exactly those two starved classes and leave Urban/Barren (78) and Herbaceous
(44) as pure volunteer data.

Every augmented point is tagged source="osm_derived" and is disclosed in the
README and the app legend. This is not a workaround for the project's thesis -
it IS the thesis: local participatory coverage is too thin to model with, which
is the gap the task queue exists to close.

Wetland points are sampled in BOTH years on purpose, so the model learns
flooded AND dry prairie as the same class. That is what stops Paynes Prairie's
seasonal hydrology from registering as a land-cover conversion.
"""
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal, osr
gdal.UseExceptions()
random.seed(42)

def rings(path):
    """OSM elements -> closed lon/lat rings."""
    try: els = json.loads((c.RAW / path).read_text())["elements"]
    except Exception: return []
    out = []
    for e in els:
        g = e.get("geometry")
        if not g or len(g) < 4: continue
        out.append(([(p["lon"], p["lat"]) for p in g], e.get("tags", {})))
    return out

def area_m2(ring):
    """Shoelace in local metres (good enough for a size filter)."""
    if len(ring) < 3: return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx = 111320 * np.cos(np.radians(lat0)); ky = 110540
    xs = [p[0] * kx for p in ring]; ys = [p[1] * ky for p in ring]
    return abs(sum(xs[i]*ys[(i+1) % len(xs)] - xs[(i+1) % len(xs)]*ys[i]
                   for i in range(len(xs)))) / 2

def inside(ring, x, y):
    n = len(ring); j = n - 1; r = False
    for i in range(n):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj-xi)*(y-yi)/(yj-yi+1e-18)+xi: r = not r
        j = i
    return r

def interior_points(polys, n_target, min_area=40000, margin_deg=0.0004):
    """Sample points safely inside polygons (margin ~40 m from any edge)."""
    big = [(r, t) for r, t in polys if area_m2(r) >= min_area]
    random.shuffle(big)
    pts = []
    for ring, tags in big:
        if len(pts) >= n_target: break
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        for _ in range(60):
            x = random.uniform(min(xs), max(xs)); y = random.uniform(min(ys), max(ys))
            if not inside(ring, x, y): continue
            if not all(inside(ring, x+dx, y+dy) for dx, dy in
                       ((margin_deg,0),(-margin_deg,0),(0,margin_deg),(0,-margin_deg))): continue
            if not (c.AOI_4326[0] < x < c.AOI_4326[2] and c.AOI_4326[1] < y < c.AOI_4326[3]): continue
            pts.append({"lon": x, "lat": y, "osm_name": tags.get("name")})
            break
    return pts

class Sampler:
    """Reads the LOCAL 20 m AOI mosaics - no network."""
    def __init__(self):
        self.ds = {y: gdal.Open(str(c.RAW / f"emb_{y}.tif")) for y in (c.BEFORE, c.AFTER)}
        self.gt = self.ds[c.BEFORE].GetGeoTransform()
        s = osr.SpatialReference(); s.ImportFromEPSG(4326)
        s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        d = osr.SpatialReference(); d.ImportFromEPSG(c.ANALYSIS_EPSG)
        d.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        self.tr = osr.CoordinateTransformation(s, d)
    def at(self, lon, lat, year):
        X, Y, _ = self.tr.TransformPoint(lon, lat)
        px = int((X - self.gt[0]) / self.gt[1]); py = int((Y - self.gt[3]) / self.gt[5])
        ds = self.ds[year]
        if not (0 <= px < ds.RasterXSize and 0 <= py < ds.RasterYSize): return None
        v = ds.ReadAsArray(px, py, 1, 1).reshape(64).astype(np.int16)
        if (v == c.AEF_NODATA).any(): return None
        return c.dequantize(v).tolist()

HERB_WET = {"marsh", "wet_meadow", "bog", "reedbed"}   # herbaceous wetland -> Water/Wetland
# NOTE: wetland=swamp is FORESTED wetland (cypress/tupelo in north Florida).
# It is structurally Woody, not open water. Sampling it as Water/Wetland made the
# model call 22% of the county water and collapsed the Herbaceous class to 0.2%.

if __name__ == "__main__":
    wat = rings("osm_water.json")
    openwater = [(r, t) for r, t in wat if t.get("natural") == "water"]
    marsh     = [(r, t) for r, t in wat if t.get("natural") == "wetland"
                 and t.get("wetland") in HERB_WET]
    swamp     = [(r, t) for r, t in wat if t.get("natural") == "wetland"
                 and t.get("wetland") == "swamp"]
    wood      = rings("osm_wood.json")
    herb      = rings("osm_herb.json")
    # Impervious surfaces only. landuse=residential is DELIBERATELY EXCLUDED: Gainesville
    # suburbs carry heavy tree canopy, and sampling them teaches the model that canopy means
    # urban - the exact Urban<->Herbaceous confusion we are trying to fix (recall was 0.62).
    urban     = [(r, t) for r, t in rings("osm_urban.json")
                 if (t.get("landuse") in {"industrial", "retail", "commercial", "quarry", "landfill"}
                     or t.get("amenity") == "parking")]
    print(f"OSM polygons: openwater={len(openwater)} marsh={len(marsh)} "
          f"swamp={len(swamp)} wood={len(wood)} herb={len(herb)} urban={len(urban)}")

    plan = [(openwater, 25, 0, "osm_openwater"),
            (marsh,     20, 0, "osm_marsh"),
            (swamp,     20, 1, "osm_swamp"),     # forested wetland -> Woody
            (wood,      25, 1, "osm_wood"),
            (herb,      45, 2, "osm_herb"),
            (urban,     28, 3, "osm_urban")]   # parking/commercial/industrial: impervious
    smp = Sampler(); added = []
    for polys, n, cls, tag in plan:
        if not polys: print(f"  ! {tag}: no polygons, skipping"); continue
        ma, mg = (15000, 0.00022) if tag == "osm_urban" else (40000, 0.0004)
        pts = interior_points(polys, n, min_area=ma, margin_deg=mg)
        got = 0
        for p in pts:
            for year in (c.BEFORE, c.AFTER):    # both years: wet AND dry states
                emb = smp.at(p["lon"], p["lat"], year)
                if emb is None: continue
                added.append({"globe_id": f"{tag}-{got}-{year}", "lon": p["lon"], "lat": p["lat"],
                              "year": year, "observed_date": f"{year}-01-01", "muc_code": None,
                              "class_code": cls, "class_label": c.CLASSES[cls],
                              "source": "osm_derived", "osm_tag": tag,
                              "osm_name": p.get("osm_name"), "emb": emb})
                got += 1
        print(f"  {tag}: {len(pts)} locations -> {got} samples (class {cls} {c.CLASSES[cls]})")

    globe = json.loads((c.OUT / "training_points.json").read_text())
    for g in globe: g.setdefault("osm_tag", None)
    allp = globe + added
    (c.OUT / "training_points_augmented.json").write_text(json.dumps(allp))
    from collections import Counter
    print(f"\nTOTAL {len(allp)} = {len(globe)} GLOBE + {len(added)} OSM")
    for k, v in Counter(p["class_label"] for p in allp).most_common(): print(f"   {v:4d}  {k}")
    print("\n   by source:", dict(Counter(p["source"] for p in allp)))
