/* The `ferrovue` command, run as a project runs it: from the project's root, as a process. */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const CLI = join(import.meta.dirname, "../src/cli.ts");
let root = "";

const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ferrovue-cli-"));
  mkdirSync(join(root, "components"));
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "src/generated" }));
  writeFileSync(
    join(root, "components", "Hello.vue"),
    `<script setup lang="ts">
defineProps<{ name: string }>();
</script>
<template><p>Hello, {{ name }}</p></template>`,
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it("writes one module per component, and the module tying them together", () => {
  const r = run();
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("src/generated: 2 files, 2 changed, 0 removed");
  expect(readdirSync(join(root, "src/generated")).toSorted()).toEqual(["hello.rs", "mod.rs"]);
});

it("rewrites nothing that did not change, so a Rust build does not rebuild it", async () => {
  run();
  const before = statSync(join(root, "src/generated/hello.rs")).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  const r = run();
  expect(r.stdout).toContain("nothing changed");
  expect(statSync(join(root, "src/generated/hello.rs")).mtimeMs).toBe(before);
});

it("replaces what the output directory held", () => {
  mkdirSync(join(root, "src/generated"), { recursive: true });
  writeFileSync(join(root, "src/generated/old.rs"), "// gone");
  expect(run().status).toBe(0);
  expect(readdirSync(join(root, "src/generated"))).not.toContain("old.rs");
});

it("--check passes on what it just wrote", () => {
  run();
  const r = run("--check");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("src/generated is up to date");
});

it("--check fails on a module that differs, and on one it would not write", () => {
  run();
  writeFileSync(join(root, "src/generated/hello.rs"), "// edited by hand");
  writeFileSync(join(root, "src/generated/extra.rs"), "// not generated");
  const r = run("--check");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("stale: src/generated/hello.rs");
  expect(r.stderr).toContain("not generated: src/generated/extra.rs");
});

it("--check fails when nothing was ever generated, and writes nothing", () => {
  const r = run("--check");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("stale: src/generated/mod.rs");
  expect(() => readdirSync(join(root, "src/generated"))).toThrow(/ENOENT/);
});

it("fails, naming the file and the construct, on a component it cannot translate", () => {
  writeFileSync(
    join(root, "components", "Bad.vue"),
    `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ n.toPrecision(2) }}</p></template>`,
  );
  const r = run();
  expect(r.status).toBe(1);
  // The line in the `.vue` file, quoted with a caret, and no stack trace.
  expect(r.stderr).toContain("error: components/Bad.vue:4:17: `.toPrecision()` is not supported");
  expect(r.stderr).toContain(" 4 | <template><p>{{ n.toPrecision(2) }}</p></template>");
  expect(r.stderr).toContain("   |                 ^");
  expect(r.stderr).not.toContain("    at ");
});

it("--watch regenerates on a change, and reports an error without stopping", async () => {
  const child = spawn(process.execPath, [CLI, "--watch"], { cwd: root });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const waitFor = async (text: string): Promise<void> => {
    for (let i = 0; i < 100 && !out.includes(text); i++) await new Promise((r) => setTimeout(r, 50));
    expect(out).toContain(text);
  };
  try {
    await waitFor("watching for changes");
    writeFileSync(join(root, "components", "Hello.vue"), `<script setup lang="ts">
defineProps<{ name: string }>();
</script>
<template><p>{{ name / 2 }}</p></template>`);
    await waitFor("error: components/Hello.vue");
    writeFileSync(join(root, "components", "Hello.vue"), `<script setup lang="ts">
defineProps<{ name: string }>();
</script>
<template><p>Bye, {{ name }}</p></template>`);
    await waitFor("1 changed");
  } finally {
    child.kill();
  }
});

it("fails on a configuration without its two directories", () => {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components" }));
  const r = run();
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("needs `components` and `out`");
});
