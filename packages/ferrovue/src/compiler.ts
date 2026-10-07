import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { relativePath } from "./paths.ts";
import { type Config, ctx, loadConfig, tyOfName } from "./context.ts";
import { failIn, snake } from "./model.ts";
import { readComponent, refuseOptionsApi } from "./component.ts";
import { listDir } from "./files.ts";
import { scopeFor } from "./script.ts";
import { attrsFlow } from "./fallthrough.ts";
import { prepareDynamic } from "./dynamic.ts";
import { componentSource, GENERATED, isIsland, modSource } from "./rust.ts";
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
  ctx.vnodeTag = null;
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
  const files = [
    ...listDir(root, config.components, "components")
      .filter((f) => f.endsWith(".vue"))
      .toSorted()
      .map((f) => ({ file: join(dir, f), name: basename(f, ".vue") })),
    ...PLUGINS.flatMap((p) => p.components?.() ?? []).map((c) => ({ file: join(root, c.file), name: c.name })),
  ];
  const modulesOf = new Map<string, string>();
  for (const f of files) {
    const rel = relativePath(root, f.file);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.name)) {
      failIn(rel, "FV0007", `the component is called \`${f.name}\` after its file, which is not a Rust name: name the file in PascalCase, letters and digits (\`UserCard.vue\`)`);
    }
    const file = moduleFile(snake(f.name));
    if (file === "mod.rs") failIn(rel, "FV0007", `the component's module would be \`mod.rs\`, which holds the generated modules: rename the file`);
    const taken = modulesOf.get(file);
    if (taken) failIn(rel, "FV0007", `the component's module would be \`${file}\`, as ${taken}'s is: rename one of them`);
    modulesOf.set(file, rel);
  }
  const read = files.map((f) => readComponent(f.file, root, f.name));
  const children = new Set(read.flatMap((r) => [...r.comp.imports, ...r.comp.childProps.values()].filter((c) => c !== r.comp.name)));
  for (const r of read) if (r.optionsApi) refuseOptionsApi(r.comp, r.optionsApi, children.has(r.comp.name));
  const byName = new Map(read.map((r) => [r.comp.name, r]));
  const components = new Map(read.map((r) => [r.comp.name, r.comp]));
  ctx.components = components;
  const scopes = read.map((r) => scopeFor(r.comp, r.ast, components).scope);
  const analysed = prepareDynamic(read.map((r, i) => ({ ...r, scope: scopes[i]! })));
  const all = read.map((r, i) => ({ comp: r.comp, ssr: analysed[i]!, children: scopes[i]!.children, attrsBindings: scopes[i]!.attrsBindings }));
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
      const dep = byName.get(i);
      if (dep) place(dep);
    }
    ordered.push(r);
  };
  read.forEach(place);
  for (const r of ordered) {
    ctx.narrowCount = 0;
    out.set(moduleFile(r.comp.module), componentSource(r.comp, r.ast, r.ssr, components));
  }
  const modules = PLUGINS.flatMap((p) => p.modules?.() ?? []);
  out.set("mod.rs", modSource(read.map((r) => r.comp), modules.map(([file]) => file)));
  for (const [file, text] of modules) {
    const taken = modulesOf.get(file);
    if (taken) failIn(taken, "FV0007", `the component's module would be \`${file}\`, which ferrovue writes for the project's ${file.replace(/\.rs$/, "").replaceAll("_", " ")}: rename the file`);
    out.set(file, text);
  }
  return out;
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
  const removed = readdirSync(target).filter((f) => f.endsWith(".rs") && !files.has(f) && isGenerated(join(target, f)));
  for (const f of removed) rmSync(join(target, f));
  const islands = Object.fromEntries([...ctx.components.values()].filter(isIsland).map((c) => [c.name, c.file]));
  return { files: [...files.keys()], changed, removed, islands };
}

export { CONFIG_FILE, loadConfig, TYPES_MODULE, type Config, type HelperSpec, type RoutesSource, type TwinSpec, type TypeName } from "./context.ts";
export { GenError } from "./model.ts";

export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

