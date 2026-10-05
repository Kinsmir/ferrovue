import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import { generate } from "../src/compiler.ts";
import { attachSsrRender, fixtureApp, readFixture } from "../src/testing.ts";
import { cases, CLIENT_ONLY, HEAD, headRendered, hydrationBody, OPTIONS, placeHead, recordedHead, renderFixture, ROOT, ROUTES, TELEPORTS, UNHEAD_REWRITES, VUE_DISAGREES } from "./conformance-cases.ts";
import { settled, stillLoading } from "../src/settle.ts";

const WRITE = process.env.FERROVUE_FIXTURES_WRITE === "1";

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", {
  eager: true,
});
const components = new Map(
  Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]),
);
for (const [name, component] of components) attachSsrRender(join(ROOT, "components", `${name}.vue`), name, component);

it("has fixtures for every component, and recorded HTML for every fixture", () => {
  expect(components.size).toBeGreaterThanOrEqual(120);
  expect(cases.length).toBeGreaterThanOrEqual(390);
  expect([...new Set(cases.map((c) => c.component))].toSorted()).toEqual([...components.keys()].toSorted());
  const files = readdirSync(join(ROOT, "fixtures"), { recursive: true, encoding: "utf8" }).filter((f) => /\.\w+$/.test(f));
  const named = (ext: string): string[] => files.filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).toSorted();
  expect(files.filter((f) => !/\.(json|html)$/.test(f))).toEqual([]);
  expect(named(".html")).toEqual(named(".json"));
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
    expect(files.get(`${module}.rs`), name).toMatch(new RegExp(`[ "]${(c as { __scopeId: string }).__scopeId}\\b`));
  }
});

describe("Vue renders each fixture to its recorded HTML", () => {
  for (const c of cases) {
    it(`${c.component}/${c.name}`, async () => {
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES, OPTIONS);
      const html = await renderFixture(app);
      if (WRITE) writeFileSync(`${c.base}.html`, html);
      // oxlint-disable-next-line vitest/no-conditional-expect -- a recording run writes instead of comparing
      else expect(html).toBe(c.html);
    });
  }
});

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
    placeHead(null);
  });
  for (const c of cases) {
    it(`${c.component}/${c.name}`, async () => {
      placeHead(recordedHead(c.html));
      document.body.innerHTML = hydrationBody(c.html);
      const head = document.head.innerHTML;
      const before = document.getElementById("root")!.firstChild;
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES, { ...OPTIONS, hydrate: true });
      app.mount("#root");
      await settled(app);
      await headRendered();
      const rewrites = UNHEAD_REWRITES.has(`${c.component}/${c.name}`);
      // oxlint-disable-next-line vitest/no-conditional-expect -- unhead's own server writes these heads in markup the parser reads back otherwise
      if (rewrites) expect(document.head.innerHTML, "the fixture is in UNHEAD_REWRITES").not.toBe(head);
      // oxlint-disable-next-line vitest/no-conditional-expect -- the same check, for every other fixture
      else expect(document.head.innerHTML, "unhead's client took over the head as the server wrote it").toBe(head);
      const mismatches = warnings.filter((w) => /hydrat|mismatch/i.test(w));
      const disagrees = VUE_DISAGREES.has(`${c.component}/${c.name}`);
      expect(disagrees ? [] : mismatches).toEqual([]);
      expect(mismatches.length > 0, "a fixture mismatches exactly when it is in VUE_DISAGREES").toBe(disagrees);
      expect(document.getElementById("root")!.firstChild).toBe(before);
      expect(document.getElementById("root")!.innerHTML, "`<ClientOnly>` showed its content once mounted").toContain(CLIENT_ONLY[c.component] ?? "");
      app.unmount();
      await headRendered();
    });
  }
});

const CLIENT_DIFFERS = new Set([
  "ScopedQuirks/empty.json",
  "ScopedQuirks/hostile.json",
  "ScopedQuirks/noted.json",
  "ScopedCard/empty.json",
  "ScopedShelf/empty.json",
  "ScopedRack/empty.json",
  "PlainForward/empty.json",
]);

it("lists only fixtures that exist, and with scope ids in CLIENT_DIFFERS", () => {
  const scoped = new Set(cases.filter((c) => c.html.includes(" data-v-")).map((c) => `${c.component}/${c.name}`));
  const all = new Set(cases.map((c) => `${c.component}/${c.name}`));
  expect([...CLIENT_DIFFERS].filter((k) => !scoped.has(k))).toEqual([]);
  expect([...VUE_DISAGREES, ...UNHEAD_REWRITES].filter((k) => !all.has(k))).toEqual([]);
});

describe.skipIf(WRITE)("the recorded HTML carries the scope ids the client renders", () => {
  const ids = (root: ParentNode): string[] =>
    [...root.querySelectorAll("*")].map((el) => `${el.tagName} ${el.getAttributeNames().filter((a) => a.startsWith("data-v-")).toSorted().join(" ")}`);
  afterEach(() => {
    document.body.innerHTML = "";
  });
  for (const c of cases.filter((c) => c.html.includes(" data-v-"))) {
    it(`${c.component}/${c.name}`, async () => {
      const [main, teleported] = c.html.split(HEAD)[0]!.split(TELEPORTS);
      const targets = Object.keys(JSON.parse(teleported ?? "{}") as Record<string, string>);
      document.body.innerHTML = `<div id="root"></div>${targets.map((t) => `<div id="${t.replace(/^#/, "")}"></div>`).join("")}`;
      const app = await fixtureApp(components.get(c.component)!, readFixture(c.json), ROUTES, { ...OPTIONS, client: true });
      app.mount("#root");
      if (stillLoading(app)) await settled(app);
      const recorded = document.createElement("template");
      recorded.innerHTML = main!;
      const server = ids(recorded.content);
      const client = ids(document.getElementById("root")!);
      const differs = CLIENT_DIFFERS.has(`${c.component}/${c.name}`);
      expect(differs ? [] : server).toEqual(differs ? [] : client);
      expect(JSON.stringify(server) !== JSON.stringify(client), "a fixture's ids differ exactly when it is in CLIENT_DIFFERS").toBe(differs);
      app.unmount();
    });
  }
});
