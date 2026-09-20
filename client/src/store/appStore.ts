import { create } from 'zustand';
import { DEFAULT_LAYER_ROWS } from '@/data/constants';
import type { BasemapId, LayerGroup, LayerRowId, LayerRowState } from '@/data/types';

/**
 * CLIENT state only — things the user manipulates.
 *
 * Fetched data (stats, legend, tasks, availability) belongs to React Query, not
 * here. See data/queries.ts for the split. Mixing the two is what makes map
 * config drift out of sync with the data it was derived from.
 *
 * This store is the single source of truth for layer *configuration*. The
 * OpenLayers map reads from it; it never reads from the map. Anything that
 * needs a live OL object goes through `map/layerRegistry`.
 *
 * OWNERSHIP: Stream A. Stream B reads it freely but should not add fields
 * without saying so; Stream D uses `compareStore` instead.
 */

export type ToolId = 'pan' | 'measure-line' | 'measure-area' | 'pin';

interface AppState {
  // ── layers ──
  rows: LayerRowState[];
  setVisible: (id: LayerRowId, visible: boolean) => void;
  toggleVisible: (id: LayerRowId) => void;
  setOpacity: (id: LayerRowId, opacity: number) => void;
  setYear: (id: LayerRowId, year: 2017 | 2024) => void;
  moveRow: (id: LayerRowId, direction: -1 | 1) => void;
  /**
   * Drag-reorder within a group. Indices are positions in the group's
   * TOP-FIRST display order, which is the reverse of render order.
   */
  reorderGroup: (group: LayerGroup, fromIndex: number, toIndex: number) => void;
  markUnavailable: (ids: LayerRowId[]) => void;

  // ── basemap ──
  basemap: BasemapId;
  setBasemap: (b: BasemapId) => void;

  /** Sentinel-2 composite: false = true colour (RGB), true = false colour (CIR). */
  falseColor: boolean;
  setFalseColor: (v: boolean) => void;

  /**
   * Sentinel-2 radiometry. Off (default) puts both years on one shared linear
   * reflectance scale so they can be compared; on restores the per-scene 2–98%
   * stretch baked in at export, which has more contrast but a different mapping
   * for each year.
   */
  percentileStretch: boolean;
  setPercentileStretch: (v: boolean) => void;

  // ── change threshold ──
  threshold: number;
  setThreshold: (t: number) => void;
  /**
   * Seed the threshold from stats.change.slider_default once it loads, but
   * never clobber a value the user has already dragged to — which matters
   * because a shared URL hydrates the threshold before stats resolve.
   */
  thresholdTouched: boolean;
  initThreshold: (t: number) => void;

  // ── tools ──
  tool: ToolId;
  setTool: (t: ToolId) => void;

  // ── panels ──
  leftOpen: boolean;
  toggleLeft: () => void;
  /** The verification queue is an on-demand overlay, not a layout column. */
  queueOpen: boolean;
  toggleQueue: () => void;
  setQueueOpen: (v: boolean) => void;
  /** Legend floats over the map bottom-right; collapsible to its header. */
  legendOpen: boolean;
  toggleLegend: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  rows: DEFAULT_LAYER_ROWS.map((r) => ({ ...r })),

  setVisible: (id, visible) =>
    set((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, visible } : r)) })),

  toggleVisible: (id) =>
    set((s) => ({
      rows: s.rows.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r)),
    })),

  setOpacity: (id, opacity) =>
    set((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, opacity } : r)) })),

  setYear: (id, year) =>
    set((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, year } : r)) })),

  /**
   * Reorder within a group only. Groups occupy disjoint z-bands, so a layer can
   * never be dragged out of its band and bury the map under the basemap.
   */
  moveRow: (id, direction) =>
    set((s) => {
      const row = s.rows.find((r) => r.id === id);
      if (!row) return s;
      const siblings = s.rows
        .filter((r) => r.group === row.group)
        .sort((a, b) => a.order - b.order);
      const i = siblings.findIndex((r) => r.id === id);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= siblings.length) return s;
      const a = siblings[i]!;
      const b = siblings[j]!;
      return {
        rows: s.rows.map((r) => {
          if (r.id === a.id) return { ...r, order: b.order };
          if (r.id === b.id) return { ...r, order: a.order };
          return r;
        }),
      };
    }),

  reorderGroup: (group, fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex) return s;
      // Display order is top-first; render order is bottom-first.
      const topFirst = s.rows
        .filter((r) => r.group === group)
        .sort((a, b) => b.order - a.order);
      if (fromIndex < 0 || toIndex < 0) return s;
      if (fromIndex >= topFirst.length || toIndex >= topFirst.length) return s;

      const moved = topFirst.slice();
      const [item] = moved.splice(fromIndex, 1);
      if (!item) return s;
      moved.splice(toIndex, 0, item);

      // Reassign order so index 0 (top of the list) gets the highest order.
      const orderById = new Map<LayerRowId, number>();
      moved.forEach((r, i) => orderById.set(r.id, moved.length - 1 - i));

      return {
        rows: s.rows.map((r) =>
          orderById.has(r.id) ? { ...r, order: orderById.get(r.id)! } : r,
        ),
      };
    }),

  markUnavailable: (ids) =>
    set((s) => ({
      rows: s.rows.map((r) =>
        ids.includes(r.id) ? { ...r, unavailable: true, visible: false } : r,
      ),
    })),

  basemap: 'dark',
  setBasemap: (basemap) => set({ basemap }),

  falseColor: false,
  setFalseColor: (falseColor) => set({ falseColor }),

  percentileStretch: false,
  setPercentileStretch: (percentileStretch) => set({ percentileStretch }),

  // Placeholder until stats.change.slider_default arrives — which equals the
  // L4 gate, so the default view shows exactly the pixels that built the queue.
  threshold: 0.4,
  thresholdTouched: false,
  setThreshold: (threshold) => set({ threshold, thresholdTouched: true }),
  initThreshold: (threshold) =>
    set((s) => (s.thresholdTouched ? s : { threshold, thresholdTouched: false })),

  tool: 'pan',
  setTool: (tool) => set({ tool }),

  leftOpen: true,
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),

  queueOpen: false,
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  setQueueOpen: (queueOpen) => set({ queueOpen }),

  legendOpen: true,
  toggleLegend: () => set((s) => ({ legendOpen: !s.legendOpen })),
}));

/**
 * Rows of one group, in render order (lowest first).
 *
 * MUST be wrapped in useShallow at the call site:
 *
 *   const rows = useAppStore(useShallow(selectGroup('overlay')));
 *
 * It builds a new array every call, so zustand's default reference equality would
 * see a change on every render and loop forever with "Maximum update depth
 * exceeded". The row objects are stable, so a shallow compare is correct.
 */
export const selectGroup = (group: LayerRowState['group']) => (s: AppState) =>
  s.rows.filter((r) => r.group === group).sort((a, b) => a.order - b.order);
