import { createSSRApp, type App, type Component } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { createHead } from "@unhead/vue/client";
import { hydrateState, mountIslands, mountPage, readPage, renderPage, type Islands } from "ferrovue";
import islands from "ferrovue/islands";
import { linkRouter, routeRecords } from "ferrovue/link-router";
import pageRoutes from "ferrovue/routes";
import BasketSummary from "./components/BasketSummary.vue";

const LINKS = { linkActiveClass: "active", linkExactActiveClass: "active" };
const Picks = (): Promise<{ default: Component }> => import("./pages/picks.vue");

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const ServerPage: Component = { render: () => null };
  return createRouter({ history, routes: routeRecords(pageRoutes, ServerPage), ...LINKS });
}

export interface Hydrated {
  pinia: Pinia;
  router: Router;
  islands: Islands;
  page?: App | undefined;
  show: (href: string) => Promise<void>;
  unmount(): void;
}

export async function hydrate(history?: RouterHistory): Promise<Hydrated> {
  const pinia = createPinia();
  hydrateState(pinia);
  const head = createHead();
  const paged = document.getElementById("__fv_page") !== null;

  const pageRouter = (at: { history?: RouterHistory | undefined; location?: string }): Router =>
    linkRouter(pageRoutes, {
      ...LINKS,
      ...(at.history ? { history: at.history } : {}),
      ...(at.location ? { location: at.location } : {}),
      navigate: (href, to) => void (to.name === "/picks" ? follow(href) : window.location.assign(href)),
    });

  const router = paged ? pageRouter({ history }) : createAppRouter(history);
  await router.replace(router.options.history.location);

  const basket = document.getElementById("basket");
  const summary = basket ? createSSRApp(BasketSummary, { label: "Basket" }).use(pinia) : null;
  summary?.mount(basket!);

  const page = paged ? await mountPage(Picks, islands, { pinia, router, plugins: [head] }) : undefined;
  const hydrated: Hydrated = {
    pinia,
    router,
    islands: await mountIslands(islands, { pinia, router }),
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
    const nextRouter = pageRouter({ location: href });
    if (push) window.history.pushState(null, "", href);
    hydrated.page = await renderPage(Picks, islands, next.record, { pinia: nextPinia, router: nextRouter, plugins: [head], previous: hydrated.page });
    hydrated.pinia = nextPinia;
    hydrated.router = nextRouter;
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
