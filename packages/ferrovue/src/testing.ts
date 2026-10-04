/* What a conformance suite needs from Vue: a component's real server render, and an app that
 * renders one fixture — its props, its slots' content, and the location it is rendered at, under
 * the real vue-router.
 *
 * A fixture is a JSON object of props, plus two keys that are not props:
 * - `$slots`: each slot's content as HTML, rendered as a static node so both sides write it
 *   exactly as given; `routerView` is the page `<RouterView>` shows.
 * - `$route`: the reader's location, `/` when absent.
 * - `$stores`: Pinia's state, by store id — every store the component reads, in full, because a
 *   store absent here is built from its own `state()`, which the server never runs. */
import { readFileSync } from "node:fs";
import { compileScript, compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import * as vue from "vue";
import { createSSRApp, createStaticVNode, defineComponent, h, type App, type Component } from "vue";
import * as serverRenderer from "vue/server-renderer";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

export interface Fixture {
  props: Record<string, unknown>;
  slots: Record<string, string>;
  route: string;
  stores: Record<string, unknown>;
}

/** A fixture's JSON, split into the props and the rest. */
export function readFixture(json: Record<string, unknown>): Fixture {
  const { $slots, $route, $stores, ...props } = json;
  return {
    props,
    slots: ($slots ?? {}) as Record<string, string>,
    route: ($route as string | undefined) ?? "/",
    stores: ($stores ?? {}) as Record<string, unknown>,
  };
}

/* A bundler compiles a `.vue` file for the browser, and `renderToString` on a component without
 * `ssrRender` falls back to rendering its virtual DOM — a different path with different output
 * (attribute order, `v-model` state, comment markers). So each component is given the `ssrRender`
 * its SSR build would have, which is also what the generator translates. */
export function attachSsrRender(file: string, name: string, component: Component): void {
  const { descriptor } = parseSfc(readFileSync(file, "utf8"), { filename: file });
  const script = compileScript(descriptor, { id: name });
  const { code } = compileTemplate({
    source: descriptor.template!.content,
    filename: file,
    id: name,
    ssr: true,
    ssrCssVars: [],
    compilerOptions: { bindingMetadata: script.bindings },
  });
  const body = code
    .replace(/import \{([^}]*)\} from "vue"/g, (_, names: string) => `const {${names.replace(/ as /g, ": ")}} = __vue;`)
    .replace(
      /import \{([^}]*)\} from "vue\/server-renderer"/g,
      (_, names: string) => `const {${names.replace(/ as /g, ": ")}} = __sr;`,
    )
    .replace("export function ssrRender", "return function ssrRender");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  (component as { ssrRender?: unknown }).ssrRender = new Function("__vue", "__sr", body)(vue, serverRenderer);
}

/** The top-level nodes in a piece of HTML, which a static node needs to hydrate. */
function nodeCount(html: string): number {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.childNodes.length;
}

const staticNode = (html: string) => createStaticVNode(html, nodeCount(html));

/** A route as a routes file lists it: a path, or a path and a name. */
export type RouteEntry = string | { path: string; name?: string };

/** The router options ferrovue reproduces, as the project's configuration gives them. */
export interface RouterOptions {
  base?: string;
  linkActiveClass?: string;
  linkExactActiveClass?: string;
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
  if (routes) {
    const view = fixture.slots.routerView ?? "";
    const View = defineComponent({ render: () => staticNode(view) });
    const router = createRouter({
      history: createMemoryHistory(options.base),
      routes: routes.map((r) => (typeof r === "string" ? { path: r, component: View } : { ...r, component: View })),
      ...(options.linkActiveClass !== undefined ? { linkActiveClass: options.linkActiveClass } : {}),
      ...(options.linkExactActiveClass !== undefined ? { linkExactActiveClass: options.linkExactActiveClass } : {}),
    });
    app.use(router);
    await router.push(fixture.route);
    await router.isReady();
  }
  return app;
}
