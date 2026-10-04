/* ferrovue's own conformance suite: the components in `crates/ferrovue/tests/conformance/`
 * rendered by Vue, held to the recorded fixtures that the generated Rust is held to as well
 * (`crates/ferrovue/tests/conformance.rs`). They cover what a project's own components may not
 * exercise: slots, their fallbacks, `<RouterLink>` and `<RouterView>`.
 *
 * `FERROVUE_FIXTURES_WRITE=1` records the `.html` files from Vue instead of comparing. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { generate } from "../src/compiler.ts";
import { attachSsrRender, fixtureApp, readFixture, type RouteEntry } from "../src/testing.ts";

const ROOT = join(import.meta.dirname, "../../../crates/ferrovue/tests/conformance");
const FIXTURES = join(ROOT, "fixtures");
const ROUTES = JSON.parse(readFileSync(join(ROOT, "routes.json"), "utf8")) as RouteEntry[];
const WRITE = process.env.FERROVUE_FIXTURES_WRITE === "1";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", {
  eager: true,
});
const components = new Map(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);
for (const [name, component] of components) attachSsrRender(join(ROOT, "components", `${name}.vue`), name, component);

const cases = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(join(FIXTURES, d.name))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const base = join(FIXTURES, d.name, f.slice(0, -".json".length));
        let html = "";
        try {
          html = readFileSync(`${base}.html`, "utf8");
        } catch {
          // A new fixture: only a write run can supply its expected output.
        }
        return { component: d.name, name: f, base, json: JSON.parse(readFileSync(`${base}.json`, "utf8")), html };
      }),
  );

it("has fixtures for every component", () => {
  expect([...new Set(cases.map((c) => c.component))].sort()).toEqual([...components.keys()].sort());
});

it("has generated Rust that is what the generator writes now", () => {
  const dir = join(ROOT, "generated");
  for (const [file, text] of generate(ROOT)) expect(readFileSync(join(dir, file), "utf8"), file).toBe(text);
  expect(readdirSync(dir).sort()).toEqual([...generate(ROOT).keys()].sort());
});

describe("Vue renders each fixture to its recorded HTML", () => {
  for (const c of cases) {
    it(`${c.component}/${c.name}`, async () => {
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES);
      const html = await renderToString(app);
      if (WRITE) writeFileSync(`${c.base}.html`, html);
      else expect(html).toBe(c.html);
    });
  }
});

// Skipped while recording: the HTML it would mount is what this run is writing.
describe.skipIf(WRITE)("the recorded HTML hydrates without a mismatch", () => {
  let warnings: string[] = [];
  beforeEach(() => {
    warnings = [];
    const record = (...args: unknown[]): void => void warnings.push(args.map(String).join(" "));
    vi.spyOn(console, "warn").mockImplementation(record);
    vi.spyOn(console, "error").mockImplementation(record);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
  for (const c of cases) {
    it(`${c.component}/${c.name}`, async () => {
      document.body.innerHTML = `<div id="root">${c.html}</div>`;
      const before = document.getElementById("root")!.firstChild;
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES);
      app.mount("#root");
      expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).toEqual([]);
      expect(document.getElementById("root")!.firstChild).toBe(before);
      app.unmount();
    });
  }
});
