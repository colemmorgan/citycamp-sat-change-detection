# Technical Spec — CityCamp EMERGE Track

## Product

**Working name: `Ground Truth` — Gainesville.**
*Satellite embeddings find what changed inside Alachua County's conservation lands. GLOBE Observer volunteers go confirm it.*

### The one question
> **Can participatory science help protect conservation land — and can satellite AI tell volunteers where to go?**

### The argument, in three numbers
1. Alachua County has **10 GLOBE land-cover observations in 9 years**. The program is invisible here.
2. AlphaEarth embeddings flag **~1% of pixels** as strongly changed 2017→2024 — hundreds of hectares.
3. Some of that change is **inside protected conservation areas**. That is where the 11th observation should go.

Change detection converts an empty map into a **ranked, finite to-do list**. That is the product.

---

## Architecture

Two halves. Precompute is Python and runs once. The app is fully static.

```
PRECOMPUTE (python, local, one-time)          →  ARTIFACTS  →  STATIC APP (OpenLayers)
──────────────────────────────────────           ─────────      ──────────────────────
AlphaEarth 2017 COG ┐                            change.tif     COG change raster + slider
AlphaEarth 2024 COG ┴→ dequant → 1-cos    ────→  (COG)          
GLOBE FL land cover ──→ RF classifier      ───→  landcover.tif  classified layer
  (Ch5 L1 method)      → classify AOI            globe.geojson  observation pins
PAD-US Alachua ───────→ zonal stats        ───→  protected.json protected boundaries
change ∩ protected ───→ rank top-N         ───→  tasks.geojson  TASK QUEUE panel
```

**No Earth Engine. No backend. No auth. No database.** Deploys to GitHub Pages.

### Why no Earth Engine
The Ch5 Lesson 1 method requires AlphaEarth embeddings, which the lesson sources from Earth Engine.
We have no EE account and approval is not something to gamble a hackathon on. We source the identical
data from the public Source Cooperative COG mirror (see `00-verified-facts.md` §1). The **method is
unchanged**; only the I/O layer differs. This is a deliverable in its own right — it makes the lesson
runnable by anyone without an EE account, which maps directly to the track's
"Improve the curriculums" project direction.

---

## AOI

`-82.55, 29.48 → -82.15, 29.82` (~39 × 38 km)

Chosen to contain **Paynes Prairie Preserve** (S), **San Felasco Hammock** (NW), **Newnans Lake** (E),
and the Gainesville urban core. Straddles the tile seam at 29.61 → mosaic 2 tiles per year.

**Resolution strategy — do not block on the slow fetch:**
1. Run the **20 m** pass first. Pipeline goes end-to-end in ~6 min. Build everything against it.
2. Kick the **10 m** pass off in the background. Swap it in if it lands; ship 20 m if it doesn't.

---

## Components

### C1 — Change detection (core, non-negotiable)
`src/fetch_embeddings.py`, `src/change.py`

- Mosaic 2 tiles/year via `gdalwarp` over `/vsis3/` on the **`.vrt`** (bottom-up landmine, §1)
- De-quantize `((v/127.5)**2)*sign(v)`; mask `-128`
- `change = 1 - Σ(e2017 · e2024)` — unit vectors, so dot product is cosine
- Export `data/change.tif` as **COG** (`-of COG -co COMPRESS=DEFLATE -co OVERVIEWS=AUTO`)
- Emit percentile breaks (p90/p95/p99) to `data/stats.json` for the app's slider defaults

### C2 — Land cover classifier (core — carries the curriculum requirement)
`notebooks/lulc_classifier.ipynb`

**Inspired by Ch5 Lesson 1, not a verbatim reproduction.** We keep the lesson's method
(sample AlphaEarth embeddings at GLOBE observation points → train a Random Forest on all 64 bands →
classify the region) and deviate deliberately where the lesson's choices do not survive contact with
the data. Deviations are documented in the notebook and the README.

**Measured label reality (Florida, 2017–2025):**
`dropna(subset=['MucCode'])` leaves **148 of 691** records.
Urban 72 · Herbaceous 33 · Woodland 18 · Dwarf-Shrub 6 · Barren 6 · Cultivated 5 ·
Closed Forest 3 · Shrubland 2 · Wetland 2 · Open Water 1.
Majority-class baseline = **48.6%**. The lesson reports **43.75%** — i.e. below baseline.

**Our deviations:**
1. **Collapse 10 classes → 4:** `Urban` (72) / `Herbaceous` (33) /
   `Woody` (23 = Woodland + Closed Forest + Shrubland) / `Water-Wetland`.
   New baseline ≈ 56%; target materially above it.
2. **Analyst-added water labels.** 3 volunteer water points is unusable in a county defined by
   Paynes Prairie, Newnans Lake and Lochloosa. Add a small set of analyst-placed water labels from
   obvious open-water polygons. **Disclose as analyst-added, not volunteer-collected.**
3. **Year-matched sampling.** Read each GLOBE point's embedding from the year it was observed.
4. `sklearn.RandomForestClassifier` instead of `ee.Classifier.smileRandomForest` — no EE dependency.

**Outputs:** `data/lulc_2017.tif`, `data/lulc_2024.tif` (+ per-pixel max-class probability for gating).
Report accuracy, per-class recall, and the confusion matrix. Accuracy is not the product — state it plainly.

### C2b — Change layers (core)
`src/change.py`

Four raster layers ship, and the last one is the deliverable:

| Layer | Definition | Purpose |
|---|---|---|
| **L1** `lulc_2017.tif` | RF applied to 2017 embeddings | baseline state |
| **L2** `lulc_2024.tif` | RF applied to 2024 embeddings | current state |
| **L3** `change.tif` | `1 − cos(e2017, e2024)` | *where* it changed — classifier-independent |
| **L4** `transitions.tif` | **L3 ≥ p99 ∧ L1 ≠ L2 ∧ min(prob) ≥ 0.5** | *what* changed, high confidence |

