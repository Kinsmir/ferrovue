#!/usr/bin/env node
/* `ferrovue` — compile the project's components, run from its root.
 *
 *   ferrovue          write the Rust modules to the configured output directory
 *   ferrovue --check  write nothing; exit 1 if the committed modules are not what would be written
 *   ferrovue --watch  write them, then again whenever a component, store, type file, the routes
 *                     or the configuration changes, until interrupted */
import { readFileSync, readdirSync, watch } from "node:fs";
import { join, relative, sep } from "node:path";
import { type Config, GenError, generate, loadConfig, write } from "./compiler.ts";

const root = process.cwd();

/** A refused construct, or a broken configuration: the message alone, which names the file. */
function report(e: unknown): void {
  if (e instanceof GenError || e instanceof SyntaxError) console.error(`error: ${e.message}`);
  else throw e;
}

function check(config: Config): number {
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
    for (const name of stale) console.error(`stale: ${config.out}/${name}`);
    for (const name of extra) console.error(`not generated: ${config.out}/${name}`);
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
function watchProject(): void {
  const run = (): void => {
    try {
      once(loadConfig(root));
    } catch (e) {
      report(e);
    }
  };
  run();
  const ignored = (file: string): boolean => {
    let out = "";
    try {
      out = loadConfig(root).out;
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
  if (process.argv.includes("--watch")) watchProject();
  else if (process.argv.includes("--check")) process.exitCode = check(loadConfig(root));
  else once(loadConfig(root));
} catch (e) {
  report(e);
  process.exitCode = 1;
}
