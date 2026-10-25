import { createApp, createSSRApp, createStaticVNode, createTextVNode, defineComponent, h, Suspense, type App, type Component, type Plugin } from "vue";
import { routeRecords, type RouteEntry } from "./route-records.ts";
import { clearLoads, mountPage, provideLoads, readPage, renderPage, reviveDates, type IslandComponent, type PageOptions, type PageRecord, type RenderPageOptions } from "./client.ts";
import { parsedShape, renderDifference, shapeAtMount } from "./client-render.ts";
import { isMissing, missingPeer, peer } from "./peer.ts";
import { settled } from "./settle.ts";

/** A conformance fixture: the props, and `$slots`, `$route`, `$stores`, `$loads` and `$locale`. */
export interface Fixture {
  props: Record<string, unknown>;
  slots: Record<string, string>;
  route: string;
  stores: Record<string, unknown>;
  /** `$loads`: each loader's result by the key of its call (`loadKey`), `null` when the fixture
   * gives none. */
  loads?: Record<string, unknown> | null;
  /** `$locale`: the locale the fixture renders in, when the project translates. */
  locale?: string | null;
}

/** A fixture's JSON, split into the props and the rest. */
export function readFixture(json: Record<string, unknown>): Fixture {
  const { $slots, $route, $stores, $loads, $locale, ...props } = json;
  return {
    props,
    slots: ($slots ?? {}) as Record<string, string>,
    route: ($route as string | undefined) ?? "/",
    stores: ($stores ?? {}) as Record<string, unknown>,
    loads: ($loads as Record<string, unknown> | undefined) ?? null,
    locale: ($locale as string | undefined) ?? null,
  };
}

function nodeCount(html: string): number {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.childNodes.length;
}

const staticNode = (html: string) => (html === "" ? createTextVNode("") : createStaticVNode(html, nodeCount(html)));

async function optionalPinia(stores: Record<string, unknown>): Promise<typeof import("pinia") | null> {
  try {
    return await import("pinia");
  } catch (error) {
    if (!isMissing(error, "pinia")) throw error;
    if (Object.keys(stores).length > 0) throw missingPeer("pinia", "the fixture has `$stores`", error);
    return null;
  }
}

async function optionalHead(hydrate: boolean): Promise<Plugin | null> {
  try {
    if (hydrate) return (await import("@unhead/vue/client")).createHead();
    return (await import("@unhead/vue/server")).createHead({ disableDefaults: true });
  } catch (error) {
    if (isMissing(error, "@unhead/vue")) return null;
    throw error;
  }
}

/** The router options ferrovue reproduces, as the project's configuration gives them. */
export interface RouterOptions {
  base?: string;
  linkActiveClass?: string;
  linkExactActiveClass?: string;
  /** vue-i18n, when the project translates: every locale's messages, the default locale, and the
   * fallbacks. */
  i18n?: { messages: Record<string, unknown>; locale: string; fallbackLocale?: string | string[] };
  /** Render on the client from scratch with `createApp`: the scope
   * ids a fresh client render writes, which the server's must equal for scoped styles to apply. */
  client?: boolean;
  /** The app hydrates a page the DOM already holds: the head `@unhead/vue` gives it, when the
   * project has it, is its client head, which takes over the tags in the document's head. Otherwise
   * it is the server head `createHead({ disableDefaults: true })`, whose tags the conformance suite
   * writes after the render. */
  hydrate?: boolean;
  /** The application's own `pinia` module, used in place of the one `ferrovue/testing` would
   * import: under vitest the application's stores use the module Vite loads, which must be the
   * one that installs the fixture's state. */
  pinia?: typeof import("pinia") | undefined;
  /** The application's own `vue-router` module, used in place of the one `ferrovue/testing`
   * would import. */
  vueRouter?: typeof import("vue-router") | undefined;
  /** The application's own `vue-i18n` module, used in place of the one `ferrovue/testing` would
   * import. */
  vueI18n?: typeof import("vue-i18n") | undefined;
}

