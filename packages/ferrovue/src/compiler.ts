import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Config, ctx, loadConfig, tyOfName } from "./context.ts";
import { importsOf, readComponent } from "./component.ts";
import { scopeFor } from "./script.ts";
import { attrsFlow } from "./fallthrough.ts";
import { componentSource, isIsland, modSource } from "./rust.ts";
import { renderParams } from "./plugin.ts";
import { PLUGINS } from "./plugins/index.ts";

/** Every generated file, keyed by its name in the output directory. */
export function generate(root: string, config: Config = loadConfig(root)): Map<string, string> {
  ctx.componentsDir = config.components.replace(/\/?$/, "/");
  ctx.helperModule = config.helpers?.module ?? null;
  ctx.trustedHtml = config.trustedHtml ?? null;
  ctx.builders = config.builders ?? true;
  ctx.clientDirectives = new Set(config.clientDirectives ?? []);
  ctx.rootDir = root;
  ctx.typeStructs = new Map();
  ctx.typeAliases = new Map();
  ctx.typeFiles = new Map();
  ctx.typeRead = new Set();
  ctx.constDecls = new Map();
  ctx.typeConsts = new Map();
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
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".vue"))
    .toSorted()
    .map((f) => join(dir, f));
  const children = new Set(files.flatMap((f) => importsOf(readFileSync(f, "utf8")).filter((c) => c !== basename(f, ".vue"))));
  const read = files.map((f) => readComponent(f, root, children.has(basename(f, ".vue"))));
  const components = new Map(read.map((r) => [r.comp.name, r.comp]));
  ctx.components = components;
  const scopes = read.map((r) => scopeFor(r.comp, r.ast, components).scope);
  const all = read.map((r, i) => ({ comp: r.comp, ssr: r.ssr, children: scopes[i]!.children, attrsBindings: scopes[i]!.attrsBindings }));
  for (const p of PLUGINS) p.analyse?.(all);
  attrsFlow(all);
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
  const ordered: typeof read = [];
  const placed = new Set<string>();
  const place = (r: (typeof read)[number]): void => {
    if (placed.has(r.comp.name)) return;
    placed.add(r.comp.name);
    for (const i of r.comp.imports) {
      const dep = read.find((x) => x.comp.name === i);
      if (dep) place(dep);
    }
    ordered.push(r);
  };
  read.forEach(place);
  for (const r of ordered) {
    ctx.narrowCount = 0;
    out.set(`${r.comp.module}.rs`, componentSource(r.comp, r.ast, r.ssr, components));
  }
  const modules = PLUGINS.flatMap((p) => p.modules?.() ?? []);
  out.set("mod.rs", modSource(read.map((r) => r.comp), modules.map(([file]) => file)));
  for (const [file, text] of modules) out.set(file, text);
  return out;
}

/** Write what `generate` produces to the configured directory, replacing what is there. */
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
export function write(root: string, config: Config = loadConfig(root)): Written {
  const files = generate(root, config);
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
  const removed = readdirSync(target).filter((f) => f.endsWith(".rs") && !files.has(f));
  for (const f of removed) rmSync(join(target, f));
  const islands = Object.fromEntries([...ctx.components.values()].filter(isIsland).map((c) => [c.name, c.file]));
  return { files: [...files.keys()], changed, removed, islands };
}

export { CONFIG_FILE, loadConfig, TYPES_MODULE, type Config, type HelperSpec, type TypeName } from "./context.ts";
export { GenError } from "./model.ts";

export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

