import { useEffect, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { useCompareStore } from '@/store/compareStore';
import { createMap, type MapHandle } from '@/map/createMap';
import { applyThreshold } from '@/map/rasterLayers';
import { setMapHandle } from '@/map/mapHandle';
import * as registry from '@/map/layerRegistry';
import type {
  AssetAvailability,
  LayerId,
  LayerRowState,
  S2MetaPair,
  Stats,
  TransitionLegend,
} from '@/data/types';

/**
 * The React <-> OpenLayers boundary.
 *
 * The map is created once in a mount effect and stored in a ref. Every
 * subsequent change is pushed into OL imperatively by a small effect watching
 * one slice of store state. React never renders OL and never holds a layer.
 *
 * StrictMode double-invokes effects in development; the guard below means the
 * second invocation reuses the existing map instead of building a second one
 * (which would strand a WebGL context per layer).
 */

/** Which OL layer instances a panel row fronts, given its current year. */
function layersForRow(row: LayerRowState): LayerId[] {
  switch (row.id) {
    case 'imagery':
      return [row.year === 2017 ? 's2-2017' : 's2-2024'];
    case 'lulc':
      return [row.year === 2017 ? 'lulc-2017' : 'lulc-2024'];
    case 'change':
      return ['change'];
    case 'transitions':
      return ['transitions'];
    case 'protected':
      return ['protected'];
    case 'globe':
      return ['globe'];
    case 'tasks':
      return ['tasks'];
    case 'aoi':
      return ['aoi'];
    default:
      return [];
  }
}

/**
 * Every layer instance a row owns, active or not.
 *
 * Used for z-order and opacity, which must apply to BOTH halves of a
 * year pair — otherwise reordering a row moves only the currently visible year
 * and the two halves drift apart in the stack.
 */
function allLayersForRow(row: LayerRowState): LayerId[] {
  if (row.id === 'imagery') return ['s2-2017', 's2-2024'];
  if (row.id === 'lulc') return ['lulc-2017', 'lulc-2024'];
  return layersForRow(row);
}

interface Props {
  stats: Stats;
  legend: TransitionLegend;
  available: AssetAvailability;
  s2Meta?: S2MetaPair;
}

export function MapCanvas({ stats, legend, available, s2Meta }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<MapHandle | null>(null);

  const rows = useAppStore((s) => s.rows);
  const basemap = useAppStore((s) => s.basemap);
  const threshold = useAppStore((s) => s.threshold);
  // While compare mode owns the raster layers, this component stops driving
  // their visibility. The single hand-off point between Stream A and Stream D.
  const compareActive = useCompareStore((s) => s.mode !== 'off');

  // ── build once ──
  useEffect(() => {
    if (!containerRef.current || handleRef.current) return;

    const handle = createMap(
      containerRef.current,
      { stats, legend, available, s2Meta },
      useAppStore.getState().threshold,
    );
    handleRef.current = handle;
    // Publish for tools (Stream C) and compare mode (Stream D).
    setMapHandle(handle);

    // Dev-only escape hatch for debugging and browser-driven checks. OL
    // composites WebGL layers into one canvas, so layer state is not otherwise
    // inspectable from the DOM.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__map = handle;
    }

    return () => {
      setMapHandle(null);
      handle.dispose();
      registry.clear();
      handleRef.current = null;
    };
    // Mount-only by design: rebuilding the map would strand a WebGL context
    // per layer. `stats`/`legend`/`available` are immutable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── visibility, opacity, z-order, year pairs ──
  useEffect(() => {
    if (!handleRef.current) return;
    for (const row of rows) {
      const active = layersForRow(row);
      const owned = allLayersForRow(row);

      // Order and opacity apply to every layer the row owns, so both halves of
      // a year pair stay locked together in the stack.
      for (const id of owned) {
        registry.setOpacity(id, row.opacity);
        registry.setOrder(id, row.group, row.order);
      }

      // Visibility is the active half only — UNLESS compare mode is on, which
      // by definition needs both years rendered at once and manages their
      // visibility itself. (Stream D.)
      if (compareActive) continue;
      for (const id of owned) {
        registry.setVisible(id, active.includes(id) && row.visible && !row.unavailable);
      }
    }
  }, [rows, compareActive]);

  // ── basemap ──
  useEffect(() => {
    if (!handleRef.current) return;
    registry.setVisible('basemap-dark', basemap === 'dark');
    registry.setVisible('basemap-sat', basemap === 'sat');
  }, [basemap]);

  // ── threshold: a uniform update, safe to fire per frame ──
  useEffect(() => {
    if (!handleRef.current) return;
    applyThreshold(handleRef.current.rasters, threshold);
  }, [threshold]);

  return <div ref={containerRef} className="absolute inset-0 bg-surface-0" />;
}
