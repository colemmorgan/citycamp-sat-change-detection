# Methods

**Project:** Land cover change detection and GLOBE Observer tasking, Alachua County, Florida.
**Study area:** `-82.55, 29.48, -82.15, 29.82`. 39.2 km by 37.2 km. 3,645,796 pixels at 20 m.
**Years compared:** 2017 and 2024.

This report gives the method and the reason for each choice.
For the datasets, read [`data-sources.md`](data-sources.md).
For the code, read `processing-pipeline/README.md`.

---

## 1. The problem

A conservation manager must decide where to send a volunteer. This splits into three questions.

| Question | Can a model answer it? | Method |
|---|---|---|
| Where did the ground change? | Yes | Cosine distance between satellite embeddings |
| What was there, and what is there now? | Yes, approximately | Random Forest on embedding values |
| Is the change a problem? | **No** | A person must go to the site |

The third answer is the product. The system does not detect illegal clearing. It makes a
ranked list of sites. A person then finds the cause.

---

## 2. Change detection

### 2.1 Why we use embeddings

NDVI and other indexes measure greenness. They do not show change that keeps the greenness
the same. Examples are bare soil that becomes pavement, or a crop field that becomes fallow.

AlphaEarth gives 64 numbers for each 10 m pixel for each year. The numbers hold spectral
data, texture, and seasonal behaviour together. A change in these numbers shows a change on
the ground.

This choice has a second result. NDVI stays unused. We can then use NDVI as an independent
test. See section 6.

### 2.2 The measurement

The 64 numbers make a vector with a length of 1. Cosine similarity is therefore the dot
product:

```
change = 1 − cos(e₂₀₁₇, e₂₀₂₄) = 1 − Σᵢ e₂₀₁₇ᵢ · e₂₀₂₄ᵢ
```

The range is 0 to 2. We measured 0.0076 to 0.9446.

Google documents this method for this dataset. We did not invent it.

The code divides by the vector lengths. It does not assume a length of 1. Resampling can
change the length. We measured the lengths after de-quantization. They were 0.9915 to 1.0092,
with a mean of 1.0001.

**Why cosine and not Euclidean distance.** For vectors with a length of 1, the two measures
give the same order (`d² = 2 − 2cos`). Any limit on one converts to a limit on the other.
Cosine has a set range. It stays valid if a later data release removes the length rule.

### 2.3 Two rules you must follow

**De-quantize first.** The stored values are 8-bit integers. They are not linear. Apply this
before any calculation:

```python
deq = ((v / 127.5) ** 2) * np.sign(v)
```

If you skip this step, the result looks correct but is wrong. The square term makes the error
different across the range. The result is not a simple rescale.

**Do not reproject before you calculate.** We calculate on the native EPSG:32617 grid. Both
years align on this grid. Reprojection mixes the 64 values of adjacent pixels. A mixed vector
no longer has a length of 1. It is no longer a valid point in the embedding space. We
reproject only the single output number.

**Read the `.vrt` file, not the `.tiff` file.** The source files store rows from the bottom
up. The `.tiff` file gives flipped data. The `.vrt` file gives the correct row order.

### 2.4 Memory

The code adds one band at a time:

```
dot += e₁ᵢ·e₂ᵢ ;  n₁ += e₁ᵢ² ;  n₂ += e₂ᵢ²      for i in 0..63
```

Peak memory is 5 × (H × W) float32, not 2 × 64 × (H × W). This changes 1.9 GB to 75 MB.
The same code runs at 10 m. The simple method needs 7.4 GB at 10 m.

### 2.5 Result

| Percentile | Value |
|---|---|
| p50 | 0.0648 |
| p75 | 0.1177 |
| p90 | 0.2741 |
| p95 | 0.3598 |
| **p97** | **0.4091** |
| p99 | 0.5010 |
| p99.9 | 0.6934 |
| max | 0.9446 |

Mean 0.1087. Standard deviation 0.1086.

Most pixels are stable. A small number show large change. This is the correct shape.

