import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import { fromLonLat } from 'ol/proj';
import { AOI_4326, CLASS_COLORS, Z_BAND } from '@/data/constants';
import { ASSETS, dataUrl } from '@/data/paths';
import type { AssetAvailability, ClassCode, TransitionLegend } from '@/data/types';
import { register } from './layerRegistry';

/**
 * Vector layers.
 *
 * Everything ships as EPSG:4326 and is reprojected to the 3857 view on read —
 * this is deliberate (RFC 7946 for vectors, no client reprojection for
 * rasters), not an inconsistency to fix.
 *
 * NEVER derive area from these geometries. Web Mercator overstates area by
 * 1.32x at this latitude; `area_ha` is pre-computed in UTM and shipped as an
 * attribute.
 */

const geojson = new GeoJSON({
  dataProjection: 'EPSG:4326',
  featureProjection: 'EPSG:3857',
});

function source(file: string) {
  return new VectorSource({ url: dataUrl(file), format: geojson });
}

// ─── AOI boundary ────────────────────────────────────────────────────────────
/**
 * Synthesised client-side from the AOI constant — no pipeline dependency and no
 * bytes shipped. Labelled "Analysis extent" so it is never mistaken for a
 * political boundary: it is the data footprint, not the city limits.
 */
export function createAoiLayer(): VectorLayer<VectorSource> {
  const [w, s, e, n] = AOI_4326;
  const ring = [
    fromLonLat([w, s]),
    fromLonLat([e, s]),
    fromLonLat([e, n]),
    fromLonLat([w, n]),
    fromLonLat([w, s]),
  ];
  const layer = new VectorLayer({
    source: new VectorSource({ features: [new Feature(new Polygon([ring]))] }),
    style: new Style({
      stroke: new Stroke({ color: '#6C77E5', width: 1.25, lineDash: [6, 4] }),
    }),
    zIndex: Z_BAND.reference + 3,
  });
  register('aoi', layer);
  return layer;
}

// ─── protected land ──────────────────────────────────────────────────────────
/** Outline only, no fill — it must never compete with the change raster. */
export function createProtectedLayer(): VectorLayer<VectorSource> {
  const layer = new VectorLayer({
    source: source(ASSETS.protectedAreas),
    style: new Style({
      stroke: new Stroke({ color: 'rgba(122, 214, 168, 0.85)', width: 1 }),
      fill: new Fill({ color: 'rgba(122, 214, 168, 0.05)' }),
    }),
    zIndex: Z_BAND.reference + 0,
  });
  register('protected', layer);
  return layer;
}

// ─── GLOBE observations ──────────────────────────────────────────────────────
/**
 * GLOBE observations are drawn as ONE symbol regardless of whether their MUC
 * classification is usable. The usable/unusable split is a modelling concern,
 * not something a map reader needs encoded in the symbology — an observation is
 * an observation. The distinction still travels in the feature properties and
 * is available in the detail popup.
 *
 * osm_derived keeps its own muted symbol: those are not GLOBE observations at
 * all, they are supplementary training labels, and conflating the two would
 * misrepresent the data.
 */
const GLOBE_POINT = new Style({
  image: new Circle({
    radius: 5,
    fill: new Fill({ color: '#4A80B5' }),
    stroke: new Stroke({ color: 'rgba(9,9,9,0.7)', width: 1 }),
  }),
});

const GLOBE_STYLES = {
  globe_unusable: GLOBE_POINT,
  globe_volunteer: GLOBE_POINT,
  osm_derived: new Style({
    image: new Circle({
      radius: 2.5,
      fill: new Fill({ color: 'rgba(147, 148, 150, 0.55)' }),
      stroke: new Stroke({ color: 'rgba(9,9,9,0.6)', width: 0.5 }),
    }),
  }),
} as const;

export function createGlobeLayer(): VectorLayer<VectorSource> {
  const layer = new VectorLayer({
    source: source(ASSETS.globePoints),
    style: (feature) => {
      const src = feature.get('source') as keyof typeof GLOBE_STYLES;
      return GLOBE_STYLES[src] ?? GLOBE_STYLES.osm_derived;
    },
    zIndex: Z_BAND.reference + 1,
  });
  register('globe', layer);
  return layer;
}

// ─── verification tasks ──────────────────────────────────────────────────────
/** Polygon outlined in its category colour, plus a rank-numbered pin. */
export function createTasksLayer(legend: TransitionLegend): VectorLayer<VectorSource> {
  const colorFor = (code: number): string =>
    legend[String(code)]?.color ?? '#D7301F';

  const layer = new VectorLayer({
    source: source(ASSETS.tasks),
    style: (feature) => {
      const rank = feature.get('rank') as number;
      const color = colorFor(feature.get('transition_code') as number);
      return new Style({
        stroke: new Stroke({ color, width: 1.5 }),
        fill: new Fill({ color: 'rgba(0,0,0,0)' }),
        text: new Text({
          text: String(rank),
          font: '600 10px "Funnel Sans", sans-serif',
          fill: new Fill({ color: '#FEFEFF' }),
          stroke: new Stroke({ color: '#090909', width: 2.5 }),
          offsetY: -1,
        }),
      });
    },
    zIndex: Z_BAND.reference + 2,
  });
  register('tasks', layer);
  return layer;
}

/** Highlight for the selected task. Separate layer so selection never restyles the queue. */
export function createTaskHighlightLayer(): VectorLayer<VectorSource> {
  const layer = new VectorLayer({
    source: new VectorSource(),
    style: new Style({
      stroke: new Stroke({ color: '#6C77E5', width: 2.5 }),
      fill: new Fill({ color: 'rgba(108, 119, 229, 0.18)' }),
    }),
    zIndex: Z_BAND.tool + 0,
  });
  register('task-highlight', layer);
  return layer;
}

export function createVectorLayers(available: AssetAvailability, legend: TransitionLegend) {
  return {
    aoi: createAoiLayer(),
    protected: available.protectedAreas ? createProtectedLayer() : undefined,
    globe: available.globePoints ? createGlobeLayer() : undefined,
    tasks: available.tasks ? createTasksLayer(legend) : undefined,
    highlight: createTaskHighlightLayer(),
  };
}

/** Exposed for the legend so swatches and map colours cannot drift apart. */
export const classColor = (c: ClassCode): string => CLASS_COLORS[c];
