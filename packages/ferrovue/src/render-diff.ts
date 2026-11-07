import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { unifiedDiff } from "./diff.ts";
import { slashed } from "./paths.ts";
import { visibleText } from "./visible.ts";

/** How a fixture renders at the ref compared with the working tree. */
export type FixtureChange = "text" | "markup" | "added" | "removed";

/** A fixture that renders differently, by its path under the rendered output:
 * `<config>/<Component>/<case>`. */
export interface RenderedChange {
  fixture: string;
  change: FixtureChange;
  /** The visible text's unified diff, for a change of text. */
  diff?: string;
}

/** What `ferrovue diff` found. */
export interface RenderDiff {
  changes: RenderedChange[];
  /** How many fixtures render the same text and markup. */
  same: number;
}

const SKIPPED = new Set(["node_modules", ".git", "target", "dist", ".claude"]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SUITE = /\b(conformanceSuite|registerConformance)\b/;
const VITE_CONFIGS = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js", "vitest.config.mjs", "vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"];

function files(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (SKIPPED.has(d.name)) return [];
    const path = join(dir, d.name);
    return d.isDirectory() ? files(path, base) : [slashed(relative(base, path))];
  });
}

/** The rendered HTML under `dir`, by `<config>/<Component>/<case>`. */
export function renderedFixtures(dir: string): Map<string, string> {
  return new Map(
    files(dir)
      .filter((f) => f.endsWith(".html"))
      .toSorted()
      .map((f) => [f.slice(0, -".html".length), readFileSync(join(dir, f), "utf8")]),
  );
}

/** Compare the fixtures rendered at the ref, `before`, with those of the working tree, `after`. */
export function compareRendered(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): RenderDiff {
  const changes: RenderedChange[] = [];
  let same = 0;
  for (const fixture of [...new Set([...before.keys(), ...after.keys()])].toSorted()) {
    const a = before.get(fixture);
    const b = after.get(fixture);
    if (a === undefined) changes.push({ fixture, change: "added" });
    else if (b === undefined) changes.push({ fixture, change: "removed" });
    else if (a === b) same++;
    else {
      const [ta, tb] = [visibleText(a), visibleText(b)];
      changes.push(ta === tb ? { fixture, change: "markup" } : { fixture, change: "text", diff: unifiedDiff(fixture, `${ta}\n`, `${tb}\n`) });
    }
  }
  return { changes, same };
}

/** The directory whose Vite or Vitest configuration runs the tests of `root`: the nearest one up to
 * `top` that holds one, or `root`. */
export function testRoot(root: string, top: string): string {
  for (let dir = root; ; dir = dirname(dir)) {
    if (VITE_CONFIGS.some((f) => existsSync(join(dir, f)))) return dir;
    if (dir === top || dirname(dir) === dir) return root;
  }
}

/** The test files under `dir` that call `conformanceSuite` or `registerConformance`. */
export function conformanceTests(dir: string): string[] {
  return files(dir)
    .filter((f) => TEST_FILE.test(f) && SUITE.test(readFileSync(join(dir, f), "utf8")))
    .toSorted();
}

function render(cwd: string, tests: readonly string[], into: string, vitest: string): void {
  const run = spawnSync(process.execPath, [vitest, "run", "--reporter=dot", ...tests], { cwd, encoding: "utf8", env: { ...process.env, FERROVUE_FIXTURES_OUT: into } });
  if (run.error) throw run.error;
  if (renderedFixtures(into).size === 0) {
    const tail = `${run.stdout}${run.stderr}`.trim().split("\n").slice(-20).join("\n");
    throw new Error(`no fixture rendered in ${cwd}: Vitest ran ${tests.join(", ")}${tail ? `\n${tail}` : ""}`);
  }
}

function linkModules(from: string, into: string, top: string): void {
  for (let dir = from; ; dir = dirname(dir)) {
    const modules = join(dir, "node_modules");
    const target = join(into, relative(top, dir), "node_modules");
    if (existsSync(modules) && !existsSync(target) && existsSync(dirname(target))) symlinkSync(modules, target, "junction");
    if (dir === top || dirname(dir) === dir) return;
  }
}

/** Render every conformance fixture of the project at `project` in the working tree and at the git
 * ref `against`, with the working tree's `node_modules`, and compare the two. `tests` names the
 * test files that run the suite, relative to the directory of the project's Vitest
 * configuration; by default every test file there that calls `conformanceSuite`. */
export function renderDiff(project: string, against: string, tests?: readonly string[]): RenderDiff {
  const root = realpathSync.native(project);
  const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const top = realpathSync.native(resolve(git(root, "rev-parse", "--show-toplevel")));
  let commit: string;
  try {
    commit = git(root, "rev-parse", "--verify", "--quiet", `${against}^{commit}`);
  } catch {
    throw new Error(`'${against}' names no commit in ${top}: give a branch, a tag or a commit`);
  }
  const cwd = testRoot(root, top);
  const suites = tests?.length ? [...tests] : conformanceTests(cwd);
  if (!suites.length) throw new Error(`no test file under ${cwd} calls \`conformanceSuite\`: name the one that runs the conformance suite with \`--test\``);
  const vitest = join(dirname(createRequire(join(cwd, "package.json")).resolve("vitest/package.json")), "vitest.mjs");
  const scratch = mkdtempSync(join(tmpdir(), "ferrovue-diff-"));
  const tree = join(scratch, "tree");
  try {
    git(top, "worktree", "add", "--detach", tree, commit);
    linkModules(cwd, tree, top);
    const [before, after] = [join(scratch, "before"), join(scratch, "after")];
    render(join(tree, relative(top, cwd)), suites, before, vitest);
    render(cwd, suites, after, vitest);
    return compareRendered(renderedFixtures(before), renderedFixtures(after));
  } finally {
    if (existsSync(tree)) spawnSync("git", ["-C", top, "worktree", "remove", "--force", tree]);
    if (existsSync(scratch) && statSync(scratch).isDirectory()) rmSync(scratch, { recursive: true, force: true });
  }
}
