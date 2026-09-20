import { useCallback, useEffect, useState } from 'react';
import { useMapHandle } from '@/map/mapHandle';

/**
 * Where the map viewport is, expressed in the overlay's own coordinate space.
 *
 * The compare overlay is a normal absolutely-positioned element; the map is an
 * OpenLayers viewport somewhere else in the tree. If the two are mounted as
 * siblings over the same box those coordinates coincide and this returns
 * `{left:0, top:0, …}` — but nothing enforces that, and a swipe divider that is
 * offset by a panel width is both very obvious and very annoying to debug.
 *
 * So the geometry is measured rather than assumed. The cost is one
 * ResizeObserver; the benefit is that the divider lands on the map wherever the
 * overlay is mounted.
 */
export interface MapArea {
  /** Offset of the map viewport from the overlay's top-left, in CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export function useMapArea(overlay: HTMLElement | null, enabled: boolean): MapArea | null {
  const handle = useMapHandle();
  const [area, setArea] = useState<MapArea | null>(null);

  const viewport = handle?.map.getViewport() ?? null;

  const measure = useCallback(() => {
    if (!overlay || !viewport) {
      setArea(null);
      return;
    }
    const mapRect = viewport.getBoundingClientRect();
    const ownRect = overlay.getBoundingClientRect();
    setArea((prev) => {
      const next: MapArea = {
        left: mapRect.left - ownRect.left,
        top: mapRect.top - ownRect.top,
        width: mapRect.width,
        height: mapRect.height,
      };
      // Bail out on an unchanged measurement, or the ResizeObserver and the
      // state update feed each other a new object every frame.
      if (
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
      ) {
        return prev;
      }
      return next;
    });
  }, [overlay, viewport]);

  useEffect(() => {
    if (!enabled || !overlay || !viewport) {
      setArea(null);
      return;
    }
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    observer.observe(viewport);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled, overlay, viewport, measure]);

  return enabled ? area : null;
}

/**
 * Pointer clientX -> fraction across the map viewport, clamped to 0–1.
 * Measured against the map, never against the overlay, because the fraction is
 * what the scissor box is computed from.
 */
export function fractionFromClientX(viewport: HTMLElement, clientX: number): number {
  const rect = viewport.getBoundingClientRect();
  if (rect.width <= 0) return 0.5;
  const raw = (clientX - rect.left) / rect.width;
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}
