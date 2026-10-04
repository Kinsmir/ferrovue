/* The `ferrovue` command, run as a project runs it: from the project's root, as a process. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  expect(r.stdout).toContain("wrote 2 files to src/generated");
  expect(readdirSync(join(root, "src/generated")).sort()).toEqual(["hello.rs", "mod.rs"]);
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
  expect(() => readdirSync(join(root, "src/generated"))).toThrow();
});

it("fails, naming the file and the construct, on a component it cannot translate", () => {
  writeFileSync(
    join(root, "components", "Bad.vue"),
    `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ n / 2 }}</p></template>`,
  );
  const r = run();
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("components/Bad.vue");
});

it("fails on a configuration without its two directories", () => {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components" }));
  const r = run();
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("needs `components` and `out`");
});
