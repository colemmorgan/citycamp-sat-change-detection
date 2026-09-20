import { useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { MapSearch } from '@/routes/search';
import { useCompareStore } from '@/store/compareStore';

/**
 * Compare state <-> URL (`cmp`, `cpos`), so a comparison is a shareable link.
 *
 * The rule from plans/04 §3, which is what stops this becoming a feedback loop:
 *
 *   ONE-TIME READ  — hydrate the store from the URL once, on mount.
 *   ONE-WAY WRITE  — after that only the store writes to the URL.
 *   THROTTLE + REPLACE — the divider moves at pointer rate; pushing a history
 *   entry per pointermove would make the back button useless.
 *
 * It reads the URL through `useRouter()` rather than `useSearch()` on purpose.
 * `useSearch` subscribes, so every centre/zoom commit from the map would
 * re-render the compare overlay for no reason — and the overlay is on top of a
 * live map. The router instance gives the same data with no subscription.
 */

const WRITE_INTERVAL_MS = 300;

export function useCompareUrl(): void {
  const router = useRouter();
  const hydrated = useRef(false);

  // ── read, once ──
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const search = router.state.location.search as Partial<MapSearch>;
    const { setMode, setPosition } = useCompareStore.getState();

    if (search.cmp && search.cmp !== 'off') setMode(search.cmp);
    // Applied even without `cmp` so that a link can pre-seed the divider, and
    // clamped by the store's own setter.
    if (typeof search.cpos === 'number') setPosition(search.cpos);
  }, [router]);

  // ── write, throttled ──
  useEffect(() => {
    let timer: number | undefined;

    const commit = () => {
      timer = undefined;
      const { mode, position } = useCompareStore.getState();
      void router.navigate({
        to: '/',
        search: (prev: MapSearch): MapSearch => ({
          ...prev,
          // Absent rather than "off": a link to the normal map should look
          // like a link to the normal map.
          cmp: mode === 'off' ? undefined : mode,
          // 3 dp is ~1px on a 1000px viewport — past that it is just noise in
          // the URL bar.
          cpos: mode === 'swipe' ? Number(position.toFixed(3)) : undefined,
        }),
        replace: true,
      });
    };

    const schedule = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(commit, WRITE_INTERVAL_MS);
    };

    const unsubscribe = useCompareStore.subscribe((state, prev) => {
      if (!hydrated.current) return;
      if (state.mode === prev.mode && state.position === prev.position) return;
      schedule();
    });

    return () => {
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [router]);
}