**The limit is empirical.** No cosine value means "changed" everywhere. The value depends on
the landscape. We use the 97th percentile of this study area. We publish the number in
`stats.change.l4_threshold`. The map slider starts at this number.

---

## 3. Land cover model

### 3.1 Source of the method

EMERGE Textbook 2, Chapter 5, Lesson 1: "Mapping Land Cover From GLOBE Data and Satellite
Embeddings". The method samples embeddings at observation points. It trains a Random Forest
on all 64 values. It then classifies the region.

We changed four things.

| Change | Reason |
|---|---|
| Read embeddings from the public mirror, not Earth Engine | We have no Earth Engine account |
| 10 MUC classes become 4 | Four classes had fewer than 5 examples |
| `sklearn.RandomForestClassifier`, not `smileRandomForest` | Follows from the first change |
| Add labels from OpenStreetMap | See section 3.3 |

### 3.2 Why Random Forest

We kept the model from the lesson. We did not replace it.

The data has 466 samples and 64 related values. A neural network overfits this data. It also
needs tuning time. Random Forest needs no scaling and no feature engineering. It handles
unequal class sizes with weights. It trains in seconds. We ran the pipeline many times.

The lesson uses the same model. Our results stay comparable.

Settings: 300 trees, `class_weight="balanced_subsample"`, no depth limit, `random_state=42`.
The lesson uses 50 trees. More trees reduce variance and cost little time.

### 3.3 The label problem

GLOBE Land Cover for Florida gives 691 records. The lesson removes records with no MUC code.
This leaves 148 records.

```
Urban 72 · Herbaceous 33 · Woodland 18 · Dwarf-Shrub 6 · Barren 6
Cultivated 5 · Closed Forest 3 · Shrubland 2 · Wetland 2 · Open Water 1
```

Four classes have fewer than 5 examples. The majority-class baseline is 48.6%. The lesson
reports 43.75%. This is below its own baseline.

This is not a fault in the lesson. It shows the limit of 148 points across 10 classes.

**Action 1: use 4 classes.** `Water/Wetland`, `Woody`, `Herbaceous`, `Urban/Barren`.

**Action 2: add labels from OpenStreetMap.** Water/Wetland had 3 examples. Woody had 23.
The county holds Paynes Prairie, Newnans Lake, and commercial forest. We sampled points
inside OpenStreetMap polygons. Each polygon is 1.5 hectares or larger. Each point is 30 m or
more from an edge. We tested each point with a ray-cast algorithm.

We sampled each wetland point in both years. This teaches the model that wet prairie and dry
prairie are the same class. Seasonal flooding then does not appear as land cover change.

Final set: **466 points. 148 from GLOBE volunteers. 318 from OpenStreetMap.** Each point
carries a `source` value. The map shows the two sources with different symbols.

| Class | GLOBE | OpenStreetMap | Total |
|---|---|---|---|
| Water / Wetland | 3 | 84 | 87 |
| Woody | 23 | 90 | 113 |
| Herbaceous | 44 | 90 | 134 |
| Urban / Barren | 78 | 54 | 132 |

### 3.4 Two label errors we made

**`wetland=swamp` is forest.** In north Florida, swamp means cypress and tupelo trees. These
have a closed canopy. 2,727 of 3,776 OpenStreetMap wetland polygons carry this tag. We first
sampled them as Water/Wetland. The model then called 22% of the county water. The Herbaceous
class fell to 0.2% of the map. We now map `swamp` to Woody.

**`landuse=residential` does not work as an urban label here.** Gainesville houses sit under
trees. These points teach the model that trees are urban. This is the error we wanted to
remove. We now use only surfaces with no vegetation: `industrial`, `retail`, `commercial`,
`quarry`, `landfill`, and `parking`. Urban recall rose from 0.62 to 0.93. Accuracy rose from
0.795 to 0.819. The `development` category rose from 0 to 6 detections.

### 3.5 Test results and the leakage audit