/** An app rendering one fixture of `component`: with a router over `routes` when there are any. */
export async function fixtureApp(
  component: Component,
  fixture: Fixture,
  routes: RouteEntry[] | null,
  options: RouterOptions = {},
): Promise<App> {
  const slots = Object.fromEntries(
    Object.entries(fixture.slots)
      .filter(([name]) => name !== "routerView")
      .map(([name, html]) => [name, () => [staticNode(html)]]),
  );
  clearLoads();
  const loads = fixture.loads ?? null;
  if (loads) provideLoads(loads);
  const root = () => h(component, reviveDates(component, fixture.props), slots);
  const app = (options.client ? createApp : createSSRApp)({ render: loads ? () => h(Suspense, null, { default: root }) : root });
  const head = await optionalHead(options.hydrate ?? false);
  if (head) app.use(head);
  const pinia = options.pinia ?? (await optionalPinia(fixture.stores));
  if (pinia) {
    const store = pinia.createPinia();
    store.state.value = structuredClone(fixture.stores) as typeof store.state.value;
    app.use(store);
  }
  if (options.i18n) {
    const { createI18n } = options.vueI18n ?? await peer("vue-i18n", "the fixture is rendered with `i18n` options", () => import("vue-i18n"));
    const i18nOptions = {
      legacy: false as const,
      locale: fixture.locale ?? options.i18n.locale,
      ...(options.i18n.fallbackLocale !== undefined ? { fallbackLocale: options.i18n.fallbackLocale } : {}),
      messages: options.i18n.messages,
      missingWarn: false,
      fallbackWarn: false,
    };
    app.use(createI18n(i18nOptions as Parameters<typeof createI18n>[0]));
  }
  if (routes) {
    const { createMemoryHistory, createRouter } = options.vueRouter ?? await peer("vue-router", "the fixture is rendered with routes", () => import("vue-router"));
    const view = fixture.slots.routerView ?? "";
    const View = defineComponent({ render: () => staticNode(view) });
    const router = createRouter({
      history: createMemoryHistory(options.base),
      routes: routeRecords(routes, View),
      ...(options.linkActiveClass !== undefined ? { linkActiveClass: options.linkActiveClass } : {}),
      ...(options.linkExactActiveClass !== undefined ? { linkExactActiveClass: options.linkExactActiveClass } : {}),
    });
    app.use(router);
    await router.push(fixture.route);
    await router.isReady();
  }
  return app;
}

/** A page as the server wrote it: `html` holds the container and, unless `record` is given, the
 * record's script. */
export interface RecordedPage {
  html: string;
  record?: PageRecord;
}

function recordScript(id: string, record: PageRecord): string {
  const json = JSON.stringify(record).replace(/[<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `<script type="application/json" id="${id}">${json}</script>`;
}

function shape(node: Node, scratch: HTMLElement): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType === 8) return `<!--${node.textContent ?? ""}-->`;
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const attrs = el
    .getAttributeNames()
    .filter((name) => name !== "style")
    .toSorted()
    .map((name) => ` ${name}=${JSON.stringify(el.getAttribute(name))}`);
  scratch.setAttribute("style", el.getAttribute("style") ?? "");
  if (scratch.style.cssText) attrs.push(` style=${JSON.stringify(scratch.style.cssText)}`);
  return `<${el.tagName}${attrs.join("")}>${[...el.childNodes].map((child) => shape(child, scratch)).join("")}</${el.tagName}>`;
}

/** Put a recorded page into the document's body and hydrate it with `mountPage`, throwing on a
 * node Vue replaced, on any change hydrating made to the markup (a `style` attribute is compared by
 * the declarations it holds), and on anything Vue warns or logs as an error until the page has
 * settled. The markup is compared as hydrating leaves it; what changes once the page is mounted,
 * such as a `<ClientOnly>` showing its content or an async component loading, is the app's to
 * change. Resolves to the app, mounted and settled. */
