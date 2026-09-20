# Methods Report

**Project:** Satellite change detection and participatory-science tasking, Alachua County, Florida
**Track:** NASA and Environmental Data — CityCamp Gainesville Hack Day, 20 September 2026
**Study area:** `-82.55, 29.48, -82.15, 29.82` — 39.2 × 37.2 km, 3,645,796 analysis pixels at 20 m
**Comparison:** 2017 → 2024

This document covers the data-science and machine-learning method and the reasoning behind each
choice. Data provenance and licensing are in [`data-sources.md`](data-sources.md); operational
detail is in `processing-pipeline/README.md`.

---

## 1. The problem, stated as a modelling problem

A conservation manager wants to know **where to send a volunteer**. That decomposes into two
questions a model can answer and one it cannot:

| Question | Answerable? | Method |
|---|---|---|
| *Where did the ground change between 2017 and 2024?* | Yes | Cosine distance between annual satellite embeddings |
| *What was there before, and what is there now?* | Yes, approximately | Random Forest over embedding features |
| *Is that change a problem?* | **No** | Requires a human on site — this is the output, not an input |

The third row is the product. The system does not claim to detect illegal clearing; it produces a
ranked, finite list of places where something measurably changed, described in plain language, so
a person can go and determine what it is. Every design decision below follows from treating the
model's output as a *prioritised question*, not a verdict.

---

## 2. Change detection

### 2.1 Why embeddings rather than spectral indices

The conventional approach is to difference a vegetation index such as NDVI. It is interpretable
but narrow: it responds to greenness and little else, so it misses structural change that does not
alter chlorophyll — bare soil to pavement, forest thinning, a field going from crop to fallow.

AlphaEarth Foundations encodes a full year of satellite observation at each 10 m pixel into a
64-dimensional unit vector, trained to place physically similar surfaces near one another. A
displacement in that space captures spectral, textural and phenological change together.

Choosing embeddings for detection while *reserving* NDVI has a second benefit: NDVI stays
uncontaminated and can be used later as an independent check (§6).

### 2.2 The metric

The embeddings are unit-length, so cosine similarity reduces to a dot product:

```
change = 1 − cos(e₂₀₁₇, e₂₀₂₄) = 1 − Σᵢ e₂₀₁₇ᵢ · e₂₀₂₄ᵢ
```

Range `[0, 2]`; observed `0.0076 – 0.9446`. This is the operation Google's own documentation
prescribes for the dataset, so the method is the dataset's intended use rather than an
improvisation.

The implementation divides by the norms anyway rather than assuming unit length, because
overview-level resampling can nudge vectors off the unit sphere. Measured norms after
de-quantisation were **0.9915 – 1.0092 (mean 1.0001)**, confirming the assumption held — but the
division costs nothing and removes the dependency on it.

**Why cosine and not Euclidean.** For unit vectors the two are monotonically related
(`d² = 2 − 2cos`), so any threshold on one maps to a threshold on the other. Cosine is preferred
because it is bounded, interpretable as an angle, and stable if a future embedding release relaxes
unit-normalisation.

### 2.3 Two correctness requirements

**De-quantisation.** Values are stored as int8 and are not linear in the underlying embedding.
The documented inverse must be applied before any arithmetic:

```python
deq = ((v / 127.5) ** 2) * np.sign(v)
```

Skipping this produces plausible-looking output that is quantitatively wrong — the squaring term
means the error is non-uniform across the range, so the result is not merely rescaled.

**Never reproject before computing.** The cosine is computed on the native EPSG:32617 grid, where
both years are already pixel-aligned. Reprojecting first would interpolate the 64 components
independently; an interpolated embedding is no longer unit-length and no longer a valid point in
the embedding space. Only the resulting scalar is reprojected, for delivery.

A third hazard is structural rather than mathematical: the published COGs are stored **bottom-up**
(origin bottom-left, positive y-resolution). Reading the `.tiff` directly yields vertically
flipped data; the pipeline reads the sibling `.vrt`, which corrects this.

