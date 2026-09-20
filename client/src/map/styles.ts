import type { ExpressionValue } from 'ol/expr/expression';
import { CHANGE_RAMP, CLASS_COLORS } from '@/data/constants';
import type { ClassCode, TransitionLegend } from '@/data/types';

/**
 * WebGL style expressions for the categorical and continuous rasters.
 *
 * Three things here are load-bearing and were wrong in the original contract:
 *
 *  1. `normalize: false` on every source (set in rasterLayers.ts). OL's default
 *     divides Byte data by 255, so class code 3 becomes 0.0118 and every
 *     integer comparison silently fails — a blank layer with no error.
 *
 *  2. Alpha is 0–1, not 0–255. The contract's [255,237,160,180] clamps to fully
 *     opaque and flattens the low-end of the ramp.
 *
 *  3. change.tif's nodata really is NaN (verified with gdalinfo). NaN fails
 *     every comparison, so `['<', band, t]` returns false for nodata pixels and
 *     they fall through to the colour ramp as solid red. They must be gated on
 *     the alpha band OL appends when a source declares nodata.
 */

const TRANSPARENT: ExpressionValue = [0, 0, 0, 0];

/**
 * Continuous change ramp, driven by a style *variable* rather than a baked-in
 * literal. `updateStyleVariables({ t })` then updates a uniform instead of
 * recompiling the shader on every slider tick.
 *
 * The ramp is normalised to 0–1 before interpolation — `(band - t) / span` —
 * so the interpolate stops stay constant. Using `['var','t']` directly as a
 * stop input is not reliably supported by OL's WebGL style compiler; this form
 * sidesteps the question entirely and behaves identically.
 */
export function changeColor(): ExpressionValue {
  const value: ExpressionValue = ['band', 1];
  const alpha: ExpressionValue = ['band', 2];
  const t: ExpressionValue = ['var', 't'];

  // Normalised position above the threshold, clamped to the ramp.
  const u: ExpressionValue = [
    'clamp',
    ['/', ['-', value, t], CHANGE_RAMP.span],
    0,
    1,
  ];

  return [
    'case',
    // nodata (NaN) — alpha band is 0 there
    ['==', alpha, 0],
    TRANSPARENT,
    // below threshold
    ['<', value, t],
    TRANSPARENT,
    // above threshold: pale yellow -> red
    ['interpolate', ['linear'], u, 0, CHANGE_RAMP.low, 1, CHANGE_RAMP.high],
  ];
}

/** Land-cover: exact integer class codes. 255 = nodata. */
export function lulcColor(): ExpressionValue {
  const v: ExpressionValue = ['band', 1];
  const alpha: ExpressionValue = ['band', 2];

  const cases: ExpressionValue[] = [];
  for (const code of [0, 1, 2, 3] as ClassCode[]) {
    cases.push(['==', v, code], CLASS_COLORS[code]);
  }

  return ['case', ['==', alpha, 0], TRANSPARENT, ...cases, TRANSPARENT];
}

/**
 * Confirmed transitions, coloured from transitions_legend.json.
 *
 * Built dynamically because the legend length varies with the run — the real
 * pipeline produced 6 entries, not the 12 theoretically possible. Keys are NOT
 * zero-padded, so water-origin codes are single digits ("1", not "01").
 *
 * 0 means "no confirmed transition" and must stay transparent.
 */
export function transitionsColor(legend: TransitionLegend): ExpressionValue {
  const v: ExpressionValue = ['band', 1];
  const alpha: ExpressionValue = ['band', 2];

  const cases: ExpressionValue[] = [];
  for (const [key, entry] of Object.entries(legend)) {
    const code = Number(key);
    if (!Number.isFinite(code) || code === 0) continue;
    cases.push(['==', v, code], entry.color);
  }

  return ['case', ['==', alpha, 0], TRANSPARENT, ['==', v, 0], TRANSPARENT, ...cases, TRANSPARENT];
}

