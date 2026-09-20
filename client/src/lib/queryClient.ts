import { QueryClient } from '@tanstack/react-query';

/**
 * Every query in this app reads a static file produced once by the pipeline.
 * Nothing changes within a session, so the global defaults disable the
 * background refetching that would otherwise re-request a 24 MB COG sidecar
 * whenever the tab regains focus mid-demo.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});
