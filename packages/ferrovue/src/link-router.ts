import { createMemoryHistory, createRouter, isNavigationFailure, NavigationFailureType, START_LOCATION, type RouteLocationNormalized, type Router, type RouterHistory } from "vue-router";
import { routeRecords, type RouteEntry } from "./routes.ts";

export { routeRecords, type RouteEntry } from "./routes.ts";

/** What `linkRouter` hands navigations to, and the router options of `ferrovue.config.json`. */
export interface LinkRouterOptions {
  /** The application's own navigation, called with the `href` of every navigation after the first
   * (the base included, as the link's `href` attribute has it) and the route it resolves to. */
  navigate: (href: string, to: RouteLocationNormalized) => void;
  /** The history's base, as `router.base` in `ferrovue.config.json` gives it. */
  base?: string;
  /** As `router.linkActiveClass` in `ferrovue.config.json`. */
  linkActiveClass?: string;
  /** As `router.linkExactActiveClass` in `ferrovue.config.json`. */
  linkExactActiveClass?: string;
  /** The location of the page the router is for, as an `href` with the base (the one `navigate`
   * is given): the page a navigation goes to, which the browser's location is not yet. The
   * browser's location by default. */
  location?: string;
  /** The history the router reads its first location from. By default a memory history at
   * `location`: the router neither writes to the browser's history nor listens to it. */
  history?: RouterHistory;
}

const Empty = { render: () => null };

function pageHistory(base: string | undefined, location: string | undefined): RouterHistory {
  const history = createMemoryHistory(base);
  const href = location ?? window.location.pathname + window.location.search + window.location.hash;
  const end = href.search(/[?#]/);
  const pathname = end < 0 ? href : href.slice(0, end);
  const rest = end < 0 ? "" : href.slice(end);
  const prefix = history.base;
  const path = prefix && pathname.toLowerCase().startsWith(prefix.toLowerCase()) ? pathname.slice(prefix.length) || "/" : pathname;
  history.replace(path + rest);
  return history;
}

/** A router for `<RouterLink>` and `useRoute()` alone, for an application whose own navigation
 * layer leaves the page: built from the routes file the compiler reads, every route rendering
 * nothing. Its first navigation resolves the page the server rendered; every later one, a link's
 * click included, is handed to `navigate` and aborted, so the router stays on that page. Build one
 * for each page the application shows. */
export function linkRouter(routes: RouteEntry[], options: LinkRouterOptions): Router {
  const history = options.history ?? pageHistory(options.base, options.location);
  const router = createRouter({
    history,
    routes: routeRecords(routes, Empty),
    ...(options.linkActiveClass !== undefined ? { linkActiveClass: options.linkActiveClass } : {}),
    ...(options.linkExactActiveClass !== undefined ? { linkExactActiveClass: options.linkExactActiveClass } : {}),
  });
  router.beforeEach((to, from) => {
    if (from === START_LOCATION) return true;
    options.navigate(history.createHref(to.fullPath), to);
    return false;
  });
  router.afterEach((to, _from, failure) => {
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) options.navigate(history.createHref(to.fullPath), to);
  });
  return router;
}
