#!/usr/bin/env node
/* `ferrovue`: compile the project's components, run from its root.
 *
 *   ferrovue                  write the Rust modules to the configured output directory
 *   ferrovue --check          write nothing; exit 1 if the committed modules are not what would be written
 *   ferrovue --check --diff   show a unified diff of differences
 *   ferrovue --watch          write them, then again whenever a component, store, type file, the routes
 *                             or the configuration changes, until interrupted
 *   ferrovue init             scaffold a starter ferrovue.config.json and components directory
 *   ferrovue -c, --config     path to configuration file (default: ferrovue.config.json)
 *   ferrovue -v, --version    print the version and exit
 *   ferrovue -h, --help       print this help and exit */
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { type Config, CONFIG_FILE, GenError, generate, loadConfig, VERSION, write } from "./compiler.ts";
import { unifiedDiff } from "./diff.ts";

const root = process.cwd();

const HELP = `Usage: ferrovue [command] [options]

Compile Vue components to Rust render functions, run from the project root.

Commands:
  init                     scaffold starter ferrovue.config.json and components

Options:
      --check              check that generated files match committed files without writing
  -d, --diff               show unified diff of changes when checking (use with --check)
      --watch              watch components, stores, routes and config for changes and regenerate
  -c, --config <path>      path to configuration file (default: ferrovue.config.json)
  -v, --version            print the version and exit
  -h, --help               print this help and exit
`;

/** A refused construct, or a broken configuration: the message alone, which names the file. */
function report(e: unknown): void {
  if (e instanceof GenError || e instanceof SyntaxError) console.error(`error: ${e.message}`);
  else throw e;
}

function initProject(targetRoot: string, configPath?: string): number {
  const configFile = configPath ? resolve(targetRoot, configPath) : join(targetRoot, CONFIG_FILE);
  if (existsSync(configFile)) {
    console.error(`error: configuration file already exists: ${relative(targetRoot, configFile) || CONFIG_FILE}`);
    return 1;
  }
  const defaultComponents = "components";
  const defaultOut = "src/generated";

  mkdirSync(dirname(configFile), { recursive: true });
  const config = {
    components: defaultComponents,
    out: defaultOut,
  };
  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
  console.log(`created ${relative(targetRoot, configFile) || CONFIG_FILE}`);

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
    console.log(`created ${join(defaultComponents, "Hello.vue")}`);
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
    // An absent directory is simply stale.
  }
  const stale = [...want.keys()].filter((name) => {
    try {
      return readFileSync(join(dir, name), "utf8") !== want.get(name);
    } catch {
      return true;
    }
  });
  const extra = have.filter((name) => !want.has(name));
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
      console.error(`not generated: ${config.out}/${name}`);
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
  const what = changed.length || removed.length ? `${changed.length} changed, ${removed.length} removed` : "nothing changed";
  console.log(`${config.out}: ${files.length} files, ${what}`);
}

/** Regenerate on every change to what the components are compiled from, reporting errors and
 * carrying on. The output directory itself, dependencies and build output are ignored. */
function watchProject(configPath?: string): void {
  const run = (): void => {
    try {
      once(loadConfig(root, configPath));
    } catch (e) {
      report(e);
    }
  };
  run();
  const ignored = (file: string): boolean => {
    let out = "";
    try {
      out = loadConfig(root, configPath).out;
    } catch {
      // A broken configuration ignores nothing; the next run reports it.
    }
    const parts = file.split(sep);
    return (
      parts.some((p) => p === "node_modules" || p === "target" || p === ".git" || p === "dist") ||
      (out !== "" && (file === out || file.startsWith(out + sep))) ||
      !/\.(vue|ts|json)$/.test(file)
    );
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(root, { recursive: true }, (_event, name) => {
    if (!name || ignored(relative(root, join(root, name)))) return;
    // Editors write a file in several steps: one run once they are done.
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 50);
  });
  console.log("watching for changes (Ctrl-C to stop)");
}

try {
  const rawArgs = process.argv.slice(2);
  let configPath: string | undefined;
  const args: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (arg === "-c" || arg === "--config") {
      if (i + 1 >= rawArgs.length || rawArgs[i + 1]!.startsWith("-")) {
        console.error(`error: option '${arg}' requires an argument`);
        process.exit(1);
      }
      configPath = rawArgs[++i];
    } else if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
    } else {
      args.push(arg);
    }
  }

  const known = new Set(["init", "--check", "--diff", "-d", "--watch", "-v", "--version", "-h", "--help"]);
  const unknown = args.find((a) => !known.has(a));
  if (unknown !== undefined) {
    console.error(`error: unknown option or command '${unknown}'\n\nRun \`ferrovue --help\` for usage.`);
    process.exit(1);
  }
  if ((args.includes("--diff") || args.includes("-d")) && !args.includes("--check")) {
    console.error("error: '--diff' requires '--check'");
    process.exit(1);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
  } else if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trimEnd());
  } else if (args.includes("init")) {
    process.exitCode = initProject(root, configPath);
  } else if (args.includes("--watch")) {
    watchProject(configPath);
  } else if (args.includes("--check")) {
    const showDiff = args.includes("--diff") || args.includes("-d");
    process.exitCode = check(loadConfig(root, configPath), showDiff);
  } else {
    once(loadConfig(root, configPath));
  }
} catch (e) {
  report(e);
  process.exitCode = 1;
}
