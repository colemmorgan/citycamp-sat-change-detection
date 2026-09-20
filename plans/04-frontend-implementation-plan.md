# Frontend Implementation Plan — v1

**Status: awaiting sign-off. No code written yet.**

Supersedes the frontend portions of `01-technical-spec.md` §C4 and amends `02-frontend-data-contract.md`
where noted. Everything not restated here still holds — read `02` first; this document does not repeat it.

Written 2026-09-20 12:47 EDT. Submit 17:00. App build window closes 16:20 for C5 (README/deploy/Devpost).
**Wall clock available: 3h33m. Full scope is ~5h15m solo. This plan is built to be parallelised —
see §9.**

---

## 0. Decisions taken

| Question | Decision |
|---|---|
| Imagery source | **Pre-warp to EPSG:3857 in the pipeline, self-host in `data/`.** No client-side MPC fetching. |
| Change-detection UI | **Full.** Right panel holds task queue, threshold slider, legend, explainer. |
| "Gainesville area" | **Analysis AOI bbox** (`-82.55, 29.48, -82.15, 29.82`). Boundary drawn as the AOI rectangle. |
| Deadline | **17:00 today.** |
| Scope | **No cuts.** Parallelise instead. |
| Router | **TanStack Router, code-based, single route file. Typed search params carry map state.** |

### Consequences of the imagery decision

1. **No MPC client.** All Planetary Computer work (STAC search, SAS signing, download, warp) happens in
   the Python pipeline. The frontend sees only local COGs. This removes the EPSG:32617 reprojection
   blocker, the SAS-token-expiry risk, and the CORS unknown in one move.
2. **The 256 MB in-memory COG cache is dropped.** Browser HTTP cache handles range-request reuse;
   OL's tile cache handles decoded tiles. A bespoke byte-accounted LRU adds no measurable benefit for
   self-hosted files. Replacement: `cacheSize: 512` on each GeoTIFF source, so toggling layers off and
   on never refetches.
3. **The AOI boundary needs no pipeline work.** Synthesised client-side from the `AOI_4326` constant as
   a 5-vertex ring. Zero bytes shipped, zero dependency on pipeline timing.

---

## 1. Contract amendments requested

Needs the pipeline agent's agreement. Items 1.1 and 1.3 change pipeline output; the rest are
clarifications.

### 1.1 Sentinel-2 ships as **one 4-band COG per year**, not two 3-band files

Replaces `02-frontend-data-contract.md` §2 rows for `s2_2017.tif` / `s2_2024.tif`.

| File | Bands | Type | NoData | Compression |
|---|---|---|---|---|
| `s2_2017.tif` | **4**: `[B08 NIR, B04 Red, B03 Green, B02 Blue]` | Byte | 0 | DEFLATE |
| `s2_2024.tif` | same | Byte | 0 | DEFLATE |

- **True colour** = bands `2,3,4`. **False colour (CIR)** = bands `1,2,3`.
- Both composites become a **client-side toggle on one layer** — no second file, no second fetch, no
  second WebGL context.
- Halves the pipeline's S2 export work and the payload versus four 3-band files.
- DEFLATE, not JPEG: JPEG-in-TIFF is YCbCr 3-band and does not carry a 4th band cleanly. Also avoids
  `geotiff.js`'s flakiest decode path.

Payload at 2330×2279: ~6 MB/year deflated → 12 MB both years, plus `change.tif` ~12 MB, `lulc_*` ~2 MB,
`transitions` <1 MB ≈ **27 MB**, inside the contract's 25–30 MB budget.

### 1.2 All single-band rasters read with `normalize: false` and `interpolate: false`

No pipeline change — documenting client behaviour so it is not "fixed" later. Contract §2.1 sets
`normalize: false` only for `change.tif`. It is equally required for `lulc_*` and `transitions`: OL's
default normalisation divides Byte data by 255, so class code `3` becomes `0.0118` and every
`['==', ['band', 1], 3]` silently fails — a blank layer, no error. `interpolate: false` is required on
categorical rasters or resampling invents class codes that do not exist.

### 1.3 `transitions_legend.json` keys are **not zero-padded**

`from_code * 10 + to_code` with `from_code = 0` (Water/Wetland) yields single digits: 0→3 is `"3"`, not
`"03"`. The contract's only example is `"13"`, which does not disambiguate. Client parses keys as
integers and assumes no fixed width. **Pipeline must not zero-pad**, or every water-origin transition
silently fails lookup.

