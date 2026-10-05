import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { chromium, firefox, webkit, type Browser, type Page } from "playwright";
import { build, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_ONLY, ROOT } from "../test/conformance-cases.ts";
import type { PageCase } from "./page-entry.ts";

const ORIGIN = "http://pages.test";
const LAUNCHERS = { chromium, firefox, webkit };
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];
const PAGES = join(ROOT, "pages");

const cases = new Map<string, PageCase>(
  readdirSync(PAGES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const base = join(PAGES, f.slice(0, -".json".length));
      const { layout, record } = JSON.parse(readFileSync(`${base}.json`, "utf8")) as Omit<PageCase, "html">;
      return [f, { layout, record, html: `<div id="app">${readFileSync(`${base}.html`, "utf8")}</div>` }];
    }),
);
const shelf = cases.get("shelf.json")!;
const FRAGMENTED = "fragmented";
cases.set(FRAGMENTED, { ...shelf, html: shelf.html.replace('<div class="body"><!--[-->', '<div class="body"><!--[--><!--[-->').replace("<!--]--></div>", "<!--]--><!--]--></div>") });

let bundle = "";
beforeAll(async () => {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const result = (await build({
    configFile: false,
    root: import.meta.dirname,
    logLevel: "warn",
    plugins: [vue()],
    resolve: { alias: [{ find: /^ferrovue\/client$/, replacement: join(import.meta.dirname, "../src/client.ts") }] },
    build: { write: false, minify: false, rolldownOptions: { input: "page-entry.ts", output: { codeSplitting: false } } },
  }).finally(() => {
    process.env.NODE_ENV = nodeEnv;
  })) as Rolldown.RolldownOutput;
  bundle = result.output.find((o): o is Rolldown.OutputChunk => o.type === "chunk" && o.isEntry)!.code;
});

function documentFor(c: PageCase): string {
  const json = JSON.stringify(c).replace(/</g, "\\u003c");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>page</title>` +
    `<script type="application/json" id="fv-page-case">${json}</script>` +
    `<script type="module" src="/entry.js"></script></head><body></body></html>`
  );
}

describe.each(BROWSERS)("%s", (name) => {
  let browser: Browser | undefined;
  let page: Page;
  beforeAll(async () => {
    try {
      browser = await LAUNCHERS[name].launch();
    } catch (e) {
      if (process.env.CI) throw e;
      console.warn(`${name} does not launch here, so its tests are skipped:`, String(e).split("\n")[0]);
      return;
    }
    page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      if (path === "entry.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      const c = cases.get(path);
      return c === undefined ? route.fulfill({ status: 204 }) : route.fulfill({ contentType: "text/html; charset=utf-8", body: documentFor(c) });
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const file of cases.keys()) {
    if (file === FRAGMENTED) continue;
    it(`hydrates ${file} exactly`, async ({ skip }) => {
      if (!browser) skip();
      await page.goto(`${ORIGIN}/${file}`);
      const result = await page.evaluate(() => window.pageHydration!);
      expect(result).toMatch(/^hydrated: /);
      const named = Object.values(cases.get(file)!.record.slots).flatMap((parts) => parts.map((part) => part.c));
      for (const shown of named.map((c) => CLIENT_ONLY[c]).filter(Boolean)) expect(result, "`<ClientOnly>` showed its content once mounted").toContain(shown);
    });
  }

  it("fails on a fragment the client does not render", async ({ skip }) => {
    if (!browser) skip();
    await page.goto(`${ORIGIN}/${FRAGMENTED}`);
    expect(await page.evaluate(() => window.pageHydration!)).toMatch(/did not hydrate exactly/);
  });
});
