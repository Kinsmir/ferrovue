/* Every conformance fixture's recorded HTML, hydrated in real browsers.
 *
 * `conformance.test.ts` hydrates the same HTML in happy-dom, whose parser is not a browser's: where
 * a browser rebuilds markup as it parses (a `<div>` closing a `<p>`, a table's implied `<tbody>`,
 * `<select>`, entities), Vue hydrates against what the browser built, and only a browser shows the
 * mismatch. Each fixture is loaded as a page — the HTML as a server sends it, teleported content
 * in its targets — and hydrated by the components as a client build compiles them (`entry.ts`,
 * bundled once with Vite and Vue's development build). The test fails on any hydration warning and
 * any error the page logs, and checks that Vue kept the server's nodes and left the document as it
 * was parsed — apart from the attributes listed in `PATCHED`, which Vue rewrites on purpose, and
 * the fixtures in `VUE_DISAGREES`, which Vue's own client hydrates with a mismatch.
 *
 * Nothing listens on a port: Playwright answers the page's requests from memory. */
import vue from "@vitejs/plugin-vue";
import { chromium, firefox, webkit, type Browser, type ConsoleMessage, type Page } from "playwright";
import { build, type Rolldown } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cases, hydrationBody, OPTIONS, ROUTES, VUE_DISAGREES } from "../test/conformance-cases.ts";
import type { PageData } from "./entry.ts";

const ORIGIN = "http://conformance.test";
const LAUNCHERS = { chromium, firefox, webkit };
/** The browsers to hydrate in. One that will not launch fails the run in CI, and elsewhere is
 * skipped with a warning: WebKit, for one, needs system libraries only some Linux systems have. */
const BROWSERS = (process.env.FERROVUE_BROWSERS ?? "chromium,firefox,webkit").split(",") as (keyof typeof LAUNCHERS)[];

/** Attributes Vue rewrites as it hydrates, by fixture: since 3.5 it sets every dynamic prop again,
 * and `v-show` sets `style.display`, so the browser serialises what it was given anew. Each is the
 * attribute as the server wrote it (and the browser parsed it), then as it is once hydrated; the
 * test fails if one no longer happens, so the list stays true. */
const PATCHED: Record<string, { browsers?: string[]; server: string; hydrated: string }[]> = {
  // `v-show` sets `style.display`, and the browser writes the declarations back that it could
  // parse: the hostile colour is dropped.
  "Styles/hostile.json": [{ server: 'style="color:red&quot;&gt;&lt;script&gt;;display:none;"', hydrated: 'style="display: none;"' }],
  // Vue sets `meter.max`, a double, and Firefox reflects it into the attribute with 15 significant
  // digits: 2⁵³ reads back as 9007199254740990.
  "Numbers/tiny-and-huge.json": [{ browsers: ["firefox"], server: 'max="9007199254740992"', hydrated: 'max="9007199254740990"' }],
};

/** The bundle `entry.ts` builds to, with every component in it. */
let bundle = "";
beforeAll(async () => {
  // Vue's development build, which reports every mismatch with what differed.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const result = (await build({
    configFile: false,
    root: import.meta.dirname,
    logLevel: "warn",
    plugins: [vue()],
    define: { __VUE_I18N_FULL_INSTALL__: "true", __VUE_I18N_LEGACY_API__: "false", __INTLIFY_PROD_DEVTOOLS__: "false" },
    build: { write: false, minify: false, rolldownOptions: { input: "entry.ts" } },
  }).finally(() => {
    process.env.NODE_ENV = nodeEnv;
  })) as Rolldown.RolldownOutput;
  bundle = result.output.find((o): o is Rolldown.OutputChunk => o.type === "chunk" && o.isEntry)!.code;
});

/** The page a fixture is loaded as: its data in the head, its HTML as the body. */
function pageFor(c: (typeof cases)[number]): string {
  const data: PageData = { component: c.component, fixture: c.json, routes: ROUTES, options: OPTIONS };
  // `<` escaped, so no string in the fixture can close the script.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${c.component}/${c.name}</title>` +
    `<script type="application/json" id="fv-fixture">${json}</script>` +
    `<script type="module" src="/entry.js"></script></head>` +
    `<body>${hydrationBody(c.html)}</body></html>`
  );
}

/** A console message as Vue wrote it, with the elements it names as markup, not `JSHandle@node`. */
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
      // The page's own, not the browser's (Firefox's password manager warns on some pages). Other
      // warnings — a route with no match, a negative `v-for` range — are what the fixture tests.
      if (!m.location().url.startsWith(ORIGIN)) return;
      if (m.type() === "error" || (m.type() === "warning" && /hydrat|mismatch/i.test(m.text()))) messages.push(describeMessage(m));
    });
    page.on("pageerror", (e) => void messages.push(Promise.resolve(`uncaught: ${e.message}`)));
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/entry.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
      const html = pages.get(decodeURIComponent(path));
      // Anything else a fixture refers to (`<img src="/a.png">`) is there, and empty.
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
      // Where Vue's own server and client disagree, it mismatches and patches the document.
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
    });
  }
});
