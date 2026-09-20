import { useEffect, useRef } from 'react';
import type BaseLayer from 'ol/layer/Base';
import type { LayerId } from '@/data/types';
import { getMapHandle, useMapHandle } from '@/map/mapHandle';
import * as registry from '@/map/layerRegistry';
import { useCompareStore } from '@/store/compareStore';
import { clipLayerToBand, type Band } from './scissor';
import { MANAGED_RASTERS, resolveTargetLayer } from './targets';

/**
 * Raster ownership while compare mode is on.
 *
 * MapCanvas stops driving raster visibility the moment `mode !== 'off'` (it
 * has to — both years being visible at once is the entire point, and its
 * year-pair exclusion would fight us). From that moment this hook is the only
 * thing that decides which rasters are visible, and it must hand back a sane
 * map when the user turns compare off.
 *
 * "Sane" is a snapshot taken on the way in, not a guess on the way out. The
 * user may have been looking at land cover at 40% opacity; restoring defaults
 * would quietly throw that away. MapCanvas re-applies its own row state as
 * well once `compareActive` flips back to false, which is harmless — it agrees
 * with the snapshot for every row-backed layer and the snapshot additionally
 * covers `campus-change`, which no panel row fronts.
 */

interface LayerState {
  visible: boolean;
  opacity: number;
}

export function useCompareLayers(): void {
  const handle = useMapHandle();
  const mode = useCompareStore((s) => s.mode);
  const left = useCompareStore((s) => s.left);
  const right = useCompareStore((s) => s.right);

  /** Pre-compare raster state, captured once on entry. */
  const snapshot = useRef<Map<LayerId, LayerState> | null>(null);
  /** Live divider position for the per-frame scissor callbacks. */
  const position = useRef(useCompareStore.getState().position);

  // The divider moves at pointer rate. Routing it through React state would
  // re-run the effect below — and therefore re-attach render listeners — on
  // every pointermove. A ref plus an explicit map.render() is one repaint per
  // move and no re-subscription.
  useEffect(
    () =>
      useCompareStore.subscribe((state, prev) => {
        if (state.position === prev.position) return;
        position.current = state.position;
        getMapHandle()?.map.render();
      }),
    [],
  );

  // ── apply ──
  useEffect(() => {
    if (!handle || mode === 'off') return;

    if (!snapshot.current) {
      const taken = new Map<LayerId, LayerState>();
      for (const id of MANAGED_RASTERS) {
        const layer = registry.get(id);
        if (layer) taken.set(id, { visible: layer.getVisible(), opacity: layer.getOpacity() });
      }
      snapshot.current = taken;
    }

    // Compare mode is a two-layer statement. Anything else on the map muddies
    // it, so every managed raster starts hidden and only targets come back.
    for (const id of MANAGED_RASTERS) registry.setVisible(id, false);

    const detach: Array<() => void> = [];
    const show = (id: LayerId | null, band: (() => Band | null) | null): BaseLayer | null => {
      if (!id) return null;
      const layer = registry.get(id);
      if (!layer) return null;
      layer.setVisible(true);
      // Full opacity on both sides: a comparison between a 65% layer and a
      // 100% layer is a comparison of opacities, not of imagery.
      layer.setOpacity(1);
      if (band) detach.push(clipLayerToBand(layer, band));
      return layer;
    };

    const leftId = resolveTargetLayer(left);
    const rightId = resolveTargetLayer(right);

    if (mode === 'swipe') {
      if (leftId && rightId && leftId !== rightId) {
        show(leftId, () => ({ from: 0, to: position.current }));
        show(rightId, () => ({ from: position.current, to: 1 }));
      } else {
        // Same layer on both sides, or only one side resolved: clipping it
        // against itself would just delete half the map for no reason.
        show(leftId ?? rightId, null);
      }
    } else {
      // sideBySide: the primary map is the LEFT pane only. The right target
      // lives on the secondary map (useSideBySide), which has its own layers.
      show(leftId, null);
    }

    handle.map.render();

    return () => {
      for (const fn of detach) fn();
      handle.map.render();
    };
  }, [handle, mode, left, right]);

  // ── restore ──
  // Separate from the apply effect so that switching swipe <-> sideBySide does
  // not round-trip through the pre-compare state and flash the old map.
  useEffect(() => {
    if (mode !== 'off') return;
    const taken = snapshot.current;
    if (!taken) return;
    snapshot.current = null;
    for (const [id, state] of taken) {
      registry.setVisible(id, state.visible);
      registry.setOpacity(id, state.opacity);
    }
    getMapHandle()?.map.render();
  }, [mode]);

  // Unmounting mid-comparison must not leave the map in compare's layout.
  useEffect(
    () => () => {
      const taken = snapshot.current;
      if (!taken) return;
      snapshot.current = null;
      for (const [id, state] of taken) {
        registry.setVisible(id, state.visible);
        registry.setOpacity(id, state.opacity);
      }
    },
    [],
  );
}