### 2.4 Computation

Accumulated band-by-band rather than loading two 64-band cubes:

```
dot += e₁ᵢ·e₂ᵢ ;  n₁ += e₁ᵢ² ;  n₂ += e₂ᵢ²      for i in 0..63
```

Peak memory is ~5 × (H × W) float32 instead of 2 × 64 × (H × W) — 1.9 GB becomes ~75 MB, and the
same code runs at 10 m, where the naive form would need **7.4 GB**.

### 2.5 Observed distribution

| percentile | value |
|---|---|
| p50 | 0.0648 |
| p75 | 0.1177 |
| p90 | 0.2741 |
| p95 | 0.3598 |
| **p97** | **0.4091** |
| p99 | 0.5010 |
| p99.9 | 0.6934 |
| max | 0.9446 |

mean 0.1087, sd 0.1086. A long right tail over a stable bulk — the shape a change detector should
produce over a landscape that is mostly stable.

**Threshold choice is empirical, not physical.** There is no absolute cosine value that means
"changed"; the distribution depends on the landscape. We use the **97th percentile of this AOI**
and publish the value (`stats.change.l4_threshold`) so it is inspectable and adjustable. The app's
slider is initialised there, so what a user sees matches what the pipeline gated on.

---

## 3. Land cover classification

### 3.1 Method and provenance

From **EMERGE Textbook 2 (Geospatial AI), Chapter 5 Lesson 1**, *"Mapping Land Cover From GLOBE
Data and Satellite Embeddings"*: sample satellite embeddings at participatory-science observation
points, train a Random Forest on all 64 bands, apply it to the region.

Deviations, each with its reason:

| # | Deviation | Reason |
|---|---|---|
| 1 | Embeddings from the public COG mirror, not Earth Engine | No EE account; approval is not dependable inside a one-day event. Identical data. |
| 2 | 10 MUC Level-1 classes → 4 | Four classes had fewer than 5 examples statewide |
| 3 | `sklearn.RandomForestClassifier` vs `ee.Classifier.smileRandomForest` | Follows from (1) |
| 4 | Sparse classes augmented from OpenStreetMap | §3.3 |

### 3.2 Why Random Forest

Deliberately kept, not upgraded. It suits the regime: 466 samples against 64 correlated features,
where a neural model would overfit and need tuning time we did not have. It is
scale-invariant, needs no feature engineering, handles class imbalance via weighting, and trains
in seconds — which mattered, because the pipeline was rerun many times as labelling problems
surfaced. It is also what the curriculum uses, so results remain comparable to the lesson.

