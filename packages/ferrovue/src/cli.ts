#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { relativePath } from "./paths.ts";
import { type Config, CONFIG_FILE, type GenError, generate, isGenerated, loadConfig, VERSION, write } from "./compiler.ts";
import { helpText, parseArgs } from "./args.ts";
import { unifiedDiff } from "./diff.ts";
import { type Diagnostic, diagnose, formatRefusal, formatWarning, isRefusal } from "./diagnostics.ts";
import { affects, type Inputs, inputsOf } from "./inputs.ts";

const root = process.cwd();

const SCHEMA_URL = `https://cdn.jsdelivr.net/npm/ferrovue@${VERSION}/schema.json`;

let json = false;
let warnings: Diagnostic[] = [];

function warn(warning: GenError): void {
  if (json) warnings.push(diagnose(warning, "warning"));
  else console.error(formatWarning(warning));
}

function emit(result: Record<string, unknown> & { diagnostics?: Diagnostic[] }): void {
  const { diagnostics = [], ...rest } = result;
  console.log(JSON.stringify({ diagnostics: [...warnings, ...diagnostics], ...rest }));
  warnings = [];
}

const load = (configPath?: string): Config => loadConfig(root, configPath, warn);

function report(e: unknown): void {
  if (!isRefusal(e)) throw e;
  if (json) emit({ diagnostics: [diagnose(e)] });
  else console.error(formatRefusal(e));
}

function initProject(targetRoot: string, configPath?: string): number {
  const configFile = configPath ? resolve(targetRoot, configPath) : join(targetRoot, CONFIG_FILE);
  if (existsSync(configFile)) {
    console.error(`error: configuration file already exists: ${relativePath(targetRoot, configFile) || CONFIG_FILE}`);
    return 1;
  }
  const defaultComponents = "components";
  const defaultOut = "src/generated";

  mkdirSync(dirname(configFile), { recursive: true });
  const config = {
    $schema: SCHEMA_URL,
    components: defaultComponents,
    out: defaultOut,
  };
  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
  console.log(`created ${relativePath(targetRoot, configFile) || CONFIG_FILE}`);

  const compDir = join(targetRoot, defaultComponents);
  mkdirSync(compDir, { recursive: true });

  const helloVue = join(compDir, "Hello.vue");
  if (!existsSync(helloVue)) {
    writeFileSync(
      helloVue,
      `<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <p>Hello, {{ name }}!</p>
</template>
`,
    );
    console.log(`created ${defaultComponents}/Hello.vue`);
  }

  const outDir = join(targetRoot, defaultOut);
  mkdirSync(outDir, { recursive: true });

  console.log("\nNext steps:\n  1. Run `ferrovue` to generate Rust render functions into src/generated\n  2. In your Rust crate, declare `mod generated;` to use them");
  return 0;
}

function check(config: Config, showDiff = false): number {
  const want = generate(root, config);
  const dir = join(root, config.out);
  let have: string[] = [];
  try {
    have = readdirSync(dir).filter((f) => f.endsWith(".rs"));
  } catch {
  }
  const stale = [...want.keys()].filter((name) => {
    try {
      return readFileSync(join(dir, name), "utf8") !== want.get(name);
    } catch {
      return true;
    }
  });
  const extra = have.filter((name) => !want.has(name));
  if (json) {
    emit({ out: config.out, stale: stale.map((name) => `${config.out}/${name}`), notGenerated: extra.map((name) => `${config.out}/${name}`) });
    return stale.length || extra.length ? 1 : 0;
  }
  if (stale.length || extra.length) {
    const committed = (name: string): string => {
      try {
        return readFileSync(join(dir, name), "utf8");
      } catch {
        return "";
      }
    };
    for (const name of stale) {
      console.error(`stale: ${config.out}/${name}`);
      if (showDiff) console.error(unifiedDiff(`${config.out}/${name}`, committed(name), want.get(name)!));
    }
    for (const name of extra) {
      const foreign = isGenerated(join(dir, name)) ? "" : ` (not written by ferrovue, so \`ferrovue\` leaves it: move it out of ${config.out})`;
      console.error(`not generated: ${config.out}/${name}${foreign}`);
      if (showDiff) console.error(unifiedDiff(`${config.out}/${name}`, committed(name), ""));
    }
    console.error("run `ferrovue` to regenerate");
    return 1;
  }
  console.log(`${config.out} is up to date`);
  return 0;
}

function once(config: Config): void {
  const { files, changed, removed } = write(root, config);
  if (json) return emit({ out: config.out, files, changed, removed });
  const what = changed.length || removed.length ? `${changed.length} changed, ${removed.length} removed` : "nothing changed";
  console.log(`${config.out}: ${files.length} files, ${what}`);
}

function watchProject(configPath?: string): void {
  let inputs: Inputs;
  const run = (): void => {
    let config: Config | null = null;
    try {
      config = load(configPath);
      once(config);
    } catch (e) {
      // A refusal is reported as one; anything else (a folder renamed away, a file read as it is
      // written) is shown too, and the watch carries on for the change that puts it right.
      if (isRefusal(e)) report(e);
      else console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inputs = inputsOf(root, configPath ?? CONFIG_FILE, config);
    }
  };
  run();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // One recursive watch of the root, filtered to the inputs: watching each input directory instead
  // would miss one created later, and the type files may be anywhere.
  const watcher = watch(root, { recursive: true }, (_event, name) => {
    if (!name || !affects(inputs, join(root, name))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 50);
  });
  watcher.on("error", (e) => {
    console.error(`error: stopped watching: ${e.message}`);
    process.exitCode = 1;
  });
  (json ? console.error : console.log)("watching for changes (Ctrl-C to stop)");
}

try {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`error: ${parsed.error}`);
    process.exit(1);
  }
  const { command, options, spelt } = parsed;
  const configPath = options.get("--config") as string | undefined;
  const format = options.get("--format");
  if (format !== undefined && format !== "human" && format !== "json") {
    console.error(`error: '--format' is 'human' or 'json'`);
    process.exit(1);
  }
  json = format === "json";
  for (const w of parsed.warnings) warn(w);
  const conflict = (a: string, b: string): never => {
    console.error(`error: '${a}' does not combine with '${b}'`);
    return process.exit(1);
  };
  if (command === "init") {
    const other = ["--check", "--watch", "--diff"].find((o) => options.has(o));
    if (other !== undefined) conflict("init", spelt.get(other)!);
    if (json) conflict("init", "--format json");
  }
  if (options.has("--check") && options.has("--watch")) conflict("--check", "--watch");
  if (options.has("--diff") && !options.has("--check")) {
    console.error("error: '--diff' requires '--check'");
    process.exit(1);
  }
  if (options.has("--diff") && json) {
    console.error("error: '--diff' writes text, and does not combine with '--format json'");
    process.exit(1);
  }
  if (options.has("--version")) {
    console.log(VERSION);
  } else if (options.has("--help")) {
    console.log(helpText());
  } else if (command === "init") {
    process.exitCode = initProject(root, configPath);
  } else if (options.has("--watch")) {
    watchProject(configPath);
  } else if (options.has("--check")) {
    process.exitCode = check(load(configPath), options.has("--diff"));
  } else {
    once(load(configPath));
  }
} catch (e) {
  report(e);
  process.exitCode = 1;
}