/**
 * Sentinel-2, switchable between true colour and false colour (CIR).
 *
 * Band layout (set as descriptions in the file):
 *   [1] B08 NIR   [2] B04 Red   [3] B03 Green   [4] B02 Blue
 *   true colour  = 2,3,4
 *   false colour = 1,2,3   (vegetation reads bright red)
 *
 * Band 5 is the alpha mask OL appends because the source declares nodata 0.
 *
 * STRETCH. A 2–98 percentile stretch was baked in per scene at export time by
 * `gdal_translate -scale_N lo hi 1 255`, so the Byte value carried by the COG is
 *
 *     byte = 1 + (reflectance - lo_year) / (hi_year - lo_year) * 254
 *
 * with lo/hi measured from THAT YEAR'S scene. Each year therefore sits on its
 * own radiometric scale, which is why flipping between them shows apparent
 * change that is partly just the stretch.
 *
 * `s2Linear` inverts that and re-maps onto one scale shared by both years, so
 * the two are directly comparable. It cannot recover the clipped tails — every
 * reflectance below lo was flattened to 1 and everything above hi to 255 — so
 * this is an honest un-stretch of the middle 96%, not of the whole scene.
 *
 * `fc` and `stretch` are style variables so both toggles are uniform updates
 * rather than shader recompiles.
 */

/** Per-band bounds, in the band order the COG uses: NIR, Red, Green, Blue. */
export type BandBounds = ReadonlyArray<readonly [number, number]>;

/**
 * Reflectance recoverable from a Byte band, normalised onto `shared`.
 *
 *   refl = lo + (byte - 1) * (hi - lo) / 254
 *   out  = (refl - sLo) / (sHi - sLo)
 *
 * Folded to `byte * m + c` so the GPU does one multiply-add per band.
 */
function linearBand(band: number, own: readonly [number, number], shared: readonly [number, number]) {
  const [lo, hi] = own;
  const [sLo, sHi] = shared;
  const span = Math.max(sHi - sLo, 1e-6);
  const m = (hi - lo) / 254 / span;
  const c = (lo - (hi - lo) / 254 - sLo) / span;
  return ['clamp', ['+', ['*', ['band', band], m], c], 0, 1] as ExpressionValue;
}

export function s2Color(own?: BandBounds, shared?: BandBounds): ExpressionValue {
  const alpha: ExpressionValue = ['band', 5];

  const stretched = [1, 2, 3, 4].map(
    (b) => ['/', ['band', b], 255] as ExpressionValue,
  );

  // Without the sidecar there is nothing to invert, so both branches show the
  // baked stretch and the toggle simply has no visible effect.
  const linear =
    own && shared
      ? [0, 1, 2, 3].map((i) => linearBand(i + 1, own[i]!, shared[i]!))
      : stretched;

  const pick = (v: ExpressionValue[]): ExpressionValue => [
    'case',
    ['==', ['var', 'fc'], 1],
    ['array', v[0]!, v[1]!, v[2]!, 1],
    ['array', v[1]!, v[2]!, v[3]!, 1],
  ];

  return [
    'case',
    ['==', alpha, 0],
    TRANSPARENT,
    ['==', ['var', 'stretch'], 1],
    pick(stretched),
    pick(linear),
  ];
}

/** COG band order. The sidecar keys reflectance bounds by band code. */
export const S2_BAND_CODES = ['B08', 'B04', 'B03', 'B02'] as const;

/**
 * The shared scale: each band's widest recoverable range across both years.
 *
 * Taking min(lo) and max(hi) guarantees every value either year can represent
 * lands inside it, so neither year clips against the other — the point of the
 * exercise is that the same ground reflectance gets the same screen value in
 * both.
 */
export function sharedBounds(a: Record<string, [number, number]>, b: Record<string, [number, number]>): BandBounds {
  return S2_BAND_CODES.map((code) => {
    const x = a[code] ?? [0, 3000];
    const y = b[code] ?? [0, 3000];
    return [Math.min(x[0], y[0]), Math.max(x[1], y[1])] as const;
  });
}

/** One year's own baked bounds, in COG band order. */
export function ownBounds(m: Record<string, [number, number]>): BandBounds {
  return S2_BAND_CODES.map((code) => (m[code] ?? [0, 3000]) as readonly [number, number]);
}
