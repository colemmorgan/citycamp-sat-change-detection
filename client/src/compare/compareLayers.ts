import TileLayer from 'ol/layer/Tile';
import WebGLTileLayer from 'ol/layer/WebGLTile';
import GeoTIFF from 'ol/source/GeoTIFF';
import XYZ from 'ol/source/XYZ';
import { BASEMAPS, Z_BAND } from '@/data/constants';
import { ASSETS, dataUrl } from '@/data/paths';
import type { BasemapId, LayerId, TransitionLegend } from '@/data/types';
import { changeColor, lulcColor, s2Color, transitionsColor } from '@/map/styles';

/**
 * Layers for the SECOND map in side-by-side mode.
 *
 * An OpenLayers layer belongs to exactly one map, so the right-hand view cannot
 * borrow the instances in layerRegistry — it needs its own. These are
 * deliberately NOT registered: the registry is the primary map's index, and
 * writing into it would make `registry.get('s2-2024')` return a layer that is
 * not on the primary map, which would break the layer panel and compare's own
 * visibility bookkeeping.
 *
 * Source options are copied from map/rasterLayers.ts and must stay identical —
 * `normalize: false` and `interpolate: false` in particular. Normalising would
 * rescale Byte class codes to 0–1 and break every integer comparison in the
 * style; interpolating would invent class codes that do not exist.
 *
 * Each WebGLTile layer costs one WebGL context and browsers cap those around
 * 16, so exactly one raster is ever built here — the right-hand target.
 */

function cog(url: string, nodata?: number): GeoTIFF {
  return new GeoTIFF({
    sources: [{ url, ...(nodata !== undefined ? { nodata } : {}) }],
    normalize: false,
    interpolate: false,
    projection: 'EPSG:3857',
    transition: 0,
  });
}

export function createCompareBasemap(id: BasemapId): TileLayer<XYZ> {
  const cfg = BASEMAPS[id];
  return new TileLayer({
    source: new XYZ({
      url: cfg.url,
      // Attribution is a submission requirement and travels with the tiles, so
      // it is set here too even though this map draws no attribution control.
      attributions: cfg.attribution,
      maxZoom: cfg.maxZoom,
      crossOrigin: 'anonymous',
    }),
    zIndex: Z_BAND.basemap,
  });
}

/**
 * One raster for the secondary map, or null for an id that has no raster
 * (vectors, basemaps) — callers treat null as "this pane shows basemap only".
 */
export function createCompareRaster(
  id: LayerId,
  legend: TransitionLegend,
  threshold: number,
): WebGLTileLayer | null {
  switch (id) {
    case 'change':
      return new WebGLTileLayer({
        source: cog(dataUrl(ASSETS.change)),
        style: { color: changeColor(), variables: { t: threshold } },
        opacity: 1,
        zIndex: Z_BAND.overlay + 2,
      });

    case 'campus-change':
      return new WebGLTileLayer({
        source: cog(dataUrl(ASSETS.campusChange)),
        style: { color: changeColor(), variables: { t: threshold } },
        opacity: 1,
        zIndex: Z_BAND.overlay + 4,
      });

    case 'transitions':
      return new WebGLTileLayer({
        source: cog(dataUrl(ASSETS.transitions), 255),
        style: { color: transitionsColor(legend) },
        opacity: 1,
        zIndex: Z_BAND.overlay + 3,
      });

    case 'lulc-2017':
    case 'lulc-2024':
      return new WebGLTileLayer({
        source: cog(dataUrl(id === 'lulc-2017' ? ASSETS.lulc2017 : ASSETS.lulc2024), 255),
        style: { color: lulcColor() },
        opacity: 1,
        zIndex: Z_BAND.overlay + 1,
      });

    case 's2-2017':
    case 's2-2024':
      return new WebGLTileLayer({
        source: cog(dataUrl(id === 's2-2017' ? ASSETS.s2_2017 : ASSETS.s2_2024), 0),
        // s2Color() reads ['var','fc'] to switch true/false colour. A WebGL
        // style that references an undeclared variable fails to compile, so the
        // declaration is not optional. See the note in the hand-off about
        // map/rasterLayers.ts, which omits it.
        style: { color: s2Color(), variables: { fc: 0 } },
        opacity: 1,
        zIndex: Z_BAND.overlay + 0,
      });

    default:
      return null;
  }
}

/** Whether a raster built here responds to the change-threshold slider. */
export function usesThreshold(id: LayerId): boolean {
  return id === 'change' || id === 'campus-change';
}
