import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const BASELINE = join(ROOT, "crates/ferrovue/benches/instructions.json");
const MEASURED = join(ROOT, "target/instructions/instructions.json");
const ARTIFACT = "instructions";

/** Instruction counts and what they were measured with. `instructions` is `null` in a placeholder,
 * which the check only records against. */
export interface Baseline {
  toolchain: string;
  target: string;
  budget: number;
  instructions: Record<string, number> | null;
}

/** One scenario of a check: its baseline and measured counts, either absent where only the other
 * names the scenario. */
export interface Row {
  scenario: string;
  baseline: number | null;
  measured: number | null;
  change: number | null;
  over: boolean;
}

/** The instructions each benchmark ran, by its id, from gungraun's JSON output (one object a line). */
export function parseSummaries(stdout: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const summary = JSON.parse(line) as {
      id: string;
      profiles: { tool: string; data: { total: { metrics: { Ir?: { values: { new: number } } } } } }[];
    };
    const callgrind = summary.profiles.find((p) => p.tool === "Callgrind");
    const ir = callgrind?.data.total.metrics.Ir?.values.new;
    if (ir === undefined) throw new Error(`gungraun reported no instruction count for ${summary.id}`);
    counts.set(summary.id, ir);
  }
  return counts;
}

/** Each scenario of the baseline and of the run, with the change in percent; a scenario is over
 * when it ran more than `budget` percent above its baseline, or is missing from either side. */
export function compare(baseline: Record<string, number>, measured: ReadonlyMap<string, number>, budget: number): Row[] {
  const scenarios = [...new Set([...Object.keys(baseline), ...measured.keys()])];
  return scenarios.map((scenario) => {
    const base = baseline[scenario] ?? null;
    const now = measured.get(scenario) ?? null;
    const change = base !== null && now !== null ? ((now - base) / base) * 100 : null;
    return { scenario, baseline: base, measured: now, change, over: change === null || change > budget };
  });
}

