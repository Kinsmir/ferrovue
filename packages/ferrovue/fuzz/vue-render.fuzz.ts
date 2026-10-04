/* Renders each generated component's fixtures with Vue's `renderToString`, exactly as the
 * conformance suite does (`attachSsrRender`, `fixtureApp`), and writes the HTML (or the error) per
 * case to `$FERROVUE_FUZZ_VUE_OUT`. Run by `run.ts`; never part of `pnpm test`. */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import type { Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { attachSsrRender, fixtureApp, readFixture } from "../src/testing.ts";

interface VueCase {
  key: string;
  file: string;
  name: string;
  json: string;
}

it("renders every fixture", async () => {
  const cases = JSON.parse(readFileSync(process.env.FERROVUE_FUZZ_VUE_CASES!, "utf8")) as VueCase[];
  const results: Record<string, { ok: string } | { err: string }> = {};
  const loaded = new Map<string, Promise<Component>>();
  const load = (c: VueCase): Promise<Component> => {
    let p = loaded.get(c.file);
    if (!p) {
      p = (async () => {
        const m = (await import(/* @vite-ignore */ c.file)) as { default: Component };
        attachSsrRender(c.file, c.name, m.default);
        return m.default;
      })();
      loaded.set(c.file, p);
    }
    return p;
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const c of cases) {
      try {
        const app = await fixtureApp(await load(c), readFixture(JSON.parse(c.json) as Record<string, unknown>), null);
        results[c.key] = { ok: await renderToString(app) };
      } catch (e) {
        results[c.key] = { err: String((e as Error).stack ?? e).split("\n").slice(0, 4).join("\n") };
      }
    }
  } finally {
    console.warn = warn;
  }
  writeFileSync(process.env.FERROVUE_FUZZ_VUE_OUT!, JSON.stringify(results));
});
