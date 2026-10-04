/* The pages the Rust server renders hydrate in the browser with no mismatch.
 *
 * Each page comes from the server binary itself (`--render <path>`: the page as a browser has it
 * once the stream ends), goes into happy-dom, and is hydrated by the client's own `hydrate()`. Vue
 * reports every hydration mismatch as a warning, so the test fails on any; it then checks that the
 * server's nodes are the ones Vue kept, that the hydrated islands work, and that the scoped styles
 * of the client build apply to the server's elements. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createMemoryHistory } from "vue-router";
import { components, hydrate, type Hydrated } from "../client/app.ts";

const ROOT = join(import.meta.dirname, "../../..");

/** The server's page at `path`, as `cargo run` prints it. */
function render(path: string): string {
  return execFileSync("cargo", ["run", "--quiet", "--locked", "-p", "ferrovue-example-fullstack", "--", "--render", path], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const pages = new Map<string, string>();
beforeAll(() => {
  for (const path of ["/", "/books/dune"]) pages.set(path, render(path));
});

let warnings: string[] = [];
let app: Hydrated | undefined;
beforeEach(() => {
  warnings = [];
  const record = (...args: unknown[]): void => void warnings.push(args.map(String).join(" "));
  vi.spyOn(console, "warn").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** Put the body of the server's page at `path` into the document, as the browser parses it —
 * without the client's `<script>`, whose code is what this test runs. */
function put(path: string): void {
  const body = /<body>([\s\S]*)<\/body>/.exec(pages.get(path)!)?.[1];
  expect(body, "the page has a body").toBeTruthy();
  expect(body).toMatch(/<script type="module" src="[^"]+"><\/script>$/);
  document.body.innerHTML = body!.replace(/<script type="module"[^>]*><\/script>/g, "");
}

/** Hydrate the document as the browser would at `path`. */
async function hydrateAt(path: string): Promise<Hydrated> {
  const history = createMemoryHistory();
  history.replace(path);
  app = await hydrate(history);
  return app;
}

/** The `data-v-` id the client build gave a component with `<style scoped>`. Hydration keeps the
 * server's attributes without comparing it, so a different one would leave the styles unapplied. */
function scopeId(name: string): string {
  const id = (components[name] as { __scopeId?: string }).__scopeId;
  expect(id, `${name} has scoped styles`).toMatch(/^data-v-[0-9a-f]{8}$/);
  return id!;
}

/** Whether every element from `root` down carries `id`. */
const scoped = (root: Element, id: string): boolean => [root, ...root.querySelectorAll("*")].every((el) => el.hasAttribute(id));

it("scopes the client build's stylesheet to the ids the server writes", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../dist/.vite/manifest.json"), "utf8")) as Record<string, { css?: string[] }>;
  const css = manifest["client/main.ts"]!.css!.map((f) => readFileSync(join(import.meta.dirname, "../dist", f), "utf8")).join("");
  for (const name of ["BasketSummary", "Reviews"]) expect(css).toContain(`[${scopeId(name)}]`);
});

/** The first node in each hydrated root: Vue keeps the server's node when it hydrates cleanly. */
const roots = (): (ChildNode | null)[] => [...document.querySelectorAll("[data-island], #basket")].map((el) => el.firstChild);

it("hydrates the home page, an island per book and the store's summary, changing nothing", async () => {
  put("/");
  const nodes = roots();
  const html = document.body.innerHTML;
  const { islands } = await hydrateAt("/");
  expect(warnings).toEqual([]);
  expect(islands.apps).toHaveLength(4);
  expect(nodes).toHaveLength(5);
  expect(roots()).toEqual(nodes);
  expect(document.body.innerHTML).toBe(html);
  // The summary's scoped styles reach the server's elements.
  expect(scoped(document.querySelector("#basket .basket")!, scopeId("BasketSummary"))).toBe(true);
});

it("hydrates a streamed book page, whose islands then share the store", async () => {
  put("/books/dune");
  const nodes = roots();
  const { islands, pinia } = await hydrateAt("/books/dune");
  expect(warnings).toEqual([]);
  // AddToBasket, and the Reviews streamed into the hole.
  expect(islands.apps).toHaveLength(2);
  expect(roots()).toEqual(nodes);
  expect(pinia.state.value.basket).toEqual({ owner: "guest", ids: ["solaris"] });
  // The island's click reaches the shared store, and the separately hydrated summary shows it.
  const summary = document.querySelector("#basket .basket")!;
  expect(summary.textContent).toBe("Basket of guest: 1 book");
  const add = document.querySelector<HTMLButtonElement>("button.add")!;
  add.click();
  await nextTick();
  expect(add.textContent).toBe("In the basket");
  expect(add.disabled).toBe(true);
  expect(summary.textContent).toBe("Basket of guest: 2 books");

  // The streamed reviews island: two of three shown, until the button shows the rest.
  expect(scoped(document.querySelector(".review-list")!, scopeId("Reviews"))).toBe(true);
  const items = [...document.querySelectorAll<HTMLElement>(".review-list li")];
  expect(items.map((li) => li.style.display)).toEqual(["", "", "none"]);
  document.querySelector<HTMLButtonElement>("button.more")!.click();
  await nextTick();
  expect(items.map((li) => li.style.display)).toEqual(["", "", ""]);
  expect(document.querySelector("button.more")).toBeNull();
  expect(warnings).toEqual([]);
});
