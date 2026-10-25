import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { it } from "vitest";
import type { Component } from "vue";
import type { Config } from "../src/config.ts";
import { datePlansOf, fixtureOptions, renderFixture } from "../src/conformance.ts";
import { type DatePlans, withDatePlans } from "../src/date-plans.ts";
import { attachSsrRender } from "../src/ssr.ts";
import { fixtureApp, readFixture } from "../src/fixture.ts";

interface VueCase {
  key: string;
  file: string;
  name: string;
  json: string;
  root: string;
  config: Config;
}

it("renders every fixture", async () => {
  const cases = JSON.parse(readFileSync(process.env.FERROVUE_FUZZ_VUE_CASES!, "utf8")) as VueCase[];
  const results: Record<string, { ok: string } | { err: string }> = {};
  const loaded = new Map<string, Promise<Component>>();
  const load = (c: VueCase): Promise<Component> => {
    let p = loaded.get(c.file);
    if (!p) {
      p = (async () => {
        const dir = dirname(c.file);
        for (const f of readdirSync(dir).filter((f) => f.endsWith(".vue") && join(dir, f) !== c.file)) {
          const helper = (await import(/* @vite-ignore */ join(dir, f))) as { default: Component };
          attachSsrRender(join(dir, f), basename(f, ".vue"), helper.default);
        }
        const m = (await import(/* @vite-ignore */ c.file)) as { default: Component };
        attachSsrRender(c.file, c.name, m.default);
        return m.default;
      })();
      loaded.set(c.file, p);
    }
    return p;
  };
  const plans = new Map<string, DatePlans>();
  const plansOf = (c: VueCase): DatePlans => {
    let p = plans.get(c.root);
    if (!p) plans.set(c.root, (p = datePlansOf(c.root, c.config)));
    return p;
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const c of cases) {
      try {
        const { routes, options } = fixtureOptions(c.root, c.config);
        const fixture = withDatePlans(readFixture(JSON.parse(c.json) as Record<string, unknown>), c.name, plansOf(c));
        const app = await fixtureApp(await load(c), fixture, routes, options);
        results[c.key] = { ok: (await renderFixture(app)).toWellFormed().replace(/\\u[dD][89a-fA-F][0-9a-fA-F]{2}/g, "�") };
      } catch (e) {
        results[c.key] = { err: String((e as Error).stack ?? e).split("\n").slice(0, 4).join("\n") };
      }
    }
  } finally {
    console.warn = warn;
  }
  writeFileSync(process.env.FERROVUE_FUZZ_VUE_OUT!, JSON.stringify(results));
});
