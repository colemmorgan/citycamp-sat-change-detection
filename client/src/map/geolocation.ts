import Geolocation from 'ol/Geolocation';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { Circle, Fill, Stroke, Style } from 'ol/style';
import { containsCoordinate } from 'ol/extent';
import { toLonLat } from 'ol/proj';
import type Map from 'ol/Map';
import { AOI_3857, Z_BAND } from '@/data/constants';

/**
 * "Where am I" — browser geolocation plotted on the map.
 *
 * Permission is requested only on an explicit user action. Prompting on load
 * is hostile, and some browsers ignore a geolocation request that has no user
 * gesture behind it anyway.
 *
 * Requires a secure context: HTTPS or localhost. GitHub Pages is HTTPS, so
 * this works in production.
 *
 * The study area is a 44 km box around Gainesville and the map's pan extent is
 * constrained to it, so a user elsewhere in the world would be located off-map
 * with no way to see the marker. `insideAoi` lets the UI say that plainly
 * rather than appearing to do nothing.
 */

export type GeoStatus = 'idle' | 'locating' | 'active' | 'denied' | 'unavailable' | 'error';

export interface GeoState {
  status: GeoStatus;
  /** [lon, lat] in EPSG:4326. */
  position: [number, number] | null;
  /** Metres. */
  accuracy: number | null;
  insideAoi: boolean;
  message: string | null;
}

const POSITION_STYLE = new Style({
  image: new Circle({
    radius: 6,
    fill: new Fill({ color: '#6C77E5' }),
    stroke: new Stroke({ color: '#FEFEFF', width: 2 }),
  }),
});

const ACCURACY_STYLE = new Style({
  fill: new Fill({ color: 'rgba(108, 119, 229, 0.12)' }),
  stroke: new Stroke({ color: 'rgba(108, 119, 229, 0.5)', width: 1 }),
});

export interface GeoHandle {
  start: () => void;
  stop: () => void;
  dispose: () => void;
}

export function createGeolocation(map: Map, onChange: (s: GeoState) => void): GeoHandle {
  const positionFeature = new Feature<Point>();
  positionFeature.setStyle(POSITION_STYLE);

  const accuracyFeature = new Feature();
  accuracyFeature.setStyle(ACCURACY_STYLE);

  const source = new VectorSource({ features: [accuracyFeature, positionFeature] });
  // Deliberately NOT in the layer registry. The registry holds layers the user
  // can toggle and reorder in the panel; this one is owned entirely by this
  // module and controlled by the locate button.
  const layer = new VectorLayer({
    source,
    zIndex: Z_BAND.tool + 10,
    visible: false,
  });
  map.addLayer(layer);

  const geo = new Geolocation({
    trackingOptions: { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    projection: map.getView().getProjection(),
  });

  let state: GeoState = {
    status: 'idle',
    position: null,
    accuracy: null,
    insideAoi: false,
    message: null,
  };

  const emit = (next: Partial<GeoState>) => {
    state = { ...state, ...next };
    onChange(state);
  };

  geo.on('change:position', () => {
    const coord = geo.getPosition();
    if (!coord) return;

    positionFeature.setGeometry(new Point(coord));
    const accGeom = geo.getAccuracyGeometry();
    accuracyFeature.setGeometry(accGeom ?? undefined);
    layer.setVisible(true);

    const inside = containsCoordinate(AOI_3857 as number[], coord);
    const [lon, lat] = toLonLat(coord);
    const lonLat: [number, number] = [lon as number, lat as number];

    emit({
      status: 'active',
      position: lonLat,
      accuracy: geo.getAccuracy() ?? null,
      insideAoi: inside,
      message: inside
        ? null
        : 'You are outside the study area — the map stays over Alachua County.',
    });

    if (inside) {
      map.getView().animate({ center: coord, zoom: 14, duration: 700 });
    }
  });

  geo.on('error', (e) => {
    // PERMISSION_DENIED === 1 in the browser GeolocationPositionError enum.
    const denied = (e as unknown as { code?: number }).code === 1;
    layer.setVisible(false);
    emit({
      status: denied ? 'denied' : 'error',
      message: denied
        ? 'Location permission denied. You can re-enable it in your browser’s site settings.'
        : 'Could not get your location.',
    });
  });

  return {
    start: () => {
      if (!('geolocation' in navigator)) {
        emit({ status: 'unavailable', message: 'This browser has no geolocation support.' });
        return;
      }
      if (!window.isSecureContext) {
        emit({
          status: 'unavailable',
          message: 'Location needs a secure connection (HTTPS).',
        });
        return;
      }
      emit({ status: 'locating', message: null });
      geo.setTracking(true);
    },
    stop: () => {
      geo.setTracking(false);
      layer.setVisible(false);
      emit({ status: 'idle', position: null, accuracy: null, message: null });
    },
    dispose: () => {
      geo.setTracking(false);
      geo.dispose();
      map.removeLayer(layer);
    },
  };
}
