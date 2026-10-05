import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    for (let i = 0; i < 400 && !out.includes(text); i++) await new Promise((r) => setTimeout(r, 50));
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
}, 70_000);

it("fails on a configuration without its two directories", () => {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components" }));
  const r = run();
  expect(r.status).not.toBe(0);
  expect(r.stderr).toContain("needs `components` and `out`");
});

it("--version prints the version", () => {
  const r = run("--version");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

it("-v prints the version", () => {
  const r = run("-v");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

it("--help prints usage information", () => {
  const r = run("--help");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("Usage: ferrovue");
  expect(r.stdout).toContain("--check");
  expect(r.stdout).toContain("--watch");
  expect(r.stdout).toContain("--version");
  expect(r.stdout).toContain("--help");
  expect(r.stdout).toContain("--config");
  expect(r.stdout).toContain("init");
});

it("-h prints usage information", () => {
  const r = run("-h");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("Usage: ferrovue");
});

it("fails with a clean message and no stack trace when ferrovue.config.json is missing", () => {
  rmSync(join(root, "ferrovue.config.json"));
  const r = run();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error: cannot find `ferrovue.config.json`");
  expect(r.stderr).not.toContain("    at ");
});

it("fails on an unknown option or command", () => {
  const r = run("--unknown-flag");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error: unknown option or command '--unknown-flag'");
});

it("init scaffolds a starter configuration and component in an empty directory", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "ferrovue-init-"));
  try {
    const r = spawnSync(process.execPath, [CLI, "init"], { cwd: emptyDir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("created ferrovue.config.json");
    expect(r.stdout).toContain("created components/Hello.vue");
    expect(existsSync(join(emptyDir, "ferrovue.config.json"))).toBe(true);
    expect(existsSync(join(emptyDir, "components/Hello.vue"))).toBe(true);

    const gen = spawnSync(process.execPath, [CLI], { cwd: emptyDir, encoding: "utf8" });
    expect(gen.status, gen.stderr).toBe(0);
    expect(existsSync(join(emptyDir, "src/generated/hello.rs"))).toBe(true);
    expect(existsSync(join(emptyDir, "src/generated/mod.rs"))).toBe(true);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

it("init fails if configuration file already exists", () => {
  const r = run("init");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error: configuration file already exists");
});

it("--config allows specifying a custom configuration file", () => {
  writeFileSync(
    join(root, "custom-ferrovue.json"),
    JSON.stringify({ components: "components", out: "src/custom_out" }),
  );
  const r = run("--config", "custom-ferrovue.json");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("src/custom_out: 2 files");
  expect(existsSync(join(root, "src/custom_out/hello.rs"))).toBe(true);
});

it("-c allows specifying a custom configuration file", () => {
  writeFileSync(
    join(root, "custom2.json"),
    JSON.stringify({ components: "components", out: "src/custom2_out" }),
  );
  const r = run("-c", "custom2.json");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("src/custom2_out: 2 files");
});

it("--config fails when option argument is missing", () => {
  const r = run("--config");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error: option '--config' requires an argument");
});

it("--config fails when specified file does not exist", () => {
  const r = run("--config", "nonexistent.json");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error: cannot find `nonexistent.json`");
});

it("--check --diff shows line diffs for stale modules", () => {
  run();
  writeFileSync(join(root, "src/generated/hello.rs"), "// manual edit\n");
  const r = run("--check", "--diff");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("stale: src/generated/hello.rs");
  expect(r.stderr).toContain("--- a/src/generated/hello.rs");
  expect(r.stderr).toContain("+++ b/src/generated/hello.rs");
  expect(r.stderr).toContain("\n-// manual edit\n");
  expect(r.stderr).toMatch(/\n\+pub struct Props/);
});

it("--check -d shows diff for ungenerated extra modules", () => {
  run();
  writeFileSync(join(root, "src/generated/extra.rs"), "// extra file\n");
  const r = run("--check", "-d");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("not generated: src/generated/extra.rs");
  expect(r.stderr).toContain("--- a/src/generated/extra.rs");
  expect(r.stderr).toContain("+++ /dev/null");
  expect(r.stderr).toContain("@@ -1,1 +0,0 @@\n-// extra file");
});

it("refuses an option it does not know, whatever else is given", () => {
  const r = run("--check", "--bogus");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("unknown option or command '--bogus'");
});

it("--diff fails without --check", () => {
  const r = run("--diff");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error: '--diff' requires '--check'");
});


