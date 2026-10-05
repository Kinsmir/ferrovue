import { readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "@vue/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick, type Component } from "vue";
import { createPinia, type Pinia } from "pinia";
import { hydrateState, mountIslands, type IslandComponent } from "../src/client.ts";

const ROOT = join(import.meta.dirname, "../../../crates/ferrovue/tests/conformance");
const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", { eager: true });
const components = Object.fromEntries(Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]));

function fixture(component: string, name: string): { props: Record<string, unknown>; stores: unknown; html: string } {
  const base = join(ROOT, "fixtures", component, name);
  const { $slots: _, $stores, $route: __, ...props } = JSON.parse(readFileSync(`${base}.json`, "utf8")) as Record<string, unknown>;
  return { props, stores: $stores ?? {}, html: readFileSync(`${base}.html`, "utf8") };
}

const island = (name: string, props: unknown, html: string, hydrate?: string): string =>
  `<div data-island="${escapeHtml(name)}" data-props="${escapeHtml(JSON.stringify(props))}"${hydrate === undefined ? "" : ` data-hydrate="${escapeHtml(hydrate)}"`}>${html}</div>`;

const stateScript = (state: unknown): string => `<script type="application/json" id="__pinia">${JSON.stringify(state)}</script>`;

class Watcher {
  static all: Watcher[] = [];
  observed: Element[] = [];
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    if (options?.rootMargin !== undefined && !/^(-?\d+(px|%)\s*){1,4}$/.test(options.rootMargin)) throw new SyntaxError("rootMargin must be specified in pixels or percent");
    this.callback = callback;
    this.options = options;
    Watcher.all.push(this);
  }
  observe(el: Element): void {
    this.observed.push(el);
  }
  disconnect(): void {
    this.observed = [];
  }
  static show(el: Element): void {
    for (const watcher of Watcher.all) {
      if (watcher.observed.includes(el)) watcher.callback([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], watcher as never);
    }
  }
}

let warnings: string[] = [];
let calls: string[] = [];
beforeEach(() => {
  warnings = [];
  calls = [];
  Watcher.all = [];
  const record = (...args: unknown[]): void => void warnings.push(args.map(String).join(" "));
  vi.spyOn(console, "warn").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
  vi.stubGlobal("IntersectionObserver", Watcher);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const lazy = (...names: string[]): Record<string, IslandComponent> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      async () => {
        calls.push(name);
        await Promise.resolve();
        return { default: components[name]! };
      },
    ]),
  );

const counter = fixture("Counter", "fresh");
const text = fixture("Text", "full");

function page(hydrate: string): { pinia: Pinia; lazyIsland: HTMLElement; first: ChildNode | null } {
  document.body.innerHTML = `${stateScript(counter.stores)}${island("Text", text.props, text.html)}${island("Counter", counter.props, counter.html, hydrate)}`;
  const pinia = createPinia();
  hydrateState(pinia);
  const lazyIsland = document.querySelector<HTMLElement>('[data-island="Counter"]')!;
  return { pinia, lazyIsland, first: lazyIsland.firstChild };
}

const mismatches = (): string[] => warnings.filter((w) => /hydrat|mismatch/i.test(w));

it("loads and hydrates an island that waits to be visible only once it is, leaving it as it was", async () => {
  const { pinia, lazyIsland, first } = page("visible");
  const html = document.body.innerHTML;
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  expect(calls).toEqual(["Text"]);
  expect(islands.apps).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls).toEqual(["Text"]);
  expect(document.body.innerHTML).toBe(html);

  Watcher.show(lazyIsland);
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  expect(calls).toEqual(["Text", "Counter"]);
  expect(mismatches()).toEqual([]);
  expect(lazyIsland.firstChild).toBe(first);
  expect(document.body.innerHTML).toBe(html);
  lazyIsland.querySelector("h4")!.click();
  await nextTick();
  expect(lazyIsland.firstElementChild!.getAttribute("data-count")).toBe("1");
  islands.unmount();
});

it("hands a root margin to the observer of an island that waits to be visible", async () => {
  const { pinia, lazyIsland, first } = page("visible:200px 0px");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  expect(Watcher.all.map((w) => w.options)).toEqual([{ rootMargin: "200px 0px" }]);
  expect(calls).toEqual(["Text"]);
  Watcher.show(lazyIsland);
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  expect(mismatches()).toEqual([]);
  expect(lazyIsland.firstChild).toBe(first);
  islands.unmount();
});

it("observes with the default margin when the one given is empty", async () => {
  const { pinia } = page("visible:");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  expect(Watcher.all.map((w) => w.options)).toEqual([undefined]);
  islands.unmount();
});

