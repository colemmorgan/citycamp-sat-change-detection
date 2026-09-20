import { useEffect, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { toLonLat, fromLonLat } from 'ol/proj';
import { useAppStore } from '@/store/appStore';
import { useTasksStore } from '@/store/tasksStore';
import { useMapHandle } from '@/map/mapHandle';
import { encodeCenter, parseCenter, decodeLayers, encodeLayers } from '@/routes/search';
import type { LayerRowId } from '@/data/types';

/**
 * Map state <-> URL.
 *
 * Makes every view a shareable link:
 *   ?c=-82.31,29.66&z=13.4&t=0.41&b=dark&l=change,transitions&task=TASK-0007
 *
 * Two rules, both load-bearing:
 *
 *  1. ONE-WAY WRITE, ONE-TIME READ. The URL is hydrated into the store exactly
 *     once on mount; after that only the store writes to the URL. Binding both
 *     directions produces a feedback loop that is miserable to debug.
 *
 *  2. THROTTLE AND REPLACE. Centre and zoom commit on OL's `moveend`, never per
 *     frame, and always with `replace: true` — otherwise every pan pushes a
 *     history entry and the back button becomes unusable.
 *
 * Only the keys owned here are written, using the functional updater so that
 * compare mode's own params (`cmp`, `cpos`) are never clobbered.
 */
export function useMapUrlSync() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const handle = useMapHandle();
  const hydrated = useRef(false);

  const threshold = useAppStore((s) => s.threshold);
  const basemap = useAppStore((s) => s.basemap);
  const rows = useAppStore((s) => s.rows);
  const selectedId = useTasksStore((s) => s.selectedId);

  // ── hydrate once ──
  useEffect(() => {
    if (hydrated.current || !handle) return;
    hydrated.current = true;

    const s = search as Record<string, unknown>;
    const store = useAppStore.getState();

    if (typeof s.t === 'number') store.setThreshold(s.t);
    if (s.b === 'dark' || s.b === 'sat') store.setBasemap(s.b);

    if (typeof s.l === 'string') {
      const want = new Set(decodeLayers(s.l));
      for (const row of store.rows) store.setVisible(row.id, want.has(row.id));
    }

    const center = parseCenter(typeof s.c === 'string' ? s.c : undefined);
    const view = handle.map.getView();
    if (center) view.setCenter(fromLonLat(center));
    if (typeof s.z === 'number') view.setZoom(s.z);

    // Restore the selection so the task's polygon is still highlighted, but do
    // NOT open the queue. `task` is written to the URL on every selection, so
    // it survives a reload of one's own session — auto-opening here meant the
    // panel reappeared on every refresh once any task had ever been clicked.
    // The queue stays a deliberate action: the top-bar toggle, or a task click.
    if (typeof s.task === 'string') {
      useTasksStore.getState().select(s.task);
    }
    // Mount-only hydration by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  // ── store -> URL for discrete state (commits immediately) ──
  useEffect(() => {
    if (!hydrated.current) return;
    const visible = rows.filter((r) => r.visible && !r.unavailable).map((r) => r.id as LayerRowId);
    navigate({
      to: '.',
      replace: true,
      search: (prev) => ({
        ...prev,
        t: Number(threshold.toFixed(4)),
        b: basemap,
        l: encodeLayers(visible),
        task: selectedId ?? undefined,
      }),
    });
  }, [threshold, basemap, rows, selectedId, navigate]);

  // ── map -> URL for centre/zoom (commits on moveend only) ──
  useEffect(() => {
    if (!handle) return;
    const { map } = handle;

    const onMoveEnd = () => {
      if (!hydrated.current) return;
      const view = map.getView();
      const c = view.getCenter();
      const z = view.getZoom();
      if (!c || z === undefined) return;
      const [lon, lat] = toLonLat(c);
      navigate({
        to: '.',
        replace: true,
        search: (prev) => ({
          ...prev,
          c: encodeCenter(lon as number, lat as number),
          z: Number(z.toFixed(1)),
        }),
      });
    };

    map.on('moveend', onMoveEnd);
    return () => map.un('moveend', onMoveEnd);
  }, [handle, navigate]);
}
