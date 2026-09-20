## Inspiration

Change detection is the interesting half of satellite imagery. "What is here" is a solved
problem — you can look at a picture. "What is different, and does it matter" is harder, and
it's the question anyone actually managing land is asking.

The other interesting problem in this track is making participatory mapping worth more.
GLOBE Observer collects real ground observations, but scattered points on a map don't do much
alone, and satellite data can't tell you why something changed. Each one covers the other's
weakness — satellites see everywhere but understand nothing, people understand what they're
looking at but can only be in one place.

Pulling the GLOBE API for Alachua County set the direction. There are 29 land cover
observations and none carry a usable classification, so there was nothing local to train on.
That pushed the design the other way round: instead of GLOBE data feeding the model, the
satellite data produces the list of places where an observation would be worth taking.

## What it does

It compares Alachua County in 2017 to 2024 and produces a ranked list of 40 places where the
land actually changed — what it was, what it is now, how big, and whether it sits inside a
conservation area. The top result is 5.8 hectares of woody cover lost inside Santa Fe Springs
Conservation Area.

The map has a threshold slider, a year toggle, and click-to-zoom on any site.

## How it was built

The core is Google's AlphaEarth embeddings. Every 10m pixel gets 64 numbers describing a
year of satellite observation, normalized to length 1. Comparing two years is just the angle
between two vectors:

$$\text{change} = 1 - \cos(e_{2017}, e_{2024}) = 1 - \sum_{i=0}^{63} e_{2017,i} \cdot e_{2024,i}$$

That gives you *where* something changed but not *what*. For that, the method comes from EMERGE
Textbook 2, Chapter 5 Lesson 1 — sample embeddings at ground observation points, train a
Random Forest on all 64 bands, classify the region. Run it on both years and you get "was
woody, now bare."

The two get combined: a pixel counts as real change only if the embedding moved a lot AND the
class flipped AND the classifier was confident both years AND the patch is at least a hectare.
That takes 3.6 million pixels down to 113 patches.

Everything runs from one script with no account or API key. Python, GDAL and scikit-learn for
the pipeline. React and OpenLayers for the map, reading Cloud-Optimized GeoTIFFs directly, so
the whole thing is static files.

## Challenges

**No Earth Engine account.** The curriculum lesson reads AlphaEarth from Earth Engine, which
needs an approved account. The same data is published as COGs on Source Cooperative, which
works anonymously.

- The files are stored bottom-up, so reading them directly gives vertically flipped data.
- The values are 8-bit integers that need decoding before any math.
- Both failures are silent — the numbers look fine and are wrong.

**Swamp is not water.** Sampling OpenStreetMap wetland polygons for water labels made the model
call 22% of the county water.

- 2,727 of 3,776 wetland polygons in north Florida are tagged `swamp`, which here means cypress
  forest.
- The model had been taught that closed tree canopy was water.
- `landuse=residential` broke the same way — Gainesville suburbs are full of trees, so using
  them as urban examples taught the model that canopy is urban.

**Paynes Prairie kept winning.** A wet prairie that floods and dries lights up the change map
at 2.2x the county average.

- Ranked by magnitude, the top conservation alert in the county was a wetland being wet.
- Fix: type every change by category (vegetation loss, development, revegetation, hydrologic)
  and rank by type first.
- It still appears, labeled as hydrology, just not at the top.

**Most class changes were noise.** 16.5% of pixels changed class between the two years.

- The tell was symmetry: 81,038 pixels went herbaceous→woody, 92,096 went woody→herbaceous.
- Equal traffic both ways across a class boundary is the classifier being unsure, not land
  changing.
- Fix: require the embedding distance to agree before anything counts.

## What was learned

Cosine similarity is simpler than expected — once vectors are normalized, "how much did this
place change" is one dot product, with no training and no parameters.

Land use is not land cover. OpenStreetMap tags what a parcel is *for*; GLOBE records what's
physically *there*. The model gets 0.896 accuracy on OpenStreetMap points and 0.628 on GLOBE
points, which is a real gap.

Checking the work mattered more than expected. The change categories were validated against
NDVI from Sentinel-2, which shares no inputs with the embeddings or the classifier. 95 out of
95 moved in the predicted direction.

## What's next

Use all years from 2017–2025 instead of two endpoints, to separate a step change from slow
drift. And go visit some of the 40 sites — nobody has confirmed one on the ground yet, which
is the entire point.
