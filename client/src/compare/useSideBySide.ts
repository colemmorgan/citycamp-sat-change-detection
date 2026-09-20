import { useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import type WebGLTileLayer from 'ol/layer/WebGLTile';
import { defaults as defaultInteractions } from 'ol/interaction';
import { VIEW } from '@/data/constants';
import type { LayerId, TransitionLegend } from '@/data/types';
import { useMapHandle } from '@/map/mapHandle';
import { useAppStore } from '@/store/appStore';
import { useCompareStore } from '@/store/compareStore';
import { createCompareBasemap, createCompareRaster, usesThreshold } from './compareLayers';
import { resolveTargetLayer } from './targets';

/**
 * The second map, for side-by-side.
 *
 * Swipe needs one view; side-by-side needs two, because `syncViews: false` is
 * meaningless otherwise. So this builds a real second ol/Map over the right
 * half of the map area and leaves the primary map showing the left target.
 *
 * TWO NON-OBVIOUS PARTS
 *
 * 1. The primary map keeps its full width — MapCanvas owns that element and we
 *    do not resize it. Its viewport centre would therefore sit underneath the
 *    right pane, putting the left target's centre off-screen. `View#padding` is
 *    the built-in fix: padding `[0, paneWidth, 0, 0]` tells the view that the
 *    right `paneWidth` pixels are covered, and it re-centres on the visible
 *    remainder. Setting it also shifts the centre so nothing jumps.
 *
 * 2. An OpenLayers layer can only be on one map, so the right pane gets its own
 *    instances (compareLayers.ts) rather than borrowing from layerRegistry.
 *    Exactly one raster is built, because each WebGLTile layer costs a WebGL
 *    context and browsers cap those near 16.
 */

const NO_PADDING = [0, 0, 0, 0];

export function useSideBySide(
  pane: HTMLDivElement | null,
  enabled: boolean,
  legend: TransitionLegend | undefined,
): void {
  const handle = useMapHandle();
  const right = useCompareStore((s) => s.right);
  const syncViews = useCompareStore((s) => s.syncViews);
  const basemap = useAppStore((s) => s.basemap);
  const threshold = useAppStore((s) => s.threshold);

  const [secondary, setSecondary] = useState<Map | null>(null);
  const rasterRef = useRef<WebGLTileLayer | null>(null);

  // `right` is an object; resolving it to a layer id first keeps the build
  // effect from tearing down and rebuilding the map on an identical selection.
  const rightId: LayerId | null = enabled ? resolveTargetLayer(right) : null;

  // ── build / tear down the second map ──
  useEffect(() => {
    if (!enabled || !pane || !handle || !legend) return;

    const primaryView = handle.map.getView();

    // Re-centre the primary view on the half of itself that stays visible.
    // Must happen before the secondary view copies the centre, or the two
    // panes open looking at different places.
    const applyPadding = () => {
      primaryView.padding = [0, pane.getBoundingClientRect().width, 0, 0];
    };
    applyPadding();

    const view = new View({
      projection: VIEW.projection,
      center: primaryView.getCenter() ?? [...VIEW.center],
      resolution: primaryView.getResolution(),
      rotation: primaryView.getRotation(),
      minZoom: VIEW.minZoom,
      maxZoom: VIEW.maxZoom,
      extent: [...VIEW.extent],
      constrainOnlyCenter: VIEW.constrainOnlyCenter,
      showFullExtent: VIEW.showFullExtent,
      constrainResolution: false,
    });

    const raster = rightId ? createCompareRaster(rightId, legend, threshold) : null;
    rasterRef.current = raster;

    const map = new Map({
      target: pane,
      view,
      layers: raster ? [createCompareBasemap(basemap), raster] : [createCompareBasemap(basemap)],
      // No controls at all: the primary map already draws the app's chrome and
      // OL's defaults are light-themed.
      controls: [],
      interactions: defaultInteractions({
        doubleClickZoom: true,
        altShiftDragRotate: false,
        pinchRotate: false,
      }),
      moveTolerance: 2,
    });
    setSecondary(map);

    // The pane is sized as a fraction of the map area, so a window resize or a
    // side panel opening changes both the pane and the primary view's padding.
    const observer = new ResizeObserver(() => {
      applyPadding();
      map.updateSize();
    });
    observer.observe(pane);

    return () => {
      observer.disconnect();
      setSecondary(null);
      rasterRef.current = null;
      map.setTarget(undefined);
      map.dispose();
      primaryView.padding = [...NO_PADDING];
    };
    // `threshold` and `basemap` are read at build time; they are kept current
    // by the two effects below rather than by rebuilding the map (which would
    // cost a WebGL context churn on every slider tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pane, handle, legend, rightId, basemap]);

  // ── keep the two views locked ──
  useEffect(() => {
    if (!secondary || !handle || !syncViews) return;

    const a = handle.map.getView();
    const b = secondary.getView();
    let applying = false;

    const copy = (from: View, to: View) => {
      if (applying) return;
      applying = true;
      const center = from.getCenter();
      const resolution = from.getResolution();
      if (center) to.setCenter(center);
      if (resolution !== undefined) to.setResolution(resolution);
      to.setRotation(from.getRotation());
      applying = false;
    };

    const fromA = () => copy(a, b);
    const fromB = () => copy(b, a);
    const events = ['change:center', 'change:resolution', 'change:rotation'] as const;

    // Adopt the primary view first, so enabling sync snaps the right pane to
    // the left one rather than the other way round.
    fromA();
    for (const type of events) {
      a.on(type, fromA);
      b.on(type, fromB);
    }

    return () => {
      for (const type of events) {
        a.un(type, fromA);
        b.un(type, fromB);
      }
    };
  }, [secondary, handle, syncViews]);

  // ── threshold slider reaches the second map too ──
  useEffect(() => {
    if (!secondary || !rightId || !usesThreshold(rightId)) return;
    // A uniform update, not a shader recompile — safe per frame.
    rasterRef.current?.updateStyleVariables({ t: threshold });
  }, [secondary, rightId, threshold]);
}