/** The comparison as a Markdown table. */
export function table(rows: Row[], budget: number): string {
  const n = (v: number | null): string => (v === null ? "missing" : v.toLocaleString("en-US"));
  const pct = (r: Row): string => (r.change === null ? "" : `${r.change >= 0 ? "+" : ""}${r.change.toFixed(2)}%`);
  return [
    `| Scenario | Baseline | Measured | Change (budget +${budget}%) |`,
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.scenario} | ${n(r.baseline)} | ${n(r.measured)} | ${pct(r)}${r.over ? " (over)" : ""} |`),
  ].join("\n");
}

/** The version of gungraun `Cargo.lock` holds, which `gungraun-runner` must match. */
export function gungraunVersion(lock: string): string {
  const m = /\[\[package\]\]\nname = "gungraun"\nversion = "([^"]+)"/.exec(lock);
  if (!m) throw new Error("Cargo.lock has no gungraun package");
  return m[1]!;
}

function run(baseline: Baseline): Map<string, number> {
  const cc = `CC_${baseline.target.replaceAll("-", "_")}`;
  const env = { ...process.env, [cc]: process.env[cc] ?? "cc" };
  const stdout = execFileSync(
    "cargo",
    [`+${baseline.toolchain}`, "bench", "--locked", "--target", baseline.target, "-p", "ferrovue", "--bench", "instructions", "--", "--output-format=json"],
    { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );
  return parseSummaries(stdout);
}

function preflight(baseline: Baseline): string | null {
  if (process.platform !== "linux" || process.arch !== "x64") return "the instruction counts are measured on x86_64 Linux only, where Valgrind runs";
  const wanted = gungraunVersion(readFileSync(join(ROOT, "Cargo.lock"), "utf8"));
  let runner = "";
  try {
    runner = execFileSync("gungraun-runner", ["--version"], { encoding: "utf8" });
  } catch {
    runner = "";
  }
  if (!runner.includes(wanted)) return `gungraun-runner ${wanted} is needed: cargo install gungraun-runner --version ${wanted} --locked`;
  const targets = execFileSync("rustup", ["target", "list", "--installed", "--toolchain", baseline.toolchain], { encoding: "utf8" });
  if (!targets.split("\n").includes(baseline.target)) {
    return `Rust ${baseline.toolchain} with the ${baseline.target} target is needed: rustup target add --toolchain ${baseline.toolchain} ${baseline.target}`;
  }
  return null;
}

const write = (path: string, baseline: Baseline): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n");
};

const read = (path: string): Baseline => JSON.parse(readFileSync(path, "utf8")) as Baseline;

const show = (path: string): string => relative(ROOT, path) || path;

function fromCi(runId: string | undefined): number {
  const gh = (args: string[]): string => execFileSync("gh", args, { cwd: ROOT, encoding: "utf8" }).trim();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const id = runId ?? gh(["run", "list", "--workflow", "ci.yml", "--commit", head, "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"]);
  if (!id) {
    console.error(`error: no CI run on ${head}; push the branch, or start one with gh workflow run ci.yml --ref <branch>`);
    return 2;
  }
  const dir = mkdtempSync(join(tmpdir(), "ferrovue-instructions-"));
  try {
    try {
      execFileSync("gh", ["run", "download", id, "--name", ARTIFACT, "--dir", dir], { cwd: ROOT, stdio: "ignore" });
    } catch {
      console.error(`error: CI run ${id} has no ${ARTIFACT} artifact; wait for its Performance budgets job to finish`);
      return 2;
    }
    const measured = read(join(dir, "instructions.json"));
    if (!measured.instructions) {
      console.error(`error: CI run ${id}'s ${ARTIFACT} artifact holds no counts`);
      return 2;
    }
    write(BASELINE, measured);
    console.log(`wrote CI run ${id}'s ${Object.keys(measured.instructions).length} scenarios to ${show(BASELINE)}`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      update: { type: "boolean", default: false },
      "from-ci": { type: "boolean", default: false },
      baseline: { type: "string" },
      toolchain: { type: "string" },
      print: { type: "string" },
    },
  });
  const path = values.baseline ? resolve(values.baseline) : BASELINE;
  if (values["from-ci"]) return fromCi(positionals[0]);
  if (values.print === "runner-version") {
    console.log(gungraunVersion(readFileSync(join(ROOT, "Cargo.lock"), "utf8")));
    return 0;
  }
  const committed = read(BASELINE);
  if (values.print === "toolchain") {
    console.log(committed.toolchain);
    return 0;
  }
  let baseline: Baseline = committed;
  try {
    baseline = read(path);
  } catch (e) {
    if (!values.update) throw e;
  }
  const measuring: Baseline = { ...committed, toolchain: values.toolchain ?? baseline.toolchain, instructions: null };
  const problem = preflight(measuring);
  if (problem) {
    console.error(`error: ${problem}`);
    return 2;
  }
  const measured: Baseline = { ...measuring, instructions: Object.fromEntries(run(measuring)) };
  write(MEASURED, measured);
  if (values.update) {
    write(path, measured);
    console.log(`wrote ${Object.keys(measured.instructions!).length} scenarios to ${show(path)}`);
    return 0;
  }
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  const heading = `### Instruction counts (Rust ${measured.toolchain}, ${measured.target})`;
  if (!baseline.instructions) {
    const counts = Object.entries(measured.instructions!).map(([k, v]) => `| ${k} | ${v.toLocaleString("en-US")} |`);
    const report = ["| Scenario | Measured |", "|---|---|", ...counts].join("\n");
    console.log(report);
    if (summary) appendFileSync(summary, `${heading}\n\n${show(path)} is a placeholder, so nothing is compared. Fill it from this run with \`node scripts/instructions.ts --from-ci\`.\n\n${report}\n`);
    if (process.env["GITHUB_REF_TYPE"] === "tag") {
      console.error(`error: ${show(path)} is a placeholder; a release needs a baseline (node scripts/instructions.ts --from-ci)`);
      return 1;
    }
    console.log(`::warning title=No instruction baseline::${show(path)} is a placeholder; the counts are recorded in ${show(MEASURED)} and compared with nothing`);
    return 0;
  }
  if (measured.toolchain !== baseline.toolchain || measured.target !== baseline.target) {
    console.error(`error: the baseline was measured with Rust ${baseline.toolchain} for ${baseline.target}, this run with Rust ${measured.toolchain} for ${measured.target}`);
    return 2;
  }
  const rows = compare(baseline.instructions, new Map(Object.entries(measured.instructions!)), baseline.budget);
  const report = table(rows, baseline.budget);
  console.log(report);
  if (summary) appendFileSync(summary, `${heading}\n\n${report}\n`);
  const over = rows.filter((r) => r.over);
  for (const r of over) {
    console.error(
      r.change === null
        ? `error: ${r.scenario} is ${r.baseline === null ? "not in the baseline" : "in the baseline but did not run"}`
        : `error: ${r.scenario} ran ${r.change.toFixed(2)}% more instructions than its baseline, over the ${baseline.budget}% budget`,
    );
  }
  if (over.length) console.error("A deliberate change takes the CI run's counts with `node scripts/instructions.ts --from-ci` (TESTING.md, Performance budgets).");
  return over.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
