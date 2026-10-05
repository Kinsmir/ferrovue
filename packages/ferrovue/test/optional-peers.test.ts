import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");
const ENTRIES = ["index", "compiler", "types", "testing", "client", "link-router", "islands", "vite"];
let root = "";
let result: Record<string, unknown> = {};

const script = (nowhere: string) => `
import { registerHooks } from "node:module";
const src = ${JSON.stringify(pathToFileURL(SRC).href)};
registerHooks({
  resolve(specifier, context, next) {
    if (/^(vite|vitest|vue-i18n|pinia|vue-router|@unhead\\/vue)(\\/|$)/.test(specifier)) {
      return next(specifier, { ...context, parentURL: ${JSON.stringify(nowhere)} });
    }
    return next(specifier, context.parentURL === import.meta.url ? { ...context, parentURL: src + "/testing.ts" } : context);
  },
});
const out = { loaded: {} };
for (const entry of ${JSON.stringify(ENTRIES)}) {
  out.loaded[entry] = await import(src + "/" + entry + ".ts").then(() => "loaded", (error) => error.message);
}
const { conformanceSuite, fixtureApp, readFixture } = await import(src + "/testing.ts");
const { defineComponent, h } = await import("vue");
const { renderToString } = await import("vue/server-renderer");
const Hello = defineComponent({ props: { name: String }, render() { return h("p", "Hello, " + this.name); } });
out.html = await renderToString(await fixtureApp(Hello, readFixture({ name: "Ada" }), null));
const hydrating = await fixtureApp(Hello, readFixture({ name: "Ada" }), null, { hydrate: true });
out.hydrating = await renderToString(hydrating);
out.head = "$unhead" in hydrating.config.globalProperties;
const failure = async (json, routes, options) => {
  try {
    await fixtureApp(Hello, readFixture(json), routes, options);
    return null;
  } catch (error) {
    return error.message;
  }
};
out.stores = await failure({ name: "Ada", $stores: { cart: { items: [] } } }, null);
out.routes = await failure({ name: "Ada", $route: "/" }, ["/"]);
out.i18n = await failure({ name: "Ada" }, null, { i18n: { messages: { en: {} }, locale: "en" } });
out.vitest = await conformanceSuite({ config: "ferrovue.config.json", components: {} }).then(() => null, (error) => error.message);
process.stdout.write(JSON.stringify(out));
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ferrovue-peers-"));
  const file = join(root, "child.mjs");
  writeFileSync(file, script(pathToFileURL(join(root, "nowhere.mjs")).href));
  const r = spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  result = JSON.parse(r.stdout) as Record<string, unknown>;
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

it("loads every entry of the package without the optional peers, vitest included", () => {
  expect(result.loaded).toEqual({
    index: "loaded",
    compiler: "loaded",
    types: "loaded",
    testing: "loaded",
    client: "loaded",
    "link-router": expect.stringContaining("vue-router") as unknown,
    islands: expect.stringContaining("ferrovue/islands is written by the Vite plugin") as unknown,
    vite: "loaded",
  });
});

it("renders a fixture with no routes, stores, locale or head without the optional peers", () => {
  expect(result.html).toBe("<p>Hello, Ada</p>");
  expect(result.hydrating).toBe("<p>Hello, Ada</p>");
  expect(result.head).toBe(false);
});

it("names the peer to install when a fixture needs one that is missing", () => {
  expect(result.stores).toMatch(/`\$stores`, which needs `pinia`: install it/);
  expect(result.routes).toMatch(/routes, which needs `vue-router`: install it/);
  expect(result.i18n).toMatch(/`i18n` options, which needs `vue-i18n`: install it/);
  expect(result.vitest).toMatch(/`conformanceSuite` registers vitest tests, which needs `vitest`: install it/);
});
