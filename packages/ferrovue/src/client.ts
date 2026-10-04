/* What the browser does with a page ferrovue rendered. */
import { createSSRApp, type App, type Component, type Plugin } from "vue";
import type { Pinia } from "pinia";
import type { Router } from "vue-router";

/** Give Pinia the state the server rendered with — what `ferrovue::state_script_into` wrote — before
 * the app mounts, so every store starts from it and the hydrated markup agrees with the server's. */
export function hydrateState(pinia: Pinia, id = "__pinia", doc: Document = document): void {
  const text = doc.getElementById(id)?.textContent;
  if (text) pinia.state.value = JSON.parse(text) as Pinia["state"]["value"];
}

export interface MountOptions {
  /** One Pinia for every island, so they share stores. Call `hydrateState` on it first. */
  pinia?: Pinia;
  /** One router for every island that renders a `<RouterLink>` or reads the route. Mounting waits
   * until it has resolved the current location, which the server rendered against. */
  router?: Router;
  /** Anything else each island's app should `use`: i18n, a component library. */
  plugins?: Plugin[];
  /** Where to look for islands: the whole document by default. */
  root?: ParentNode;
  /** Told about an island left as the server rendered it, because its component is not among
   * those given or its props are malformed. Warns on the console by default. */
  onError?: (element: Element, problem: string) => void;
}

/** The islands mounted. */
export interface Islands {
  /** One app per island, in document order. */
  apps: App[];
  /** Unmount every island, as a page leaving would. */
  unmount(): void;
}

/** Hydrate every island on the page: each `<div data-island="Name" data-props="…">` that
 * `Html::island` wrote becomes an app of the component of that name, given the props the server
 * rendered it with, mounted where it is. */
export async function mountIslands(components: Record<string, Component>, options: MountOptions = {}): Promise<Islands> {
  const root = options.root ?? document;
  const report = options.onError ?? ((el: Element, problem: string) => console.warn(`[ferrovue] island left unhydrated: ${problem}`, el));
  if (options.router) await options.router.isReady();
  const apps: App[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-island]"))) {
    const name = el.dataset.island ?? "";
    const component = components[name];
    if (!component) {
      report(el, `no component called ${JSON.stringify(name)} was given`);
      continue;
    }
    let props: Record<string, unknown>;
    try {
      props = JSON.parse(el.dataset.props ?? "{}") as Record<string, unknown>;
    } catch {
      report(el, `the props of ${name} are not JSON`);
      continue;
    }
    const app = createSSRApp(component, props);
    if (options.pinia) app.use(options.pinia);
    if (options.router) app.use(options.router);
    for (const plugin of options.plugins ?? []) app.use(plugin);
    app.mount(el);
    apps.push(app);
  }
  return {
    apps,
    unmount() {
      for (const app of apps.splice(0)) app.unmount();
    },
  };
}
