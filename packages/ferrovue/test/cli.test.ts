import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { type Flag, FLAGS, helpText, parseArgs } from "../src/args.ts";

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

/** Stop a `--watch`, and wait for it to exit: Windows does not remove a directory a process still
 * has as its working directory. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill();
  await exited;
}

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

it("removes the modules it wrote that no component produces, and leaves the app's own", () => {
  run();
  const generated = readFileSync(join(root, "src/generated/hello.rs"), "utf8");
  writeFileSync(join(root, "src/generated/gone.rs"), generated);
  writeFileSync(join(root, "src/generated/main.rs"), "fn main() {}\n");
  const r = run();
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("1 removed");
  expect(existsSync(join(root, "src/generated/gone.rs"))).toBe(false);
  expect(readFileSync(join(root, "src/generated/main.rs"), "utf8")).toBe("fn main() {}\n");
  const c = run("--check");
  expect(c.status).toBe(1);
  expect(c.stderr).toContain("not generated: src/generated/main.rs (not written by ferrovue");
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
  expect(r.stderr).toContain("error[FV0602]: components/Bad.vue:4:17: `.toPrecision()` is not supported");
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
    await waitFor("error[FV0609]: components/Hello.vue");
    writeFileSync(join(root, "components", "Hello.vue"), `<script setup lang="ts">
defineProps<{ name: string }>();
</script>
<template><p>Bye, {{ name }}</p></template>`);
    await waitFor("1 changed");
  } finally {
    await stop(child);
  }
}, 70_000);

it("--watch reports an error that is not a refusal without stopping", async () => {
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
    mkdirSync(join(root, "components", "Broken.vue"));
    await waitFor("EISDIR");
    rmSync(join(root, "components", "Broken.vue"), { recursive: true });
    await waitFor("nothing changed");
    expect(child.exitCode).toBeNull();
  } finally {
    await stop(child);
  }
}, 70_000);

it("--watch regenerates on its inputs only, with `out` written as a relative path", async () => {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "./components", out: "./src/generated" }));
  const child = spawn(process.execPath, [CLI, "--watch"], { cwd: root });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const runs = () => out.split("\n").filter((l) => l.startsWith("./src/generated: ")).length;
  const waitFor = async (text: string): Promise<void> => {
    for (let i = 0; i < 400 && !out.includes(text); i++) await new Promise((r) => setTimeout(r, 50));
    expect(out).toContain(text);
  };
  try {
    await waitFor("watching for changes");
    expect(runs()).toBe(1);
    writeFileSync(join(root, "vite.config.ts"), "export default {};\n");
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(join(root, "tsconfig.json"), "{}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "export {};\n");
    writeFileSync(join(root, "src", "generated", "extra.json"), "{}\n");
    await new Promise((r) => setTimeout(r, 500));
    expect(runs()).toBe(1);
    writeFileSync(join(root, "components", "Card.vue"), "<template><p>card</p></template>");
    await waitFor("3 files, 2 changed");
    expect(runs()).toBe(2);
  } finally {
    await stop(child);
  }
}, 70_000);

it("refuses a missing components directory by its code", () => {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "missing", out: "src/generated" }));
  const r = run();
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("error[FV1116]: cannot read the `components` directory `missing`: it does not exist");
});

for (const [args, message] of [
  [["--check", "--watch"], "'--check' does not combine with '--watch'"],
  [["--watch", "--check"], "'--check' does not combine with '--watch'"],
  [["init", "--check"], "'init' does not combine with '--check'"],
  [["init", "--watch"], "'init' does not combine with '--watch'"],
  [["init", "-d"], "'init' does not combine with '-d'"],
  [["init", "--format", "json"], "'init' does not combine with '--format json'"],
] as const) {
  it(`refuses ${args.join(" ")}, options that do not combine`, () => {
    const r = run(...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(`error: ${message}\n`);
    expect(readdirSync(root)).not.toContain("src");
  });
}

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

it("prints the help committed in api/cli.txt, the CLI's part of the package's contract", () => {
  const committed = readFileSync(join(import.meta.dirname, "../api/cli.txt"), "utf8");
  expect(run("--help").stdout, "run `pnpm api:report`").toBe(committed);
});

it("refuses an option without its value, and a value given to an option that takes none", () => {
  expect(run("--format").stderr).toBe("error: option '--format' requires an argument\n");
  expect(run("--check=yes").stderr).toBe("error: option '--check' takes no value\n");
});

it("warns of a deprecated option, naming what replaces it, and still reads it", () => {
  const flags: Flag[] = [...FLAGS, { names: ["--verify"], help: "check", deprecated: { since: "0.7.0", use: "'--check'" } }];
  const parsed = parseArgs(["--verify", "--format=json"], flags);
  if ("error" in parsed) throw new Error(parsed.error);
  expect(parsed.options).toEqual(new Map<string, string | true>([["--verify", true], ["--format", "json"]]));
  expect(parsed.warnings).toEqual([expect.objectContaining({ code: "FV1118", message: "'--verify' is deprecated since 0.7.0, and goes in the next major release: use '--check'" })]);
  expect(helpText(flags)).toContain("      --verify             check (deprecated: use '--check')");
  const current = parseArgs(["--check", "-d"]);
  expect("error" in current ? current.error : current.warnings).toEqual([]);
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
  expect(r.stderr).toContain("error[FV1102]: cannot find `ferrovue.config.json`");
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
    const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { version: string };
    expect(JSON.parse(readFileSync(join(emptyDir, "ferrovue.config.json"), "utf8"))).toEqual({
      $schema: `https://cdn.jsdelivr.net/npm/ferrovue@${version}/schema.json`,
      components: "components",
      out: "src/generated",
    });

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
  expect(r.stderr).toContain("error[FV1102]: cannot find `nonexistent.json`");
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



const BAD = `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ n.toPrecision(2) }}</p></template>`;

const DOCS = "https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html";

it("gives an error its code and where the code is documented", () => {
  writeFileSync(join(root, "components", "Bad.vue"), BAD);
  const r = run();
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/^error\[FV0602\]: components\/Bad\.vue:4:17: /);
  expect(r.stderr).toContain(`\n = docs: ${DOCS}#fv0602\n`);
});

it("--format json writes a refusal as a diagnostic, and fails as without it", () => {
  writeFileSync(join(root, "components", "Bad.vue"), BAD);
  for (const args of [["--format", "json"], ["--check", "--format=json"]]) {
    const r = run(...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({
      diagnostics: [
        {
          file: "components/Bad.vue",
          line: 4,
          column: 17,
          endLine: null,
          endColumn: null,
          code: "FV0602",
          severity: "error",
          title: "Unsupported method",
          message: "`.toPrecision()` is not supported",
          docs: `${DOCS}#fv0602`,
        },
      ],
    });
  }
});

it("--format json gives a construct in setup its end, and a file that does not parse its line", () => {
  writeFileSync(
    join(root, "components", "Bad.vue"),
    `<script setup lang="ts">
import { watchEffect } from "vue";
watchEffect(() => {});
</script>
<template><i></i></template>`,
  );
  const [refused] = JSON.parse(run("--format", "json").stdout).diagnostics;
  expect(refused).toMatchObject({ file: "components/Bad.vue", line: 3, column: 1, endLine: 3, endColumn: 23, code: "FV0103" });
  writeFileSync(join(root, "components", "Bad.vue"), `<script setup lang="ts">\nconst x = ;\n</script>\n<template><i></i></template>`);
  const [unparsed] = JSON.parse(run("--format", "json").stdout).diagnostics;
  expect(unparsed).toMatchObject({ file: "components/Bad.vue", line: 2, column: 11, code: "FV0001", title: "Source file that does not parse" });
  expect(unparsed.message).toMatch(/Unexpected token/);
});

it("--format json gives a configuration error its code and file", () => {
  rmSync(join(root, "ferrovue.config.json"));
  const r = run("--format", "json");
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).diagnostics[0]).toMatchObject({ file: "ferrovue.config.json", line: null, code: "FV1102" });
});

it("--format json gives a malformed routes file and configuration their codes and files", () => {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "src/generated", routes: "routes.json" }));
  writeFileSync(join(root, "routes.json"), `["/", `);
  const r = run("--format", "json");
  expect(r.status).toBe(1);
  expect(r.stderr).toBe("");
  expect(JSON.parse(r.stdout).diagnostics).toEqual([expect.objectContaining({ file: "routes.json", line: null, code: "FV1247", title: "Routes file that is not valid JSON" })]);
  writeFileSync(join(root, "ferrovue.config.json"), "null");
  expect(JSON.parse(run("--format", "json").stdout).diagnostics[0]).toMatchObject({ file: "ferrovue.config.json", code: "FV1113" });
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "src/generated", componets: "x" }));
  expect(JSON.parse(run("--format", "json").stdout).diagnostics[0]).toMatchObject({ file: "ferrovue.config.json", code: "FV1114", message: "ferrovue.config.json has no key `componets`: did you mean `components`?" });
});

it("--format json reports what a run wrote, and what --check finds stale", () => {
  const written = run("--format", "json");
  expect(written.status).toBe(0);
  expect(JSON.parse(written.stdout)).toEqual({ diagnostics: [], out: "src/generated", files: ["hello.rs", "mod.rs"], changed: ["hello.rs", "mod.rs"], removed: [] });
  expect(JSON.parse(run("--check", "--format", "json").stdout)).toEqual({ diagnostics: [], out: "src/generated", stale: [], notGenerated: [] });
  writeFileSync(join(root, "src/generated/hello.rs"), "// edited by hand");
  writeFileSync(join(root, "src/generated/extra.rs"), "// not generated");
  const r = run("--check", "--format", "json");
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toEqual({ diagnostics: [], out: "src/generated", stale: ["src/generated/hello.rs"], notGenerated: ["src/generated/extra.rs"] });
});

it("--format takes human or json, and json does not combine with --diff", () => {
  expect(run("--format", "xml").stderr).toContain("error: '--format' is 'human' or 'json'");
  const r = run("--check", "--diff", "--format", "json");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("does not combine with '--format json'");
  expect(run("--format", "human").status).toBe(0);
});

it("matches its errors with the VS Code problem matchers the quick start gives", () => {
  const guide = readFileSync(join(import.meta.dirname, "../../../crates/ferrovue/docs/guide/quick_start.md"), "utf8");
  const tasks = JSON.parse(guide.match(/```json\n(\{\n {2}"version": "2\.0\.0"[\s\S]*?)```/)![1]!);
  const matchers: { pattern: { regexp: string; kind?: string; code: number; file: number; line?: number; column?: number; message: number } }[] = tasks.tasks[0].problemMatcher;
  const matched = (stderr: string) =>
    stderr.split("\n").flatMap((text) =>
      matchers.flatMap(({ pattern: p }) => {
        const m = new RegExp(p.regexp).exec(text);
        return m ? [{ kind: p.kind ?? "location", code: m[p.code], file: m[p.file], line: p.line && m[p.line], column: p.column && m[p.column], message: m[p.message] }] : [];
      }),
    );
  writeFileSync(join(root, "components", "Bad.vue"), BAD);
  expect(matched(run().stderr)).toEqual([{ kind: "location", code: "FV0602", file: "components/Bad.vue", line: "4", column: "17", message: "`.toPrecision()` is not supported" }]);
  rmSync(join(root, "components", "Bad.vue"));
  mkdirSync(join(root, "locales"));
  writeFileSync(join(root, "locales", "en.json"), "{ nope");
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "src/generated", i18n: { messages: "locales" } }));
  const [locale] = matched(run().stderr);
  expect(locale).toMatchObject({ kind: "file", code: "FV1401", file: "locales/en.json" });
});
