import { create } from 'zustand';
import type { LayerId } from '@/data/types';

/**
 * COMPARE MODE.
 *
 * OWNERSHIP: Stream D owns this file and everything under src/compare/.
 * Stream A defined the interface but will not implement it — the shape here is
 * the contract between the two.
 *
 * Three modes:
 *  - off        : normal map
 *  - swipe      : both targets rendered in one view, split by a draggable divider
 *  - sideBySide : two synchronised OL views, one target each
 *
 * IMPLEMENTATION NOTE for swipe: every raster here is a WebGLTile layer, so the
 * familiar canvas `prerender` + `ctx.clip()` recipe does NOT work. WebGL layers
 * need gl.enable(gl.SCISSOR_TEST) + gl.scissor(...) in `prerender` and
 * gl.disable(...) in `postrender`, with devicePixelRatio applied manually.
 */

/** What one side of the comparison shows. */
export type CompareTarget =
  | { kind: 'year'; year: 2017 | 2024 }
  | { kind: 'layer'; id: LayerId };

export type CompareMode = 'off' | 'swipe' | 'sideBySide';

interface CompareState {
  mode: CompareMode;
  setMode: (m: CompareMode) => void;

  left: CompareTarget;
  right: CompareTarget;
  setLeft: (t: CompareTarget) => void;
  setRight: (t: CompareTarget) => void;
  swap: () => void;

  /** Divider position, 0–1 across the viewport. Only meaningful in 'swipe'. */
  position: number;
  setPosition: (p: number) => void;

  /** Keep the two views' centre/zoom locked in 'sideBySide'. */
  syncViews: boolean;
  setSyncViews: (v: boolean) => void;
}

export const useCompareStore = create<CompareState>((set, get) => ({
  mode: 'off',
  setMode: (mode) => set({ mode }),

  left: { kind: 'year', year: 2017 },
  right: { kind: 'year', year: 2024 },
  setLeft: (left) => set({ left }),
  setRight: (right) => set({ right }),
  swap: () => set({ left: get().right, right: get().left }),

  position: 0.5,
  setPosition: (position) => set({ position: Math.min(1, Math.max(0, position)) }),

  syncViews: true,
  setSyncViews: (syncViews) => set({ syncViews }),
}));
