import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  Outlet,
} from '@tanstack/react-router';
import { searchSchema } from './routes/search';
import { AppShell } from './components/AppShell';

/**
 * Code-based routing, one route.
 *
 * Hash history is deliberate: GitHub Pages has no server-side rewrite, so a
 * browser-history deep link like /citycamp-sat-change-detection/?task=TASK-0007
 * works, but any path-based route would 404 on refresh. Hash keeps every
 * shareable link working without a 404.html trick.
 */

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: searchSchema,
  component: AppShell,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
