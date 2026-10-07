import { readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "@vue/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { hydrateState, mountIslands } from "../src/client.ts";
import { attachSsrRender, routeRecords, type RouteEntry } from "../src/testing.ts";

const ROOT = join(import.meta.dirname, "../../../crates/ferrovue/tests/conformance");
const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", { eager: true });
const components = Object.fromEntries(Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]));

function fixture(component: string, name: string): { props: Record<string, unknown>; stores: unknown; route: string; html: string } {
  const base = join(ROOT, "fixtures", component, name);
  const { $slots: _, $stores, $route, ...props } = JSON.parse(readFileSync(`${base}.json`, "utf8")) as Record<string, unknown>;
  return { props, stores: $stores ?? {}, route: ($route as string | undefined) ?? "/", html: readFileSync(`${base}.html`, "utf8") };
}

const island = (name: string, props: unknown, html: string): string =>
  `<div data-island="${escapeHtml(name)}" data-props="${escapeHtml(JSON.stringify(props))}">${html}</div>`;

const stateScript = (state: unknown): string =>
  `<script type="application/json" id="__pinia">${JSON.stringify(state).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`;

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  const record = (...args: unknown[]): void => void warnings.push(args.map(String).join(" "));
  vi.spyOn(console, "warn").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("hydrates each island from its own props, sharing one Pinia, without a mismatch", async () => {
  const text = fixture("Text", "full");
  const badge = fixture("Badge", "full");
  document.body.innerHTML = `${stateScript(badge.stores)}<main>${island("Text", text.props, text.html)}<aside>${island("Badge", badge.props, badge.html)}</aside></main>`;
  const before = [...document.querySelectorAll("[data-island]")].map((el) => el.firstChild);
  const pinia = createPinia();
  hydrateState(pinia);
  const islands = await mountIslands(components, { pinia });
  expect(islands.apps).toHaveLength(2);
  expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).toEqual([]);
  expect([...document.querySelectorAll("[data-island]")].map((el) => el.firstChild)).toEqual(before);
  islands.unmount();
});

it("hydrates an island that links, once the router has resolved the location", async () => {
  const nav = fixture("Nav", "at-tab");
  document.body.innerHTML = island("Nav", nav.props, nav.html);
  const routes = JSON.parse(readFileSync(join(ROOT, "routes.json"), "utf8")) as RouteEntry[];
  const View = { render: () => null };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routeRecords(routes, View),
  });
  void router.push(nav.route);
  const islands = await mountIslands(components, { router });
  expect(islands.apps).toHaveLength(1);
  expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).toEqual([]);
  islands.unmount();
});

it("hydrates a Float prop that is NaN or infinite as the number the server rendered", async () => {
  const page = readFileSync(join(ROOT, "islands.html"), "utf8").trim();
  const ratios = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY };
  attachSsrRender(join(ROOT, "components", "Narrowing.vue"), "Narrowing", components.Narrowing!);
  const markup = await Promise.all(Object.values(ratios).map((ratio) => renderToString(createSSRApp(components.Narrowing!, { ratio }))));
  expect(page).toBe(Object.keys(ratios).map((written, i) => `<div data-island="Narrowing" data-props="${escapeHtml(`{"ratio":${written}}`)}">${markup[i]}</div>`).join(""));

  document.body.innerHTML = page;
  const islands = await mountIslands(components);
  expect(islands.apps).toHaveLength(3);
  expect(warnings).toEqual([]);
  expect([...document.querySelectorAll("section > p:nth-last-of-type(2)")].map((p) => p.textContent)).toEqual(["NaN|1|false", "Infinity|1|false", "-Infinity|1|false"]);
  islands.unmount();

  document.body.innerHTML = page.replace(/:(NaN|-?Infinity)/g, ":null");
  (await mountIslands(components)).unmount();
  expect(warnings).not.toEqual([]);
});

it("hydrates a nullable prop from the null the server wrote, which an absent prop would not match", async () => {
  const page = readFileSync(join(ROOT, "null-islands.html"), "utf8").trim();
  attachSsrRender(join(ROOT, "components", "Nullable.vue"), "Nullable", components.Nullable!);
  attachSsrRender(join(ROOT, "components", "NullChild.vue"), "NullChild", components.NullChild!);
  const islands = [...page.matchAll(/<div data-island="Nullable" data-props="([^"]*)">(.*?)<\/div>(?=<div data-island|$)/g)];
  expect(islands).toHaveLength(2);
  for (const [, attr, html] of islands) {
    const props = JSON.parse(attr!.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown>;
    expect(Object.values(props)).toContain(null);
    expect(await renderToString(createSSRApp(components.Nullable!, props))).toBe(html);
  }

  document.body.innerHTML = page;
  const mounted = await mountIslands(components);
  expect(mounted.apps).toHaveLength(2);
  expect(warnings).toEqual([]);
  mounted.unmount();

  document.body.innerHTML = page.replace(/&quot;count&quot;:null,/, "");
  (await mountIslands(components)).unmount();
  expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).not.toEqual([]);
});

