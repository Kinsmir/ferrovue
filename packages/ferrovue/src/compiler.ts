import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { relativePath } from "./paths.ts";
import { type Config, CONFIG_FILE, ctx, JS_DATE, loadConfig, tyOfName } from "./context.ts";
import { refuseUnusedUnions } from "./enums.ts";
import { type Component, failIn, GenError, GenErrors, snake } from "./model.ts";
import { isRefusal } from "./diagnostics.ts";
import { readComponent, refuseOptionsApi } from "./component.ts";
import { listDir } from "./files.ts";
import { scopeFor } from "./script.ts";
import { attrsFlow } from "./fallthrough.ts";
import { prepareDynamic } from "./dynamic.ts";
import { componentSource, GENERATED, isIsland, modSource } from "./rust.ts";
import { requireWhole } from "./typescript.ts";
import { renderParams } from "./plugin.ts";
import { PLUGINS } from "./plugins/index.ts";
import type { Alias } from "./resolve.ts";

/** How a run resolves the imports of components beyond relative paths and the `paths` of the
 * project's tsconfig files. */
export interface ResolveOptions {
  /** Aliases tried before tsconfig's `paths`, as Vite's `resolve.alias` lists them: the Vite plugin
   * passes its build's own. */
  aliases?: readonly Alias[];
}

/** Every generated file, keyed by its name in the output directory. `sources` holds the text of
 * components by path, read in place of their files, as an editor's unsaved buffers. A run that
 * refuses anything raises a `GenErrors` holding every refusal it found, and generates nothing. */
export function generate(root: string, config: Config = loadConfig(root), sources: ReadonlyMap<string, string> = new Map(), options: ResolveOptions = {}): Map<string, string> {
  try {
    return generateAll(root, config, sources, options);
  } catch (e) {
    if (isRefusal(e) && !(e instanceof GenErrors)) throw new GenErrors([e]);
    throw e;
  }
}

