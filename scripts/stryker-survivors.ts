import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const REPORT = join(ROOT, "target/stryker/mutation.json");
const LIST = join(ROOT, "stryker-equivalent.txt");
const TIMEOUTS = join(ROOT, "stryker-timeout.txt");

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

/** A mutant's entry in `stryker-equivalent.txt` or `stryker-timeout.txt`: its file, mutator, the
 * text before and after, and the line it starts on, without the line's number. */
export function entry(file: string, source: string, m: Mutant): string {
  const line = source.split("\n")[m.location.start.line - 1]!;
  return `${file}: ${m.mutatorName}: ${flat(original(source, m.location))} => ${flat(m.replacement ?? "")} in ${flat(line)}`;
}

/** The entries of an equivalents list, each as often as it is listed. */
export function listed(text: string): string[] {
  return text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
}

/** What the lists leave unexplained: the survivors no entry of `equivalent` explains, the timeouts
 * no entry of `listedTimeouts` or `equivalent` explains, and the entries of the report's files that no
 * mutant uses. A listed equivalent that timed out uses its entry: a run under load can time out on
 * one no test kills. */
export function compare(
  report: Report,
  equivalent: string[],
  listedTimeouts: string[] = [],
): { unexplained: string[]; timedOut: string[]; stale: string[]; staleTimeouts: string[] } {
  const left = tally(equivalent);
  const leftTimeouts = tally(listedTimeouts);
  const unexplained: string[] = [];
  const timedOut: string[] = [];
  const pending: [string, string][] = [];
  for (const [file, { source, mutants }] of Object.entries(report.files)) {
    for (const m of mutants) {
      const k = entry(file, source, m);
      if (m.status === "Timeout") pending.push([k, located(file, m, k)]);
      else if (SURVIVED.has(m.status) && !take(left, k)) unexplained.push(located(file, m, k));
    }
  }
  for (const [k, where] of pending) if (!take(leftTimeouts, k) && !take(left, k)) timedOut.push(where);
  const files = Object.keys(report.files);
  const unused = (rest: Map<string, number>) => [...rest].flatMap(([k, n]) => (files.some((f) => k.startsWith(`${f}: `)) ? Array<string>(n).fill(k) : []));
  return { unexplained, timedOut, stale: unused(left), staleTimeouts: unused(leftTimeouts) };
}

/** Every mutant of the report that timed out, located as `compare` locates them. */
export function timeouts(report: Report): string[] {
  return Object.entries(report.files).flatMap(([file, { source, mutants }]) => mutants.filter((m) => m.status === "Timeout").map((m) => located(file, m, entry(file, source, m))));
}

function tally(list: string[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const k of list) n.set(k, (n.get(k) ?? 0) + 1);
  return n;
}

function take(left: Map<string, number>, k: string): boolean {
  const n = left.get(k) ?? 0;
  if (n > 0) left.set(k, n - 1);
  return n > 0;
}

function located(file: string, m: Mutant, k: string): string {
  return `${file}:${m.location.start.line}:${m.location.start.column}: ${m.status}: ${k.slice(file.length + 2)}`;
}

function table(report: Report, known: string[]): string {
  const rows = Object.entries(report.files).map(([file, { source, mutants }]) => {
    const count = (status: string) => mutants.filter((m) => m.status === status).length;
    const [killed, timedOut] = [count("Killed"), count("Timeout")];
    const survived = mutants.filter((m) => SURVIVED.has(m.status));
    const equivalent = survived.filter((m) => known.includes(entry(file, source, m))).length;
    const detected = killed + timedOut;
    const score = (100 * detected) / Math.max(1, detected + survived.length);
    const without = (100 * detected) / Math.max(1, detected + survived.length - equivalent);
    return `| ${file} | ${mutants.length} | ${killed} | ${timedOut} | ${equivalent} | ${survived.length - equivalent} | ${score.toFixed(2)} | ${without.toFixed(2)} |`;
  });
  return ["| File | Mutants | Killed | Timed out | Equivalent | Unexplained | Score | Without equivalents |", "|---|---:|---:|---:|---:|---:|---:|---:|", ...rows].join("\n");
}

/** The report with only the files of `only`: every file when `only` is empty. A run of some modules
 * also reports the others as an earlier run left them. */
export function restricted(report: Report, only: string[]): Report {
  return only.length === 0 ? report : { files: Object.fromEntries(Object.entries(report.files).filter(([file]) => only.includes(file))) };
}

function block(title: string, lines: string[]): string[] {
  return lines.length ? ["", title, "", "```text", ...lines, "```"] : [];
}

function main(): void {
  const report = restricted(JSON.parse(readFileSync(REPORT, "utf8")) as Report, process.argv.slice(2));
  const known = listed(readFileSync(LIST, "utf8"));
  const { unexplained, timedOut, stale, staleTimeouts } = compare(report, known, listed(readFileSync(TIMEOUTS, "utf8")));
  const summary = [
    "### Mutants (TypeScript)",
    "",
    table(report, known),
    ...block("Survivors with no test and no explanation:", unexplained),
    ...block("Timed out, and listed in neither stryker-timeout.txt nor stryker-equivalent.txt: make the loop end, or list the mutant in stryker-timeout.txt with its reason", timedOut),
    ...block("Listed as equivalent, but no mutant survived them: remove them from stryker-equivalent.txt", stale),
    ...block("Listed as timing out, but no mutant timed out on them: remove them from stryker-timeout.txt", staleTimeouts),
    ...block("Every mutant that timed out:", timeouts(report)),
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (unexplained.length || timedOut.length || stale.length || staleTimeouts.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
