import { resolve as resolvePath, sep } from "node:path";
import genericNames from "generic-names";
import postcss, { type Root } from "postcss";
import extractImports from "postcss-modules-extract-imports";
import localByDefault from "postcss-modules-local-by-default";
import modulesScope from "postcss-modules-scope";
import modulesValues from "postcss-modules-values";
import type { SFCDescriptor, SFCStyleBlock } from "@vue/compiler-sfc";
import { type Component, type N, type Scope, type Val, fail, rustStr, sourceAt, STR, UNDEF } from "../model.ts";
import { CONFIG_FILE, type CssModulesConfig } from "../context.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";
import { scopeHash } from "./scoped.ts";

declare module "../model.ts" {
  interface PluginTys {
    cssModule: { k: "cssModule"; name: string; tokens: Record<string, string> };
  }
}

/** A class's name in a CSS module, from its name as written and the module's id. */
export type NameGenerator = (local: string, file: string) => string;

interface CssModulesRun {
  names: NameGenerator | null;
  modules: Map<Component, Map<string, Record<string, string>>>;
}

interface CssModulesScope {
  useCssModule: string | null;
}

const IGNORED_ATTRS = new Set(["id", "index", "src", "type", "lang", "module", "scoped", "generic"]);

/** The id Vite gives a `<style module>` block, as `@vitejs/plugin-vue` requests it, which postcss-modules
 * names its classes from. */
export function styleRequest(file: string, index: number, style: SFCStyleBlock, id: string): string {
  let query = "";
  for (const [name, value] of Object.entries(style.attrs)) {
    if (!IGNORED_ATTRS.has(name)) query += `&${encodeURIComponent(name)}${value ? `=${encodeURIComponent(value)}` : ""}`;
  }
  return `${resolvePath(file).split(sep).join("/")}?vue&type=style&index=${index}${style.scoped ? `&scoped=${id}` : ""}${query}&lang.module.css`;
}

/** The classes, keyframes and values a CSS module exports, by name, as postcss-modules names them
 * with `names`. */
export function moduleTokens(css: string, from: string, names: NameGenerator): Record<string, string> {
  const root: Root = postcss([modulesValues, localByDefault({ mode: "local" }), extractImports, modulesScope({ generateScopedName: (local, file) => names(local, file), exportGlobals: false })]).process(css, { from }).root;
  const tokens: Record<string, string> = {};
  root.each((node) => {
    if (node.type !== "rule") return;
    if (node.selector.startsWith(":import(")) throw new Error("it imports from another file");
    if (node.selector !== ":export") return;
    node.each((decl) => {
      if (decl.type === "decl") tokens[decl.prop] = decl.value;
    });
  });
  return tokens;
}

function blockAt(source: string, block: SFCStyleBlock): N {
  return sourceAt(source, source.lastIndexOf("<style", block.loc.start.offset));
}

/** The classes each `<style module>` of a component exports, by the name a template reads them by
 * (`$style`, or the module's own name), as Vite names them with `names` when plugin-vue gives the
 * component the id `id`. Vite reads the block as written, before plugin-vue compiles it. A later
 * module of the same name replaces an earlier one, as in plugin-vue. `refuse` is given each block
 * whose classes cannot be named so, with why. */
export function componentModules(descriptor: SFCDescriptor, file: string, id: string, names: NameGenerator, refuse: (style: SFCStyleBlock, why: string) => never): Map<string, Record<string, string>> {
  const found = new Map<string, Record<string, string>>();
  for (const [index, style] of descriptor.styles.entries()) {
    if (!style.module) continue;
    if (style.src) refuse(style, "`<style module src>`: ferrovue names the classes of a module written in the component");
    if (style.lang !== undefined && style.lang !== "css") refuse(style, `\`<style module lang="${style.lang}">\`: ferrovue names the classes of a plain CSS module, which no preprocessor changes`);
    let tokens: Record<string, string>;
    try {
      tokens = moduleTokens(style.content, styleRequest(file, index, style, id), names);
    } catch (e) {
      refuse(style, `\`<style module>\` whose classes ferrovue cannot name: ${e instanceof Error ? e.message.split("\n")[0]! : String(e)}`);
    }
    found.set(typeof style.module === "string" ? style.module : "$style", tokens);
  }
  return found;
}

