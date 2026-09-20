import { useEffect, useState } from 'react';
import { toLonLat } from 'ol/proj';
import type { MapBrowserEvent } from 'ol';
import { Crosshair, Loader2, LocateFixed, TriangleAlert } from 'lucide-react';
import { useMapHandle } from '@/map/mapHandle';
import { createGeolocation, type GeoHandle, type GeoState } from '@/map/geolocation';
import { cn } from '@/lib/utils';
import { CreditsDialog } from './CreditsDialog';
import type { Stats } from '@/data/types';

/**
 * Bottom strip: cursor position, zoom, data counts, location control, credits.
 *
 * The transition-pixel count is here deliberately. L4 lights a few thousand
 * pixels out of 5.3 million, so the layer looks nearly empty — stating the
 * count turns "did it fail to load?" into "this is how rare confirmed change
 * is".
 */

function LocateButton() {
  const handle = useMapHandle();
  const [geo, setGeo] = useState<GeoHandle | null>(null);
  const [state, setState] = useState<GeoState>({
    status: 'idle',
    position: null,
    accuracy: null,
    insideAoi: false,
    message: null,
  });

  useEffect(() => {
    if (!handle) return;
    const g = createGeolocation(handle.map, setState);
    setGeo(g);
    return () => {
      g.dispose();
      setGeo(null);
    };
  }, [handle]);

  const active = state.status === 'active';
  const busy = state.status === 'locating';
  const failed =
    state.status === 'denied' || state.status === 'error' || state.status === 'unavailable';

  const Icon = busy ? Loader2 : failed ? TriangleAlert : active ? LocateFixed : Crosshair;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={!geo || busy}
        onClick={() => (active ? geo?.stop() : geo?.start())}
        title={
          state.message ??
          (active ? 'Hide my location' : 'Show my location on the map')
        }
        className={cn(
          'flex items-center gap-1 transition-colors disabled:opacity-40',
          active && 'text-border-action',
          failed && 'text-warning',
          !active && !failed && 'text-icon-base hover:text-icon-active',
        )}
      >
        <Icon size={11} className={busy ? 'animate-spin' : undefined} />
        {busy ? 'Locating…' : active ? 'My location' : 'Locate me'}
      </button>

      {/* Outside the 44 km study area the marker would be off-map, and the pan
          extent is constrained, so say so rather than appear to do nothing. */}
      {active && !state.insideAoi && (
        <span className="text-warning">outside study area</span>
      )}
      {active && state.insideAoi && state.accuracy !== null && (
        <span className="tnum text-icon-base">±{Math.round(state.accuracy)} m</span>
      )}
      {failed && state.message && (
        <span className="max-w-[320px] truncate text-icon-base" title={state.message}>
          {state.message}
        </span>
      )}
    </div>
  );
}

export function StatusStrip({ stats }: { stats: Stats }) {
  const handle = useMapHandle();
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;

    const onMove = (e: MapBrowserEvent) => {
      const [lon, lat] = toLonLat(e.coordinate);
      setPos([lon!, lat!]);
    };
    const onOut = () => setPos(null);
    const onZoom = () => setZoom(map.getView().getZoom() ?? null);

    map.on('pointermove', onMove);
    map.getViewport().addEventListener('pointerleave', onOut);
    map.on('moveend', onZoom);
    onZoom();

    return () => {
      map.un('pointermove', onMove);
      map.getViewport().removeEventListener('pointerleave', onOut);
      map.un('moveend', onZoom);
    };
  }, [handle]);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border-0 bg-surface-1 px-3 text-icon-base">
      <span className="tnum w-[150px] shrink-0">
        {pos ? `${pos[1].toFixed(4)}°, ${pos[0].toFixed(4)}°` : '—'}
      </span>
      <span className="tnum shrink-0">z{zoom !== null ? zoom.toFixed(1) : '—'}</span>

      <span className="mx-1 h-3 w-px shrink-0 bg-border-1" />
      <LocateButton />

      <span className="ml-auto" />
      <CreditsDialog stats={stats} />
    </footer>
  );
}
