import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const SKIPPED = new Set(["node_modules", "target", "dist", ".git"]);
const TS = /\.(?:ts|mts|cts|tsx)$/;

/** The one exception to the rule: the `ferrovue` crate holds each of its three crates whole as a
 * module. */
export const ALLOWED: Record<string, readonly string[]> = {
  "crates/ferrovue/src/lib.rs": ["pub use ferrovue_core as core;", "pub use ferrovue_i18n as i18n;", "pub use ferrovue_router as router;"],
};

/** A re-export: where it is, and the line that makes it. */
export interface Finding {
  file: string;
  line: number;
  text: string;
}

/** The `pub use` items of a Rust file, of any visibility, outside comments and the lines
 * `allowed` holds. */
export function rustReExports(file: string, source: string, allowed: readonly string[] = []): Finding[] {
  const found: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    const line = text.trim();
    if (line.startsWith("//") || allowed.includes(line)) return;
    if (/^pub(?:\s*\([^)]*\))?\s+use\b/.test(line)) found.push({ file, line: i + 1, text: line });
  });
  return found;
}

const lineOf = (source: string, at: number): number => source.slice(0, at).split("\n").length;

const IMPORT = /^\s*import\s+(?:type\s+)?([^;]*?)\s+from\s+["'][^"']+["']/gm;
const BRACES = /\{([^}]*)\}/;
const NAMED = /(?:^|\s)(?:type\s+)?(?:\S+\s+as\s+)?([\w$]+)\s*$/;
const DEFAULT_OR_NAMESPACE = /^(?:\*\s+as\s+)?([\w$]+)$/;

const locals = (list: string, local: RegExp): string[] => list.split(",").flatMap((part) => local.exec(part.trim())?.[1] ?? []);

const clauseNames = (clause: string): string[] => [...locals(BRACES.exec(clause)?.[1] ?? "", NAMED), ...locals(clause.replace(BRACES, ""), DEFAULT_OR_NAMESPACE)];

function imported(source: string): Set<string> {
  return new Set([...source.matchAll(IMPORT)].flatMap((m) => clauseNames(m[1]!)));
}

/** The re-exports of a TypeScript file: every `export … from`, and every `export { … }` or
 * `export default` of a name the file imports. */
export function tsReExports(file: string, source: string): Finding[] {
  const found: Finding[] = [];
  const add = (at: number, text: string) => found.push({ file, line: lineOf(source, at), text: text.replace(/\s+/g, " ").trim() });
  for (const m of source.matchAll(/^[ \t]*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["'][^"']+["'];?/gm)) add(m.index, m[0]);
  const names = imported(source);
  for (const m of source.matchAll(/^[ \t]*export\s+(?:type\s+)?\{([^}]*)\}\s*(?!\s*from\b);?/gm)) {
    const exported = m[1]!.split(",").map((s) => /^(?:type\s+)?([\w$]+)/.exec(s.trim())?.[1]);
    if (exported.some((n) => n !== undefined && names.has(n))) add(m.index, m[0]);
  }
  for (const m of source.matchAll(/^[ \t]*export\s+default\s+([\w$]+)\s*;/gm)) if (names.has(m[1]!)) add(m.index, m[0]);
  return found;
}

function files(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(path, keep));
    else if (keep(entry.name)) out.push(path);
  }
  return out;
}

/** Every re-export in the repository's Rust crates and TypeScript packages, scripts and site. */
export function findings(root: string = ROOT): Finding[] {
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  const found: Finding[] = [];
  for (const path of files(join(root, "crates"), (name) => name.endsWith(".rs"))) {
    found.push(...rustReExports(rel(path), readFileSync(path, "utf8"), ALLOWED[rel(path)]));
  }
  for (const dir of ["packages", "scripts", "site"]) {
    for (const path of files(join(root, dir), (name) => TS.test(name) && !name.endsWith(".d.ts"))) found.push(...tsReExports(rel(path), readFileSync(path, "utf8")));
  }
  return found;
}

function main(): number {
  const found = findings();
  if (!found.length) return 0;
  for (const f of found) console.error(`${f.file}:${f.line}: ${f.text}`);
  console.error(
    "\nAn item is imported from and exported at the file or module that defines it (AGENTS.md, Rules): import each name from its own file, and export it there. The `ferrovue` crate's modules `core`, `router` and `i18n` are the one exception.",
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
