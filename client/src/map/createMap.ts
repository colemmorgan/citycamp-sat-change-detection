import Map from 'ol/Map';
import View from 'ol/View';
import { defaults as defaultInteractions } from 'ol/interaction';
import { VIEW } from '@/data/constants';
import type { AssetAvailability, S2MetaPair, Stats, TransitionLegend } from '@/data/types';
import { createBasemaps } from './basemaps';
import { createRasterLayers } from './rasterLayers';
import { createVectorLayers } from './vectorLayers';

/**
 * Builds the map exactly once.
 *
 * The returned handle is held in a React ref and mutated imperatively.
 * React must never own OL objects: re-creating a WebGLTile layer on render
 * leaks a WebGL context, and browsers cap those at roughly 16.
 */
export interface MapHandle {
  map: Map;
  basemaps: ReturnType<typeof createBasemaps>;
  rasters: ReturnType<typeof createRasterLayers>;
  vectors: ReturnType<typeof createVectorLayers>;
  dispose: () => void;
}

/** The fetched data the map needs at construction time. */
export interface MapData {
  stats: Stats;
  legend: TransitionLegend;
  available: AssetAvailability;
  /** S2 sidecars. Optional: without them the stretch toggle is inert. */
  s2Meta?: S2MetaPair;
}

export function createMap(target: HTMLElement, data: MapData, threshold: number): MapHandle {
  const view = new View({
    projection: VIEW.projection,
    center: [...VIEW.center],
    zoom: VIEW.zoom,
    minZoom: VIEW.minZoom,
    maxZoom: VIEW.maxZoom,
    extent: [...VIEW.extent],
    // See constants.ts — without this the default zoom violates the extent.
    constrainOnlyCenter: VIEW.constrainOnlyCenter,
    showFullExtent: VIEW.showFullExtent,
    constrainResolution: false,
  });

  const basemaps = createBasemaps();
  const rasters = createRasterLayers({
    available: data.available,
    legend: data.legend,
    threshold,
    s2Meta: data.s2Meta,
  });
  const vectors = createVectorLayers(data.available, data.legend);

  const layers = [
    basemaps.dark,
    basemaps.sat,
    ...Object.values(rasters).filter(Boolean),
    ...Object.values(vectors).filter(Boolean),
  ];

  const map = new Map({
    target,
    view,
    layers: layers as never[],
    // No OL controls: the app draws its own chrome. Attribution for the
    // basemaps and every data source is carried by the "Credits & sources"
    // dialog in the status bar instead of an on-map overlay.
    controls: [],
    interactions: defaultInteractions({ doubleClickZoom: true, altShiftDragRotate: false, pinchRotate: false }),
    moveTolerance: 2,
  });

  return {
    map,
    basemaps,
    rasters,
    vectors,
    dispose: () => {
      map.setTarget(undefined);
      map.dispose();
    },
  };
}
