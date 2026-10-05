import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { nextTick, type Component } from "vue";
import { createMemoryHistory } from "vue-router";
import islands from "ferrovue/islands";
import { hydrate, type Hydrated } from "../client/app.ts";
import BasketSummary from "../client/components/BasketSummary.vue";
import Reviews from "../client/components/Reviews.vue";

const ROOT = join(import.meta.dirname, "../../..");

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

function put(path: string): void {
  const body = /<body>([\s\S]*)<\/body>/.exec(pages.get(path)!)?.[1];
  expect(body, "the page has a body").toBeTruthy();
  expect(body).toMatch(/<script type="module" src="[^"]+"><\/script>$/);
  document.body.innerHTML = body!.replace(/<script type="module"[^>]*><\/script>/g, "");
}

async function hydrateAt(path: string): Promise<Hydrated> {
  const history = createMemoryHistory();
  history.replace(path);
  app = await hydrate(history);
  return app;
}

function scopeId(component: Component): string {
  const id = (component as { __scopeId?: string }).__scopeId;
  expect(id, `${(component as { __name?: string }).__name} has scoped styles`).toMatch(/^data-v-[0-9a-f]{8}$/);
  return id!;
}

const scoped = (root: Element, id: string): boolean => [root, ...root.querySelectorAll("*")].every((el) => el.hasAttribute(id));

it("links the client build's stylesheets, scoped to the ids the server writes, the lazy islands' too", () => {
  const links = [...pages.get("/books/dune")!.matchAll(/<link rel="stylesheet" href="\/([^"]+)">/g)].map((m) => m[1]!);
  const css = links.map((f) => readFileSync(join(import.meta.dirname, "../dist", f), "utf8")).join("");
  for (const component of [BasketSummary, Reviews]) expect(css).toContain(`[${scopeId(component)}]`);
});

it("loads every island by the name the server writes, and only those", async () => {
  expect(Object.keys(islands)).toEqual(["AddToBasket", "Reviews"]);
  expect((await islands.Reviews!()).default).toBe(Reviews);
});

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
  expect(scoped(document.querySelector("#basket .basket")!, scopeId(BasketSummary))).toBe(true);
});

it("hydrates a streamed book page, whose islands then share the store", async () => {
  put("/books/dune");
  const nodes = roots();
  const { islands, pinia } = await hydrateAt("/books/dune");
  expect(warnings).toEqual([]);
  expect(islands.apps).toHaveLength(2);
  expect(roots()).toEqual(nodes);
  expect(pinia.state.value.basket).toEqual({ owner: "guest", ids: ["solaris"] });
  const summary = document.querySelector("#basket .basket")!;
  expect(summary.textContent).toBe("Basket of guest: 1 book");
  const add = document.querySelector<HTMLButtonElement>("button.add")!;
  add.click();
  await nextTick();
  expect(add.textContent).toBe("In the basket");
  expect(add.disabled).toBe(true);
  expect(summary.textContent).toBe("Basket of guest: 2 books");

  expect(scoped(document.querySelector(".review-list")!, scopeId(Reviews))).toBe(true);
  const items = [...document.querySelectorAll<HTMLElement>(".review-list li")];
  expect(items.map((li) => li.style.display)).toEqual(["", "", "none"]);
  document.querySelector<HTMLButtonElement>("button.more")!.click();
  await nextTick();
  expect(items.map((li) => li.style.display)).toEqual(["", "", ""]);
  expect(document.querySelector("button.more")).toBeNull();
  expect(warnings).toEqual([]);
});
