/* Pinia option stores: their state, its types, and their getters. */

import { parse as parseJs } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { type Component, type Field, type N, type Struct, type Ty, blankComponent, BOOL, fail, FLOAT, INT, opt, sameTy, snake, STR, tagAst, UNDEF } from "../model.ts";
import { ctx } from "../context.ts";
import { markStore, structOf, tyOfTs, typesImports } from "../typescript.ts";
import { patternNames, setupStatement } from "../script.ts";
import { type Plugin, runOf } from "../plugin.ts";
import { header, structSource } from "../rust.ts";

/** A getter: the parameter naming the state (an option store's), and the expression it returns.
 * \`setup\` marks a setup store's \`computed\`, which reads the state's refs and the other getters by
 * name, through \`.value\`. */
export interface StoreGetter {
  param: string | null;
  body: N;
  file: string;
  setup?: true;
}

/** A Pinia option store: `export const usePrefs = defineStore("prefs", { state: (): PrefsState => ... })`. */
export interface Store {
  /** `usePrefs` */
  hook: string;
  /** `prefs`: its key in `pinia.state.value`. */
  id: string;
  /** `prefs`: its field in the generated `Stores`. */
  field: string;
  /** `PrefsState`: the interface its state is. */
  state: string;
  /** The file, without its extension, as an import names it once resolved. */
  module: string;
  /** Its getters: name → the parameter that names the state, and the expression returned. */
  getters: Map<string, StoreGetter>;
}

/** The configured stores, read once per run. */
interface StoresRun {
  /** The stores' directory, as the configuration names it, when there is one. */
  dir: string | null;
  /** The stores, by hook name, and every interface their files declare. */
  stores: Map<string, Store>;
  structs: Map<string, Struct>;
  /** The store file each of those interfaces is declared in. */
  files: Map<string, string>;
}

/** The store module an import names, resolved and without its extension, when it is one. */
export function storeImport(comp: Component, from: string): string | null {
  const { stores } = runOf(piniaStores);
  if (!from.startsWith(".") || stores.size === 0) return null;
  const target = resolve(ctx.rootDir, dirname(comp.file), from).replace(/\.ts$/, "");
  return [...stores.values()].some((s) => s.module === target) ? target : null;
}

/** Every store in the configured directory, and the interfaces their files declare. */
function readStores(root: string, dir: string): void {
  const run = runOf(piniaStores);
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).toSorted();
  for (const f of files) {
    const path = join(root, dir, f);
    const comp = storeHome(relative(root, path));
    comp.source = readFileSync(path, "utf8");
    const ast: N[] = parseJs(comp.source, { sourceType: "module", plugins: ["typescript"] }).program.body;
    tagAst(ast, "source");
    typesImports(comp, ast);
    const decls = ast.map((st) => (st.type === "ExportNamedDeclaration" ? st.declaration : st)).filter(Boolean);
    const interfaces = decls.filter((d) => d.type === "TSInterfaceDeclaration");
    for (const d of interfaces) {
      if (run.structs.has(d.id.name)) fail(comp, `\`${d.id.name}\` is declared by another store too`, d);
      run.structs.set(d.id.name, { name: d.id.name, fields: [] });
      run.files.set(d.id.name, comp.file);
    }
    for (const d of interfaces) {
      const st = structOf(comp, d.id.name, d.body.body, run.structs);
      for (const field of st.fields) field.ty = markStore(field.ty);
      run.structs.set(d.id.name, st);
    }
    for (const d of decls) {
      if (d.type !== "VariableDeclaration") continue;
      for (const v of d.declarations) {
        const init = v.init;
        if (init?.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== "defineStore") continue;
        const [id, options] = init.arguments;
        if (id?.type !== "StringLiteral") fail(comp, "a store's id is a string literal", init);
        if (options?.type === "ArrowFunctionExpression" || options?.type === "FunctionExpression") {
          setupStore(comp, v.id.name, id.value, options, path);
          continue;
        }
        if (options?.type !== "ObjectExpression") fail(comp, "a store is `defineStore(id, { state, getters, actions })` or `defineStore(id, () => { … })`", init);
        const state = options.properties.find((p: N) => (p.key?.name ?? p.key?.value) === "state");
        const fn = state?.value ?? (state?.type === "ObjectMethod" ? state : null);
        const ret = fn?.returnType?.typeAnnotation;
        if (ret?.type !== "TSTypeReference" || !run.structs.has(ret.typeName.name)) {
          fail(comp, "a store's `state` declares its return type, an interface in the same file: `state: (): State => ({ … })`", state ?? init);
        }
        const getters = new Map<string, StoreGetter>();
        const getterObj = options.properties.find((p: N) => (p.key?.name ?? p.key?.value) === "getters");
        if (getterObj && getterObj.value?.type !== "ObjectExpression") fail(comp, "a store's `getters` is an object literal", getterObj);
        for (const g of getterObj?.value.properties ?? []) {
          const getterFn = g.type === "ObjectMethod" ? g : g.value;
          const name: string = g.key?.name ?? g.key?.value;
          if (!getterFn || !["ArrowFunctionExpression", "FunctionExpression", "ObjectMethod"].includes(getterFn.type)) {
            fail(comp, `getter \`${name}\` is a function of the state`, g);
          }
          let body: N = getterFn.body;
          if (body.type === "BlockStatement") {
            const only = body.body.length === 1 ? body.body[0] : null;
            body = only?.type === "ReturnStatement" ? only.argument : null;
          }
          const param = getterFn.params[0];
          // A getter the server cannot translate fails where a component reads it, not here.
          getters.set(name, { param: param?.type === "Identifier" ? param.name : null, body, file: comp.file });
        }
        run.stores.set(v.id.name, {
          hook: v.id.name,
          id: id.value,
          field: snake(id.value),
          state: ret.typeName.name,
          module: path.replace(/\.ts$/, ""),
          getters,
        });
      }
    }
  }
}

