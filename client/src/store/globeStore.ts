import { create } from 'zustand';
import type { GlobePointProps } from '@/data/types';

/**
 * Which GLOBE site's photo gallery is open.
 *
 * Keyed by SITE, not by observation id. Every GLOBE observation in this study
 * area was recorded at one site (17RLN604829) at the exact same coordinate, so
 * all ten render as a single dot — clicking could never identify one of them.
 * Opening the whole site and listing its visits is both correct and what a
 * volunteer returning to that spot actually wants to see.
 *
 * `fallback` carries the clicked feature's properties so the dialog can show
 * the site and date while the live API request is in flight, or if that site
 * turns out to have no published photos.
 */
interface GlobeState {
  openSite: string | null;
  fallback: GlobePointProps | null;
  open: (site: string, fallback: GlobePointProps) => void;
  close: () => void;
}

export const useGlobeStore = create<GlobeState>((set) => ({
  openSite: null,
  fallback: null,
  open: (openSite, fallback) => set({ openSite, fallback }),
  close: () => set({ openSite: null, fallback: null }),
}));
