import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import { BASEMAPS, Z_BAND } from '@/data/constants';
import { register } from './layerRegistry';

/**
 * Two basemaps, mutually exclusive, pinned to the bottom z-band.
 *
 * Esri's tile URL is {z}/{y}/{x} — row before column. That is correct for
 * ArcGIS REST and is NOT a typo; swapping it to {z}/{x}/{y} silently returns
 * tiles from the wrong place.
 */
export function createBasemaps(): { dark: TileLayer<XYZ>; sat: TileLayer<XYZ> } {
  const dark = new TileLayer({
    source: new XYZ({
      url: BASEMAPS.dark.url,
      attributions: BASEMAPS.dark.attribution,
      maxZoom: BASEMAPS.dark.maxZoom,
      crossOrigin: 'anonymous',
    }),
    // OL puts this className on the layer's own container element, which lets a
    // CSS filter darken the tiles. Esri's "Dark Gray" canvas is actually a mid
    // grey and washes out the change raster against near-black UI chrome.
    className: 'basemap-dark-layer',
    zIndex: Z_BAND.basemap,
    visible: true,
  });

  const sat = new TileLayer({
    source: new XYZ({
      url: BASEMAPS.sat.url,
      // Required whenever this layer is visible — NASA-track submission.
      attributions: BASEMAPS.sat.attribution,
      maxZoom: BASEMAPS.sat.maxZoom,
      crossOrigin: 'anonymous',
    }),
    zIndex: Z_BAND.basemap,
    visible: false,
  });

  register('basemap-dark', dark);
  register('basemap-sat', sat);
  return { dark, sat };
}