/** A setup store: \`defineStore(id, () => { …; return { … } })\`. The refs it returns are its state —
 * typed by \`ref<T>(…)\`, or by the literal they start from — the computeds it returns its getters,
 * and its functions actions, which only the client runs. */
function setupStore(comp: Component, hook: string, id: string, fn: N, path: string): void {
  const run = runOf(piniaStores);
  if (fn.body.type !== "BlockStatement") fail(comp, "a setup store's function returns its state from a block: `() => { …; return { … } }`", fn);
  const refs = new Map<string, Ty>();
  const computeds = new Map<string, N>();
  const others = new Set<string>();
  let returned: N | null = null;
  for (const st of fn.body.body) {
    if (st.type === "ReturnStatement") {
      returned = st.argument;
      continue;
    }
    if (st.type === "FunctionDeclaration") {
      if (st.id) others.add(st.id.name);
      continue;
    }
    if (st.type === "ExpressionStatement") {
      setupStatement(comp, st);
      continue;
    }
    if (st.type !== "VariableDeclaration") fail(comp, `\`${st.type}\` in a setup store is not supported`, st);
    for (const d of st.declarations) {
      if (d.id.type !== "Identifier") {
        for (const name of patternNames(d.id)) others.add(name);
        continue;
      }
      const init = d.init;
      const callee = init?.type === "CallExpression" && init.callee.type === "Identifier" ? init.callee.name : null;
      if (callee === "ref" || callee === "shallowRef") {
        refs.set(d.id.name, refType(comp, init));
      } else if (callee === "computed") {
        const getter = init.arguments[0];
        let body: N = getter?.body;
        if (body?.type === "BlockStatement") {
          const only = body.body.length === 1 ? body.body[0] : null;
          body = only?.type === "ReturnStatement" ? only.argument : null;
        }
        computeds.set(d.id.name, body);
      } else others.add(d.id.name);
    }
  }
  if (returned?.type !== "ObjectExpression") fail(comp, "a setup store returns an object of its state, getters and actions", returned ?? fn);
  const state: Field[] = [];
  const getters = new Map<string, StoreGetter>();
  for (const p of returned.properties) {
    if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") fail(comp, "a setup store returns plain names: `{ count, doubled, increment }`", p);
    const key: string = p.key.name ?? p.key.value;
    const local: string = p.value.name;
    if (refs.has(local)) state.push({ js: key, rust: snake(key), ty: markStore(refs.get(local)!) });
    else if (computeds.has(local)) getters.set(key, { param: null, body: computeds.get(local), file: comp.file, setup: true });
    else if (!others.has(local)) fail(comp, `\`${local}\` is not declared in the store's function`, p);
  }
  const name = id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") + "State";
  if (run.structs.has(name)) fail(comp, `\`${name}\` names this setup store's state; rename the interface`, fn);
  run.structs.set(name, { name, fields: state });
  run.files.set(name, comp.file);
  run.stores.set(hook, { hook, id, field: snake(id), state: name, module: path.replace(/\.ts$/, ""), getters });
}