function generateAll(root: string, config: Config, sources: ReadonlyMap<string, string>, options: ResolveOptions): Map<string, string> {
  ctx.recovered = null;
  ctx.trying = 0;
  ctx.narrowCount = 0;
  ctx.hints = new Map();
  ctx.datePlans = { components: new Map(), loaders: new Map() };
  ctx.sources = new Map([...sources].map(([file, text]) => [resolve(root, file), text]));
  ctx.aliases = options.aliases ?? [];
  ctx.tsProjects = new Map();
  ctx.tsconfigs = new Set();
  ctx.componentsDir = config.components.replace(/\/?$/, "/");
  ctx.helperModule = config.helpers?.module ?? null;
  ctx.trustedHtml = config.trustedHtml ?? null;
  ctx.dateType = config.dateType ?? JS_DATE;
  ctx.unions = new Map(Object.entries(config.unions ?? {}));
  ctx.mappedUnions = new Map();
  ctx.builders = config.builders ?? true;
  ctx.clientDirectives = new Set(config.clientDirectives ?? []);
  ctx.rootDir = root;
  ctx.vnodeTag = null;
  ctx.typeStructs = new Map();
  ctx.typeAliases = new Map();
  ctx.typeFiles = new Map();
  ctx.typeDecls = new Map();
  ctx.typeReached = new Set();
  ctx.typeRead = new Set();
  ctx.constDecls = new Map();
  ctx.tsModules = new Map();
  ctx.typeConsts = new Map();
  ctx.enums = new Map();
  ctx.plugins = PLUGINS;
  ctx.runs = new Map();
  for (const p of PLUGINS) ctx.runs.set(p, p.configure?.(config, root));
  for (const p of PLUGINS) p.prepare?.(root);
  ctx.helpers = Object.fromEntries(
    Object.entries(config.helpers?.functions ?? {}).map(([name, h]) => [
      name,
      { rust: h.rust, params: h.params.map(tyOfName), ret: tyOfName(h.returns), maxLen: h.maxLen ?? 0 },
    ]),
  );
  const dir = join(root, config.components);
  const files = [
    ...listDir(root, config.components, "components")
      .filter((f) => f.endsWith(".vue"))
      .toSorted()
      .map((f) => ({ file: join(dir, f), name: basename(f, ".vue") })),
    ...PLUGINS.flatMap((p) => p.components?.() ?? []).map((c) => ({ file: join(root, c.file), name: c.name })),
  ];
  const modulesOf = new Map<string, string>();
  const run = new Run(files.map((f) => relativePath(root, f.file)));
  const named = files.filter((f) => {
    const rel = relativePath(root, f.file);
    return run.attempt(rel, () => {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.name)) {
        failIn(rel, "FV0007", `the component is called \`${f.name}\` after its file, which is not a Rust name: name the file in PascalCase, letters and digits (\`UserCard.vue\`)`);
      }
      const file = moduleFile(snake(f.name));
      if (file === "mod.rs") failIn(rel, "FV0007", `the component's module would be \`mod.rs\`, which holds the generated modules: rename the file`);
      const taken = modulesOf.get(file);
      if (taken) failIn(rel, "FV0007", `the component's module would be \`${file}\`, as ${taken}'s is: rename one of them`);
      modulesOf.set(file, rel);
      return true;
    });
  });
  const names = new Map(named.map((f) => [relativePath(root, f.file), f.name]));
  for (const f of files) if (!names.has(relativePath(root, f.file))) run.refusedNames.add(f.name);
  let read = named.flatMap((f) => {
    const rel = relativePath(root, f.file);
    const r = run.attempt(rel, () => readComponent(f.file, root, f.name), f.name);
    return r ? [r] : [];
  });
  const children = new Set(read.flatMap((r) => [...r.comp.imports, ...r.comp.childProps.values()].filter((c) => c !== r.comp.name)));
  read = run.each(read, (r) => {
    if (r.optionsApi) refuseOptionsApi(r.comp, r.optionsApi, children.has(r.comp.name));
  });
  read = run.prune(read);
  const components = new Map(read.map((r) => [r.comp.name, r.comp]));
  ctx.components = components;
  read = run.each(read, (r) => {
    for (const f of r.comp.props.fields) requireWhole(r.comp, f.ty);
  });
  const scoped = run.prune(read).flatMap((r) => {
    const scope = run.attempt(r.comp.file, () => scopeFor(r.comp, r.ast, components).scope, r.comp.name);
    return scope ? [{ ...r, scope }] : [];
  });
  const all = run.whole(scoped, (rs) => {
    const analysed = prepareDynamic(rs);
    const each = rs.map((r, i) => ({ ...r, compiled: r.ssr, ssr: analysed[i]!, children: r.scope.children, attrsBindings: r.scope.attrsBindings }));
    for (const p of PLUGINS) p.analyse?.(each);
    attrsFlow(each);
    return each;
  });
  for (const c of components.values()) if (!all.some((r) => r.comp === c)) components.delete(c.name);
  for (const c of components.values()) c.takes = new Set(renderParams().filter((p) => p.reads(c)).map((p) => p.name));
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of components.values()) {
      for (const name of [...c.imports].flatMap((i) => [...(components.get(i)?.takes ?? [])])) {
        if (!c.takes.has(name)) {
          c.takes.add(name);
          changed = true;
        }
      }
    }
  }
  const out = new Map<string, string>();
  const ordered: typeof all = [];
  const placed = new Set<string>();
  const byName = new Map(all.map((r) => [r.comp.name, r]));
  const place = (r: (typeof all)[number]): void => {
    if (placed.has(r.comp.name)) return;
    placed.add(r.comp.name);
    for (const i of r.comp.imports) {
      const dep = byName.get(i);
      if (dep) place(dep);
    }
    ordered.push(r);
  };
  all.forEach(place);
  const built: { file: string; source: () => string }[] = [];
  for (const r of ordered) {
    if (run.prune([r]).length === 0) continue;
    const file = moduleFile(r.comp.module);
    out.set(file, "");
    const source = run.attempt(r.comp.file, () => run.recovering(() => componentSource(r.comp, r.ast, r.compiled, components)), r.comp.name);
    if (source) built.push({ file, source });
  }
  run.done();
  const reached = (): number => ctx.typeReached.size + [...components.values()].reduce((n, c) => n + c.reached.size, 0);
  let modules: [string, string][] = [];
  for (let before = -1; before !== reached(); ) {
    before = reached();
    for (const { file, source } of built) out.set(file, source());
    modules = PLUGINS.flatMap((p) => p.modules?.() ?? []);
  }
  refuseUnusedUnions(CONFIG_FILE);
  out.set("mod.rs", modSource(read.map((r) => r.comp), modules.map(([file]) => file)));
  for (const [file, text] of modules) {
    const taken = modulesOf.get(file);
    if (taken) failIn(taken, "FV0007", `the component's module would be \`${file}\`, which ferrovue writes for the project's ${file.replace(/\.rs$/, "").replaceAll("_", " ")}: rename the file`);
    out.set(file, text);
  }
  return out;
}

type Refusal = GenError | SyntaxError;

/** The refusals of one run of the compiler, collected component by component. */
class Run {
  readonly refused: { e: Refusal; file: string | null }[] = [];
  readonly refusedNames = new Set<string>();
  readonly unchecked: string[] = [];
  private readonly order: Map<string, number>;

  constructor(files: string[]) {
    this.order = new Map(files.map((f, i) => [f, i]));
  }

  attempt<T>(file: string, f: () => T, name?: string): T | undefined {
    try {
      return f();
    } catch (e) {
      if (!isRefusal(e)) throw e;
      for (const one of e instanceof GenErrors ? e.errors : [e]) this.refused.push({ e: one, file });
      if (name !== undefined) this.refusedNames.add(name);
      return undefined;
    }
  }

  each<R extends { comp: Component }>(rs: R[], f: (r: R) => void): R[] {
    return rs.filter((r) => this.attempt(r.comp.file, () => {
      f(r);
      return true;
    }, r.comp.name));
  }

