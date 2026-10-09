import { join } from "node:path";
import vue from "@vitejs/plugin-vue";
import { chromium, firefox, webkit, type Browser, type ConsoleMessage, type Page } from "playwright";
import { build, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cases, CLIENT_ONLY, CSS_MODULES, hydrationBody, OPTIONS, recordedHead, ROUTES, UNHEAD_REWRITES, VUE_DISAGREES } from "../test/conformance-cases.ts";
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
    plugins: [vue()],
    css: { modules: { generateScopedName: CSS_MODULES.generateScopedName } },
    resolve: { alias: [{ find: /^ferrovue\/client$/, replacement: join(import.meta.dirname, "../src/client.ts") }] },
    define: { __VUE_I18N_FULL_INSTALL__: "true", __VUE_I18N_LEGACY_API__: "false", __INTLIFY_PROD_DEVTOOLS__: "false" },
    build: { write: false, minify: false, rolldownOptions: { input: join(import.meta.dirname, "entry.ts"), output: { codeSplitting: false } } },
  }).finally(() => {
    process.env.NODE_ENV = nodeEnv;
  })) as Rolldown.RolldownOutput;
  bundle = result.output.find((o): o is Rolldown.OutputChunk => o.type === "chunk" && o.isEntry)!.code;
});

function pageFor(c: (typeof cases)[number]): string {
  const data: PageData = { component: c.component, fixture: c.json, routes: ROUTES, options: OPTIONS };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const head = recordedHead(c.html);
  return (
    `<!doctype html><html${head?.htmlAttrs ?? ""}><head><meta charset="utf-8">${head ? "" : `<title>${c.component}/${c.name}</title>`}` +
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

const pages = new Map(cases.map((c) => [`/${c.component}/${c.name}`, pageFor(c)]));

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
    page.on("console", (m) => {
      if (!m.location().url.startsWith(ORIGIN)) return;
      if (m.type() === "error" || (m.type() === "warning" && /hydrat|mismatch/i.test(m.text()))) messages.push(describeMessage(m));
    });
    page.on("pageerror", (e) => void messages.push(Promise.resolve(`uncaught: ${e.message}`)));
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/entry.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      const html = pages.get(decodeURIComponent(path));
      return html === undefined ? route.fulfill({ status: 204 }) : route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    });
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
});
