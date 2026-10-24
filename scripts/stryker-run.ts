import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");

/** The modules of `stryker.config.json`'s `mutate` that `names` name, by path, file name or file
 * name without `.ts`: all of them when `names` is empty. */
export function modules(mutate: string[], names: string[]): string[] {
  if (names.length === 0) return mutate;
  return names.map((name) => {
    const found = mutate.find((m) => m === name || basename(m) === name || basename(m, ".ts") === name);
    if (found === undefined) throw new Error(`\`${name}\` is not among the modules stryker.config.json mutates: name one of ${mutate.map((m) => basename(m, ".ts")).join(", ")}`);
    return found;
  });
}

function main(): void {
  const { mutate } = JSON.parse(readFileSync(join(ROOT, "stryker.config.json"), "utf8")) as { mutate: string[] };
  const files = modules(mutate, process.argv.slice(2));
  const steps: [string, string[]][] = [
    ["pnpm", ["exec", "stryker", "run", "--force", "--mutate", files.join(",")]],
    [process.execPath, [join(ROOT, "scripts/stryker-survivors.ts"), ...files]],
  ];
  for (const [command, args] of steps) {
    const { status } = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
    if (status !== 0) {
      process.exitCode = status ?? 1;
      return;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
