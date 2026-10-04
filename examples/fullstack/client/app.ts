/* What the browser does with a page the Rust server rendered.
 *
 * The server's HTML is static except where it says otherwise: each `data-island` element, which
 * `mountIslands` hydrates from the props the server wrote beside it, and the basket summary, which
 * reads the store and is hydrated on its own. Every one of them shares one Pinia, started from the
 * state the server rendered with, and one router. */
import { createSSRApp, type Component } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createRouter, createWebHistory, type Router, type RouterHistory } from "vue-router";
import { hydrateState, mountIslands, type Islands } from "ferrovue/client";
import routes from "./routes.json" with { type: "json" };

// Every component, by name: `data-island="AddToBasket"` is `components/AddToBasket.vue`.
const modules = import.meta.glob<{ default: Component }>("./components/*.vue", { eager: true });
export const components: Record<string, Component> = Object.fromEntries(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);

/** The router the server's `route_table` mirrors: the same routes file, and the same link classes
 * as `ferrovue.config.json`. The pages are the server's, so no route has a view of its own here. */
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
  // Before anything mounts: every store starts from the state the server rendered with.
  hydrateState(pinia);
  const router = createAppRouter(history);
  await router.replace(router.options.history.location);

  // A component that reads a store has no `island()` on the server, which writes props alone; the
  // layout wraps this one in `#basket` so it can be hydrated here, from the shared store.
  const basket = document.getElementById("basket");
  const summary = basket && components.BasketSummary ? createSSRApp(components.BasketSummary, { label: "Basket" }).use(pinia) : null;
  summary?.mount(basket!);

  const islands = await mountIslands(components, { pinia, router });
  return {
    pinia,
    router,
    islands,
    unmount() {
      islands.unmount();
      summary?.unmount();
    },
  };
}