it("leaves an island it cannot hydrate as the server rendered it, and says why", async () => {
  const text = fixture("Text", "full");
  document.body.innerHTML = `${island("Missing", {}, "<p>kept</p>")}<div data-island="Text" data-props="{not json">${text.html}</div>${island("Text", text.props, text.html)}`;
  const problems: string[] = [];
  const islands = await mountIslands(components, { onError: (_el, problem) => problems.push(problem) });
  expect(islands.apps).toHaveLength(1);
  expect(problems).toEqual([expect.stringMatching(/^no component called "Missing" was given \(`ferrovue\/islands` holds/), "the props of Text are not JSON"]);
  expect(document.body.innerHTML).toContain("<p>kept</p>");
  islands.unmount();
});

it("unmounts every island", async () => {
  const text = fixture("Text", "full");
  document.body.innerHTML = island("Text", text.props, text.html) + island("Text", text.props, text.html);
  const islands = await mountIslands(components);
  expect(islands.apps).toHaveLength(2);
  islands.unmount();
  expect(islands.apps).toHaveLength(0);
});

it("loads only the components the page names, each once, and mounts their islands in document order", async () => {
  const text = fixture("Text", "full");
  const badge = fixture("Badge", "full");
  document.body.innerHTML = `${stateScript(badge.stores)}${island("Text", text.props, text.html)}${island("Badge", badge.props, badge.html)}${island("Text", text.props, text.html)}`;
  const calls: string[] = [];
  const lazy = (name: string) => async () => {
    calls.push(name);
    await new Promise((resolve) => setTimeout(resolve, name === "Text" ? 10 : 0));
    return { default: components[name]! };
  };
  const before = [...document.querySelectorAll("[data-island]")].map((el) => el.firstChild);
  const pinia = createPinia();
  hydrateState(pinia);
  const islands = await mountIslands({ Text: lazy("Text"), Badge: lazy("Badge"), Nav: lazy("Nav") }, { pinia });
  expect(calls).toEqual(["Text", "Badge"]);
  expect(islands.apps.map((app) => Reflect.get(app, "_component"))).toEqual([components.Text, components.Badge, components.Text]);
  expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).toEqual([]);
  expect([...document.querySelectorAll("[data-island]")].map((el) => el.firstChild)).toEqual(before);
  islands.unmount();
});

it("takes a loader that resolves to the component itself, and a functional component as a component", async () => {
  const text = fixture("Text", "full");
  document.body.innerHTML = `${island("Text", text.props, text.html)}${island("Plain", { label: "hi" }, "<b>hi</b>")}`;
  const Plain = Object.assign((props: { label: string }) => h("b", props.label), { props: ["label"] });
  const islands = await mountIslands({ Text: () => Promise.resolve(components.Text!), Plain });
  expect(islands.apps.map((app) => Reflect.get(app, "_component"))).toEqual([components.Text, Plain]);
  expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).toEqual([]);
  islands.unmount();
});

it("leaves the islands of a component that did not load as the server rendered them", async () => {
  const text = fixture("Text", "full");
  document.body.innerHTML = `${island("Text", text.props, text.html)}${island("Broken", {}, "<p>kept</p>")}`;
  const problems: string[] = [];
  const islands = await mountIslands(
    { Text: () => Promise.resolve({ default: components.Text! }), Broken: () => Promise.reject(new Error("offline")) },
    { onError: (_el, problem) => problems.push(problem) },
  );
  expect(islands.apps).toHaveLength(1);
  expect(problems).toEqual(["Broken did not load: offline"]);
  expect(document.body.innerHTML).toContain("<p>kept</p>");
  islands.unmount();
});

it("reports an island that throws as it mounts, and still hydrates the ones after it", async () => {
  document.body.innerHTML = `${island("Throws", {}, "<p>kept</p>")}${island("Plain", { label: "hi" }, "<b>hi</b>")}`;
  const Throws = { setup: (): never => { throw new Error("broken setup"); } };
  const Plain = Object.assign((props: { label: string }) => h("b", props.label), { props: ["label"] });
  const problems: string[] = [];
  const islands = await mountIslands({ Throws, Plain }, { onError: (_el, problem) => problems.push(problem) });
  expect(islands.apps.map((app) => Reflect.get(app, "_component"))).toEqual([Plain]);
  expect(problems).toEqual(["Throws did not mount: broken setup"]);
  islands.unmount();
});
