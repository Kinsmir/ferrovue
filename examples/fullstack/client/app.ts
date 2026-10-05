import { createSSRApp, type App, type Component } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { createHead } from "@unhead/vue/client";
import { hydrateState, mountIslands, mountPage, type Islands } from "ferrovue";
import islands from "ferrovue/islands";
import { routeRecords } from "ferrovue/link-router";
import pageRoutes from "ferrovue/routes";
import BasketSummary from "./components/BasketSummary.vue";

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const ServerPage: Component = { render: () => null };
  return createRouter({
    history,
    routes: routeRecords(pageRoutes, ServerPage),
    linkActiveClass: "active",
    linkExactActiveClass: "active",
  });
}

export interface Hydrated {
  pinia: Pinia;
  router: Router;
  islands: Islands;
  page?: App;
  unmount(): void;
}

export async function hydrate(history?: RouterHistory): Promise<Hydrated> {
  const pinia = createPinia();
  hydrateState(pinia);
  const router = createAppRouter(history);
  await router.replace(router.options.history.location);

  const basket = document.getElementById("basket");
  const summary = basket ? createSSRApp(BasketSummary, { label: "Basket" }).use(pinia) : null;
  summary?.mount(basket!);

  const head = createHead();
  const page = document.getElementById("__fv_page") ? await mountPage(() => import("./pages/picks.vue"), islands, { pinia, router, plugins: [head] }) : undefined;

  const mounted = await mountIslands(islands, { pinia, router });
  return {
    pinia,
    router,
    islands: mounted,
    page,
    unmount() {
      mounted.unmount();
      summary?.unmount();
      page?.unmount();
    },
  };
}
