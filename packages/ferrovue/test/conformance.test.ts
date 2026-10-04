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
import { attachSsrRender, fixtureApp, readFixture } from "../src/testing.ts";
import { cases, hydrationBody, OPTIONS, ROOT, ROUTES, TELEPORTS } from "./conformance-cases.ts";

const WRITE = process.env.FERROVUE_FIXTURES_WRITE === "1";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", {
  eager: true,
});
const components = new Map(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);
for (const [name, component] of components) attachSsrRender(join(ROOT, "components", `${name}.vue`), name, component);

it("has fixtures for every component", () => {
  expect([...new Set(cases.map((c) => c.component))].toSorted()).toEqual([...components.keys()].toSorted());
});

it("has generated Rust that is what the generator writes now", () => {
  const dir = join(ROOT, "generated");
  for (const [file, text] of generate(ROOT)) expect(readFileSync(join(dir, file), "utf8"), file).toBe(text);
  expect(readdirSync(dir).toSorted()).toEqual([...generate(ROOT).keys()].toSorted());
});

it("gives each `<style scoped>` component the id `@vitejs/plugin-vue` gave its client build", () => {
  const scoped = [...components].filter(([, c]) => (c as { __scopeId?: string }).__scopeId);
  expect(scoped.length).toBeGreaterThanOrEqual(5);
  const files = generate(ROOT);
  for (const [name, c] of scoped) {
    const module = name.replace(/[A-Z]/g, (ch) => "_" + ch.toLowerCase()).replace(/^_/, "");
    expect(files.get(`${module}.rs`), name).toContain(` ${(c as { __scopeId: string }).__scopeId}`);
  }
});

describe("Vue renders each fixture to its recorded HTML", () => {
  for (const c of cases) {
    it(`${c.component}/${c.name}`, async () => {
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES, OPTIONS);
      // What was teleported follows the render, after a marker, as the generated Rust writes it.
      const ssr: { teleports?: Record<string, string> } = {};
      const main = await renderToString(app, ssr);
      const teleported = Object.entries(ssr.teleports ?? {});
      const html = teleported.length ? `${main}${TELEPORTS}${JSON.stringify(Object.fromEntries(teleported))}` : main;
      if (WRITE) writeFileSync(`${c.base}.html`, html);
      // oxlint-disable-next-line vitest/no-conditional-expect -- a recording run writes instead of comparing
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
      // Teleported content is placed in its targets, as a page places it.
      document.body.innerHTML = hydrationBody(c.html);
      const before = document.getElementById("root")!.firstChild;
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES, OPTIONS);
      app.mount("#root");
      expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).toEqual([]);
      expect(document.getElementById("root")!.firstChild).toBe(before);
      app.unmount();
    });
  }
});

/* Hydration keeps the server's attributes without comparing scope ids, so a wrong one would hydrate
 * cleanly and leave the scoped styles unapplied. Each element of the recorded HTML must carry the
 * ids a fresh client render gives it — except where Vue's own server render differs from its client
 * render, as `ScopedQuirks` shows: a `:slotted()` component's slot fallback, and a root with
 * `inheritAttrs: false` under a scoped component's root. */
const CLIENT_DIFFERS = new Set(["ScopedQuirks", "ScopedCard/empty.json", "ScopedShelf/empty.json", "ScopedRack/empty.json", "PlainForward/empty.json"]);
describe.skipIf(WRITE)("the recorded HTML carries the scope ids the client renders", () => {
  const ids = (root: ParentNode): string[] =>
    [...root.querySelectorAll("*")].map((el) => `${el.tagName} ${el.getAttributeNames().filter((a) => a.startsWith("data-v-")).toSorted().join(" ")}`);
  afterEach(() => {
    document.body.innerHTML = "";
  });
  const checked = cases.filter((c) => c.html.includes(" data-v-") && !CLIENT_DIFFERS.has(c.component) && !CLIENT_DIFFERS.has(`${c.component}/${c.name}`));
  for (const c of checked) {
    it(`${c.component}/${c.name}`, async () => {
      const [main, teleported] = c.html.split(TELEPORTS);
      const targets = Object.keys(JSON.parse(teleported ?? "{}") as Record<string, string>);
      document.body.innerHTML = `<div id="root"></div>${targets.map((t) => `<div id="${t.replace(/^#/, "")}"></div>`).join("")}`;
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES, { ...OPTIONS, client: true });
      app.mount("#root");
      const recorded = document.createElement("template");
      recorded.innerHTML = main!;
      expect(ids(recorded.content)).toEqual(ids(document.getElementById("root")!));
      app.unmount();
    });
  }
});
