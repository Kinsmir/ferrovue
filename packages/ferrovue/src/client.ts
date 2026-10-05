import { createSSRApp, createTextVNode, defineComponent, h, onMounted, ref, type App, type Component, type Plugin } from "vue";
import type { Pinia } from "pinia";
import type { Router } from "vue-router";

const BARE = /"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g;
const NON_FINITE: Record<string, number> = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY };

function parseJson(text: string): unknown {
  if (!/NaN|Infinity/.test(text)) return JSON.parse(text);
  let escaped = "\\u0000";
  while (text.includes(escaped)) escaped += "\\u0000";
  const tag = JSON.parse(`"${escaped}"`) as string;
  const quoted = text.replace(BARE, (match) => (match.startsWith('"') ? match : `"${escaped}${match}"`));
  return JSON.parse(quoted, (_key, value: unknown) => (typeof value === "string" && value.startsWith(tag) ? NON_FINITE[value.slice(tag.length)] : value));
}

/** Give Pinia the state the server rendered with (what `ferrovue::state_script_into` wrote) before
 * the app mounts, so every store starts from it and the hydrated markup agrees with the server's. */
export function hydrateState(pinia: Pinia, id = "__pinia", doc: Document = document): void {
  const text = doc.getElementById(id)?.textContent;
  if (text) pinia.state.value = parseJson(text) as Pinia["state"]["value"];
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

/** A component, or a function that loads one (`() => import("./Counter.vue")`), so that the code
 * of an island not on the page is never fetched. A function is taken for a loader as vue-router
 * takes one for a lazy route: unless it has `props` or `displayName`, which mark a functional
 * component, or `__vccOpts`, a class component. `ferrovue/islands` maps the name of every island
 * to a loader. */
export type IslandComponent = Component | (() => Promise<Component | { default: Component }>);

/** The islands mounted. */
export interface Islands {
  /** One app per island, in document order. */
  apps: App[];
  /** Unmount every island, as a page leaving would. */
  unmount(): void;
}

/** Hydrate every island on the page: each `<div data-island="Name" data-props="…">` that
 * `Html::island` wrote becomes an app of the component of that name, given the props the server
 * rendered it with, mounted where it is. A loader is called only for an island the page holds, all
 * of them at once, and the islands mount in document order once every one has loaded. */
export async function mountIslands(components: Record<string, IslandComponent>, options: MountOptions = {}): Promise<Islands> {
  const root = options.root ?? document;
  const report = options.onError ?? ((el: Element, problem: string) => console.warn(`[ferrovue] island left unhydrated: ${problem}`, el));
  const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-island]"));
  const loading = new Map<string, Promise<Component | Error>>();
  for (const el of elements) {
    const name = el.dataset.island ?? "";
    if (Object.hasOwn(components, name) && !loading.has(name)) loading.set(name, load(components[name]!));
  }
  const [loaded] = await Promise.all([
    Promise.all([...loading].map(async ([name, pending]) => [name, await pending] as const)).then((pairs) => new Map(pairs)),
    options.router?.isReady(),
  ]);
  const apps: App[] = [];
  for (const el of elements) {
    const name = el.dataset.island ?? "";
    const component = loaded.get(name);
    if (!component) {
      report(el, `no component called ${JSON.stringify(name)} was given (\`ferrovue/islands\` holds every component that has an \`island()\`)`);
      continue;
    }
    if (component instanceof Error) {
      report(el, `${name} did not load: ${component.message}`);
      continue;
    }
    let props: Record<string, unknown>;
    try {
      props = parseJson(el.dataset.props ?? "{}") as Record<string, unknown>;
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

type SsrSlot = (props: object, push: (chunk: unknown) => void, parent: unknown, scopeId: string) => unknown;

/** Content only the browser renders. The server writes the `#fallback` slot, or nothing; the
 * browser hydrates that fallback, then swaps in the default slot once mounted. ferrovue does not
 * compile the default slot, so anything may go there: a component library's components, code that
 * reads `window`. The swap happens only where Vue runs on the page, as in an island. */
export const ClientOnly: Component = Object.assign(
  defineComponent({
    name: "ClientOnly",
    inheritAttrs: false,
    setup(_, { slots }) {
      const mounted = ref(false);
      onMounted(() => {
        mounted.value = true;
      });
      return () => (mounted.value ? slots.default?.() : slots.fallback?.());
    },
  }),
  {
    ssrRender(ctx: { $slots: Record<string, SsrSlot | undefined> }, push: (chunk: unknown) => void, parent: unknown): void {
      const fallback = ctx.$slots.fallback;
      if (!fallback) {
        push("<!---->");
        return;
      }
      push("<!--[-->");
      fallback({}, push, parent, "");
      push("<!--]-->");
    },
  },
);

async function load(component: IslandComponent): Promise<Component | Error> {
  if (typeof component !== "function" || "props" in component || "displayName" in component || "__vccOpts" in component) return component;
  try {
    const loaded = await (component as () => Promise<Component | { default: Component }>)();
    return typeof loaded === "object" && "default" in loaded ? loaded.default : loaded;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/** One component the server rendered into a slot of a page's layout, as `ferrovue::Part` records
 * it: its name (`c`) and the props it was rendered from (`p`). */
export interface PagePart {
  c: string;
  p: Record<string, unknown>;
}

/** What `ferrovue::PageRecord` writes: the layout's props, and each slot's parts in order. */
export interface PageRecord {
  props: Record<string, unknown>;
  slots: Record<string, PagePart[]>;
}

export interface PageOptions extends Pick<MountOptions, "pinia" | "router" | "plugins"> {
  /** The element holding the layout's root, or a selector for it: `#app` by default. */
  container?: Element | string;
  /** The `id` of the record's script, as given to `PageRecord::script_into`: `__fv_page` by default. */
  record?: string;
  /** The document to read the page from. */
  doc?: Document;
}

/** The app of a page: its root renders `layout` with the record's props, and each slot as the
 * components the record names, in order, as a plain array, which hydrates the markup the server
 * wrote with no fragment of its own. `components` must hold every component the record names. */
export function createPageApp(layout: Component, record: PageRecord, components: Record<string, Component>, options: PageOptions = {}): App {
  const slots = Object.fromEntries(
    Object.entries(record.slots).map(([name, parts]) => [
      name,
      () => (parts.length ? parts.map((part) => h(components[part.c]!, part.p)) : [createTextVNode("")]),
    ]),
  );
  const app = createSSRApp({ name: "FerrovuePage", render: () => h(layout, record.props, slots) });
  if (options.pinia) app.use(options.pinia);
  if (options.router) app.use(options.router);
  for (const plugin of options.plugins ?? []) app.use(plugin);
  return app;
}

/** Hydrate a page `ferrovue::Page` rendered: read its record, load the components it names (and
 * no others), wait for the router, and mount the layout on the container. Rejects, leaving the page
 * as the server rendered it, when the container or the record is missing or a component is not
 * given or does not load. */
export async function mountPage(layout: IslandComponent, components: Record<string, IslandComponent>, options: PageOptions = {}): Promise<App> {
  const doc = options.doc ?? document;
  const selector = options.container ?? "#app";
  const container = typeof selector === "string" ? doc.querySelector(selector) : selector;
  if (!container) throw new Error(`[ferrovue] the page has no ${selector as string} to mount on`);
  const id = options.record ?? "__fv_page";
  const text = doc.getElementById(id)?.textContent;
  if (!text) throw new Error(`[ferrovue] the page has no record: no <script id="${id}">`);
  const record = parseJson(text) as PageRecord;
  const names = new Set(Object.values(record.slots).flatMap((parts) => parts.map((part) => part.c)));
  const loading = [...names].map(async (name) => {
    if (!Object.hasOwn(components, name)) throw new Error(`[ferrovue] no component called ${JSON.stringify(name)} was given to mountPage`);
    return [name, await loadOrThrow(name, components[name]!)] as const;
  });
  const [root, parts] = await Promise.all([loadOrThrow("the layout", layout), Promise.all(loading), options.router?.isReady()]);
  const app = createPageApp(root, record, Object.fromEntries(parts), options);
  app.mount(container);
  return app;
}

async function loadOrThrow(name: string, component: IslandComponent): Promise<Component> {
  const result = await load(component);
  if (result instanceof Error) throw new Error(`[ferrovue] ${name} did not load: ${result.message}`, { cause: result });
  return result;
}
