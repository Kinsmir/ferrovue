/* `mountIslands` against pages as the Rust side writes them: each island the recorded conformance
 * HTML inside the wrapper `ferrovue::Html::island` writes (`tests/conformance.rs` holds the Rust
 * wrapper to this shape), with the stores' state in the script `state_script_into` writes. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "@vue/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Component } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { hydrateState, mountIslands } from "../src/client.ts";
import { routeRecords, type RouteEntry } from "../src/testing.ts";

const ROOT = join(import.meta.dirname, "../../../crates/ferrovue/tests/conformance");
const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", { eager: true });
const components = Object.fromEntries(Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]));

function fixture(component: string, name: string): { props: Record<string, unknown>; stores: unknown; route: string; html: string } {
  const base = join(ROOT, "fixtures", component, name);
  const { $slots: _, $stores, $route, ...props } = JSON.parse(readFileSync(`${base}.json`, "utf8")) as Record<string, unknown>;
  return { props, stores: $stores ?? {}, route: ($route as string | undefined) ?? "/", html: readFileSync(`${base}.html`, "utf8") };
}

/** What `Html::island` writes. */
const island = (name: string, props: unknown, html: string): string =>
  `<div data-island="${escapeHtml(name)}" data-props="${escapeHtml(JSON.stringify(props))}">${html}</div>`;

/** What `state_script_into` writes, with the same escapes. */
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
  // Hydrated in place: the server's nodes are the ones the apps now own.
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

it("leaves an island it cannot hydrate as the server rendered it, and says why", async () => {
  const text = fixture("Text", "full");
  document.body.innerHTML = `${island("Missing", {}, "<p>kept</p>")}<div data-island="Text" data-props="{not json">${text.html}</div>${island("Text", text.props, text.html)}`;
  const problems: string[] = [];
  const islands = await mountIslands(components, { onError: (_el, problem) => problems.push(problem) });
  expect(islands.apps).toHaveLength(1);
  expect(problems).toEqual(['no component called "Missing" was given', "the props of Text are not JSON"]);
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
