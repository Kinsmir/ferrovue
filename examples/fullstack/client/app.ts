import { createSSRApp, type Component } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { hydrateState, mountIslands, type Islands } from "ferrovue";
import islands from "ferrovue/islands";
import BasketSummary from "./components/BasketSummary.vue";
import routes from "./routes.json" with { type: "json" };

export function createAppRouter(history: RouterHistory = createWebHistory()): Router {
  const ServerPage: Component = { render: () => null };
  return createRouter({
    history,
    routes: routes.map((r) => ({ ...r, component: ServerPage })),
    linkActiveClass: "active",
    linkExactActiveClass: "active",
  });
}

export interface Hydrated {
  pinia: Pinia;
  router: Router;
  islands: Islands;
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

  const mounted = await mountIslands(islands, { pinia, router });
  return {
    pinia,
    router,
    islands: mounted,
    unmount() {
      mounted.unmount();
      summary?.unmount();
    },
  };
}