Configuration: 300 trees (up from the lesson's 50 — variance reduction is nearly free here),
`class_weight="balanced_subsample"`, no depth limit, `random_state=42`.

### 3.3 The labelling problem, and how it was handled

GLOBE Land Cover for all of Florida, 2017–2025, returns **691 records**. The lesson drops rows
without a MUC code, leaving **148**. Their distribution across the lesson's 10 classes:

```
Urban 72 · Herbaceous 33 · Woodland 18 · Dwarf-Shrub 6 · Barren 6
Cultivated 5 · Closed Forest 3 · Shrubland 2 · Wetland 2 · Open Water 1
```

Four classes have fewer than 5 examples. The majority-class baseline is 48.6%, and **the lesson's
published accuracy of 43.75% is below its own baseline** — not a criticism of EMERGE, but a
demonstration of what 148 points across 10 classes permits.

**Response 1 — collapse to 4 classes** with defensible physical boundaries:
`Water/Wetland`, `Woody`, `Herbaceous`, `Urban/Barren`.

**Response 2 — augment the starved classes from OpenStreetMap.** Water/Wetland had 3 examples and
Woody 23, in a county defined by Paynes Prairie, Newnans Lake and working timberland. Supplementary
points were sampled from the interior of OSM polygons (≥1.5–4 ha, ≥30 m from any edge, verified by
ray-casting point-in-polygon), each sampled in **both** years.

Sampling wetlands in both years is deliberate: it teaches the model that flooded prairie and dry
prairie are the *same* class, which is what stops Paynes Prairie's seasonal hydrology registering
as land-cover conversion.

Final set: **466 points = 148 GLOBE volunteer + 318 OSM-derived**, disclosed per-point via a
`source` field and styled separately in the app.

| Class | GLOBE | OSM | Total |
|---|---|---|---|
| Water / Wetland | 3 | 84 | 87 |
| Woody | 23 | 90 | 113 |
| Herbaceous | 44 | 90 | 134 |
| Urban / Barren | 78 | 54 | 132 |

### 3.4 Two labelling errors we made and corrected

Both changed results materially, and both are recorded because they are the kind of domain trap
that a reproduction would hit.

**`wetland=swamp` is forested wetland.** In north Florida, swamp is cypress and tupelo — closed
canopy, structurally *woody*. **2,727 of 3,776** OSM wetland polygons carry this tag. Sampling
them as Water/Wetland taught the model that closed canopy means water: it classified **22% of the
county as water** and collapsed Herbaceous to **0.2%** of the map. Remapping `swamp` → Woody fixed
it.

**`landuse=residential` is not a usable urban label here.** Gainesville's suburbs carry heavy tree
canopy. Including them would teach the model that tree cover means urban — the precise
Urban↔Herbaceous confusion we were trying to fix. Urban labels are restricted to unambiguously
impervious tags (`industrial`, `retail`, `commercial`, `quarry`, `landfill`, `parking`). Urban
recall went **0.62 → 0.93**, overall accuracy **0.795 → 0.819**, and the `development` category
went from 0 to 6 detections.

### 3.5 Validation, including a leakage audit

A single 80/20 split on 466 points is a weak estimate, and our sampling design has an obvious
leakage risk: **56% of locations contribute more than one sample** (the same coordinates sampled in
2017 and 2024, up to 5 samples at one spot). If one year lands in train and the other in test, the
model has effectively seen the test point.

We therefore evaluated under **GroupKFold, grouping by physical location**, so no coordinate
appears in both folds:

| Evaluation | Accuracy |
|---|---|
| Reported random 80/20 split | 0.8191 |
| 5-fold stratified CV (random, leaky) | 0.8197 ± 0.0416 |
| **5-fold grouped CV (leakage-free)** | **0.8110 ± 0.0473** |
| Shuffled-label null | 0.280 |
| Majority-class baseline | 0.2876 |

**Leakage inflation is 0.9 percentage points** — the headline figure is close to honest. The
shuffled-label null lands at 0.280 against a 0.288 chance level, confirming the signal is real and
not an artifact of the grouping.

Leakage-free per-class performance:

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Water / Wetland | 0.918 | 0.897 | **0.907** | 87 |
| Woody | 0.858 | 0.805 | **0.831** | 113 |
| Herbaceous | 0.793 | 0.716 | 0.753 | 134 |
| Urban / Barren | 0.734 | 0.856 | 0.790 | 132 |

Confusion matrix (rows true, columns predicted):

```
                  Water  Woody   Herb  Urban
Water / Wetland      78      4      1      4
Woody                 5     91     10      7
Herbaceous            1      7     96     30
Urban / Barren        1      4     14    113
```

The dominant error is the **Herbaceous ↔ Urban/Barren** boundary (30 + 14 cases), which is
expected: parking lots, bare soil and dry grass are genuinely similar at 20 m, and the boundary
between "mown lot" and "developed" is partly a definitional choice rather than a physical one.

### 3.6 The most important caveat

Accuracy is **not uniform across label sources**:

| Evaluated on | Accuracy | n |
|---|---|---|
| OSM-derived points | **0.896** | 318 |
| **GLOBE volunteer points** | **0.628** | 148 |

And training on one source to predict the other transfers poorly — OSM→GLOBE **0.547**,
GLOBE→OSM **0.428**.

The headline 0.811 is carried by OSM points, which are 68% of the set. On the participatory-science
labels the curriculum actually uses, the model scores **0.628**.

This is a real domain shift, and the likely causes are instructive rather than mysterious:

- **Land use is not land cover.** OSM tags parcels by *function*; GLOBE records *what is physically
  present*. An OSM `commercial` parcel may be 60% parking, 30% lawn, 10% building.
- **Viewpoint differs.** GLOBE volunteers classify what they see from ground level in four
  directions; OSM polygons are top-down. A 20 m pixel over a treed parking lot reads differently
  from either perspective.
- **Positional uncertainty.** A GLOBE point is a GPS reading at the observer, not a delineated
  region; at 20 m the sampled pixel may straddle a boundary.

0.628 on GLOBE points still sits far above the 0.288 chance level and well above the lesson's
0.4375, so the method works. But the honest single-number summary of the land-cover model is
**"0.81 overall, 0.63 on volunteer-labelled ground truth."**

### 3.7 Feature behaviour

Importance is spread across the 64 axes — top-5 account for 24.4% and top-20 for 59.2%, against
7.8% and 31.2% under uniformity. Moderately concentrated, with no dominant axis. This is expected
for a learned embedding, where information is distributed rather than aligned to individual
dimensions, and it means per-axis feature selection would not meaningfully reduce the model.

---

## 4. Combining the two signals

### 4.1 The problem with each signal alone

- **Cosine change alone** says *something changed here* but cannot say what — useless for triage
  and unexplainable to a non-expert.
- **Class-difference alone** is overwhelmed by noise. **16.5% of pixels** change predicted class
  between 2017 and 2024, which cannot be real for a seven-year interval over a mostly stable
  landscape.

The decisive evidence that the class differences are noise is their **symmetry**:

```
Herbaceous → Woody :  81,038 px
Woody → Herbaceous :  92,096 px      ratio 0.880
```

Near-balanced two-way exchange across a decision boundary is the signature of classifier flicker.
Real landscape change is directional.

### 4.2 The gate

```
L4 = (cosine change ≥ p97) ∧ (class₂₀₁₇ ≠ class₂₀₂₄)
     ∧ (min(confidence₂₀₁₇, confidence₂₀₂₄) ≥ 0.5) ∧ (contiguous patch ≥ 1 ha)
```

| Stage | Pixels | % of valid | Area |
|---|---|---|---|
| Valid pixels | 3,645,796 | 100% | 145,832 ha |
| 1. cosine ≥ p97 (0.409) | 109,429 | 3.00% | 4,377 ha |
| 2. + class flipped | 44,680 | 1.23% | 1,787 ha |
| 3. + confidence ≥ 0.5 | 12,972 | 0.36% | 519 ha |
| 4. + contiguity ≥ 1 ha | **113 patches** | — | **452 ha** |

**The clearest evidence that the gate works is that it breaks the symmetry:**

| | Woody → Herbaceous | Herbaceous → Woody | ratio |
|---|---|---|---|
| Before gating | 92,096 | 81,038 | 0.880 (symmetric — noise) |
| **After gating** | **6,167** | **2,945** | **0.478 (directional — signal)** |

A filter that only removed pixels at random would preserve the ratio. Instead a balanced exchange
becomes a 2:1 directional bias toward vegetation loss. The gate is selecting real change.

### 4.3 On "independence"

We describe the cosine term as independent of the classifier. Being precise: it is
**computationally** independent — different algorithm, no shared parameters, no shared training —
so classifier errors cannot propagate into it. It is **not statistically** independent: mean change
where the class flipped is 0.1926 against 0.0921 where it did not, a **2.09×** ratio.

That correlation is expected and desirable. Both respond to the same underlying physical change,
which is exactly why their conjunction is informative: agreement between two differently-derived
signals is stronger evidence than either alone, while the absence of shared machinery means the
classifier's failure modes do not reproduce in the cosine.

Why the confidence term: a pixel the classifier is unsure about in either year is a poor basis for
asserting a transition, independent of how much the embedding moved.

Why contiguity: real land change is spatially contiguous; classifier flicker is salt-and-pepper.
A 1 ha minimum is a morphological filter that exploits that difference, and it is a gentler
instrument than raising the threshold, which would discard small real changes along with noise.

---

## 5. Ranking

Ranking on magnitude alone fails for a specific, local reason. **Paynes Prairie** is a natural wet
prairie whose water extent swings dramatically year to year. That is a large embedding displacement
*and* a genuine class flip — so a magnitude-ranked queue puts natural hydrology at #1 and buries
actual forest loss. A Gainesville judge would recognise it instantly as a false alarm.

Each transition is therefore typed before ranking:

| Category | Definition | Base weight |
|---|---|---|
| `vegetation_loss` | Woody → Herbaceous or Urban/Barren | 100 |
| `development` | Herbaceous → Urban/Barren | 70 |
| `revegetation` | → Woody | 30 |
| `hydrologic` | anything involving Water/Wetland | 20 |

```
score = base + protection_boost + 40·(change − threshold)/(1 − threshold) + 8·log₁₀(1 + area_ha)
```

`protection_boost` is 25 inside protected land, 10 adjacent (within 500 m), 0 outside. The log-area
term rewards larger patches with diminishing returns, so a 40 ha patch outranks a 4 ha patch
without dominating the ordering.

Paynes Prairie still appears, correctly labelled as hydrologic variability, and does not compete
for the top slots. Detecting it, identifying it as hydrology, and ranking it accordingly is a
stronger result than either hiding it or leading with it.

**Quota selection.** Pure category-first ordering made all 40 shipped tasks `vegetation_loss`,
hiding the 6 development detections. The shipped queue is quota-selected — 24 / 6 / 6 / 4 —
and severity-ordered within and across. All 113 candidates ship in `candidates.geojson`.

---

## 6. Independent validation

The queue is built from AlphaEarth embeddings and a Random Forest. **NDVI** is computed from
Sentinel-2 surface reflectance and shares no input with either, so it is a genuine out-of-band
test rather than a restatement of the model:

```
NDVI = (B08 − B04) / (B08 + B04)
```

If the categories are meaningful, NDVI must move in the direction each one predicts.

| Category | n | mean ΔNDVI | expected | agreement |
|---|---|---|---|---|
| `vegetation_loss` | 61 | −0.4050 | down | **61 / 61** |
| `development` | 6 | −0.3237 | down | **6 / 6** |
| `revegetation` | 28 | +0.3485 | up | **28 / 28** |
| `hydrologic` | 7 | −0.0758 | none predicted | n/a |

**95 / 95 directional agreement**, against an AOI-wide background drift of **−0.0194** — the
category signals are 17–21× background. Of the 40 shipped tasks, **32 carry `ndvi_agrees: true`
and none carry `false`**; the 8 nulls are 4 hydrologic (no direction predicted) and 4 patches too
small to sample.

This also resolved a specific doubt. The 30 `revegetation` detections were plausibly classifier
artifacts in the Herbaceous↔Woody boundary. At +0.3485 mean NDVI gain with 28/28 agreement, they
are real regrowth.

> NDVI is computed from **raw 16-bit reflectance**, never from the shipped display COG, which is
> stretched to 8-bit per scene with different per-year stretches — that would make cross-year NDVI
> meaningless.

**What this does and does not establish.** It confirms the *direction and sign* of detected change
using independent data. It does not confirm the *class labels* — an independent check on those
would need ground truth we do not have, which is the gap the task queue exists to close.

---

## 7. Resolution

The county analysis runs at 20 m, downsampled from native 10 m via the published overview pyramid
(whose pixels are means renormalised to unit length, so they remain valid embeddings). This was a
throughput decision: 10 m over the full AOI costs ~15 min/year of transfer and 7.4 GB of memory.

It has a measurable cost at building scale. The Wertheim Laboratory at the University of Florida,
completed **2020**, is ~2 × 3 pixels at 20 m and mixes with its surroundings:

| Site | Built | 20 m | 10 m |
|---|---|---|---|
| **Wertheim Laboratory** | 2020 | 88th pct | **98.6th pct** |
| J. Wayne Reitz Union | 1967 | — | 79.7th pct |
| Scott Family Hall | Apr 2017 | — | 84.8th pct |

A campus AOI is therefore also processed at native 10 m. The three sites together form a
self-validating demonstration: two buildings 100 m apart, same imagery and same model, where the
one constructed in 2020 reads 98.6th percentile and the one standing since 1967 reads 79.7th.
Scott Family Hall is a second control — completed just before the 2017 composite, so "no change"
is the correct answer, and the model gives it.

Wertheim is also instructive about the gate: at county scale it is `Urban/Barren` in both years —
no class flip — so it never enters the task queue. That is correct. It is infill on an existing
parking lot, not habitat loss.

---

## 8. Limitations

1. **Land-cover accuracy on volunteer labels is 0.628**, against 0.811 overall (§3.6). The gap is a
   real domain shift between OSM land *use* and GLOBE land *cover*.
2. **Herbaceous recall is 0.716**, the weakest class, confusing mainly with Urban/Barren. The 6
   `development` detections should be read as an upper bound.
3. **The threshold is a percentile, not a physical constant.** p97 is specific to this AOI and
   this pair of years; it is published rather than hidden.
4. **Embedding change means "this looks different to the model,"** not "a tree was cut down." The
   ambiguity is intrinsic and is why the output is a task list.
5. **Two time points only.** No trend, no seasonality separation beyond what the annual composite
   already integrates. A 2017–2025 series is available and would separate step changes from drift.
6. **No ground truth inside the study area.** The model that classifies Gainesville was trained on
   zero usable volunteer observations from Gainesville — see §9.
7. **20 m dilutes building-scale change** (§7), mitigated only for the campus subset.
8. **Class boundaries are partly definitional.** Herbaceous vs Urban/Barren for a mown vacant lot
   is a choice, not a measurement, and the confusion matrix reflects that.

## 9. The finding that frames the project

Inside the study area there are exactly **10** GLOBE land-cover observations. All are from **one
site** (`17RLN604829`), all fall within a **six-week window in late 2025**, and **not one** carries
a usable land-cover classification. **Zero** volunteer observations from the study area could train
the model.

This is why the labels had to be augmented from OSM, why the model is weaker on volunteer data
than on OSM data, and why the deliverable is a ranked task list rather than a map with a
confidence score. The modelling constraints described throughout this document are all downstream
of one fact: there is almost no local participatory data, because contributing has not visibly
mattered. A finite, ranked,place-specific list of places worth visiting is a direct attempt to change
that.

## 10. With more time

- **Sample the full 2017–2025 series** and fit a per-pixel trajectory rather than an endpoint
  difference, separating step changes from gradual drift.
- **Stratified field validation** of a random sample of task polygons — the only way to measure
  precision of the *task list itself*, as opposed to the direction of change.
- **Spatially blocked cross-validation** in addition to grouped, to quantify spatial
  autocorrelation between nearby training points.
- **Calibrate the classifier** (isotonic or Platt) so the 0.5 confidence gate corresponds to a
  true probability rather than an uncalibrated forest vote share.
- **Reconcile the label domains** — a small set of dual-labelled sites where a GLOBE observation
  and an OSM polygon coincide would quantify the §3.6 shift directly.
