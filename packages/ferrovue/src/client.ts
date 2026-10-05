/* What the browser does with a page ferrovue rendered. */
import { createSSRApp, type App, type Component, type Plugin } from "vue";
import type { Pinia } from "pinia";
import type { Router } from "vue-router";

/** A JSON string, skipped whole as it may hold the same letters, or a bare number JSON has no word
 * for, which the server writes as JavaScript does where `serde_json` alone would write `null`. */
const BARE = /"(?:[^"\\]|\\.)*"|-?Infinity|NaN/g;
const NON_FINITE: Record<string, number> = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY };

/** `JSON.parse`, reading back the bare `NaN`, `Infinity` and `-Infinity` that an island's props and
 * the state script hold for a number that is not finite, so the client renders what the server did.
 * Throws as `JSON.parse` does on anything else that is not JSON. */
function parseJson(text: string): unknown {
  // Plain JSON: almost everything the server writes, and all it wrote before it wrote these.
  if (!/NaN|Infinity/.test(text)) return JSON.parse(text);
  // Each token becomes a string that starts with more NULs in a row than any string in the text
  // holds (JSON has one way to write a NUL, `\u0000`), so no other value can be mistaken for one.
  let escaped = "\\u0000";
  while (text.includes(escaped)) escaped += "\\u0000";
  const tag = JSON.parse(`"${escaped}"`) as string;
  const quoted = text.replace(BARE, (match) => (match.startsWith('"') ? match : `"${escaped}${match}"`));
  return JSON.parse(quoted, (_key, value: unknown) => (typeof value === "string" && value.startsWith(tag) ? NON_FINITE[value.slice(tag.length)] : value));
}

/** Give Pinia the state the server rendered with — what `ferrovue::state_script_into` wrote — before
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

/** A component, or a function that loads one — `() => import("./Counter.vue")` — so that the code
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
  // Each component the page names, loaded once however many islands it has.
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

/** The component itself, or what its loader resolves to: a module's default export, or the
 * component. A loader that rejects gives its error, which leaves only its own islands unhydrated. */
async function load(component: IslandComponent): Promise<Component | Error> {
  if (typeof component !== "function" || "props" in component || "displayName" in component || "__vccOpts" in component) return component;
  try {
    const loaded = await (component as () => Promise<Component | { default: Component }>)();
    return typeof loaded === "object" && "default" in loaded ? loaded.default : loaded;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}
