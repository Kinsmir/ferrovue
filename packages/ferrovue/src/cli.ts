#!/usr/bin/env node
/* `ferrovue` — compile the project's components, run from its root.
 *
 *   ferrovue          write the Rust modules to the configured output directory
 *   ferrovue --check  write nothing; exit 1 if the committed modules are not what would be written */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate, loadConfig, write } from "./compiler.ts";

const root = process.cwd();
const config = loadConfig(root);

if (process.argv.includes("--check")) {
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
    process.exit(1);
  }
  console.log(`${config.out} is up to date`);
} else {
  const files = write(root, config);
  console.log(`wrote ${files.length} files to ${config.out}`);
}
