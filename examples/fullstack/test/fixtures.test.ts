import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { attachSsrRender, fixtureApp, readFixture } from "ferrovue/testing";
import Reviews from "../client/components/Reviews.vue";

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "fixtures");
const WRITE = process.env.FERROVUE_FIXTURES_WRITE === "1";
const components: Record<string, Component> = { Reviews };
for (const [name, component] of Object.entries(components)) attachSsrRender(join(ROOT, "client/components", `${name}.vue`), name, component);

for (const name of readdirSync(FIXTURES)) {
  for (const file of readdirSync(join(FIXTURES, name)).filter((f) => f.endsWith(".json"))) {
    it(`renders ${name}/${file} with Vue as the Rust does`, async () => {
      const base = join(FIXTURES, name, file.slice(0, -".json".length));
      const json = JSON.parse(readFileSync(`${base}.json`, "utf8")) as Record<string, unknown>;
      const html = await renderToString(await fixtureApp(components[name]!, readFixture(json), null));
      if (WRITE) writeFileSync(`${base}.html`, html);
      // oxlint-disable-next-line vitest/no-conditional-expect -- a recording run writes instead of comparing
      else expect(html).toBe(readFileSync(`${base}.html`, "utf8"));
    });
  }
}