/** How Vite names a CSS module's classes with `css.modules` set as `config` is, from `context`, the
 * directory Vite runs in. */
export function scopedNames(config: CssModulesConfig, context: string): NameGenerator {
  return genericNames(config.generateScopedName, { context, hashPrefix: config.hashPrefix ?? "" });
}

function readModules(comp: Component, descriptor: SFCDescriptor, file: string, source: string): void {
  const run = runOf(cssModules);
  const module = descriptor.styles.find((st) => st.module);
  if (!module) return;
  if (run.names === null) {
    fail(comp, "FV1005", `\`<style module>\` takes its class names from Vite's \`css.modules\`: set \`cssModules\` in ${CONFIG_FILE} as Vite's \`css.modules.generateScopedName\` is set, or use a global or scoped \`<style>\``, blockAt(source, module));
  }
  run.modules.set(comp, componentModules(descriptor, file, scopeHash(file, source), run.names, (style, why) => fail(comp, "FV1014", why, blockAt(source, style))));
}

function moduleOf(comp: Component, name: string): Val | null {
  const tokens = runOf(cssModules).modules.get(comp)?.get(name);
  return tokens ? { code: "()", ty: { k: "cssModule", name, tokens } } : null;
}

export const cssModules: Plugin<CssModulesRun, CssModulesScope> = {
  name: "css-modules",
  configure: (config, root) => {
    const m = config.cssModules;
    const context = resolvePath(root, m?.context ?? config.viteRoot ?? ".");
    return { names: m ? scopedNames(m, context) : null, modules: new Map() };
  },
  sfc: readModules,
  scope: () => ({ useCssModule: null }),
  scriptImport(s, st, from) {
    if (from !== "vue") return false;
    for (const sp of st.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "useCssModule") scopeOf(cssModules, s).useCssModule = sp.local.name;
    }
    return false;
  },
  scriptBinding(s: Scope, d: N) {
    const callee = scopeOf(cssModules, s).useCssModule;
    const init = d.init;
    if (callee === null || init?.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== callee) return false;
    const arg = init.arguments[0];
    if (init.arguments.length > 1 || (arg && arg.type !== "StringLiteral")) fail(s.comp, "FV1015", "`useCssModule` takes the name of a `<style module>` as a string literal, or nothing for `$style`", init);
    const name: string = arg?.value ?? "$style";
    const v = moduleOf(s.comp, name);
    if (!v) fail(s.comp, "FV1015", `\`useCssModule(${arg ? JSON.stringify(name) : ""})\` names no \`<style module${name === "$style" ? "" : `="${name}"`}>\` of this component, where Vue gives an empty object`, init);
    if (d.id.type !== "Identifier") fail(s.comp, "FV1015", "`useCssModule()` is bound to a name, as `const classes = useCssModule()`", d);
    s.setup.set(d.id.name, v);
    return true;
  },
  global: (s, name) => moduleOf(s.comp, name),
  member(_s, base, prop) {
    if (base.ty.k !== "cssModule") return null;
    const value = Object.hasOwn(base.ty.tokens, prop) ? base.ty.tokens[prop] : undefined;
    return value === undefined ? { code: "None", ty: UNDEF } : { code: rustStr(value), ty: STR };
  },
  values: {
    describe: (ty) => (ty.k === "cssModule" ? `the CSS module \`${ty.name}\`` : undefined),
    unbindable: (ty) => (ty.k === "cssModule" ? { what: `the CSS module \`${ty.name}\``, fix: `bind one of its classes, as \`${ty.name}.name\`` } : undefined),
  },
};
