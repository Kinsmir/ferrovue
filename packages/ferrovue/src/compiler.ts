/* ferrovue's compiler: `.vue` → Rust render functions.
 *
 * The input is not the template. It is what `@vue/compiler-sfc` compiles the template to for
 * server rendering — straight-line `_push` calls, `if`, `_ssrRenderList`, and a handful of
 * `@vue/server-renderer` helpers — so element structure, attribute order, whitespace and the
 * fragment markers are decided by Vue, and this file only has to translate a small, closed
 * vocabulary of JavaScript into Rust that writes the same bytes. The generated code calls the
 * `ferrovue` crate for everything Vue's runtime does.
 *
 * Anything outside that vocabulary is an error naming the component and the construct, never a
 * best guess: a guess that is wrong by one byte is a hydration mismatch in a browser, found by a
 * reader.
 *
 * A project describes itself in `ferrovue.config.json` at its root — see `Config` — and runs the
 * `ferrovue` command there. `generate()` is also what a drift test calls, so the committed files can
 * be held to exactly what this produces.
 *
 * This module is the public API; the translation lives in the modules beside it. */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Config, ctx, loadConfig, tyOfName } from "./context.ts";
import { readComponent } from "./component.ts";
import { scopeFor } from "./script.ts";
import { attrsFlow, scopeFlow } from "./scoped.ts";
import { componentSource, isIsland, modSource } from "./rust.ts";
import { renderParams } from "./plugin.ts";
import { PLUGINS } from "./plugins/index.ts";

/** Every generated file, keyed by its name in the output directory. */
export function generate(root: string, config: Config = loadConfig(root)): Map<string, string> {
  ctx.componentsDir = config.components.replace(/\/?$/, "/");
  ctx.helperModule = config.helpers?.module ?? null;
  ctx.trustedHtml = config.trustedHtml ?? null;
  ctx.clientDirectives = new Set(config.clientDirectives ?? []);
  ctx.rootDir = root;
  ctx.scopeId = config.scopeId ?? "filepath-source";
  ctx.viteRoot = resolve(root, config.viteRoot ?? ".");
  ctx.typeStructs = new Map();
  ctx.typeAliases = new Map();
  ctx.typeFiles = new Map();
  ctx.typeRead = new Set();
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
  const read = files.map((f) => readComponent(f, root));
  const components = new Map(read.map((r) => [r.comp.name, r.comp]));
  ctx.components = components;
  // What a component reads — a store, the route — is known once its setup is read.
  const scopes = read.map((r) => scopeFor(r.comp, r.ast, components).scope);
  // Which roots may be handed scope ids, and which slot content given a slot scope id.
  scopeFlow(read.map((r, i) => ({ comp: r.comp, ssr: r.ssr, children: scopes[i]!.children })));
  // Which components may be passed attributes beyond their props.
  attrsFlow(read.map((r, i) => ({ comp: r.comp, ssr: r.ssr, children: scopes[i]!.children, attrsBindings: scopes[i]!.attrsBindings })));
  // A render parameter reaches every component on the way down to one that reads it.
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
  // A child before its parents, which read the props its scoped slots pass.
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
    // Numbered per component, so a file's text depends on its own source alone.
    ctx.narrowCount = 0;
    out.set(`${r.comp.module}.rs`, componentSource(r.comp, r.ast, r.ssr, components));
  }
  // Beside the components, the modules the plugins write.
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
      // A new file.
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

