import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILE, generate, loadConfig } from "./compiler.ts";
import { type Diagnostic, diagnose, isRefusal, refusalsOf } from "./diagnostics.ts";
import { GenError } from "./model.ts";

/** A refusal in the file an editor holds, with its range as offsets into the text it was given. The
 * end is exclusive, and `null` where the compiler does not know it. */
export interface Located extends Diagnostic {
  start: number;
  end: number | null;
}

/** Where an editor's checks find the project: the configuration file's path from the project root. */
export interface EditorOptions {
  config?: string;
}

const FRESH_MS = 1000;
const recent = new Map<string, { text: string; at: number; found: Located[] }>();

/** The directory holding `config` that is `dir` or the nearest above it. */
export function projectRoot(dir: string, config: string = CONFIG_FILE): string | null {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (existsSync(join(at, config))) return at;
    if (dirname(at) === at) return null;
  }
}

function offsetOf(text: string, line: number, column: number): number {
  let at = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return Math.min(at + column - 1, text.length);
}

function check(file: string, text: string, options: EditorOptions): Located[] {
  const root = projectRoot(dirname(file), options.config);
  if (!root) return [];
  try {
    generate(root, loadConfig(root, options.config), new Map([[file, text]]));
    return [];
  } catch (e) {
    if (!isRefusal(e)) {
      console.error(e);
      return [];
    }
    return refusalsOf(e).flatMap((one) => {
      const found = diagnose(one);
      const readAt = one instanceof GenError ? one.readAt : null;
      const d = readAt && found.file !== null && resolve(root, found.file) !== file ? { ...found, file: readAt.file, line: readAt.line ?? null, column: readAt.column ?? null, endLine: null, endColumn: null } : found;
      if (d.file === null || resolve(root, d.file) !== file) return [];
      const start = d.line === null ? 0 : offsetOf(text, d.line, d.column ?? 1);
      const end = d.endLine === null ? null : offsetOf(text, d.endLine, d.endColumn ?? 1);
      return [{ ...d, start, end }];
    });
  }
}

/** The refusals in a component of a ferrovue project, compiling the project with `text` in place of
 * the file. A project is the nearest directory above the file holding the configuration; a file in
 * none has no refusals. A component that uses a refused one is checked once that one compiles, and
 * a refusal of the project's configuration hides those of every component. */
export function refusalsIn(file: string, text: string, options: EditorOptions = {}): Located[] {
  const path = resolve(file);
  const hit = recent.get(path);
  if (hit && hit.text === text && Date.now() - hit.at < FRESH_MS) return hit.found;
  const found = check(path, text, options);
  recent.set(path, { text, at: Date.now(), found });
  return found;
}
