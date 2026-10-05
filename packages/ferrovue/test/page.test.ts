import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPageApp, mountPage, type PageRecord } from "../src/client.ts";
import { hydrateRecordedPage } from "../src/hydration.ts";
import { attachSsrRender } from "../src/testing.ts";
import { CLIENT_ONLY, ROOT } from "./conformance-cases.ts";

const WRITE = process.env.FERROVUE_FIXTURES_WRITE === "1";
const PAGES = join(ROOT, "pages");

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/{Panel,Frame,Text,Prose,ClientSide,PlainBox}.vue", {
  eager: true,
});
const components: Record<string, Component> = Object.fromEntries(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);
for (const [name, component] of Object.entries(components)) attachSsrRender(join(ROOT, "components", `${name}.vue`), name, component);

interface PageFixture {
  name: string;
  base: string;
  layout: string;
  record: PageRecord;
  html: string;
}

const pages: PageFixture[] = readdirSync(PAGES)
  .filter((f) => f.endsWith(".json"))
  .toSorted()
  .map((f) => {
    const base = join(PAGES, f.slice(0, -".json".length));
    const { layout, record } = JSON.parse(readFileSync(`${base}.json`, "utf8")) as { layout: string; record: PageRecord };
    let html = "";
    try {
      html = readFileSync(`${base}.html`, "utf8");
    } catch {
    }
    return { name: f, base, layout, record, html };
  });

afterEach(() => {
  document.body.innerHTML = "";
});

it("has page fixtures", () => {
  expect(pages.length).toBeGreaterThanOrEqual(4);
});

describe("Vue renders each page to its recorded HTML", () => {
  for (const page of pages) {
    it(`pages/${page.name}`, async () => {
      const html = await renderToString(createPageApp(components[page.layout]!, page.record, components));
      if (WRITE) writeFileSync(`${page.base}.html`, html);
      // oxlint-disable-next-line vitest/no-conditional-expect -- a recording run writes instead of comparing
      else expect(html).toBe(page.html);
    });
  }
});

describe.skipIf(WRITE)("each recorded page hydrates exactly", () => {
  for (const page of pages) {
    it(`pages/${page.name}`, async () => {
      const app = await hydrateRecordedPage({ html: `<div id="app">${page.html}</div>`, record: page.record }, components[page.layout]!, components);
      const named = Object.values(page.record.slots).flatMap((parts) => parts.map((part) => part.c));
      for (const shown of named.map((c) => CLIENT_ONLY[c]).filter(Boolean)) {
        expect(document.getElementById("app")!.innerHTML, "`<ClientOnly>` showed its content once mounted").toContain(shown);
      }
      app.unmount();
    });
  }
});

const Shelf = defineComponent({ props: { title: String }, setup: (props, { slots }) => () => h("ul", [h("li", props.title), slots.default?.()]) });
const Item = defineComponent({ props: { label: String, n: Number }, setup: (props) => () => h("li", `${props.label} ${props.n}`) });
const shelf: PageRecord = { props: { title: "s" }, slots: { default: [{ c: "Item", p: { label: "a", n: 1 } }, { c: "Item", p: { label: "b", n: 2 } }] } };
const shelfHtml = "<ul><li>s</li><!--[--><li>a 1</li><li>b 2</li><!--]--></ul>";

it("renders a slot's parts as Vue renders them, with no fragment of their own", async () => {
  expect(await renderToString(createPageApp(Shelf, shelf, { Item }))).toBe(shelfHtml);
});

it("loads only the components the record names", async () => {
  const unused = vi.fn<() => Promise<{ default: Component }>>(async () => ({ default: Item }));
  const item = vi.fn<() => Promise<{ default: Component }>>(async () => ({ default: Item }));
  const app = await hydrateRecordedPage({ html: `<div id="app">${shelfHtml}</div>`, record: shelf }, Shelf, { Item: item, Unused: unused });
  expect(item).toHaveBeenCalledOnce();
  expect(unused).not.toHaveBeenCalled();
  expect(document.querySelector("#app li:last-child")!.textContent).toBe("b 2");
  app.unmount();
});

it("reads back the numbers JSON cannot carry, and the escapes the server writes", async () => {
  document.body.innerHTML =
    '<main><ul><li>&lt;/script&gt;</li><!--[--><li>a NaN</li><li>b -Infinity</li><!--]--></ul></main>' +
    '<script type="application/json" id="page">{"props":{"title":"\\u003c/script\\u003e"},"slots":{"default":[{"c":"Item","p":{"label":"a","n":NaN}},{"c":"Item","p":{"label":"b","n":-Infinity}}]}}</script>';
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = await mountPage(Shelf, { Item }, { container: "main", record: "page" });
  expect(warn).not.toHaveBeenCalled();
  expect(document.querySelector("main")!.innerHTML).toBe("<ul><li>&lt;/script&gt;</li><!--[--><li>a NaN</li><li>b -Infinity</li><!--]--></ul>");
  app.unmount();
  vi.restoreAllMocks();
});

it("fails on a fragment the client does not render, as a v-for of the parts would write", async () => {
  const html = `<div id="app"><ul><li>s</li><!--[--><!--[--><li>a 1</li><li>b 2</li><!--]--><!--]--></ul></div>`;
  await expect(hydrateRecordedPage({ html, record: shelf }, Shelf, { Item })).rejects.toThrow(/did not hydrate exactly/);
});

it("refuses a page whose record or container is missing, or whose components are not all given", async () => {
  document.body.innerHTML = `<div id="app">${shelfHtml}</div>`;
  await expect(mountPage(Shelf, { Item })).rejects.toThrow(/no record: no <script id="__fv_page">/);
  await expect(mountPage(Shelf, { Item }, { container: "#nowhere" })).rejects.toThrow(/no #nowhere to mount on/);
  document.body.insertAdjacentHTML("beforeend", `<script type="application/json" id="__fv_page">${JSON.stringify(shelf)}</script>`);
  await expect(mountPage(Shelf, {})).rejects.toThrow(/no component called "Item" was given to mountPage/);
  const failing = async (): Promise<{ default: Component }> => {
    throw new Error("offline");
  };
  await expect(mountPage(Shelf, { Item: failing })).rejects.toThrow(/Item did not load: offline/);
  expect(document.getElementById("app")!.innerHTML).toBe(shelfHtml);
});
