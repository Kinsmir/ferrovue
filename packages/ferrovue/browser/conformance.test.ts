import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { chromium, firefox, webkit, type Browser, type ConsoleMessage, type Page } from "playwright";
import { build, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cases, CLIENT_ONLY, COMMENTS, CSS_MODULES, datePlans, OPTIONS, ROUTES, UNHEAD_REWRITES, VUE_DISAGREES } from "../test/conformance-cases.ts";
import { hydrationBody, recordedHead } from "../src/conformance.ts";
import type { PageData } from "./entry.ts";

const ORIGIN = "http://conformance.test";
const LAUNCHERS = { chromium, firefox, webkit };
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];

const PATCHED: Record<string, { browsers?: string[]; server: string; hydrated: string }[]> = {
  "Styles/hostile.json": [{ server: 'style="color:red&quot;&gt;&lt;script&gt;;display:none;"', hydrated: 'style="display: none;"' }],
  "CssVarsBranch/on.json": [{ server: '<b data-v-d62f6e13="">c</b>', hydrated: '<b data-v-d62f6e13="" style="--d62f6e13-tone: pink;">c</b>' }],
  "CssVarsShapes/on.json": [{ server: '<b data-v-d62f6e13="">c</b>', hydrated: '<b data-v-d62f6e13="" style="--d62f6e13-tone: teal;">c</b>' }],
  "CssVarsShapes/hostile.json": [
    {
      browsers: ["chromium", "firefox"],
      server: '<b data-v-d62f6e13="">c</b>',
      hydrated: `<b data-v-d62f6e13="" style="--d62f6e13-tone: &quot;&lt;/main&gt;&quot; '&lt;i&gt;' &amp;;">c</b>`,
    },
    {
      browsers: ["webkit"],
      server: '<b data-v-d62f6e13="">c</b>',
      hydrated: '<b data-v-d62f6e13="" style="--d62f6e13-tone: &quot;&lt;/main&gt;&quot; &quot;&lt;i&gt;&quot; &amp;;">c</b>',
    },
  ],
  "CssVarsPage/full.json": [
    {
      server: "<i>a</i><i>b</i>",
      hydrated: '<i style="--d9e366c1-tone: maroon; --d9e366c1-size: 2;">a</i><i style="--d9e366c1-tone: maroon; --d9e366c1-size: 2;">b</i>',
    },
  ],
  "AttrQuirks/absent.json": [{ server: `a^="x">keys`, hydrated: `a^="x" value="x">keys` }],
  "AttrQuirks/empty.json": [{ server: `a^="">keys`, hydrated: `a^="" value="">keys` }],
  "AttrQuirks/full.json": [{ server: `a^="Go">keys`, hydrated: `a^="Go" value="Go">keys` }],
  "AttrQuirks/hostile.json": [{ server: `a^="&lt;&quot;&amp;'&gt;">keys`, hydrated: `a^="&lt;&quot;&amp;'&gt;" value="&lt;&quot;&amp;'&gt;">keys` }],
  "Numbers/tiny-and-huge.json": [{ browsers: ["firefox"], server: 'max="9007199254740992"', hydrated: 'max="9007199254740990"' }],
};

let bundle = "";
beforeAll(async () => {
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const result = (await build({
    configFile: false,
    root: join(import.meta.dirname, "../../.."),
    logLevel: "warn",
    plugins: [vue({ script: { fs: { fileExists: existsSync, readFile: (file) => readFileSync(file, "utf8"), realpath: realpathSync } }, template: { compilerOptions: { comments: COMMENTS } } })],
    css: { modules: { generateScopedName: CSS_MODULES.generateScopedName } },
    resolve: { alias: [{ find: /^ferrovue$/, replacement: join(import.meta.dirname, "../src/client.ts") }] },
    define: { __VUE_I18N_FULL_INSTALL__: "true", __VUE_I18N_LEGACY_API__: "false", __INTLIFY_PROD_DEVTOOLS__: "false" },
    build: { write: false, minify: false, rolldownOptions: { input: join(import.meta.dirname, "entry.ts"), output: { codeSplitting: false } } },
  }).finally(() => {
    process.env.NODE_ENV = nodeEnv;
  })) as Rolldown.RolldownOutput;
  bundle = result.output.find((o): o is Rolldown.OutputChunk => o.type === "chunk" && o.isEntry)!.code;
});