it("hydrates at once an island whose root margin the browser rejects, read exactly, and says so", async () => {
  const margin = `200px" onclick="x' &amp; <b>`;
  const { pinia, lazyIsland } = page(`visible:${margin}`);
  expect(lazyIsland.dataset.hydrate).toBe(`visible:${margin}`);
  const problems: string[] = [];
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia, onError: (_el, problem) => problems.push(problem) });
  expect(islands.apps).toHaveLength(2);
  expect(calls).toEqual(["Text", "Counter"]);
  expect(problems).toEqual([`Counter has data-hydrate=${JSON.stringify(`visible:${margin}`)}, which the browser rejects (rootMargin must be specified in pixels or percent), so it hydrated at once`]);
  expect(mismatches()).toEqual([]);
  islands.unmount();
});

it("hydrates an island that waits for interaction on the first event, then dispatches that event again", async () => {
  const { pinia, lazyIsland, first } = page("interaction");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  expect(calls).toEqual(["Text"]);
  lazyIsland.querySelector("h4")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  lazyIsland.querySelector("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  await nextTick();
  expect(calls).toEqual(["Text", "Counter"]);
  expect(mismatches()).toEqual([]);
  expect(lazyIsland.firstChild).toBe(first);
  expect(pinia.state.value.counter?.count).toBe(2);
  expect(lazyIsland.firstElementChild!.getAttribute("data-count")).toBe("2");
  lazyIsland.querySelector("h4")!.click();
  await nextTick();
  expect(pinia.state.value.counter?.count).toBe(3);
  islands.unmount();
});

it("hears a focus within the island, which does not bubble", async () => {
  const { pinia, lazyIsland } = page("interaction");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  lazyIsland.querySelector("h4")!.dispatchEvent(new FocusEvent("focus"));
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  expect(mismatches()).toEqual([]);
  islands.unmount();
});

it("hydrates on the events it is given in place of the usual ones", async () => {
  const { pinia, lazyIsland } = page("interaction:keydown   wheel");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  lazyIsland.querySelector("h4")!.click();
  lazyIsland.dispatchEvent(new PointerEvent("pointerenter"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls).toEqual(["Text"]);
  lazyIsland.querySelector("h4")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  expect(mismatches()).toEqual([]);
  islands.unmount();
});

it("hydrates an island that waits for the browser to be idle once it is", async () => {
  const { pinia } = page("idle");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  expect(calls).toEqual(["Text"]);
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  expect(calls).toEqual(["Text", "Counter"]);
  expect(mismatches()).toEqual([]);
  islands.unmount();
});

it("waits a moment for idle where the browser cannot say when it is", async () => {
  vi.stubGlobal("requestIdleCallback", undefined);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { pinia } = page("idle");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  await vi.advanceTimersByTimeAsync(199);
  expect(calls).toEqual(["Text"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual(["Text", "Counter"]);
  vi.useRealTimers();
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  islands.unmount();
});

it("hydrates an island that waits for a media query once it matches, reading the query exactly", async () => {
  const query = `(min-width: 1px)" onclick="x' &amp; <b>`;
  const lists: { query: string; matches: boolean; change?: () => void }[] = [];
  vi.stubGlobal("matchMedia", (q: string) => {
    const list = {
      query: q,
      matches: false,
      addEventListener: (_: string, listener: () => void) => void (list.change = listener),
      removeEventListener: () => {},
    } as (typeof lists)[number] & { addEventListener: unknown; removeEventListener: unknown };
    lists.push(list);
    return list;
  });
  const { pinia, lazyIsland } = page(`media:${query}`);
  expect(lazyIsland.dataset.hydrate).toBe(`media:${query}`);
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  expect(lists.map((l) => l.query)).toEqual([query]);
  expect(calls).toEqual(["Text"]);
  lists[0]!.change!();
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  expect(mismatches()).toEqual([]);
  islands.unmount();
});

it("hydrates at once an island whose media query already matches", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const { pinia } = page("media:print");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  islands.unmount();
});

it("hydrates at once an island whose data-hydrate it does not know, and says so", async () => {
  const { pinia } = page("later");
  const problems: string[] = [];
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia, onError: (_el, problem) => problems.push(problem) });
  expect(islands.apps).toHaveLength(2);
  expect(problems).toEqual(['Counter has data-hydrate="later", which this version of ferrovue does not know, so it hydrated at once']);
  islands.unmount();
});

it("stops waiting once unmounted, loading nothing more", async () => {
  const { pinia, lazyIsland } = page("visible");
  const islands = await mountIslands(lazy("Text", "Counter"), { pinia });
  islands.unmount();
  Watcher.show(lazyIsland);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(calls).toEqual(["Text"]);
  expect(islands.apps).toHaveLength(0);
});

it("reports an island that waited and then did not load, leaving it as the server rendered it", async () => {
  const { pinia, lazyIsland } = page("visible");
  const html = document.body.innerHTML;
  const problems: string[] = [];
  const islands = await mountIslands({ ...lazy("Text"), Counter: () => Promise.reject(new Error("offline")) }, { pinia, onError: (_el, problem) => problems.push(problem) });
  Watcher.show(lazyIsland);
  await vi.waitFor(() => expect(problems).toEqual(["Counter did not load: offline"]));
  expect(islands.apps).toHaveLength(1);
  expect(document.body.innerHTML).toBe(html);
  islands.unmount();
});