**Why L4 is gated, not naive.** A raw L1-vs-L2 diff is dominated by classifier flicker: at ~60%
per-year accuracy, a naive differential is wrong most of the time. Cosine change is computed from the
embeddings directly and is statistically independent of the classifier, so requiring high cosine change
suppresses flicker (an unchanged pixel scores low no matter how it was labelled). The class flip then
supplies the plain-language description the cosine layer cannot give: *"Woody → Urban."*

**L4 is what feeds the task queue (C3).** Encode transitions as a categorical raster + a
`transitions_legend.json` naming each from→to pair, so the app can label them without a lookup table.

### C3 — Conservation intersect (core — this is the conservation framing)
`src/tasks.py`

- Pull PAD-US Alachua polygons → `data/protected.geojson`
- Polygonize **L4 confirmed transitions** (`gdal.Polygonize`) → drop specks (< 0.5 ha)
- Tag each polygon: inside / within 500 m of / outside protected land
- Each polygon already carries from→to classes → *"Woody → Urban, changed 0.41, inside Lochloosa WCA"*
- Rank: inside-protected first, then by change magnitude × area
- Export top ~40 as `data/tasks.geojson` with a stable `task_id`

### C4 — OpenLayers app (core — this is the judge's artifact)
`app/` — static HTML/JS, no build step, no framework

| Layer | Source |
|---|---|
| Basemap | Esri World Imagery XYZ |
| **L3 cosine change** | `ol/source/GeoTIFF` reading `change.tif` COG directly |
| **L1/L2 LULC** | `lulc_2017.tif` / `lulc_2024.tif`, categorical palette, swipe or toggle |
| **L4 transitions** | `transitions.tif`, coloured by from→to pair |
| Protected areas | `ol/source/Vector` GeoJSON, outlined |
| GLOBE observations | points, styled by protocol |
| Task pins | numbered, ranked |

- **Threshold slider** — live-restyle the change raster client-side. This is the demo moment.
- **Task queue panel** — click a task → map flies to it, shows *was / now / change score / which preserve*
- **"Mark as verified"** → `localStorage`. No backend. Wrapped in try/catch.
- Legend + a plain-language "what am I looking at" box. Non-expert legibility is a scored criterion.

*Fallback if `ol/source/GeoTIFF` misbehaves:* `gdal2tiles.py` → XYZ PNG + `ol/source/XYZ`. Budget 15 min to swap.

### C5 — Submission (core — do not leave to the last 10 minutes)
- `README.md`: what/why, **named curriculum + lesson**, every data source linked, setup steps, credits,
  AlphaEarth attribution string (§1), reuse/maintenance note
- Devpost entry + deployed GitHub Pages link
- 3 screenshots

---

## Timeline (now ≈ 12:00, submit 17:00)

| Window | Phase | Exit criterion |
|---|---|---|
| **12:00–12:20** | Scaffold repo. **Immediately** launch 20 m fetch in background. | Fetch running, dirs exist |
| 12:20–13:15 | C1 change detection → `change.tif` + stats | COG opens in QGIS, hotspots look real |
| 13:15–14:15 | C2 4-class RF + L1/L2; C2b build L4 | Confusion matrix printed, L4 non-empty & plausible |
| 14:15–14:45 | C3 intersect → `tasks.geojson` | Top-40 tasks, named preserves attached |
| 14:45–15:45 | C4 OpenLayers app | All layers render, slider works |
| 15:45–16:20 | C4 task panel + polish + legend | Clickable end-to-end demo |
| 16:20–17:00 | C5 README, deploy, Devpost, rehearse | **Submitted** |

Kick the 10 m fetch off at ~13:15 in the background; swap at 15:45 only if it's done.

### Cut lines — drop in this order if behind
1. Sentinel-2 before/after imagery *(already cut from core — stretch only)*
2. 10 m resolution → ship 20 m
3. L1/L2 LULC layers hidden in the app → keep L4 + notebook (L4 still needs them computed)
4. "Mark as verified" persistence → static list
5. L4 gating relaxed to cosine-only → task list loses from→to labels but still ranks

**Never cut:** C1, the C2 notebook, C5.

---

## Explicitly out of scope
- ❌ **Gaussian splat** — needs COLMAP/nerfstudio + GPU; GLOBE photos are 4 fixed-direction shots from one
  point and are geometrically unusable for reconstruction. README future-work only.
- ❌ **Admin accounts / auth / tasking backend** — tasks are *derived* from C3 and rendered client-side.
- ❌ **Live Earth Engine** — not available to us and not needed.
- ❌ Mosquito habitat protocol — 3 records in Alachua. Mention in README as a data-gap finding.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| 10 m fetch too slow | **High** | 20 m is the default; 10 m is opportunistic. Already measured. |
| `ol/source/GeoTIFF` CORS/range issues on Pages | Med | gdal2tiles XYZ fallback, 15 min |
| RF accuracy embarrassingly low | Med | 4-class collapse; present confusion matrix openly; accuracy is not the product |
| Change hotspots are all cloud/water artifacts | Med | Inspect early at 12:20 gate; mask water via classifier if needed |
| `rasterio`/`geopandas` install burns time | Low | Use `osgeo.gdal`/`ogr` — already present, zero install |

---

## Honest framing (say this out loud to judges)
- The RF accuracy is modest and we show the confusion matrix. Accuracy is not the deliverable —
  **the ranked task list is.**
- Embedding change means *"this place looks different to the model,"* not *"a tree was cut down."*
  That ambiguity is exactly **why a human needs to go look** — which is the entire thesis.
