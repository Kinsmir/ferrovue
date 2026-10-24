import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const REPORT = join(ROOT, "target/stryker/mutation.json");
const LIST = join(ROOT, "stryker-equivalent.txt");

interface Position {
  line: number;
  column: number;
}

/** A mutant as Stryker's JSON report holds it. */
export interface Mutant {
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: Position; end: Position };
}

interface Report {
  files: Record<string, { source: string; mutants: Mutant[] }>;
}

const SURVIVED = new Set(["Survived", "NoCoverage"]);
const DETECTED = new Set(["Killed", "Timeout"]);
const SHORT = 120;

function flat(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= SHORT ? one : `${one.slice(0, SHORT / 2 - 2)} … ${one.slice(2 - SHORT / 2)}`;
}

/** The source text a mutant replaces. */
export function original(source: string, { start, end }: Mutant["location"]): string {
  const lines = source.split("\n");
  if (start.line === end.line) return lines[start.line - 1]!.slice(start.column - 1, end.column - 1);
  return [lines[start.line - 1]!.slice(start.column - 1), ...lines.slice(start.line, end.line - 1), lines[end.line - 1]!.slice(0, end.column - 1)].join("\n");
}

/** A mutant's entry in `stryker-equivalent.txt`: its file, mutator, the text before and after, and
 * the line it starts on, without the line's number. */
export function entry(file: string, source: string, m: Mutant): string {
  const line = source.split("\n")[m.location.start.line - 1]!;
  return `${file}: ${m.mutatorName}: ${flat(original(source, m.location))} => ${flat(m.replacement ?? "")} in ${flat(line)}`;
}

/** The entries of an equivalents list, each as often as it is listed. */
export function listed(text: string): string[] {
  return text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
}

/** The survivors no entry explains, and the entries of the report's files that no survivor uses. A
 * listed mutant that timed out uses its entry: a run under load can time out on one no test kills. */
export function compare(report: Report, known: string[]): { unexplained: string[]; stale: string[] } {
  const left = new Map<string, number>();
  for (const k of known) left.set(k, (left.get(k) ?? 0) + 1);
  const unexplained: string[] = [];
  const timedOut: string[] = [];
  for (const [file, { source, mutants }] of Object.entries(report.files)) {
    for (const m of mutants) {
      if (m.status === "Timeout") timedOut.push(entry(file, source, m));
      if (!SURVIVED.has(m.status)) continue;
      const k = entry(file, source, m);
      const n = left.get(k) ?? 0;
      if (n > 0) left.set(k, n - 1);
      else unexplained.push(`${file}:${m.location.start.line}:${m.location.start.column}: ${m.status}: ${k.slice(file.length + 2)}`);
    }
  }
  for (const k of timedOut) {
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
  }
  const files = Object.keys(report.files);
  const stale = [...left].flatMap(([k, n]) => (files.some((f) => k.startsWith(`${f}: `)) ? Array<string>(n).fill(k) : []));
  return { unexplained, stale };
}

function table(report: Report, known: string[]): string {
  const rows = Object.entries(report.files).map(([file, { source, mutants }]) => {
    const count = (s: Set<string>) => mutants.filter((m) => s.has(m.status)).length;
    const detected = count(DETECTED);
    const survived = mutants.filter((m) => SURVIVED.has(m.status));
    const equivalent = survived.filter((m) => known.includes(entry(file, source, m))).length;
    const score = (100 * detected) / Math.max(1, detected + survived.length);
    const counted = (100 * detected) / Math.max(1, detected + survived.length - equivalent);
    return `| ${file} | ${mutants.length} | ${detected} | ${equivalent} | ${survived.length - equivalent} | ${score.toFixed(2)} | ${counted.toFixed(2)} |`;
  });
  return ["| File | Mutants | Killed | Equivalent | Unexplained | Score | Without equivalents |", "|---|---:|---:|---:|---:|---:|---:|", ...rows].join("\n");
}

/** The report with only the files of `only`: every file when `only` is empty. A run of some modules
 * also reports the others as an earlier run left them. */
export function restricted(report: Report, only: string[]): Report {
  return only.length === 0 ? report : { files: Object.fromEntries(Object.entries(report.files).filter(([file]) => only.includes(file))) };
}

function main(): void {
  const report = restricted(JSON.parse(readFileSync(REPORT, "utf8")) as Report, process.argv.slice(2));
  const known = listed(readFileSync(LIST, "utf8"));
  const { unexplained, stale } = compare(report, known);
  const summary = [
    "### Mutants (TypeScript)",
    "",
    table(report, known),
    ...(unexplained.length ? ["", "Survivors with no test and no explanation:", "", "```text", ...unexplained, "```"] : []),
    ...(stale.length ? ["", "Listed as equivalent, but no mutant survived them: remove them from stryker-equivalent.txt", "", "```text", ...stale, "```"] : []),
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (unexplained.length || stale.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
