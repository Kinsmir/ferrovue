import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { relativePath } from "./paths.ts";
import { ctx } from "./context.ts";
import { type Component, fail, type N } from "./model.ts";

/** An alias a bundler resolves imports through, as Vite's `resolve.alias` lists it: a string
 * matches the specifier itself and any path below it (`@` matches `@/lib/format`), a regular
 * expression is replaced in the specifier. `replacement` is an absolute path, or one relative to
 * the importing file. */
export interface Alias {
  /** The specifier, or the start of one before a `/`, or a pattern replaced in it. */
  find: string | RegExp;
  /** What it is replaced with: an absolute path, or one relative to the importing file. */
  replacement: string;
}

/** The `paths` of one tsconfig file, after its `extends`, with the directory they are relative to. */
interface TsPaths {
  file: string;
  paths: [pattern: string, targets: string[]][];
  base: string;
  baseUrl: string | null;
}

/** The tsconfig file that applies to a directory, with the projects it references. */
export interface TsProject {
  file: string;
  projects: TsPaths[];
  error: string | null;
}

/** Where a specifier leads: the files tried, and what led there when it is not a relative path. */
interface Lookup {
  tried: string[];
  via: string | null;
}

/** The `.ts` file an import of `spec` from `fromFile` (relative to the root) reads: a relative path,
 * or one that Vite's `resolve.alias`, when the Vite plugin runs, or tsconfig's `paths` and `baseUrl`
 * maps to a file. `null` for a package or a path that leads to no `.ts` file. */
export function resolveImport(fromFile: string, spec: string): string | null {
  for (const lookup of lookups(fromFile, spec)) {
    for (const base of lookup.tried) {
      const file = tsFile(base);
      if (file !== null) return file;
    }
  }
  return null;
}

/** Refuse `name`, which the server reads, when `comp` imports it from a module that resolves to no
 * `.ts` file, naming the specifier and where it was looked for. */
export function refuseUnresolved(comp: Component, name: string, n: N): void {
  const from = comp.unresolved.get(name);
  if (from === undefined) return;
  fail(comp, "FV0110", `\`${name}\` is imported from \`${from}\`, which the compiler cannot resolve to a \`.ts\` file of the project: ${whyUnresolved(comp.file, from)}`, n);
}

/** Why `spec` imported from `fromFile` reaches no `.ts` file. */
function whyUnresolved(fromFile: string, spec: string): string {
  const all = lookups(fromFile, spec);
  const tried = all.flatMap((l) => l.tried.map((t) => relativePath(ctx.rootDir, t))).join(", ");
  const via = all.find((l) => l.via !== null)?.via;
  if (isRelative(spec)) return `there is no \`.ts\` file at ${tried}`;
  if (via !== undefined) return tried === "" ? `${via} maps it to a package` : `${via} maps it to ${tried}, where there is no \`.ts\` file`;
  const project = tsProject(resolve(ctx.rootDir, dirname(fromFile)));
  const paths = project === null ? "a tsconfig.json's `compilerOptions.paths` (there is none)" : `the \`compilerOptions.paths\` of ${relativePath(ctx.rootDir, project.file)}${project.error === null ? "" : ` (${project.error})`}`;
  const vite = ctx.aliases.length > 0 ? "Vite's `resolve.alias`" : "Vite's `resolve.alias` (read only by the Vite plugin)";
  return `it is a package, or an alias declared neither in ${paths} nor in ${vite}`;
}

function isRelative(spec: string): boolean {
  return spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../");
}

function tsFile(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")]) {
    try {
      if (statSync(candidate).isFile() && candidate.endsWith(".ts")) return candidate;
    } catch {
    }
  }
  return null;
}

/** The ways `spec` may lead to a file, in the order they are tried: a relative path, else the
 * first of Vite's aliases that matches, then tsconfig's `paths` and `baseUrl`, of the tsconfig file
 * nearest the importing file and of the projects it references. */
function lookups(fromFile: string, spec: string): Lookup[] {
  const dir = resolve(ctx.rootDir, dirname(fromFile));
  if (isRelative(spec)) return [{ tried: [resolve(dir, spec)], via: null }];
  const found: Lookup[] = [];
  const alias = ctx.aliases.find((a) => (typeof a.find === "string" ? spec === a.find || spec.startsWith(`${a.find}/`) : a.find.test(spec)));
  if (alias !== undefined) {
    const to = typeof alias.find === "string" ? alias.replacement + spec.slice(alias.find.length) : spec.replace(alias.find, alias.replacement);
    const target = isAbsolute(to) ? to : isRelative(to) ? resolve(dir, to) : null;
    found.push({ tried: target === null ? [] : [target], via: `Vite's alias \`${String(alias.find)}\`` });
  }
  const project = tsProject(dir);
  for (const p of project?.projects ?? []) {
    const match = bestPattern(p.paths, spec);
    if (match !== null) {
      const [pattern, targets, star] = match;
      const base = p.baseUrl ?? p.base;
      found.push({ tried: targets.map((t) => resolve(base, t.replace("*", star))), via: `\`${pattern}\` in ${relativePath(ctx.rootDir, p.file)}'s \`paths\`` });
    }
    if (p.baseUrl !== null) found.push({ tried: [resolve(p.baseUrl, spec)], via: null });
  }
  return found;
}

