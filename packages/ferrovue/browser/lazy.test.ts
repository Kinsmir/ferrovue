import { readFileSync } from "node:fs";
import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { escapeHtml } from "@vue/shared";
import { chromium, firefox, webkit, type Browser, type Page } from "playwright";
import { build, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT } from "../test/conformance-cases.ts";

const ORIGIN = "http://lazy.test";
const LAUNCHERS = { chromium, firefox, webkit };
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];
const WIDE = "(min-width: 1000px)";

function island(component: string, fixture: string, hydrate?: string): string {
  const base = join(ROOT, "fixtures", component, fixture);
  const { $slots: _, $stores: __, $route: ___, ...props } = JSON.parse(readFileSync(`${base}.json`, "utf8")) as Record<string, unknown>;
  const when = hydrate === undefined ? "" : ` data-hydrate="${escapeHtml(hydrate)}"`;
  return `<div data-island="${component}" data-props="${escapeHtml(JSON.stringify(props))}"${when}>${readFileSync(`${base}.html`, "utf8")}</div>`;
}

const BODY = island("Text", "hostile") + island("Attrs", "hostile", "idle") + island("Lists", "hostile", `media:${WIDE}`);
const DOCUMENT =
  `<!doctype html><html><head><meta charset="utf-8"><title>lazy</title>` +
  `<script type="module" src="/entry.js"></script></head><body>${BODY}` +
  `<script>document.currentScript.remove(); window.parsed = document.body.innerHTML;</script></body></html>`;

const files = new Map<string, { type: string; body: string | Uint8Array }>();
beforeAll(async () => {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const result = (await build({
    configFile: false,
    root: import.meta.dirname,
    logLevel: "warn",
    plugins: [vue()],
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: { entry: "lazy-entry.ts" }, output: { entryFileNames: "[name].js", chunkFileNames: "[name]-[hash].js", assetFileNames: "[name]-[hash][extname]" } },
    },
  }).finally(() => {
    process.env.NODE_ENV = nodeEnv;
  })) as Rolldown.RolldownOutput;
  for (const out of result.output) {
    const type = out.fileName.endsWith(".css") ? "text/css" : "text/javascript";
    files.set(out.fileName, { type, body: out.type === "chunk" ? out.code : out.source });
  }
});

function holdIdle(): void {
  const real = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback.bind(window) : null;
  const held: { run: () => void; cancelled: boolean }[] = [];
  let next = 0;
  window.requestIdleCallback = (callback, options) => {
    next += 1;
    const entry = { cancelled: false, run: () => void 0 };
    entry.run = () => {
      if (entry.cancelled) return;
      if (real) real(callback, options);
      else setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0);
    };
    held.push(entry);
    return next;
  };
  window.cancelIdleCallback = (id) => {
    const entry = held[id - 1];
    if (entry) entry.cancelled = true;
  };
  (window as { releaseIdle?: () => void }).releaseIdle = () => {
    for (const entry of held) entry.run();
  };
}

describe.each(BROWSERS)("%s", (name) => {
  let browser: Browser | undefined;
  let page: Page;
  let messages: string[] = [];
  let chunks: string[] = [];
  beforeAll(async () => {
    try {
      browser = await LAUNCHERS[name].launch();
    } catch (e) {
      if (process.env.CI) throw e;
      console.warn(`${name} does not launch here, so its tests are skipped:`, String(e).split("\n")[0]);
      return;
    }
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.addInitScript(holdIdle);
    page.on("console", (m) => {
      if (m.type() === "warning" || m.type() === "error") messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => void messages.push(`uncaught: ${e.message}`));
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname.slice(1));
      if (path === "") return route.fulfill({ contentType: "text/html; charset=utf-8", body: DOCUMENT });
      const file = files.get(path);
      if (!file) return route.fulfill({ status: 404 });
      if (path !== "entry.js") chunks.push(path.replace(/-[\w-]+\.\w+$/, ""));
      return route.fulfill({ contentType: file.type, body: typeof file.body === "string" ? file.body : Buffer.from(file.body) });
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function open(): Promise<void> {
    messages = [];
    chunks = [];
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(async () => void (await window.islands));
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
  }

  const hydrated = (component: string): Promise<boolean> =>
    page.locator(`[data-island="${component}"]`).evaluate((el) => Boolean((el as { _vnode?: unknown })._vnode));

  const unchanged = (): Promise<boolean> => page.evaluate(() => document.body.innerHTML === (window as { parsed?: string }).parsed);

  it("fetches an island waiting for idle only once the browser is idle, and hydrates it exactly", async ({ skip }) => {
    if (!browser) skip();
    await open();
    expect(await hydrated("Text")).toBe(true);
    expect(await hydrated("Attrs")).toBe(false);
    expect(chunks).toEqual([]);
    expect(await unchanged()).toBe(true);

    await page.evaluate(() => (window as { releaseIdle?: () => void }).releaseIdle!());
    await page.waitForFunction(() => Boolean((document.querySelector('[data-island="Attrs"]') as { _vnode?: unknown } | null)?._vnode));
    expect(chunks).toEqual(["Attrs"]);
    expect(await hydrated("Lists")).toBe(false);
    expect(await unchanged()).toBe(true);
    expect(messages).toEqual([]);
  });

  it("fetches an island waiting for a media query only once it matches, and hydrates it exactly", async ({ skip }) => {
    if (!browser) skip();
    await open();
    expect(await page.evaluate((query) => matchMedia(query).matches, WIDE)).toBe(false);
    expect(await hydrated("Lists")).toBe(false);
    expect(chunks).toEqual([]);
    expect(await unchanged()).toBe(true);

    await page.setViewportSize({ width: 1200, height: 600 });
    await page.waitForFunction(() => Boolean((document.querySelector('[data-island="Lists"]') as { _vnode?: unknown } | null)?._vnode));
    expect(chunks).toEqual(["Lists"]);
    expect(await hydrated("Attrs")).toBe(false);
    expect(await unchanged()).toBe(true);
    expect(messages).toEqual([]);
  });
});
