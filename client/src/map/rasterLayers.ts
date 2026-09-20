import WebGLTileLayer from 'ol/layer/WebGLTile';
import GeoTIFF from 'ol/source/GeoTIFF';
import { Z_BAND } from '@/data/constants';
import { ASSETS, dataUrl } from '@/data/paths';
import type { AssetAvailability, LayerId, S2MetaPair, TransitionLegend } from '@/data/types';
import { register } from './layerRegistry';
import {
  changeColor,
  lulcColor,
  ownBounds,
  s2Color,
  sharedBounds,
  transitionsColor,
} from './styles';

/**
 * COG raster layers.
 *
 * Every source sets `normalize: false` and `interpolate: false`. Both are
 * mandatory, not stylistic:
 *   - normalize would rescale Byte class codes to 0–1 and break every integer
 *     comparison in the style expressions.
 *   - interpolate would resample categorical codes and invent classes that do
 *     not exist (a "1.5" between Woody and Herbaceous).
 *
 * A layer is only built when its file was found by the availability probe, so
 * a missing raster produces no layer, no WebGL context, and no console noise.
 */

interface BuildArgs {
  available: AssetAvailability;
  legend: TransitionLegend;
  threshold: number;
  /** Absent if the sidecars failed to load; imagery then has no stretch toggle. */
  s2Meta?: S2MetaPair;
}

function cog(url: string, nodata?: number) {
  return new GeoTIFF({
    sources: [{ url, ...(nodata !== undefined ? { nodata } : {}) }],
    // Keep raw values. The threshold slider depends on real cosine numbers and
    // the categorical layers depend on real integer class codes.
    normalize: false,
    interpolate: false,
    // Rasters are already EPSG:3857 — no client reprojection, by design.
    projection: 'EPSG:3857',
    // No fade-in: the categorical layers flicker through wrong colours while a
    // transition is in flight, because interpolating class codes is meaningless.
    transition: 0,
  });
}

export function createRasterLayers({ available, legend, threshold, s2Meta }: BuildArgs) {
  const built: Partial<Record<LayerId, WebGLTileLayer>> = {};

  const add = (id: LayerId, layer: WebGLTileLayer) => {
    register(id, layer);
    built[id] = layer;
  };

  // ── L3 change (on by default; the slider layer) ──
  if (available.change) {
    const layer = new WebGLTileLayer({
      source: cog(dataUrl(ASSETS.change)),
      style: { color: changeColor(), variables: { t: threshold } },
      opacity: 0.75,
      zIndex: Z_BAND.overlay + 2,
      visible: true,
    });
    add('change', layer);
  }

  // ── L4 confirmed transitions (on by default) ──
  // Intentionally sparse: ~15k lit pixels out of 5.3M. A near-empty layer here
  // is correct output, not a failed load.
  if (available.transitions) {
    const layer = new WebGLTileLayer({
      source: cog(dataUrl(ASSETS.transitions), 255),
      style: { color: transitionsColor(legend) },
      opacity: 1,
      zIndex: Z_BAND.overlay + 3,
      visible: true,
    });
    add('transitions', layer);
  }

  // ── L1/L2 land cover (off by default, mutually exclusive pair) ──
  for (const [id, key, year] of [
    ['lulc-2017', ASSETS.lulc2017, 2017],
    ['lulc-2024', ASSETS.lulc2024, 2024],
  ] as const) {
    const assetKey = year === 2017 ? 'lulc2017' : 'lulc2024';
    if (!available[assetKey]) continue;
    const layer = new WebGLTileLayer({
      source: cog(dataUrl(key), 255),
      style: { color: lulcColor() },
      opacity: 0.65,
      zIndex: Z_BAND.overlay + 1,
      visible: false,
    });
    add(id, layer);
  }

  // ── Sentinel-2 true colour (off by default, mutually exclusive pair) ──
  // Each year gets its OWN baked bounds but the SAME shared target scale, which
  // is what puts the two years on one radiometry when stretch is off.
  const shared = s2Meta ? sharedBounds(s2Meta[2017].stretch, s2Meta[2024].stretch) : undefined;
  for (const [id, key, assetKey, year] of [
    ['s2-2017', ASSETS.s2_2017, 's2_2017', 2017],
    ['s2-2024', ASSETS.s2_2024, 's2_2024', 2024],
  ] as const) {
    if (!available[assetKey]) continue;
    const own = s2Meta ? ownBounds(s2Meta[year].stretch) : undefined;
    const layer = new WebGLTileLayer({
      source: cog(dataUrl(key), 0),
      // fc      = 0 true colour, 1 false colour (CIR)
      // stretch = 0 shared linear reflectance, 1 the baked per-scene 2–98%
      style: { color: s2Color(own, shared), variables: { fc: 0, stretch: 0 } },
      opacity: 1,
      zIndex: Z_BAND.overlay + 0,
      visible: false,
    });
    add(id, layer);
  }

  // ── Campus change, native 10 m over UF (off by default) ──
  if (available.campusChange) {
    const layer = new WebGLTileLayer({
      source: cog(dataUrl(ASSETS.campusChange)),
      style: { color: changeColor(), variables: { t: threshold } },
      opacity: 0.85,
      zIndex: Z_BAND.overlay + 4,
      visible: false,
    });
    add('campus-change', layer);
  }

  return built;
}

/**
 * Push a new threshold into every layer that uses it.
 * A uniform update — no shader recompile, so this is safe to call per frame.
 */
export function applyThreshold(layers: Partial<Record<LayerId, WebGLTileLayer>>, t: number) {
  layers.change?.updateStyleVariables({ t });
  layers['campus-change']?.updateStyleVariables({ t });
}

/**
 * Switch both S2 years between the shared linear scale and the baked per-scene
 * 2–98% stretch. Uniform update, so it is instant and costs no recompile.
 */
export function applyStretch(
  layers: Partial<Record<LayerId, WebGLTileLayer>>,
  percentile: boolean,
) {
  const stretch = percentile ? 1 : 0;
  layers['s2-2017']?.updateStyleVariables({ stretch });
  layers['s2-2024']?.updateStyleVariables({ stretch });
}

/** Switch both S2 years between true colour (false) and false colour / CIR (true). */
export function applyComposite(
  layers: Partial<Record<LayerId, WebGLTileLayer>>,
  falseColor: boolean,
) {
  const fc = falseColor ? 1 : 0;
  layers['s2-2017']?.updateStyleVariables({ fc });
  layers['s2-2024']?.updateStyleVariables({ fc });
}
