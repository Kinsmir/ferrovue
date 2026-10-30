import { createSSRApp, type App, type Component } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createMemoryHistory, createRouter, createWebHistory, type RouteLocationNormalizedLoaded, type Router, type RouterHistory } from "vue-router";
import { createHead } from "@unhead/vue/client";
import { hydrateState, mountIslands, mountPage, readPage, renderPage, type Islands } from "ferrovue";
import islands from "ferrovue/islands";
import { linkRoutes, type LinkRoutes } from "ferrovue/link-routes";
import { routeRecords } from "ferrovue/route-records";
import pageRoutes from "ferrovue/routes";
import BasketSummary from "./components/BasketSummary.vue";

const LINKS = { linkActiveClass: "active", linkExactActiveClass: "active" };
const Picks = (): Promise<{ default: Component }> => import("./pages/picks.vue");

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const ServerPage: Component = { render: () => null };
  return createRouter({ history, routes: routeRecords(pageRoutes, ServerPage), ...LINKS });
}

function atLocation(location: string): RouterHistory {
  const history = createMemoryHistory();
  history.replace(location);
  return history;
}

export interface Hydrated {
  pinia: Pinia;
  route: RouteLocationNormalizedLoaded;
  islands: Islands;
  page?: App | undefined;
  show: (href: string) => Promise<void>;
  unmount(): void;
}

export async function hydrate(location?: string): Promise<Hydrated> {
  const pinia = createPinia();
  hydrateState(pinia);
  const head = createHead();
  const paged = document.getElementById("__fv_page") !== null;

  const pageLinks = (at: string | undefined): LinkRoutes =>
    linkRoutes(pageRoutes, {
      ...LINKS,
      ...(at ? { location: at } : {}),
      navigate: (href, to) => void (to.name === "/picks" ? follow(href) : window.location.assign(href)),
    });

  const links = paged ? pageLinks(location) : undefined;
  const router = links ? undefined : createAppRouter(location === undefined ? undefined : atLocation(location));
  await router?.replace(router.options.history.location);

  const basket = document.getElementById("basket");
  const summary = basket ? createSSRApp(BasketSummary, { label: "Basket" }).use(pinia) : null;
  summary?.mount(basket!);

  const page = links ? await mountPage(Picks, islands, { pinia, plugins: [head, links] }) : undefined;
  const hydrated: Hydrated = {
    pinia,
    route: links?.route ?? router!.currentRoute.value,
    islands: await mountIslands(islands, links ? { pinia, plugins: [links] } : { pinia, router: router! }),
    page,
    show,
    unmount() {
      window.removeEventListener("popstate", back);
      hydrated.islands.unmount();
      summary?.unmount();
      hydrated.page?.unmount();
    },
  };

  async function show(href: string, push = false): Promise<void> {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`${href} answered ${response.status}`);
    const next = readPage(await response.text());
    const nextPinia = createPinia();
    hydrateState(nextPinia, { text: next.state });
    const nextLinks = pageLinks(href);
    if (push) window.history.pushState(null, "", href);
    hydrated.page = await renderPage(Picks, islands, next.record, {
      pinia: nextPinia,
      plugins: [head, nextLinks],
      loads: next.loads,
      previous: hydrated.page,
    });
    hydrated.pinia = nextPinia;
    hydrated.route = nextLinks.route;
  }

  function follow(href: string): Promise<void> {
    return show(href, true).catch(() => window.location.assign(href));
  }

  function back(): void {
    show(window.location.pathname + window.location.search).catch(() => window.location.reload());
  }

  if (paged) window.addEventListener("popstate", back);
  return hydrated;
}
