#!/usr/bin/env python3
"""Stage D2 - observation points as GeoJSON for the map.

Three kinds of point, all disclosed:
  globe_volunteer  - a GLOBE observation WITH a usable MUC code (trained on)
  globe_unusable   - a GLOBE observation with NO MUC code (cannot be trained on)
  osm_derived      - supplementary label for a class GLOBE could not support

The unusable points are the project's central evidence and must be on the map.
Inside the study area there are exactly 10 GLOBE land-cover observations: all
from ONE site, all within six weeks of late 2025, and NOT ONE carries a usable
land-cover classification. Zero volunteer points trained the Gainesville model.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c

W, S, E, N = c.AOI_4326
inside = lambda lo, la: W <= lo <= E and S <= la <= N

pts = json.loads((c.OUT / "training_points_augmented.json").read_text())
feats = []
for p in pts:
    feats.append({"type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(p["lon"], 6), round(p["lat"], 6)]},
        "properties": {
            "globe_id": p["globe_id"], "observed_date": p["observed_date"],
            "muc_code": p.get("muc_code"), "class_code": p["class_code"],
            "class_label": p["class_label"], "used_in_training": True,
            "source": p["source"], "osm_tag": p.get("osm_tag"),
            "in_aoi": inside(p["lon"], p["lat"])}})

# GLOBE observations that exist but carry no usable classification
recs = json.loads((c.RAW / "globe_fl_land_covers.json").read_text())["results"]
unusable_aoi = 0
for r in recs:
    lo, la = float(r["longitude"]), float(r["latitude"])
    if c.muc_to_class(r["data"].get("landcoversMucCode")) is not None: continue
    ia = inside(lo, la)
    if not ia: continue                      # statewide unusables would swamp the map
    unusable_aoi += 1
    feats.append({"type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lo, 6), round(la, 6)]},
        "properties": {
            "globe_id": str(r.get("pid")), "observed_date": r["measuredDate"][:10],
            "muc_code": None, "class_code": None, "class_label": None,
            "used_in_training": False, "source": "globe_unusable",
            "site_name": r.get("siteName"), "osm_tag": None, "in_aoi": True,
            "why_unusable": "No MUC land-cover code recorded"}})

(c.OUT / "globe_points.geojson").write_text(json.dumps(
    {"type": "FeatureCollection", "features": feats}))

globe_train_aoi = sum(1 for f in feats if f["properties"]["source"] == "globe_volunteer"
                      and f["properties"]["in_aoi"])
st = json.loads((c.OUT / "stats.json").read_text())
st["counts"].update({
    "points_total": len(feats),
    "globe_trained_in_aoi": globe_train_aoi,
    "globe_unusable_in_aoi": unusable_aoi,
    "globe_total_in_aoi": globe_train_aoi + unusable_aoi,
    "globe_trained_statewide": sum(1 for p in pts if p["source"] == "globe_volunteer"),
    "osm_supplements": sum(1 for p in pts if p["source"] == "osm_derived"),
})
st["headline"] = {
    "globe_obs_in_study_area": globe_train_aoi + unusable_aoi,
    "globe_usable_in_study_area": globe_train_aoi,
    "distinct_sites_in_study_area": len({f["properties"].get("site_name")
                                         for f in feats
                                         if f["properties"]["source"] == "globe_unusable"}),
    "statement": (f"{globe_train_aoi + unusable_aoi} GLOBE land-cover observations exist in the "
                  f"study area; {globe_train_aoi} are usable for modelling."),
}
(c.OUT / "stats.json").write_text(json.dumps(st, indent=2))
print(f"wrote {len(feats)} points")
print(f"  GLOBE usable in AOI   : {globe_train_aoi}")
print(f"  GLOBE unusable in AOI : {unusable_aoi}")
print(f"  headline: {st['headline']['statement']}")