A single 80/20 split on 466 points gives a weak estimate. Our sampling also has a leakage
risk. **56% of locations give more than one sample.** We sample the same coordinates in 2017
and in 2024. One spot gives up to 5 samples. A random split can put one year in the training
set and the other year in the test set. The model then sees the test point.

We therefore tested again with GroupKFold. We group by location. No coordinate appears in
both sets.

| Test | Accuracy |
|---|---|
| Random 80/20 split | 0.8191 |
| 5-fold cross-validation, random | 0.8197 ± 0.0416 |
| **5-fold cross-validation, grouped** | **0.8110 ± 0.0473** |
| Shuffled labels | 0.280 |
| Majority-class baseline | 0.2876 |

**Leakage adds 0.9 percentage points.** The reported number is close to correct.

The shuffled-label test gives 0.280. Chance is 0.288. The signal is real.

Results per class, with no leakage:

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Water / Wetland | 0.918 | 0.897 | **0.907** | 87 |
| Woody | 0.858 | 0.805 | **0.831** | 113 |
| Herbaceous | 0.793 | 0.716 | 0.753 | 134 |
| Urban / Barren | 0.734 | 0.856 | 0.790 | 132 |

Confusion matrix. Rows give the true class. Columns give the predicted class.

```
                  Water  Woody   Herb  Urban
Water / Wetland      78      4      1      4
Woody                 5     91     10      7
Herbaceous            1      7     96     30
Urban / Barren        1      4     14    113
```

The main error is Herbaceous against Urban/Barren. This is 30 + 14 cases. Parking lots, bare
soil, and dry grass look similar at 20 m. The border between "mown lot" and "developed" is
also a definition, not a measurement.

### 3.6 The most important limit

Accuracy is not the same for the two label sources.

| Test set | Accuracy | n |
|---|---|---|
| OpenStreetMap points | **0.896** | 318 |
| **GLOBE points** | **0.628** | 148 |

Training on one source and testing on the other gives a lower result. OpenStreetMap to GLOBE
gives 0.547. GLOBE to OpenStreetMap gives 0.428.

OpenStreetMap points are 68% of the set. They carry the headline number. On GLOBE points the
model gives 0.628.

Three causes are likely.

1. **Land use is not land cover.** OpenStreetMap tags the function of a parcel. GLOBE records
   what is physically present. An OpenStreetMap `commercial` parcel can be 60% parking,
   30% grass, and 10% building.
2. **The viewpoint is different.** A GLOBE volunteer looks along the ground in four
   directions. An OpenStreetMap polygon looks down from above.
3. **The position is not exact.** A GLOBE point is a GPS reading at the volunteer. It is not
   a drawn area. At 20 m the sampled pixel can cross a border.

0.628 is above the chance level of 0.288. It is also above the lesson result of 0.4375. The
method works. The correct summary is: **0.81 overall, 0.63 on volunteer labels.**

### 3.7 Feature use

The model spreads importance across the 64 values. The top 5 values give 24.4%. The top 20
give 59.2%. Equal use would give 7.8% and 31.2%. No single value controls the result. This is
normal for a learned embedding. Feature selection would not make the model smaller.

---

## 4. The filter

### 4.1 Why one signal is not enough

Cosine change shows that something changed. It does not show what changed.

Class difference alone does not work. **16.5% of pixels change class between 2017 and 2024.**
A county does not change 16.5% of its area in seven years.

The direction of the changes proves this:

```
Herbaceous → Woody :  81,038 pixels
Woody → Herbaceous :  92,096 pixels      ratio 0.880
```

Equal movement in both directions across a class border is classifier noise. Real land change
moves in one direction.

### 4.2 The filter rules

```
L4 = (cosine change ≥ p97) AND (class 2017 ≠ class 2024)
     AND (minimum confidence ≥ 0.5) AND (patch ≥ 1 hectare)
```