function pageFor(c: (typeof cases)[number], light = false): string {
  const data: PageData = { component: c.component, fixture: c.json, routes: ROUTES, options: OPTIONS, plans: datePlans(), light };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const head = recordedHead(c.html);
  return (
    `<!doctype html><html${head?.htmlAttrs ?? ""}><head><meta charset="utf-8">${light ? '<base href="/static/">' : ""}${head ? "" : `<title>${c.component}/${c.name}</title>`}` +
    `<script type="application/json" id="fv-fixture">${json}</script>` +
    `<script type="module" src="/entry.js"></script>${head?.headTags ?? ""}</head>` +
    `<body${head?.bodyAttrs ?? ""}>${hydrationBody(c.html)}</body></html>`
  );
}

async function describeMessage(m: ConsoleMessage): Promise<string> {
  const args = await Promise.all(
    m.args().map((a) =>
      a.evaluate((v) => (v instanceof Element ? v.outerHTML.slice(0, 200) : v instanceof Node ? JSON.stringify(v.textContent) : String(v))),
    ),
  ).catch(() => [m.text()]);
  return `${m.type()}: ${args.join(" ")}`;
}

const ROUTED = cases.filter((c) => "$route" in c.json && c.component !== "App");
const pages = new Map<string, string>([...cases.map((c) => [`/${c.component}/${c.name}`, pageFor(c)] as const), ...ROUTED.map((c) => [`/light/${c.component}/${c.name}`, pageFor(c, true)] as const)]);

const ZONES = ["Pacific/Kiritimati", "America/St_Johns", "Asia/Kathmandu"];
const DATED = cases.filter((c) => ["DatePost", "DateStamp", "DateRows", "DateDays", "DateReplies", "DateThread", "LoadedDates"].includes(c.component));

async function serve(page: Page, logged: (message: Promise<string>) => void): Promise<void> {
  page.on("console", (m) => {
    if (!m.location().url.startsWith(ORIGIN)) return;
    if (m.type() === "error" || (m.type() === "warning" && (/hydrat|mismatch/i.test(m.text()) || new URL(page.url()).pathname.startsWith("/light/")))) logged(describeMessage(m));
  });
  page.on("pageerror", (e) => logged(Promise.resolve(`uncaught: ${e.message}`)));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/entry.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    const html = pages.get(decodeURIComponent(path));
    return html === undefined ? route.fulfill({ status: 204 }) : route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
}

