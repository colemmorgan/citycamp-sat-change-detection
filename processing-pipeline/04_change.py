#!/usr/bin/env python3
"""Stage B - cosine change between the two embedding years.

change = 1 - cos(e_before, e_after). The vectors are unit-length after
de-quantization, so this is just the dot product, but we divide by the norms
anyway to stay correct if overview resampling nudged them off unit length.

Accumulates band-by-band rather than loading two 64-band cubes: peak memory is
~5 x (H x W) float32 instead of 2 x 64 x (H x W). That is what makes the 10 m
build possible later without a rewrite.

Computed on the native EPSG:32617 grid - NEVER reproject embeddings before
this step, since resampling interpolates the components and breaks unit length.
"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal
gdal.UseExceptions()

def main():
    t0 = time.time()
    a = gdal.Open(str(c.RAW / f"emb_{c.BEFORE}.tif"))
    b = gdal.Open(str(c.RAW / f"emb_{c.AFTER}.tif"))
    assert (a.RasterXSize, a.RasterYSize) == (b.RasterXSize, b.RasterYSize), "grid mismatch"
    W, H, NB = a.RasterXSize, a.RasterYSize, a.RasterCount
    print(f"grid {W}x{H}, {NB} bands", flush=True)

    dot = np.zeros((H, W), np.float32)
    n_a = np.zeros((H, W), np.float32)
    n_b = np.zeros((H, W), np.float32)
    bad = np.zeros((H, W), bool)

    for i in range(1, NB + 1):
        va = a.GetRasterBand(i).ReadAsArray().astype(np.int16)
        vb = b.GetRasterBand(i).ReadAsArray().astype(np.int16)
        if i == 1:
            bad = (va == c.AEF_NODATA) | (vb == c.AEF_NODATA)   # nodata spans all bands
        fa, fb = c.dequantize(va), c.dequantize(vb)
        dot += fa * fb; n_a += fa * fa; n_b += fb * fb
        if i % 16 == 0: print(f"  band {i}/{NB}", flush=True)

    cos = dot / (np.sqrt(n_a) * np.sqrt(n_b) + 1e-9)
    change = (1.0 - cos).astype(np.float32)
    change[bad] = np.nan
    valid = change[~bad]
    print(f"\nvalid px {valid.size:,} ({valid.size/(H*W)*100:.1f}%)  nodata {int(bad.sum()):,}", flush=True)

    qs = {f"p{q}".replace(".", ""): float(np.percentile(valid, q))
          for q in (50, 75, 90, 95, 99, 99.9)}
    qs.update(max=float(valid.max()), mean=float(valid.mean()), min=float(valid.min()))
    for k, v in qs.items(): print(f"   {k:6s} {v:.4f}")

    # native-grid GeoTIFF (analysis product, stays local)
    drv = gdal.GetDriverByName("GTiff")
    utm = drv.Create(str(c.RAW / "change_utm.tif"), W, H, 1, gdal.GDT_Float32,
                     ["COMPRESS=DEFLATE", "TILED=YES", "NUM_THREADS=ALL_CPUS"])
    utm.SetGeoTransform(a.GetGeoTransform()); utm.SetProjection(a.GetProjection())
    utm.GetRasterBand(1).WriteArray(change)
    utm.GetRasterBand(1).SetNoDataValue(float("nan"))
    utm.FlushCache(); utm = None; a = None; b = None

    # -> EPSG:3857 z13 delivery COG (contract: 2330x2279, Float32, NaN nodata)
    xmin, ymin, xmax, ymax = c.AOI_3857
    gdal.Warp(str(c.RAW / "change_3857.tif"), str(c.RAW / "change_utm.tif"),
              dstSRS=f"EPSG:{c.DELIVERY_EPSG}",
              outputBounds=(xmin, ymin, xmax, ymax),
              xRes=c.Z13_RES, yRes=c.Z13_RES, resampleAlg="bilinear",
              srcNodata=float("nan"), dstNodata=float("nan"),
              creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "NUM_THREADS=ALL_CPUS"])
    gdal.Translate(str(c.OUT / "change.tif"), str(c.RAW / "change_3857.tif"),
                   format="COG",
                   creationOptions=["COMPRESS=DEFLATE", "BLOCKSIZE=512",
                                    "OVERVIEWS=AUTO", "NUM_THREADS=ALL_CPUS"])

    stats = {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "aoi_4326": list(c.AOI_4326), "resolution_m": c.Z13_RES, "zoom_level": 13,
        "analysis_epsg": c.ANALYSIS_EPSG, "analysis_res_m": c.ANALYSIS_RES,
        "years": {"before": c.BEFORE, "after": c.AFTER},
        "change": {**qs, "slider_default": qs["p99"],
                   "slider_min": qs["p90"], "slider_max": qs["max"]},
        "classes": {str(k): v for k, v in c.CLASSES.items()},
        "model": {"n_train": None, "n_test": None, "accuracy": None,
                  "baseline_majority": None, "note": "filled by 05_train_rf.py"},
        "counts": {"tasks": None, "globe_in_aoi": None, "transition_px": None},
        "credits": {"alphaearth": c.AEF_ATTRIBUTION,
                    "sentinel2": "Contains modified Copernicus Sentinel data, processed by ESA.",
                    "globe": "NASA GLOBE Observer participatory science data."},
    }
    (c.OUT / "stats.json").write_text(json.dumps(stats, indent=2))
    sz = (c.OUT / "change.tif").stat().st_size / 1e6
    print(f"\nwrote change.tif ({sz:.1f} MB) + stats.json in {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
