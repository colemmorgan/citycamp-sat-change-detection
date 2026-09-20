#!/usr/bin/env python3
"""Stage C3 - train the Random Forest and classify both years.

Method from EMERGE Textbook 2, Ch5 Lesson 1: sample satellite embeddings at
participatory-science observation points, train a Random Forest on all 64
bands, apply it to the region. Deviations from the lesson (documented):
  - embeddings from the public COG mirror, not Earth Engine
  - 10 MUC Level-1 classes collapsed to 4 for sample support
  - sklearn RandomForestClassifier instead of ee.Classifier.smileRandomForest
  - sparse classes augmented from OSM (see 05_augment_labels.py)

Also emits per-pixel max-class probability, which gates the L4 transition layer.
"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as c
import numpy as np
from osgeo import gdal
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, classification_report, accuracy_score
import joblib
gdal.UseExceptions()

ROWS = 256   # chunk height for prediction

def main():
    t0 = time.time()
    pts = json.loads((c.OUT / "training_points_augmented.json").read_text())
    X = np.array([p["emb"] for p in pts], np.float32)
    y = np.array([p["class_code"] for p in pts], np.int16)
    print(f"training matrix {X.shape}", flush=True)

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    rf = RandomForestClassifier(n_estimators=300, min_samples_leaf=1,
                                class_weight="balanced_subsample",
                                n_jobs=-1, random_state=42)
    rf.fit(Xtr, ytr)
    pred = rf.predict(Xte)
    acc = accuracy_score(yte, pred)
    names = [c.CLASSES[i] for i in sorted(c.CLASSES)]
    counts = np.bincount(y, minlength=4)
    baseline = counts.max() / counts.sum()
    print(f"\ntrain {len(ytr)}  test {len(yte)}")
    print(f"ACCURACY {acc:.3f}   majority baseline {baseline:.3f}")
    print("\n" + classification_report(yte, pred, labels=sorted(c.CLASSES),
                                       target_names=names, zero_division=0))
    cm = confusion_matrix(yte, pred, labels=sorted(c.CLASSES))
    print("confusion matrix (rows=true, cols=pred)"); print(cm)

    joblib.dump(rf, c.OUT / "rf_model.joblib")
    (c.OUT / "metrics.json").write_text(json.dumps({
        "accuracy": float(acc), "baseline_majority": float(baseline),
        "n_train": int(len(ytr)), "n_test": int(len(yte)), "n_total": int(len(y)),
        "n_globe": sum(1 for p in pts if p["source"] == "globe_volunteer"),
        "n_osm": sum(1 for p in pts if p["source"] == "osm_derived"),
        "classes": {str(i): c.CLASSES[i] for i in sorted(c.CLASSES)},
        "class_counts": {c.CLASSES[i]: int(counts[i]) for i in sorted(c.CLASSES)},
        "confusion_matrix": cm.tolist(),
        "report": classification_report(yte, pred, labels=sorted(c.CLASSES),
                                        target_names=names, zero_division=0, output_dict=True),
        "n_estimators": 300,
        "method": "EMERGE Textbook 2 Ch5 Lesson 1 (adapted - see README)",
    }, indent=2))

    # ---- classify both years, chunked ----
    for year in (c.BEFORE, c.AFTER):
        src = gdal.Open(str(c.RAW / f"emb_{year}.tif"))
        W, H, NB = src.RasterXSize, src.RasterYSize, src.RasterCount
        lab = np.full((H, W), 255, np.uint8)
        prob = np.zeros((H, W), np.float32)
        for r0 in range(0, H, ROWS):
            nr = min(ROWS, H - r0)
            cube = src.ReadAsArray(0, r0, W, nr).astype(np.int16)      # (64,nr,W)
            bad = (cube == c.AEF_NODATA).any(axis=0)
            feat = c.dequantize(cube).reshape(NB, -1).T                # (nr*W,64)
            pr = rf.predict_proba(feat)
            lab[r0:r0+nr] = np.where(bad, 255, rf.classes_[pr.argmax(1)].reshape(nr, W))
            prob[r0:r0+nr] = np.where(bad, 0, pr.max(1).reshape(nr, W))
        drv = gdal.GetDriverByName("GTiff")
        for arr, nm, dt, nd in ((lab, f"lulc_{year}_utm.tif", gdal.GDT_Byte, 255),
                                (prob, f"prob_{year}_utm.tif", gdal.GDT_Float32, 0)):
            o = drv.Create(str(c.RAW / nm), W, H, 1, dt,
                           ["COMPRESS=DEFLATE", "TILED=YES", "NUM_THREADS=ALL_CPUS"])
            o.SetGeoTransform(src.GetGeoTransform()); o.SetProjection(src.GetProjection())
            o.GetRasterBand(1).WriteArray(arr); o.GetRasterBand(1).SetNoDataValue(nd)
            o.FlushCache(); o = None
        dist = {c.CLASSES[i]: f"{(lab==i).mean()*100:.1f}%" for i in sorted(c.CLASSES)}
        print(f"\n{year} classified -> {dist}", flush=True)

        # delivery COG in EPSG:3857
        xmin, ymin, xmax, ymax = c.AOI_3857
        gdal.Warp(str(c.RAW / f"lulc_{year}_3857.tif"), str(c.RAW / f"lulc_{year}_utm.tif"),
                  dstSRS=f"EPSG:{c.DELIVERY_EPSG}", outputBounds=(xmin, ymin, xmax, ymax),
                  xRes=c.Z13_RES, yRes=c.Z13_RES, resampleAlg="near",
                  srcNodata=255, dstNodata=255)
        gdal.Translate(str(c.OUT / f"lulc_{year}.tif"), str(c.RAW / f"lulc_{year}_3857.tif"),
                       format="COG", creationOptions=["COMPRESS=DEFLATE", "BLOCKSIZE=512",
                                                      "OVERVIEWS=NONE", "NUM_THREADS=ALL_CPUS"])
        src = None
    print(f"\ndone in {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
