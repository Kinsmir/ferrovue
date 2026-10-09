import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { nextTick, type Component } from "vue";
import { createMemoryHistory } from "vue-router";
import { createPinia } from "pinia";
import { createHead } from "@unhead/vue/client";
import islandLoaders from "ferrovue/islands";
import { hydrateRecordedPage, renderRecordedPage } from "ferrovue/testing";
import { createAppRouter, hydrate, type Hydrated } from "../client/app.ts";
import BasketSummary from "../client/components/BasketSummary.vue";
import Picks from "../client/pages/picks.vue";
import Reviews from "../client/components/Reviews.vue";

const headRendered = async (): Promise<void> => {
  for (let i = 0; i < 2; i++) await new Promise((done) => setTimeout(done, 0));
};

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
  for (const path of ["/", "/books/dune", "/picks", "/picks?featured=left-hand"]) pages.set(path, render(path));
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function bodyOf(path: string): string {
  const body = /<body>([\s\S]*)<\/body>/.exec(pages.get(path)!)?.[1];
  expect(body, "the page has a body").toBeTruthy();
  expect(body).toMatch(/<script type="module" src="[^"]+"><\/script>$/);
  return body!.replace(/<script type="module"[^>]*><\/script>/g, "");
}

function put(path: string): void {
  document.body.innerHTML = bodyOf(path);
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
  expect(Object.keys(islandLoaders)).toEqual(["AddToBasket", "Pick", "Reviews"]);
  expect((await islandLoaders.Reviews!()).default).toBe(Reviews);
});

const roots = (): (ChildNode | null)[] => [...document.querySelectorAll("[data-island], #basket")].map((el) => el.firstChild);

it("hydrates the home page's store summary, and a book's island once it is clicked, changing nothing", async () => {
  put("/");
  const nodes = roots();
  const html = document.body.innerHTML;
  const { islands, pinia } = await hydrateAt("/");
  expect(warnings).toEqual([]);
  expect(islands.apps).toHaveLength(0);
  expect(nodes).toHaveLength(5);
  expect(roots()).toEqual(nodes);
  expect(document.body.innerHTML).toBe(html);
  expect(scoped(document.querySelector("#basket .basket")!, scopeId(BasketSummary))).toBe(true);

  const add = document.querySelector<HTMLButtonElement>("button.add")!;
  add.click();
  await vi.waitFor(() => expect(islands.apps).toHaveLength(1));
  await nextTick();
  expect(warnings).toEqual([]);
  expect(roots()).toEqual(nodes);
  expect(add.textContent).toBe("In the basket");
  expect(pinia.state.value.basket).toEqual({ owner: "guest", ids: ["solaris", "dune"] });
  expect(document.querySelector("#basket .basket")!.textContent).toBe("Basket of guest: 2 books");
});

it("hydrates a streamed book page, whose islands then share the store", async () => {
  put("/books/dune");
  const nodes = roots();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      readonly seen: IntersectionObserverCallback;
      constructor(seen: IntersectionObserverCallback) {
        this.seen = seen;
      }
      observe(target: Element): void {
        queueMicrotask(() => this.seen([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as never));
      }
      disconnect(): void {}
    },
  );
  const { islands, pinia } = await hydrateAt("/books/dune");
  await vi.waitFor(() => expect(islands.apps).toHaveLength(2));
  expect(warnings).toEqual([]);
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
  expect(document.querySelector("span.share")).toBeNull();
  expect(document.querySelector<HTMLAnchorElement>(".review-list a.share")!.href).toMatch(/^mailto:\?body=http/);
  expect(warnings).toEqual([]);
});

it("hydrates the staff picks as one app: the layout, and each part its record names", async () => {
  put("/picks");
  document.head.innerHTML = /<head>([\s\S]*)<\/head>/.exec(pages.get("/picks")!)![1]!;
  const head = document.head.innerHTML;
  expect(document.title).toBe("Staff picks · Ferrovue Books");
  const container = document.getElementById("app")!;
  const first = container.firstChild;
  const { page, islands, pinia } = await hydrateAt("/picks");
  await headRendered();
  expect(warnings).toEqual([]);
  expect(document.head.innerHTML, "unhead's client took over the head the server wrote").toBe(head);
  expect(page).toBeDefined();
  expect(islands.apps).toHaveLength(0);
  expect(container.firstChild).toBe(first);

  const add = document.querySelector<HTMLButtonElement>('.pick[data-id="dune"] button.add')!;
  add.click();
  await nextTick();
  expect(add.textContent).toBe("In the basket");
  expect(pinia.state.value.basket).toEqual({ owner: "guest", ids: ["solaris", "dune"] });
  document.querySelector<HTMLButtonElement>("button.more")!.click();
  await nextTick();
  expect([...document.querySelectorAll<HTMLElement>(".review-list li")].map((li) => li.style.display)).toEqual(["", "", ""]);
  expect(warnings).toEqual([]);
});

it("shows the next staff picks from the record of the page it fetches, in place of the one hydrated", async () => {
  put("/picks");
  const { page: first, show } = await hydrateAt("/picks");
  const old = document.getElementById("app")!;
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (href: string) => {
    fetched.push(href);
    return new Response(pages.get(href), { headers: { "content-type": "text/html; charset=utf-8" } });
  });
  document.querySelector<HTMLButtonElement>('.pick[data-id="dune"] button.add')!.click();
  await nextTick();
  await show("/picks?featured=left-hand");
  await headRendered();
  expect(fetched).toEqual(["/picks?featured=left-hand"]);
  expect(warnings).toEqual([]);
  expect(old.isConnected).toBe(false);
  expect(first).toBeDefined();
  expect(old.innerHTML, "the hydrated page was unmounted").toBe("");
  expect(document.querySelector(".reviews h2")!.textContent).toBe("Readers on The Left Hand of Darkness");
  expect(document.querySelector(".review-list q")!.textContent).toBe("Winter, and what it does to people.");
  expect(document.title).toBe("Staff picks · Ferrovue Books");

  const add = document.querySelector<HTMLButtonElement>('.pick[data-id="dune"] button.add')!;
  expect(add.textContent, "the next page starts from the state the server wrote into it").toBe("Add to basket");
  add.click();
  await nextTick();
  expect(add.textContent).toBe("In the basket");
  expect(app!.pinia.state.value.basket).toEqual({ owner: "guest", ids: ["solaris", "dune"] });
  expect(app!.router.currentRoute.value.fullPath).toBe("/picks?featured=left-hand");
  expect(warnings).toEqual([]);
});

it("renders the staff picks from their record as the server wrote them, with the testing helper", async () => {
  const history = createMemoryHistory();
  history.replace("/picks?featured=left-hand");
  const router = createAppRouter(history);
  await router.replace("/picks?featured=left-hand");
  const page = await renderRecordedPage({ html: bodyOf("/picks?featured=left-hand") }, Picks, islandLoaders, { pinia: createPinia(), router, plugins: [createHead()] });
  expect(document.querySelector(".reviews h2")!.textContent).toBe("Readers on The Left Hand of Darkness");
  page.unmount();
});

it("hydrates the staff picks exactly with the testing helper, from the page the server wrote", async () => {
  const history = createMemoryHistory();
  history.replace("/picks");
  const router = createAppRouter(history);
  await router.replace("/picks");
  const page = await hydrateRecordedPage({ html: bodyOf("/picks") }, Picks, islandLoaders, { pinia: createPinia(), router, plugins: [createHead()] });
  expect(document.querySelector(".review-list a.share")?.getAttribute("href")).toMatch(/^mailto:\?body=/);
  page.unmount();
});