/** A setup store ref's type: \`ref<T>(…)\`, or what its initial literal is; optional when it has none. */
function refType(comp: Component, init: N): Ty {
  const run = runOf(piniaStores);
  const typed = init.typeParameters?.params?.[0];
  const value = init.arguments[0];
  if (typed) {
    const ty = tyOfTs(comp, typed, run.structs);
    return value ? ty : opt(ty);
  }
  const literal = (n: N): Ty | null => {
    if (n?.type === "StringLiteral" || (n?.type === "TemplateLiteral" && n.expressions.length === 0)) return STR;
    if (n?.type === "NumericLiteral") return Number.isInteger(n.value) ? INT : FLOAT;
    if (n?.type === "UnaryExpression" && n.operator === "-") return literal(n.argument);
    if (n?.type === "BooleanLiteral") return BOOL;
    if (n?.type === "ArrayExpression" && n.elements.length) {
      const of = literal(n.elements[0]);
      return of && n.elements.every((el: N) => sameTy(literal(el) ?? UNDEF, of)) ? { k: "list", of } : null;
    }
    return null;
  };
  return literal(value) ?? fail(comp, "a setup store's ref declares its type: `ref<string[]>([])`", init);
}

/** A store file, as the thing its types are declared in: what errors name, and where they resolve. */
export function storeHome(file: string): Component {
  return blankComponent(basename(file), "stores", file, runOf(piniaStores).structs);
}

function storesSource(dir: string): string {
  const { stores, structs: states, files } = runOf(piniaStores);
  const home = storeHome(dir);
  // Test-only `Default` lets a fixture name only the stores it reads; the rest are never looked at.
  const testDerive = (src: string) =>
    src.replace("#[cfg_attr(test, derive(serde::Deserialize))]", "#[cfg_attr(test, derive(Default, serde::Deserialize))]\n#[cfg_attr(test, serde(default))]");
  const structs = [...states.values()]
    .map((st) => testDerive(structSource(st, home, `/// \`${st.name}\` in \`${files.get(st.name)}\`.\n`)))
    .join("\n");
  const all: Struct = {
    name: "Stores",
    fields: [...stores.values()].map((st) => ({ js: st.id, rust: st.field, ty: { k: "struct", name: st.state, store: true } })),
  };
  const top = testDerive(structSource(all, home, "/// Every store's state, keyed by id as `pinia.state.value` is: what the page sends the client.\n"));
  return `${header(dir, "the store files")}
//! The Pinia stores' state, which components read while they render on the server.

${/Cow</.test(structs) ? "use std::borrow::Cow;\n\n" : ""}${structs}
${top}`;
}

/** Pinia: the stores' state, read through \`useX()\`, \`storeToRefs\` and getters. */
export const piniaStores: Plugin<StoresRun> = {
  name: "stores",
  configure: (config) => ({ dir: config.stores ?? null, stores: new Map(), structs: new Map(), files: new Map() }),
  // Store files are TypeScript, which the core's own type reader reads: once the core is configured.
  prepare(root) {
    const { dir } = runOf(piniaStores);
    if (dir) readStores(root, dir);
  },
  params: [
    {
      name: "fv_stores",
      ty: "&super::stores::Stores<'_>",
      pageTy: "&'p super::stores::Stores<'p>",
      reads: (c) => c.readsStores,
      test: { lines: ["let state: stores::Stores = serde_json::from_value(fixture.stores.clone()).map_err(|e| e.to_string())?;"], arg: "&state", fixture: true },
      fixtureField: '    #[serde(rename = "$stores", default = "Fixture::no_stores")]\n    stores: serde_json::Value,',
      fixtureDefault: "    fn no_stores() -> serde_json::Value {\n        serde_json::Value::Object(Default::default())\n    }",
    },
  ],
  modules() {
    const { dir, stores } = runOf(piniaStores);
    return stores.size ? [["stores.rs", storesSource(dir!.replace(/\/?$/, "/"))]] : [];
  },
};