  recovering<T>(f: () => T): T {
    const recovered: GenError[] = [];
    ctx.recovered = recovered;
    let value: T;
    try {
      value = f();
    } catch (e) {
      if (isRefusal(e)) throw new GenErrors([...recovered, e]);
      throw e;
    } finally {
      ctx.recovered = null;
    }
    if (recovered.length) throw new GenErrors(recovered);
    return value;
  }

  /** The components left once those that use a refused one are set aside, unchecked. */
  prune<R extends { comp: Component }>(rs: R[]): R[] {
    const uses = (r: R): string[] => [...r.comp.imports, ...r.comp.childProps.values()].filter((c) => c !== r.comp.name);
    let left = rs.filter((r) => !this.refusedNames.has(r.comp.name));
    for (let dropped = true; dropped; ) {
      dropped = false;
      left = left.filter((r) => {
        if (!uses(r).some((c) => this.refusedNames.has(c))) return true;
        this.refusedNames.add(r.comp.name);
        this.unchecked.push(r.comp.file);
        dropped = true;
        return false;
      });
    }
    return left;
  }

  whole<R extends { comp: Component }, T>(rs: R[], f: (rs: R[]) => T): T {
    for (let left = rs; ; left = this.prune(left)) {
      try {
        return f(left);
      } catch (e) {
        if (!isRefusal(e)) throw e;
        const file = e instanceof GenError ? e.at?.file : undefined;
        const culprit = left.find((r) => r.comp.file === file);
        this.refused.push({ e, file: file ?? null });
        if (!culprit) this.done();
        this.refusedNames.add(culprit!.comp.name);
      }
    }
  }

  /** Raise every refusal so far, if there is one. */
  done(): void {
    if (!this.refused.length) return;
    const rank = (r: { e: Refusal; file: string | null }): number => this.order.get(r.file ?? "") ?? this.order.size;
    const at = (e: Refusal): [number, number] => (e instanceof GenError ? [e.at?.line ?? 0, e.at?.column ?? 0] : [0, 0]);
    const seen = new Set<string>();
    const errors = this.refused
      .toSorted((a, b) => rank(a) - rank(b) || at(a.e)[0] - at(b.e)[0] || at(a.e)[1] - at(b.e)[1])
      .map((r) => r.e)
      .filter((e) => {
        const placed = e instanceof GenError && e.at?.line !== undefined ? `${e.at.file}:${e.at.line}:${e.at.column ?? 0}` : null;
        const key = `${e instanceof GenError ? e.code : ""}\n${placed ?? e.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    throw new GenErrors(errors, this.unchecked.toSorted());
  }
}

/** Whether a file starts with the header ferrovue writes, so `write` removes only what an earlier
 * run wrote and never a module of the app's own put in the output directory by mistake. */
export function isGenerated(file: string): boolean {
  try {
    return readFileSync(file, "utf8").startsWith(GENERATED);
  } catch {
    return false;
  }
}

function moduleFile(module: string): string {
  return `${module.replace(/^r#/, "")}.rs`;
}

/** What \`write\` changed in the output directory. */
export interface Written {
  /** Every file the output directory now holds. */
  files: string[];
  /** The files whose text changed, or that are new. */
  changed: string[];
  /** The files removed, which the components no longer produce. */
  removed: string[];
  /** Every component that has an `island()`, by the name `data-island` carries, with its `.vue`
   * file relative to the root: what `ferrovue/islands` loads. */
  islands: Record<string, string>;
}

/** Write what \`generate\` produces to the configured directory: only the files whose text changed,
 * so a Rust build that watches them rebuilds no more than it must, and removing what no component
 * produces any more. */
export function write(root: string, config: Config = loadConfig(root), options: ResolveOptions = {}): Written {
  const files = generate(root, config, new Map(), options);
  const target = join(root, config.out);
  mkdirSync(target, { recursive: true });
  const changed: string[] = [];
  for (const [name, text] of files) {
    let old: string | null = null;
    try {
      old = readFileSync(join(target, name), "utf8");
    } catch {
    }
    if (old !== text) {
      writeFileSync(join(target, name), text);
      changed.push(name);
    }
  }
  const removed = readdirSync(target).filter((f) => f.endsWith(".rs") && !files.has(f) && isGenerated(join(target, f)));
  for (const f of removed) rmSync(join(target, f));
  const islands = Object.fromEntries([...ctx.components.values()].filter(isIsland).map((c) => [c.name, c.file]));
  return { files: [...files.keys()], changed, removed, islands };
}

export { CONFIG_FILE, loadConfig, TYPES_MODULE, type Config, type HelperSpec, type RoutesSource, type ScopeIdMode, type TwinSpec, type TypeName } from "./context.ts";
export { GenError, GenErrors, type Location as SourceLocation } from "./model.ts";
export type { Alias } from "./resolve.ts";
export { docsUrl, ERRORS, type Code as ErrorCode, type ErrorDoc } from "./errors.ts";

export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

