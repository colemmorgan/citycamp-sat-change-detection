#!/usr/bin/env python3
"""Stage A0 - OpenStreetMap label polygons via Overpass.

GLOBE covers only 4 of our 10 MUC Level-1 classes with usable volume. These
polygons supply supplementary labels for the classes it cannot support. Every
point derived from them is tagged source="osm_derived" and disclosed in the app.

Overpass mirrors return 504 under load, so each query retries across mirrors.
Results are cached in data/raw/ and skipped if present - re-running is free.

© OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright)
"""
import os, sys, time, json, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c

MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter"]
W, S, E, N = c.AOI_4326
BBOX = f"{S},{W},{N},{E}"

QUERIES = {
    # class 0 Water/Wetland (open water + herbaceous wetland) AND class 1 (swamp = forested)
    "osm_water.json": f"""[out:json][timeout:120];
(way["natural"="water"]({BBOX});relation["natural"="water"]({BBOX});
 way["natural"="wetland"]({BBOX});relation["natural"="wetland"]({BBOX}););out geom;""",
    # class 1 Woody
    "osm_wood.json": f"""[out:json][timeout:120];
(way["natural"="wood"]({BBOX});way["landuse"="forest"]({BBOX});
 relation["natural"="wood"]({BBOX});relation["landuse"="forest"]({BBOX}););out geom;""",
    # class 2 Herbaceous
    "osm_herb.json": f"""[out:json][timeout:120];
(way["landuse"="farmland"]({BBOX});way["landuse"="meadow"]({BBOX});
 way["landuse"="grass"]({BBOX});way["natural"="grassland"]({BBOX});
 way["landuse"="orchard"]({BBOX}););out geom;""",
    # class 3 Urban/Barren - IMPERVIOUS ONLY. landuse=residential is deliberately
    # excluded: Gainesville suburbs carry heavy canopy and would teach the model
    # that tree cover means urban.
    "osm_urban.json": f"""[out:json][timeout:120];
(way["landuse"="industrial"]({BBOX});way["landuse"="retail"]({BBOX});
 way["landuse"="commercial"]({BBOX});way["amenity"="parking"]({BBOX});
 way["landuse"="quarry"]({BBOX});way["landuse"="landfill"]({BBOX}););out geom;""",
}

def fetch(name, query, tries=3):
    dst = c.RAW / name
    if dst.exists() and dst.stat().st_size > 1000:
        n = len(json.loads(dst.read_text()).get("elements", []))
        print(f"  {name:18s} cached ({n} elements)", flush=True); return
    for attempt in range(tries):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode({"data": query}).encode(),
                headers={"User-Agent": "citycamp-emerge-track/1.0"})
            with urllib.request.urlopen(req, timeout=240) as r:
                raw = r.read()
            n = len(json.loads(raw).get("elements", []))
            dst.write_bytes(raw)
            print(f"  {name:18s} {n} elements  ({url.split('/')[2]})", flush=True)
            return
        except Exception as ex:
            print(f"  {name:18s} attempt {attempt+1}/{tries} failed on "
                  f"{url.split('/')[2]}: {type(ex).__name__}", flush=True)
            time.sleep(5)
    raise SystemExit(f"could not fetch {name} from any Overpass mirror")

if __name__ == "__main__":
    print("OpenStreetMap label polygons (c) OpenStreetMap contributors, ODbL", flush=True)
    for name, q in QUERIES.items():
        fetch(name, q)
    print("OSM DONE", flush=True)
