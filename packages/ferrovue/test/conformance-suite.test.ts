import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Component } from "vue";
import { write } from "../src/compiler.ts";
import { firstDifference, registerConformance, type ConformanceOptions } from "../src/conformance.ts";

const SAMPLE = join(import.meta.dirname, "suite");
const Hello = import.meta.glob<Component>("./suite/components/Hello.vue", { eager: true, import: "default" })["./suite/components/Hello.vue"]!;
let root = "";

interface Registered {
  name: string;
  run: () => Promise<void> | void;
}

function register(options: Partial<ConformanceOptions> = {}): Registered[] {
  const tests: Registered[] = [];
  const path: string[] = [];
  registerConformance(
    {
      describe(name, body) {
        path.push(name);
        body();
        path.pop();
      },
      it(name, run) {
        tests.push({ name: [...path.slice(1), name].join(" > "), run });
      },
    },
    { config: join(root, "ferrovue.config.json"), components: { Hello }, record: false, ...options },
  );
  return tests;
}

async function outcomes(options: Partial<ConformanceOptions> = {}): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const test of register(options)) {
    try {
      await test.run();
      results[test.name] = "passed";
    } catch (error) {
      results[test.name] = error;
    }
  }
  return results;
}

const message = (error: unknown): string => (error as Error).message;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ferrovue-suite-"));
  cpSync(SAMPLE, root, { recursive: true });
  write(root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it("passes a project whose fixtures Vue renders and hydrates as recorded, with current generated Rust", async () => {
  expect(await outcomes()).toEqual({
    "has fixtures for every component, and a component for every fixture": "passed",
    "has generated Rust that is what the generator writes now": "passed",
    "Vue renders each fixture to its recorded HTML > Hello/ada.json": "passed",
    "Vue renders each fixture to its recorded HTML > Hello/hostile.json": "passed",
    "the recorded HTML hydrates without a mismatch > Hello/ada.json": "passed",
    "the recorded HTML hydrates without a mismatch > Hello/hostile.json": "passed",
  });
});

it("checks fresh client renders with `clientRender`", async () => {
  expect(await outcomes({ clientRender: true })).toEqual({
    "has fixtures for every component, and a component for every fixture": "passed",
    "has generated Rust that is what the generator writes now": "passed",
    "Vue renders each fixture to its recorded HTML > Hello/ada.json": "passed",
    "Vue renders each fixture to its recorded HTML > Hello/hostile.json": "passed",
    "the recorded HTML hydrates without a mismatch > Hello/ada.json": "passed",
    "the recorded HTML hydrates without a mismatch > Hello/hostile.json": "passed",
    "a fresh client render shows the recorded HTML > Hello/ada.json": "passed",
    "a fresh client render shows the recorded HTML > Hello/hostile.json": "passed",
  });
});

it("fails a fixture the client renders differently unless it is listed in clientDiffers, and a listed one it renders alike", async () => {
  writeFileSync(join(root, "fixtures/Hello/ada.html"), '<p class="hello">Hello, Ada<!--[--><b>3</b><!--]--></p>');
  const client = "a fresh client render shows the recorded HTML > ";
  const results = await outcomes({ clientRender: true });
  expect(message(results[`${client}Hello/ada.json`])).toBe(
    [
      "Hello/ada.json: the client renders it differently:",
      '  server: <p class="hello">Hello, Ada<b>3</b></p>',
      '  client: <p class="hello">Hello, Ada<b>2</b></p>',
      "(list it in `clientDiffers` where Vue's own client render differs from its server render)",
    ].join("\n"),
  );
  const listed = await outcomes({ clientDiffers: ["Hello/ada.json", "Hello/hostile.json"] });
  expect(listed[`${client}Hello/ada.json`]).toBe("passed");
  expect(message(listed[`${client}Hello/hostile.json`])).toBe("Hello/hostile.json is in `clientDiffers`, but the client renders it as the server did: take it out");
});

it("takes the components as `import.meta.glob` gives them", async () => {
  const components = import.meta.glob<{ default: Component }>("./suite/components/*.vue", { eager: true });
  expect(Object.values(await outcomes({ components }))).toEqual(Array(6).fill("passed"));
});

it("installs the application's own Pinia module in every fixture's app", async () => {
  const pinia = await import("pinia");
  let created = 0;
  const own = {
    ...pinia,
    createPinia: () => {
      created++;
      return pinia.createPinia();
    },
  };
  expect(Object.values(await outcomes({ pinia: own, clientRender: true }))).toEqual(Array(8).fill("passed"));
  expect(created).toBe(6);
});

it("fails a fixture Vue renders differently, saying where, with both renders to diff", async () => {
  writeFileSync(join(root, "fixtures/Hello/ada.html"), '<p class="hello">Hello, Ada<b>3</b></p>');
  const results = await outcomes();
  const error = results["Vue renders each fixture to its recorded HTML > Hello/ada.json"];
  expect(message(error)).toBe(
    'Hello/ada.json: Vue renders this fixture differently from its recorded HTML, first difference at character 30 (line 1, column 31):\n  recorded: "<p class=\\"hello\\">Hello, Ada<b>3</b></p>"\n  rendered: "<p class=\\"hello\\">Hello, Ada<b>2</b></p>"',
  );
  expect(error).toMatchObject({ expected: '<p class="hello">Hello, Ada<b>3</b></p>', actual: '<p class="hello">Hello, Ada<b>2</b></p>' });
  expect(message(results["the recorded HTML hydrates without a mismatch > Hello/ada.json"])).toMatch(/^Hello\/ada\.json did not hydrate exactly:\n.*mismatch/i);
  expect(results["Vue renders each fixture to its recorded HTML > Hello/hostile.json"]).toBe("passed");
});

it("fails a fixture with no recorded HTML, saying how to record it", async () => {
  rmSync(join(root, "fixtures/Hello/ada.html"));
  const results = await outcomes();
  expect(message(results["Vue renders each fixture to its recorded HTML > Hello/ada.json"])).toBe(
    "Hello/ada.json has no recorded HTML: record it from Vue with FERROVUE_FIXTURES_WRITE=1",
  );
});

it("records each fixture's HTML in record mode, and hydrates nothing", async () => {
  const want = readFileSync(join(SAMPLE, "fixtures/Hello/ada.html"), "utf8");
  writeFileSync(join(root, "fixtures/Hello/ada.html"), "stale");
  rmSync(join(root, "fixtures/Hello/hostile.html"));
  const results = await outcomes({ record: true });
  expect(Object.keys(results).filter((name) => name.startsWith("the recorded HTML"))).toEqual([]);
  expect(Object.values(results)).toEqual(Array(4).fill("passed"));
  expect(readFileSync(join(root, "fixtures/Hello/ada.html"), "utf8")).toBe(want);
  expect(readFileSync(join(root, "fixtures/Hello/hostile.html"), "utf8")).toBe(readFileSync(join(SAMPLE, "fixtures/Hello/hostile.html"), "utf8"));
});

it("records when FERROVUE_FIXTURES_WRITE=1 is set and `record` is not given", async () => {
  rmSync(join(root, "fixtures/Hello/ada.html"));
  process.env.FERROVUE_FIXTURES_WRITE = "1";
  try {
    const tests = register({ record: undefined });
    for (const test of tests) await test.run();
  } finally {
    delete process.env.FERROVUE_FIXTURES_WRITE;
  }
  expect(readFileSync(join(root, "fixtures/Hello/ada.html"), "utf8")).toBe(readFileSync(join(SAMPLE, "fixtures/Hello/ada.html"), "utf8"));
});

it("fails a component with no fixtures, a fixture naming no component, and a component not given", async () => {
  writeFileSync(join(root, "components/Bye.vue"), "<template><p>Bye</p></template>\n");
  mkdirSync(join(root, "fixtures/Ghost"));
  writeFileSync(join(root, "fixtures/Ghost/one.json"), "{}");
  write(root);
  const results = await outcomes();
  expect(message(results["has fixtures for every component, and a component for every fixture"])).toBe(
    [
      "the fixtures do not cover the components:",
      `Bye has no fixtures: add Bye/<case>.json under ${join(root, "fixtures")}`,
      "Bye is not in `components`",
      "the fixtures in Ghost/ name no component",
    ].join("\n"),
  );
  expect(message(results["Vue renders each fixture to its recorded HTML > Ghost/one.json"])).toBe("the fixtures in Ghost/ name no component in `components`");
});

it("fails when there are no fixtures at all", async () => {
  rmSync(join(root, "fixtures"), { recursive: true });
  const results = await outcomes();
  expect(message(results["has fixtures for every component, and a component for every fixture"])).toBe(
    [
      "the fixtures do not cover the components:",
      `there is no fixtures directory at ${join(root, "fixtures")}`,
      `Hello has no fixtures: add Hello/<case>.json under ${join(root, "fixtures")}`,
    ].join("\n"),
  );
  expect(Object.keys(results)).toHaveLength(2);
});

it("fails a project with no components, which would otherwise check nothing", async () => {
  rmSync(join(root, "components/Hello.vue"));
  rmSync(join(root, "fixtures/Hello"), { recursive: true });
  write(root);
  const results = await outcomes({ components: {} });
  expect(message(results["has fixtures for every component, and a component for every fixture"])).toBe(
    ["the fixtures do not cover the components:", `there are no components in ${join(root, "components")}`].join("\n"),
  );
});

it("fails generated Rust that is not what the generator writes now, with the diff", async () => {
  const file = join(root, "generated/hello.rs");
  writeFileSync(file, readFileSync(file, "utf8").replace("Hello, ", "Hi, "));
  writeFileSync(join(root, "generated/gone.rs"), "");
  rmSync(join(root, "generated/mod.rs"));
  const drift = message((await outcomes())["has generated Rust that is what the generator writes now"]);
  expect(drift).toMatch(/^the generated Rust in generated is not what ferrovue writes now: run `ferrovue` and commit the result\n/);
  expect(drift).toContain("--- a/generated/hello.rs");
  expect(drift).toMatch(/^-.*Hi, /m);
  expect(drift).toMatch(/^\+.*Hello, /m);
  expect(drift).toContain("mod.rs is missing");
  expect(drift).toContain("gone.rs is no longer generated");
});

it("names where two renders first differ, on later lines too", () => {
  expect(firstDifference("<p>\n<b>x</b>", "<p>\n<b>y</b>")).toBe('first difference at character 7 (line 2, column 4):\n  recorded: "<p>\\n<b>x</b>"\n  rendered: "<p>\\n<b>y</b>"');
  expect(firstDifference("<p></p>", "<p></p>!")).toMatch(/^first difference at character 7 \(line 1, column 8\)/);
});