export async function hydrateRecordedPage(
  page: RecordedPage,
  layout: Component,
  components: Record<string, IslandComponent>,
  options: PageOptions = {},
): Promise<App> {
  const doc = options.doc ?? document;
  const id = options.record ?? "__fv_page";
  doc.body.innerHTML = page.html + (page.record ? recordScript(id, page.record) : "");
  const selector = options.container ?? "#app";
  const container = typeof selector === "string" ? doc.querySelector(selector) : selector;
  if (!container) throw new Error(`the recorded page has no ${selector as string}`);
  const scratch = doc.createElement("div");
  const before = container.innerHTML;
  const shapeBefore = [...container.childNodes].map((child) => shape(child, scratch)).join("");
  const first = container.firstChild;
  const problems: string[] = [];
  const shapeOf = (): string => [...container.childNodes].map((child) => shape(child, scratch)).join("");
  let hydrated = "";
  let shapeHydrated = "";
  const watch: Plugin = {
    install(app) {
      app.config.warnHandler = (message) => void problems.push(`warning: ${message}`);
      const mount = app.mount.bind(app);
      app.mount = (...args: Parameters<App["mount"]>) => {
        const root = mount(...args);
        hydrated = container.innerHTML;
        shapeHydrated = shapeOf();
        return root;
      };
    },
  };
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => void problems.push(`console.warn: ${args.map(String).join(" ")}`);
  console.error = (...args: unknown[]) => void problems.push(`console.error: ${args.map(String).join(" ")}`);
  let app: App;
  try {
    app = await mountPage(layout, components, { ...options, doc, container, plugins: [...(options.plugins ?? []), watch] });
    await settled(app);
  } finally {
    console.warn = warn;
    console.error = error;
  }
  if (container.firstChild !== first) problems.push("Vue replaced the server's first node");
  if (shapeHydrated !== shapeBefore) problems.push(`hydrating changed the markup:\n  server:   ${before}\n  hydrated: ${hydrated}`);
  if (problems.length) {
    app.unmount();
    throw new Error(`the page did not hydrate exactly:\n${problems.join("\n")}`);
  }
  return app;
}

/** Put a recorded page into the document's body and show it again from its record with
 * `renderPage`, as a navigation shows the next page, throwing where the client's render differs
 * from the markup the browser parsed, as `renderedShape` compares them (comments and empty text
 * aside, classes, styles and form controls by what they hold), and on anything Vue warns or logs as
 * an error. The render is compared as mounting leaves it, where `<ClientOnly>` still shows its
 * fallback as the server wrote it, and, where that differs while async components are loading,
 * once they have loaded. What is teleported out of the page is not compared. Resolves to the app,
 * mounted. */
export async function renderRecordedPage(
  page: RecordedPage,
  layout: Component,
  components: Record<string, IslandComponent>,
  options: RenderPageOptions & { record?: string } = {},
): Promise<App> {
  const doc = options.doc ?? document;
  const id = options.record ?? "__fv_page";
  doc.body.innerHTML = page.html + (page.record ? recordScript(id, page.record) : "");
  const record = page.record ?? readPage(page.html, { record: id }).record;
  const selector = options.container ?? "#app";
  const container = typeof selector === "string" ? doc.querySelector(selector) : selector;
  if (!container) throw new Error(`the recorded page has no ${selector as string}`);
  const expected = parsedShape(container);
  const problems: string[] = [];
  const watch: Plugin = {
    install(app) {
      app.config.warnHandler = (message) => void problems.push(`warning: ${message}`);
    },
  };
  const mounted = shapeAtMount();
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => void problems.push(`console.warn: ${args.map(String).join(" ")}`);
  console.error = (...args: unknown[]) => void problems.push(`console.error: ${args.map(String).join(" ")}`);
  let app: App;
  try {
    app = await renderPage(layout, components, record, { ...options, doc, container, plugins: [...(options.plugins ?? []), watch, mounted.plugin] });
    const difference = await renderDifference(app, mounted.container() ?? container, await Promise.race([mounted.shape(), settled(app).then(mounted.shape)]), expected);
    if (difference) problems.push(difference);
  } finally {
    console.warn = warn;
    console.error = error;
  }
  if (problems.length) {
    app.unmount();
    throw new Error(`the page did not render from its record exactly:\n${problems.join("\n")}`);
  }
  return app;
}