| Step | Pixels | Percent | Area |
|---|---|---|---|
| Valid pixels | 3,645,796 | 100% | 145,832 ha |
| 1. cosine ≥ p97 (0.409) | 109,429 | 3.00% | 4,377 ha |
| 2. plus class change | 44,680 | 1.23% | 1,787 ha |
| 3. plus confidence ≥ 0.5 | 12,972 | 0.36% | 519 ha |
| 4. plus patch ≥ 1 ha | **113 patches** | — | **452 ha** |

**The filter changes the direction of the result. This is the proof that it works.**

| | Woody → Herbaceous | Herbaceous → Woody | Ratio |
|---|---|---|---|
| Before the filter | 92,096 | 81,038 | 0.880 |
| **After the filter** | **6,167** | **2,945** | **0.478** |

A filter that removes pixels at random keeps the ratio at 0.880. Our filter changes equal
movement into a 2 to 1 direction. The filter selects real change.

### 4.3 What "independent" means here

The cosine measurement is **computationally** independent of the model. The two use different
algorithms. They share no parameters and no training data. Model errors cannot move into the
cosine measurement.

The two are **not statistically** independent. Mean change is 0.1926 where the class changed.
It is 0.0921 where the class stayed the same. The ratio is 2.09.

This relation is correct and wanted. Both respond to the same physical change. Agreement
between two separate measurements is stronger evidence than one measurement alone.

**The confidence rule.** A pixel that the model cannot classify is a weak basis for a claim,
whatever the cosine value.

**The patch rule.** Real land change covers a continuous area. Model noise is single scattered
pixels. A 1 hectare limit removes the scattered pixels. A higher cosine limit would remove
small real changes as well.

---

## 5. Ranking

Ranking by size alone fails here. **Paynes Prairie** is a wet prairie. Its water area changes
a large amount each year. This gives a large cosine change and a real class change. A ranking
by size puts natural flooding first and hides forest loss.

The numbers show this. Mean change inside the preserve is 0.2415. The county mean is 0.1087.
16.8% of the preserve passes the cosine limit. The county figure is 3.0%.

The preserve does not enter the list. The model calls it Water/Wetland in both years. 93.9%
of the preserve has the same class in both years. **99.0% of the preserve pixels that pass
the cosine limit fail the class-change rule.**

We therefore give each change a type before we rank it.

| Category | Definition | Base weight |
|---|---|---|
| `vegetation_loss` | Woody to Herbaceous or Urban/Barren | 100 |
| `development` | Herbaceous to Urban/Barren | 70 |
| `revegetation` | Any class to Woody | 30 |
| `hydrologic` | Any change that includes Water/Wetland | 20 |

```
score = base + protection_boost + 40·(change − limit)/(1 − limit) + 8·log₁₀(1 + area_ha)
```

`protection_boost` is 25 inside protected land, 10 within 500 m, and 0 elsewhere. The area
term gives more weight to large patches. The logarithm stops large patches from controlling
the order.

Paynes Prairie stays in the data with the correct type. It does not take the top positions.

**Quota selection.** Ranking by category alone made all 40 sites `vegetation_loss`. This hid
the 6 development sites. The list now uses quotas: 24, 6, 6, and 4. All 113 sites are in
`candidates.geojson`.

---

## 6. Independent test

The list comes from AlphaEarth embeddings and a Random Forest. NDVI comes from Sentinel-2
reflectance. NDVI shares no input with either one.

```
NDVI = (B08 − B04) / (B08 + B04)
```

If the categories are correct, NDVI must move in the predicted direction.

| Category | n | Mean ΔNDVI | Prediction | Agreement |
|---|---|---|---|---|
| `vegetation_loss` | 61 | −0.4050 | down | **61 / 61** |
| `development` | 6 | −0.3237 | down | **6 / 6** |
| `revegetation` | 28 | +0.3485 | up | **28 / 28** |
| `hydrologic` | 7 | −0.0758 | none | — |

**95 of 95 agree.** The area-wide mean change is −0.0194. The category values are 17 to 21
times this background value.

