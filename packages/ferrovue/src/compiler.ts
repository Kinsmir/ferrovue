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
import { join } from "node:path";
import { type Config, ctx, loadConfig, tyOfName } from "./context.ts";
import { readComponent } from "./component.ts";
import { readRoutes } from "./router.ts";
import { readStores } from "./stores.ts";
import { i18nSource, readLocales } from "./i18n.ts";
import { scopeFor } from "./script.ts";
import { componentSource, modSource, routesSource, storesSource, typesSource } from "./rust.ts";

/** Every generated file, keyed by its name in the output directory. */
export function generate(root: string, config: Config = loadConfig(root)): Map<string, string> {
  ctx.componentsDir = config.components.replace(/\/?$/, "/");
  ctx.helperModule = config.helpers?.module ?? null;
  ctx.trustedHtml = config.trustedHtml ?? null;
  const router = config.router ?? (config.routes ? { routes: config.routes } : null);
  ctx.routes = router ? readRoutes(root, router.routes) : null;
  ctx.routerBase = router?.base ?? "";
  ctx.clientDirectives = new Set(config.clientDirectives ?? []);
  ctx.i18n = config.i18n ? readLocales(root, config.i18n) : null;
  ctx.linkActive = router?.linkActiveClass ?? "router-link-active";
  ctx.linkExactActive = router?.linkExactActiveClass ?? "router-link-exact-active";
  ctx.rootDir = root;
  ctx.typeStructs = new Map();
  ctx.typeAliases = new Map();
  ctx.typeFiles = new Map();
  ctx.typeRead = new Set();
  if (config.stores) readStores(root, config.stores);
  else {
    ctx.stores = new Map();
    ctx.storeStructs = new Map();
  }
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
  // Whether a component reads a store or the route is known once its setup is read; both reach
  // every component on the way down to one that does, and the route every one on the way down to
  // a `<RouterLink>`.
  for (const r of read) scopeFor(r.comp, r.ast, components);
  for (const c of components.values()) c.usesRoute = c.routerLink || c.readsRoute;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of components.values()) {
      if (!c.usesRoute && [...c.imports].some((i) => components.get(i)?.usesRoute)) {
        c.usesRoute = changed = true;
      }
    }
  }
  for (const c of components.values()) c.usesI18n = c.readsI18n;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of components.values()) {
      if (!c.usesI18n && [...c.imports].some((i) => components.get(i)?.usesI18n)) {
        c.usesI18n = changed = true;
      }
    }
  }
  for (const c of components.values()) c.usesTeleports = c.readsTeleports;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of components.values()) {
      if (!c.usesTeleports && [...c.imports].some((i) => components.get(i)?.usesTeleports)) {
        c.usesTeleports = changed = true;
      }
    }
  }
  for (const c of components.values()) c.usesStores = c.readsStores;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of components.values()) {
      if (!c.usesStores && [...c.imports].some((i) => components.get(i)?.usesStores)) {
        c.usesStores = changed = true;
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
  out.set("mod.rs", modSource(read.map((r) => r.comp)));
  if (ctx.routes) out.set("route_table.rs", routesSource(ctx.routes, router!.routes));
  if (ctx.stores.size) out.set("stores.rs", storesSource(config.stores!.replace(/\/?$/, "/")));
  if (ctx.typeStructs.size) out.set("types.rs", typesSource());
  if (ctx.i18n) out.set("i18n.rs", i18nSource(ctx.i18n));
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
  return { files: [...files.keys()], changed, removed };
}

export { CONFIG_FILE, loadConfig, TYPES_MODULE, type Config, type HelperSpec, type TypeName } from "./context.ts";
export { GenError } from "./model.ts";