### 1.4 Fields the contract leaves undefined

- `tasks.geojson.distance_to_protected_m` when `protected_status === "outside"` — `null`, or a real
  distance > 500? Client renders `—` for `null`.
- `tasks.geojson.protected_name` / `protected_manager` when `protected_status === "adjacent"` —
  assumed populated (adjacency is measured against a *named* unit). Confirm.
- `change.tif` — do NaN pixels occur over the full AOI, and is a `GDAL_NODATA` tag written? Determines
  whether the change style must gate on OL's appended alpha band. See §4.2.
- `globe_points.geojson` — does it carry the **148** `MucCode`-labelled statewide points, or all **691**?
  Decides whether the map can honestly show the "10 observations in Alachua County" headline. See §6.3.

---

## 2. Stack

| Concern | Choice | Note |
|---|---|---|
| Build | **Vite + React 18 + TypeScript** | Reverses contract §8's "no build step". Required by the design system. |
| Routing | **TanStack Router**, code-based | Single route file. No Vite plugin, no codegen. See §3. |
| Styling | **Tailwind v4** + `@theme` | CSS-first tokens map 1:1 onto `03-design-system.txt`. |
| Components | **shadcn/ui** | Themed via tokens, never one-off styled. |
| Icons | **lucide-react** | Single library, no mixing. |
| Map | **`ol` from npm** | Bundled; removes the import-map / `geotiff` transitive-dep hazard entirely. |
| State | **zustand** | Map instance lives in a ref, not React. Store is config source of truth. |
| Validation | **zod** | For `validateSearch`. Optional — hand-rolled validators are ~25 lines if we'd rather skip the dep. |
| Deploy | GitHub Pages, `base: '/citycamp-sat-change-detection/'` | Data in `public/data/`, copied verbatim and unhashed. |

**No drag-and-drop library.** Layer reordering uses up/down arrow buttons — zero deps, ~5 min instead
of ~25, and closer to QGIS's own affordance than dragging.

---

## 3. Routing — map state in the URL

One route (`/`) with typed, validated search params. Every view is a shareable deep link:
*"here's TASK-0007 at threshold 0.31"* is a genuine demo asset.

```ts
// validated via zod in validateSearch
{
  c:    "lon,lat"            // center, 4326, 4dp        default: AOI center
  z:    number               // zoom, 1dp                default: 11
  t:    number               // change threshold          default: stats.change.slider_default
  b:    "dark" | "sat"       // basemap                   default: "dark"
  l:    string               // visible layer ids, csv    default: "transitions,change,protected,globe,aoi"
  task: string | undefined   // selected TASK-xxxx
  comp: "tc" | "fc"          // imagery composite         default: "tc"
}
```

**Two rules that prevent the classic failure modes:**

1. **One-way write, one-time read.** URL is *derived from* the store. Hydrate the store from search
   params once on mount; after that, only the store writes to the URL. Bidirectional binding here
   produces feedback loops that are miserable to debug under time pressure.
2. **Throttle and `replace`.** Write on OL's `moveend`, not on every pan frame, throttled to ~300ms,
   with `navigate({ search, replace: true })`. Writing per-frame without `replace` fills the history
   stack and makes the back button unusable.

