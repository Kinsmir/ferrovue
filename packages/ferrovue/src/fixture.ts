/* An app rendering one conformance fixture with the real Vue: its props, its slots' content, the
 * location it is rendered at under the real vue-router, Pinia's state and vue-i18n's locale.
 *
 * A fixture is a JSON object of props, plus keys that are not props:
 * - `$slots`: each slot's content as HTML, rendered as a static node so both sides write it
 *   exactly as given; `routerView` is the page `<RouterView>` shows.
 * - `$route`: the reader's location, `/` when absent.
 * - `$stores`: Pinia's state, by store id — every store the component reads, in full, because a
 *   store absent here is built from its own `state()`, which the server never runs.
 * - `$locale`: the locale, when the project translates.
 *
 * Nothing here reads a file or compiles anything, so a browser bundle can import it too: the
 * browser hydration tests (`packages/ferrovue/browser/`) build the same app there. */
import { createSSRApp, createStaticVNode, defineComponent, h, type App, type Component } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type RouteRecordRaw } from "vue-router";
import { createI18n } from "vue-i18n";

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

/** The top-level nodes in a piece of HTML, which a static node needs to hydrate. */
function nodeCount(html: string): number {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.childNodes.length;
}

const staticNode = (html: string) => createStaticVNode(html, nodeCount(html));

/** A route as a routes file lists it: a path, or a path and a name. */
export type RouteEntry = string | { path: string; name?: string; children?: RouteEntry[] };

/** The router options ferrovue reproduces, as the project's configuration gives them. */
export interface RouterOptions {
  base?: string;
  linkActiveClass?: string;
  linkExactActiveClass?: string;
  /** vue-i18n, when the project translates: every locale's messages, the default locale, and the
   * fallbacks. */
  i18n?: { messages: Record<string, unknown>; locale: string; fallbackLocale?: string | string[] };
}

/** Route records for vue-router, every route — nested ones too — given the fixture's view. */
export function routeRecords(routes: RouteEntry[], View: Component): RouteRecordRaw[] {
  return routes.map((r) =>
    typeof r === "string"
      ? { path: r, component: View }
      : { path: r.path, component: View, ...(r.name ? { name: r.name } : {}), ...(r.children ? { children: routeRecords(r.children, View) } : {}) },
  );
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
  const app = createSSRApp({ render: () => h(component, fixture.props, slots) });
  // As the client hydrates: the state the server rendered with, set before any store is first used.
  const pinia = createPinia();
  pinia.state.value = structuredClone(fixture.stores) as typeof pinia.state.value;
  app.use(pinia);
  if (options.i18n) {
    // Messages read from the project's files at run time: their schema is not known to TypeScript.
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