/** The pattern of `paths` TypeScript resolves `spec` by: one without `*` equal to it, else the one
 * with the longest prefix before its `*` that matches, with what the `*` stands for. */
function bestPattern(paths: TsPaths["paths"], spec: string): [string, string[], string] | null {
  let best: [string, string[], string] | null = null;
  for (const [pattern, targets] of paths) {
    const star = pattern.indexOf("*");
    if (star < 0) {
      if (pattern === spec) return [pattern, targets, ""];
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix) && (best === null || prefix.length > best[0].indexOf("*"))) {
      best = [pattern, targets, spec.slice(prefix.length, spec.length - suffix.length)];
    }
  }
  return best;
}

/** The tsconfig.json nearest `dir`, as TypeScript finds it, read once a run. */
function tsProject(dir: string): TsProject | null {
  if (ctx.tsProjects.has(dir)) return ctx.tsProjects.get(dir)!;
  const file = join(dir, "tsconfig.json");
  let project: TsProject | null;
  if (isFile(file)) {
    project = { file, projects: [], error: null };
    try {
      const own = readTsconfig(file, new Set());
      project.projects.push(own.paths);
      for (const ref of own.references) {
        const path = resolve(dirname(file), ref);
        project.projects.push(readTsconfig(isFile(path) ? path : join(path, "tsconfig.json"), new Set()).paths);
      }
    } catch (e) {
      project.error = (e as Error).message;
    }
  } else {
    project = dirname(dir) === dir ? null : tsProject(dirname(dir));
  }
  ctx.tsProjects.set(dir, project);
  return project;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** A tsconfig file's `paths` and `baseUrl`, with those it `extends` underneath, and the projects it
 * references. */
function readTsconfig(file: string, seen: Set<string>): { paths: TsPaths; references: string[] } {
  if (seen.has(file)) throw new Error(`${relativePath(ctx.rootDir, file)} extends itself`);
  seen.add(file);
  ctx.tsconfigs.add(file);
  const name = relativePath(ctx.rootDir, file);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`${name} cannot be read: ${(e as Error).message}`, { cause: e });
  }
  const raw = parseJsonc(text, name);
  const paths: TsPaths = { file, paths: [], base: dirname(file), baseUrl: null };
  const extended = raw.extends === undefined ? [] : Array.isArray(raw.extends) ? raw.extends : [raw.extends];
  for (const ext of extended) {
    if (typeof ext !== "string") continue;
    const parent = extendedFile(file, ext);
    if (parent === null) continue;
    const inherited = readTsconfig(parent, seen).paths;
    if (inherited.paths.length > 0) Object.assign(paths, { file: inherited.file, paths: inherited.paths, base: inherited.base });
    if (inherited.baseUrl !== null) paths.baseUrl = inherited.baseUrl;
  }
  const options = isObject(raw.compilerOptions) ? raw.compilerOptions : {};
  if (typeof options.baseUrl === "string") paths.baseUrl = resolve(dirname(file), options.baseUrl);
  if (isObject(options.paths)) {
    paths.file = file;
    paths.base = dirname(file);
    paths.paths = Object.entries(options.paths).map(([pattern, targets]) => [pattern, Array.isArray(targets) ? targets.filter((t): t is string => typeof t === "string") : []]);
  }
  const references = Array.isArray(raw.references) ? raw.references.flatMap((r: unknown) => (isObject(r) && typeof r.path === "string" ? [r.path] : [])) : [];
  return { paths, references };
}

/** The file an `extends` of `file` names: a path, or a package's file as Node finds it. */
function extendedFile(file: string, ext: string): string | null {
  if (isRelative(ext) || isAbsolute(ext)) {
    const path = resolve(dirname(file), ext);
    return isFile(path) ? path : isFile(`${path}.json`) ? `${path}.json` : null;
  }
  const require = createRequire(file);
  for (const candidate of [ext, `${ext}.json`, `${ext}/tsconfig.json`]) {
    try {
      return require.resolve(candidate);
    } catch {
    }
  }
  return null;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON with comments and trailing commas, as TypeScript reads a tsconfig file. */
function parseJsonc(text: string, file: string): Json {
  let out = "";
  let comma = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      out += " ";
    } else if (c === ",") {
      if (comma) out += ",";
      comma = true;
    } else if (/\s/.test(c)) {
      out += c;
    } else {
      if (comma && c !== "}" && c !== "]") out += ",";
      comma = false;
      if (c === '"') {
        let end = i + 1;
        while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
        out += text.slice(i, end + 1);
        i = end;
      } else {
        out += c;
      }
    }
  }
  if (comma) out += ",";
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${(e as Error).message}`, { cause: e });
  }
  if (!isObject(parsed)) throw new Error(`${file} does not hold an object`);
  return parsed;
}