Of the 40 sites in the list, 32 have `ndvi_agrees: true`. None have `false`. The 8 empty
values are 4 `hydrologic` sites and 4 sites that are too small to sample.

This test also answered one question. The 30 `revegetation` sites could have been model
errors at the Herbaceous and Woody border. The NDVI result of +0.3485 with 28 of 28 agreement
shows that the growth is real.

We calculate NDVI from the raw 16-bit reflectance. We do not use the 8-bit map file. That
file uses a different stretch for each year. Cross-year NDVI from that file has no meaning.

**What this test shows.** It confirms the direction of each change with independent data.
**It does not confirm the class labels.** A test of the labels needs ground data. We do not
have ground data. This is the gap that the site list exists to close.

---

## 7. Resolution

The county analysis runs at 20 m. The source data is 10 m. We use the published overview
level. Overview pixels are means with the length reset to 1. They are valid embeddings.

This was a speed decision. 10 m over the full area costs 15 minutes of transfer for each year
and 7.4 GB of memory.

It has a cost at building size. The Wertheim Laboratory at the University of Florida opened
in 2020. It covers 2 by 3 pixels at 20 m.

| Site | Built | 20 m | 10 m |
|---|---|---|---|
| **Wertheim Laboratory** | 2020 | 88th percentile | **98.6th percentile** |
| J. Wayne Reitz Union | 1967 | — | 79.7th percentile |
| Scott Family Hall | April 2017 | — | 84.8th percentile |

We therefore run the campus area at 10 m as well.

The three sites make a test of the method. Two buildings stand 100 m apart. The imagery and
the model are the same. The building from 2020 gives 98.6. The building from 1967 gives 79.7.
Scott Family Hall opened just before the 2017 data. The correct answer for it is "no change".
The model gives that answer.

Wertheim also shows that the filter works. At county resolution the model calls it
Urban/Barren in both years. There is no class change. It does not enter the list. This is
correct. The site was a parking lot. The change is not a loss of habitat.

---

## 8. Limits

1. **Accuracy on volunteer labels is 0.628.** The overall figure is 0.811. Section 3.6 gives
   the cause.
2. **Herbaceous recall is 0.716.** This is the weakest class. The model confuses it with
   Urban/Barren. Read the 6 `development` sites as a maximum, not an exact count.
3. **The limit is a percentile, not a constant.** p97 applies to this area and these two
   years.
4. **Embedding change means "this looks different to the model".** It does not mean "a person removed a tree". A person must find the cause.
5. **We used two years only.** The result shows no trend. Data exists for 2017 to 2025.
6. **No ground data exists inside the study area.** See section 9.
7. **20 m hides building-size change.** Section 7 gives the numbers. Only the campus area
   runs at 10 m.
8. **Some class borders are definitions.** Herbaceous against Urban/Barren for a mown lot is
   a choice, not a measurement.

---

## 9. The finding

The study area holds **29** GLOBE land cover observations. They come from **11 sites** and
**7 people**. They cover 2025 and 2026. **Not one has a usable land cover code.** No volunteer
observation from the study area trained the model.

The problem is not the number of people. People do go out. They take photographs. They record
ground conditions. They write notes. Several 2026 notes describe change directly: "New
building to north", "LCMS change", "Student Health Care building finished in 2022".

The missing part is always the MUC classification step. That step is the only part that makes
a label a model can use.

This is the reason we added labels from OpenStreetMap. It is also the reason the model is
weaker on volunteer data. It is also the reason the output is a ranked list of sites.

---

## 10. Next steps

- **Use all years from 2017 to 2025.** Fit a line for each pixel. This separates a single
  step change from slow drift.
- **Visit a random sample of the 113 sites.** This measures the accuracy of the list itself.
- **Test with spatial blocks as well as groups.** This measures the effect of nearby training
  points.
- **Calibrate the model.** The 0.5 confidence limit would then mean a true probability.
- **Find sites with both a GLOBE observation and an OpenStreetMap polygon.** These measure
  the difference between the two label sources.
