import { createApp, createSSRApp, createStaticVNode, defineComponent, h, type App, type Component, type Plugin } from "vue";
import { routeRecords, type RouteEntry } from "./routes.ts";

export { routeRecords, type RouteEntry } from "./routes.ts";

/** A conformance fixture: the props, and `$slots`, `$route`, `$stores` and `$locale`. */
export interface Fixture {
  props: Record<string, unknown>;
  slots: Record<string, string>;
  route: string;
  stores: Record<string, unknown>;
  /** `$locale`: the locale the fixture renders in, when the project translates. */
  locale?: string | null;
}

/** A fixture's JSON, split into the props and the rest. */
export function readFixture(json: Record<string, unknown>): Fixture {
  const { $slots, $route, $stores, $locale, ...props } = json;
  return {
    props,
    slots: ($slots ?? {}) as Record<string, string>,
    route: ($route as string | undefined) ?? "/",
    stores: ($stores ?? {}) as Record<string, unknown>,
    locale: ($locale as string | undefined) ?? null,
  };
}

function nodeCount(html: string): number {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.childNodes.length;
}

const staticNode = (html: string) => createStaticVNode(html, nodeCount(html));

function isMissing(error: unknown, name: string): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    typeof message === "string" &&
    (message.includes(`'${name}'`) || message.includes(`"${name}"`))
  );
}

function missingPeer(name: string, needs: string, cause: unknown): Error {
  return new Error(`ferrovue/testing: ${needs}, which needs \`${name}\`: install it in your project (\`npm install -D ${name}\`)`, { cause });
}

export async function peer<T>(name: string, needs: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw isMissing(error, name) ? missingPeer(name, needs, error) : error;
  }
}

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
  pinia?: typeof import("pinia");
  /** The application's own `vue-router` module, used in place of the one `ferrovue/testing`
   * would import. */
  vueRouter?: typeof import("vue-router");
  /** The application's own `vue-i18n` module, used in place of the one `ferrovue/testing` would
   * import. */
  vueI18n?: typeof import("vue-i18n");
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
  const app = (options.client ? createApp : createSSRApp)({ render: () => h(component, fixture.props, slots) });
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