Threshold, layer visibility and task selection commit immediately (they're discrete); centre and zoom
commit on `moveend`.

---

## 4. Raster layer rules

### 4.1 Every GeoTIFF source

```
normalize: false      // always — categorical codes and raw cosine values both depend on it
interpolate: false    // all single-band rasters
cacheSize: 512
```

### 4.2 `change.tif` — threshold slider

The contract's §2.1 snippet bakes `t` in as a JS literal, so every slider tick calls `layer.setStyle()`
and recompiles the WebGL shader. That contradicts §7's "make it smooth."

Use `styleVariables: { t }` + `['var', 't']`, driven by `layer.updateStyleVariables({ t })` — a uniform
update, no recompile.

**Open risk:** uncertain whether OL accepts a `['var']` as a *stop input* to `interpolate` (as opposed
to the interpolated value). If not, normalise arithmetically — `(band − t) / 0.15` — and interpolate
over constant `0 → 1` stops. Same visual, same performance. **5-minute spike before step 7.**

Two bugs in the contract's snippet, corrected here:

- **Alpha is `0–1` in OL colour arrays, not `0–255`.** `[255,237,160,180]` clamps to fully opaque and
  destroys the intended soft low-end ramp. Correct: `0.70` and `0.90`.
- **`nodata: NaN` cannot match by equality** (`NaN === NaN` is false). A NaN pixel returns `false` from
  `['<', ['band',1], t]`, falls through to the `interpolate` branch, and renders as arbitrary opaque
  colour. If §1.4 confirms NaN pixels exist, gate on OL's appended alpha band (`['band', 2]`).

### 4.3 `lulc_*.tif` / `transitions.tif`

`case` expressions over exact integer codes. LULC palette fixed (contract §2.2). Transition colours
built **dynamically from `transitions_legend.json`** — entry count varies, never assume 12.

`transitions.tif` is intentionally sparse (0.1–1% of pixels lit). The status strip reports
`stats.counts.transition_px` so a near-blank layer reads as *correct output*, not a failed load.

### 4.4 `s2_*.tif` — composite toggle

One 4-band source per year; a style variable selects the band triplet. True colour `2,3,4`, false
colour `1,2,3`. Toggle lives in the imagery layer row and in the `comp` search param.

### 4.5 Missing files

Contract §8: any raster may be absent during development. `data/probe.ts` issues a 0-byte range request
per file before a layer is constructed. Absent → **no layer object created** (also caps WebGL contexts;
browsers limit around 16) and the panel row renders disabled with a "not yet generated" note. One
missing raster never breaks the map.

---

## 5. Map configuration

```
projection: EPSG:3857
center: [-9167160.1, 3458657.9]
zoom: 11, minZoom: 9, maxZoom: 16
extent: AOI_3857
constrainOnlyCenter: true     // ← REQUIRED
```

**`constrainOnlyCenter: true` is not optional.** OL's default extent constraint requires the *viewport*
to fit inside the extent. The AOI is 44.5 km wide; a 1200px viewport covers 45.9 km at z12 and 91.7 km
at z11. The contract's own default `zoom: 11` therefore violates its own `extent` constraint, and
`minZoom: 9` (366.9 km) makes it far worse — the view would snap back or refuse to zoom out.
Constraining the centre only gives exactly the "slight slack" behaviour requested.

Basemaps:
- **Dark (default):** CARTO Dark Matter
  `https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`,
  attribution `© OpenStreetMap contributors © CARTO`. No official OSM-run dark raster service exists;
  Stadia's dark styles now require an API key off localhost and would break on Pages.
- **Satellite:** Esri World Imagery, contract §1 URL, attribution
  `Esri, Maxar, Earthstar Geographics` **required whenever visible**. Non-negotiable for a NASA-track
  submission.

---

## 6. Vector layers

### 6.1 AOI boundary
Synthesised client-side from `AOI_4326` — 5-vertex ring, `border-action` stroke, dashed, no fill.
Labelled **"Analysis extent"** in the legend so it is not mistaken for a political boundary.

### 6.2 `protected.geojson` / `tasks.geojson`
Read with `dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'` per contract §0.
Protected: outline only, no fill. Tasks: polygon + rank-numbered pin from the `centroid` property
(already `[lon, lat]`; needs `fromLonLat`).

**Never compute area from geometry** — Web Mercator overstates it 1.32× at this latitude. `area_ha` is
read verbatim from the feature. Same rule binds the measure tool: see §7.3.

### 6.3 `globe_points.geojson` — the honesty problem

The pitch is "10 land-cover observations in 9 years." That count comes from the *unfiltered* 691-record
statewide set. If the shipped file holds only the 148 `MucCode`-labelled points, an unknown and possibly
much smaller number fall inside the AOI — the map could show 3 pins while the copy claims 10, in front
of judges.

Handling: the explainer box states the count from `stats.counts.globe_in_aoi`, falling back to a
client-side count of rendered features. If that number is below 10, copy reads *"N of Alachua County's
10 land-cover observations carry the labels needed for training"* — a sharper version of the argument,
not a retreat from it.

`analyst_added` points styled distinctly and labelled as such in the legend. Disclosed, not hidden.

---

## 7. Tools

A single `interactionManager` owns mutual exclusion — activating one tool deactivates the others and
restores the default pan/zoom interactions on Escape.

### 7.1 Zoom
Compact in/out + "zoom to AOI" reset. Buttons in the top bar tool group, OL's default controls hidden
so the chrome stays consistent with the design system.

### 7.2 Pin dropper
Click drops a marker; readout shows **decimal degrees and UTM 17N**, click-to-copy. Multiple pins
allowed, cleared individually or all at once. Pin positions are *not* URL-synced (unbounded length).

### 7.3 Measure — **must be geodesic**
`ol/sphere`'s `getLength` / `getArea` with `{ projection: 'EPSG:3857' }`, which applies the geodesic
correction. A naive `geometry.getLength()` / `getArea()` reports distances and areas up to **32% too
large** at this latitude — in the one feature specifically designed to demonstrate rigour, in front of
a geographer judge. Line and polygon modes, live segment labels, metric with imperial in parentheses.

---

## 8. Design system application

Tokens from `03-design-system.txt` go into Tailwind v4 `@theme` as CSS variables, then map onto
shadcn's required set. **Gaps filled with proposals — veto any of these:**

| shadcn token | Value | Source |
|---|---|---|
| `background` | `#090909` | surface-0 |
| `card` / `popover` | `#0F1011` | surface-1 |
| `secondary` / `muted` | `#16171A` | surface-2 |
| `accent` (hover) | `#1A1C1F` | surface-3 |
| `input` (pressed/filled) | `#2D2E30` | surface-4 |
| `primary` | `#5E69D1` | surface-action |
| `primary-foreground` | `#FEFEFF` | text-on-action |
| `foreground` | `#E2E3E5` | text-body |
| `muted-foreground` | `#939496` | **proposed** — reuses icon-base |
| `border` | `#1F1F24` | border-0 |
| `ring` | `#6C77E5` | border-action |
| `destructive` | `#C4544A` | **proposed** — desaturated for near-black |
| `success` | `#4A9A62` | **proposed** |
| `warning` | `#C9973F` | **proposed** |

**Radius must be an explicit scale, not a single `--radius`.** shadcn derives `sm` as
`calc(var(--radius) - 4px)`, so `--radius: 4px` yields a 0px small radius. Explicit: `2 / 4 / 8`.

**Map data colours are exempt** from "no additional accent colours" — the LULC palette (contract §2.2)
and transition colours (`transitions_legend.json`) are data encoding, not UI chrome. Legend swatches get
a 1px `border-1` outline and a 12px minimum, because Woody `#2E6B3E` on surface-1 `#0F1011` is close to
invisible at small sizes.

Fonts: **Funnel Display** (titles, panel headers) / **Funnel Sans** (everything else), Google Fonts,
`display=swap` + preconnect.

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR  (44px, surface-1, border-0 bottom)                          │
│ [mark] Spatial Awareness │ ⊹ tools │ 2017⇄2024 │ basemap ▾ │ about   │
├────────────────┬─────────────────────────────────┬───────────────────┤
│ LAYER PANEL    │                                 │ TASK PANEL        │
│ 280px          │            MAP                  │ 320px             │
│ surface-1      │         (surface-0)             │ surface-1         │
│ ▸ Overlays     │                                 │ ▸ Threshold       │
│ ▸ Reference    │                                 │ ▸ Task queue (40) │
│ ▸ Basemap      │                                 │ ▸ Legend          │
│                │                                 │ ▸ What am I       │
│                │                                 │    looking at     │
├────────────────┴─────────────────────────────────┴───────────────────┤
│ STATUS STRIP (24px) — lon/lat · scale · active tool · data status    │
└──────────────────────────────────────────────────────────────────────┘
```

Both side panels collapse to a 32px icon rail. Panels are flush-docked, never floating cards —
design system §4 and §6.

**Layer panel grouping.** Free z-ordering across *all* layers would let the user bury the map under the
basemap. Three pinned groups instead:

- **Basemap** (bottom, not reorderable) — radio: Dark / Satellite.
- **Overlays** (reorderable, seeded from contract §6 order) — transitions, change, LULC, imagery.
- **Reference** (top, not reorderable) — protected, GLOBE points, tasks, AOI.

Mutually-exclusive pairs (LULC 2017/2024, imagery 2017/2024) are **radio groups inside a single row**,
not two checkboxes — a checkbox pair would lie about what the app can do.
Row anatomy: `[☑] [icon] Name  [opacity] [▲▼]`.

---

## 9. Build plan — parallelised

Full scope is ~5h15m of work against 3h33m of wall clock. It fits **if step 0 lands first and two
additional agents take streams B and C.**

### Step 0 — the parallelisation gate (15 min, solo, blocking)

Nothing else starts until this exists. It is the interface contract between streams:

- `src/data/types.ts` — TS types for every contract artefact (stats, legend, all three GeoJSON property
  bags, layer ids as a string union).
- `src/store/` — zustand slice shapes: `layers`, `tools`, `tasks`, `threshold`. Field names final.
- `src/map/layerRegistry.ts` — the `register(id, layer)` / `get(id)` / `setVisible` / `setOpacity` /
  `setOrder` signatures, stubbed.
- `src/routes/index.tsx` — the `validateSearch` zod schema from §3.

Once these exist, the three streams touch disjoint files and cannot collide.

### Stream A — critical path (me)

| Step | Est | Ends |
|---|---|---|
| 0 · Interfaces + store + search schema | 15m | 13:02 |
| 1 · Vite + React + TS + Tailwind v4 + shadcn + router scaffold, tokens, fonts | 30m | 13:32 |
| 4 · Map core, view constraints, basemaps, AOI boundary | 20m | 13:52 |
| 6 · Raster layers + styles (§4 rules) | 30m | 14:22 |
| 7 · Threshold slider (spike §4.2 first) | 20m | 14:42 |
| 8 · Task queue — list, fly-to, highlight, mark-verified | 30m | 15:12 |
| 10 · URL search-param sync | 15m | **15:27** |

Leaves ~50 min of slack before the 16:20 handoff for integration and the pipeline's real data
arriving in a shape nobody predicted.

### Stream B — UI shell (agent 2, starts after step 1)

| Step | Est |
|---|---|
| 3 · App shell — top bar, collapsible panels, status strip | 25m |
| 5 · Layer panel — groups, radio pairs, opacity, ▲▼ reorder | 35m |
| 9 · Legend + explainer box + vector layers (protected, GLOBE) | 20m |

Touches `src/ui/**` and `src/components/**` only. Reads the store, never the map directly.

### Stream C — data + tools (agent 3, starts immediately, independent of step 0)

| Step | Est |
|---|---|
| 2 · `scripts/make_fixtures.py` — GDAL-generated schema-identical COGs, GeoJSON, stats | 20m |
| 12 · S2 imagery layer + true/false colour toggle | 15m |
| 11 · Pin dropper | 10m |
| 13 · Measure tool, geodesic (§7.3) | 30m |

Step 2 is pure Python in `scripts/` — zero collision risk, and it unblocks everyone, since real pipeline
data isn't due until ~14:45. Steps 11–13 land behind the `interactionManager` interface from step 0.

### Where the risk actually sits

Not in the feature count — in **integration at ~15:30**, when three streams meet real pipeline data for
the first time. Mitigations already in the plan: `probe.ts` means missing files degrade rather than
crash, step 0 fixes the interfaces before anyone writes against them, and fixtures (step 2) mean every
stream develops against schema-identical data from 13:10 onward rather than waiting.

---

## 10. Defaults proceeding on unless you object

1. Top bar reads **"Spatial Awareness"**; README and Devpost use
   **"Spatial Awareness — Ground Truth, Gainesville"** so the GLOBE thesis survives the rename.
2. Top bar contents: title lockup · tool group · year selector · basemap picker · About · data status.
3. Layer reorder via **▲▼ buttons**, not drag.
4. **Year swipe cut** — redundant now that every layer has an opacity slider and the panel has radio
   year pairs. This is the one thing I'd drop permanently; say the word if you want it back.
5. `localStorage` keys namespaced `spatial-awareness:verified:<task_id>`. A bare `task_id` is unsafe —
   `username.github.io` is a single origin shared by every one of your Pages repos. All reads and writes
   wrapped in try/catch with an in-memory fallback, per contract §7.
6. `stats.json` nulls render as `—`, never `null`/`NaN`. Where a null is trivially computable
   client-side (`counts.globe_in_aoi`), compute it and mark it as derived.
7. `zod` for `validateSearch`. Say so if you'd rather not add the dep — hand-rolled validators are ~25
   lines.
