import { useQuery, useQueries, type UseQueryResult } from '@tanstack/react-query';
import { ASSETS, dataUrl } from './paths';
import { probeAssets } from './loader';
import { fetchGlobeObservations, type GlobeObservation } from './globeApi';
import type {
  AssetAvailability,
  CampusTargetProps,
  S2Meta,
  S2MetaPair,
  Stats,
  TaskProps,
  TransitionLegend,
} from './types';

/**
 * Server state lives here; client state lives in zustand.
 *
 *   React Query  →  anything fetched from public/data (stats, legend, tasks,
 *                   availability). Cached, deduped, retried, shared across
 *                   components without prop drilling.
 *   Zustand      →  anything the user manipulates (layer visibility, opacity,
 *                   threshold, active tool, selection, verified set).
 *
 * Keeping the two apart is what stops the map config and the fetched data from
 * drifting out of sync during a re-render.
 *
 * Every asset is a static file generated once by the pipeline, so nothing here
 * is ever stale within a session. Refetching on window focus would cause a
 * 24 MB re-request storm the moment a judge alt-tabs away and back.
 */
const STATIC = {
  staleTime: Infinity,
  gcTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: 1,
} as const;

export const queryKeys = {
  stats: ['stats'] as const,
  legend: ['legend'] as const,
  availability: ['availability'] as const,
  tasks: ['tasks'] as const,
  campusTargets: ['campus-targets'] as const,
  globeObservations: ['globe-observations'] as const,
  s2Meta: ['s2-meta'] as const,
};

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** FeatureCollection -> just the properties, which is all the UI needs. */
async function getFeatureProps<T>(file: string): Promise<T[]> {
  const fc = await getJson<{ features: Array<{ properties: T }> }>(file);
  return fc.features.map((f) => f.properties);
}

export const useStats = (): UseQueryResult<Stats> =>
  useQuery({ queryKey: queryKeys.stats, queryFn: () => getJson<Stats>(ASSETS.stats), ...STATIC });

export const useLegend = (): UseQueryResult<TransitionLegend> =>
  useQuery({
    queryKey: queryKeys.legend,
    queryFn: () => getJson<TransitionLegend>(ASSETS.legend),
    ...STATIC,
  });

/**
 * Which assets actually exist. HEAD requests only — never fetch() a .tif for
 * pixels; ol/source/GeoTIFF uses range requests and a full fetch would pull the
 * entire file.
 */
export const useAvailability = (): UseQueryResult<AssetAvailability> =>
  useQuery({ queryKey: queryKeys.availability, queryFn: probeAssets, ...STATIC });

export const useTasks = (enabled = true): UseQueryResult<TaskProps[]> =>
  useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => getFeatureProps<TaskProps>(ASSETS.tasks),
    enabled,
    ...STATIC,
  });

export const useCampusTargets = (enabled = true): UseQueryResult<CampusTargetProps[]> =>
  useQuery({
    queryKey: queryKeys.campusTargets,
    queryFn: () => getFeatureProps<CampusTargetProps>(ASSETS.campusTargets),
    enabled,
    ...STATIC,
  });

/**
 * Live GLOBE observations, keyed by pid.
 *
 * NOT part of the STATIC group: this is the one query whose answer changes
 * while the app is open. Someone uploading photos from the field should be able
 * to refresh and see them, so it carries a short staleTime and an explicit
 * refetch rather than being cached forever.
 */
export function useGlobeObservations() {
  return useQuery({
    queryKey: queryKeys.globeObservations,
    queryFn: ({ signal }) => fetchGlobeObservations(signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    /**
     * Grouped by SITE. Every observation in this study area shares one site and
     * one exact coordinate, so the map shows a single dot for all of them —
     * the gallery has to open the site, not an individual observation.
     */
    select: (list) => {
      const bySite = new Map<string, GlobeObservation[]>();
      for (const o of list) {
        const key = o.siteName ?? o.pid;
        const arr = bySite.get(key);
        if (arr) arr.push(o);
        else bySite.set(key, [o]);
      }
      for (const arr of bySite.values()) {
        arr.sort((a, b) => b.measuredDate.localeCompare(a.measuredDate));
      }
      return { list, bySite };
    },
  });
}

/**
 * The three things the map cannot be built without.
 *
 * Returned as one object so MapCanvas has a single "ready" condition rather
 * than three independent loading states to reconcile.
 */
export function useBootstrap() {
  const results = useQueries({
    queries: [
      { queryKey: queryKeys.stats, queryFn: () => getJson<Stats>(ASSETS.stats), ...STATIC },
      {
        queryKey: queryKeys.legend,
        queryFn: () => getJson<TransitionLegend>(ASSETS.legend),
        ...STATIC,
      },
      { queryKey: queryKeys.availability, queryFn: probeAssets, ...STATIC },
      { queryKey: queryKeys.s2Meta, queryFn: getS2Meta, ...STATIC },
    ],
  });

  const [stats, legend, availability, s2Meta] = results;

  return {
    stats: stats?.data as Stats | undefined,
    legend: legend?.data as TransitionLegend | undefined,
    available: availability?.data as AssetAvailability | undefined,
    s2Meta: s2Meta?.data as S2MetaPair | undefined,
    isLoading: results.some((r) => r.isLoading),
    error: (results.find((r) => r.error)?.error ?? null) as Error | null,
    isReady: Boolean(stats?.data && legend?.data && availability?.data),
  };
}

/**
 * The two Sentinel-2 sidecars.
 *
 * Not fatal if missing — the imagery still renders, just without the option to
 * undo the per-scene stretch. So this resolves to undefined rather than
 * throwing and taking the whole bootstrap down with it.
 */
async function getS2Meta(): Promise<S2MetaPair | undefined> {
  try {
    const [a, b] = await Promise.all([
      getJson<S2Meta>(ASSETS.s2_2017_meta),
      getJson<S2Meta>(ASSETS.s2_2024_meta),
    ]);
    return { 2017: a, 2024: b };
  } catch {
    return undefined;
  }
}