describe.each(BROWSERS)("%s", (name) => {
  let browser: Browser | undefined;
  let page: Page;
  let messages: Promise<string>[] = [];
  beforeAll(async () => {
    try {
      browser = await LAUNCHERS[name].launch();
    } catch (e) {
      if (process.env.CI) throw e;
      console.warn(`${name} does not launch here, so its tests are skipped:`, String(e).split("\n")[0]);
      return;
    }
    page = await browser.newPage();
    await serve(page, (m) => void messages.push(m));
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const c of cases) {
    it(`${c.component}/${c.name}`, async ({ skip }) => {
      if (!browser) skip();
      messages = [];
      await page.goto(`${ORIGIN}/${c.component}/${c.name}`);
      const result = await page.evaluate(() => window.hydration!);
      const logged = await Promise.all(messages);
      expect(result.kept, "Vue kept the server's first node").toBe(true);
      expect(result.settled, "`<ClientOnly>` showed its content once mounted").toContain(CLIENT_ONLY[c.component] ?? "");
      const disagrees = VUE_DISAGREES.has(`${c.component}/${c.name}`);
      expect(disagrees ? [] : logged).toEqual([]);
      expect(logged.length > 0, "a fixture mismatches exactly when it is in VUE_DISAGREES").toBe(disagrees);
      if (disagrees) return;
      let expected = result.before;
      for (const p of PATCHED[`${c.component}/${c.name}`] ?? []) {
        if (p.browsers && !p.browsers.includes(name)) continue;
        expect(expected, "the attribute PATCHED lists is in the page").toContain(p.server);
        expected = expected.replace(p.server, p.hydrated);
      }
      expect(result.after, "hydrating left the document as the browser parsed it").toBe(expected);
      if (!recordedHead(c.html)) return;
      const rewrites = UNHEAD_REWRITES.has(`${c.component}/${c.name}`);
      expect(rewrites ? "" : result.head.after, "unhead's client took over the head as the browser parsed it").toBe(rewrites ? "" : result.head.before);
      expect(result.head.after !== result.head.before, "a head is rewritten exactly when its fixture is in UNHEAD_REWRITES").toBe(rewrites);
    });
  }

  it("hydrates every fixture that reads the route with linkRoutes as it was recorded", async ({ skip }) => {
    if (!browser) skip();
    expect(ROUTED.length).toBeGreaterThanOrEqual(40);
    for (const c of ROUTED) {
      messages = [];
      await page.goto(`${ORIGIN}/light/${c.component}/${c.name}`);
      const result = await page.evaluate(() => window.hydration!);
      expect(await Promise.all(messages), `${c.component}/${c.name}`).toEqual([]);
      expect(result.kept, `${c.component}/${c.name}`).toBe(true);
      expect(result.after, `${c.component}/${c.name}`).toBe(result.before);
    }
  }, 60_000);

  it("hands a click on a link hydrated with linkRoutes to navigate", async ({ skip }) => {
    if (!browser) skip();
    messages = [];
    await page.goto(`${ORIGIN}/light/Nav/at-intro.json`);
    await page.evaluate(() => window.hydration!);
    const prevented = page.evaluate(() => new Promise<boolean>((resolve) => document.addEventListener("click", (e) => resolve(e.defaultPrevented), { once: true })));
    await page.click('a[href="/blog/intro/edit"]');
    expect(await prevented).toBe(true);
    await page.click('a[href="/blog/intro"]');
    expect(await page.evaluate(() => window.navigated)).toEqual(["/blog/intro/edit", "/blog/intro"]);
    expect(new URL(page.url()).pathname).toBe("/light/Nav/at-intro.json");
    expect(await page.getAttribute('a[href="/blog/intro"]', "aria-current")).toBe("page");
    expect(await Promise.all(messages)).toEqual([]);
  });

  for (const zone of ZONES) {
    it(`hydrates every fixture with a Date prop, or dates inside its props or its loaders' results, in ${zone} as it was recorded`, async ({ skip }) => {
      if (!browser) skip();
      expect(DATED.length).toBeGreaterThanOrEqual(27);
      const context = await browser!.newContext({ timezoneId: zone });
      const zoned = await context.newPage();
      const logged: Promise<string>[] = [];
      await serve(zoned, (m) => void logged.push(m));
      try {
        expect(await zoned.evaluate(() => new Date(0).getTimezoneOffset())).not.toBe(0);
        for (const c of DATED) {
          await zoned.goto(`${ORIGIN}/${c.component}/${c.name}`);
          const result = await zoned.evaluate(() => window.hydration!);
          expect(await Promise.all(logged), `${c.component}/${c.name}`).toEqual([]);
          expect(result.after, `${c.component}/${c.name}`).toBe(result.before);
          expect(result.kept).toBe(true);
        }
      } finally {
        await context.close();
      }
    }, 60_000);
  }
});
