import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { type Component, type Field, type N, type Scope, type Struct, type Ty, type Val, absence, blankComponent, BOOL, fail, failIn, FLOAT, GenError, INT, opt, sameTy, snake, STR, tagAst, UNDEF } from "../model.ts";
import { ctx } from "../context.ts";
import { listDir, parseTs } from "../files.ts";
import { ONE_NOTHING, structOf, tyOfTs, typesImports } from "../typescript.ts";
import { patternNames, setupStatement } from "../script.ts";
import { expr, fieldVal } from "../expr.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";
import { header, structLifetime, structSource } from "../rust.ts";

declare module "../model.ts" {
  interface StructTy {
    store?: true;
  }
}

export interface StoreGetter {
  param: string | null;
  body: N;
  file: string;
  setup?: true;
}

export interface Store {
  hook: string;
  id: string;
  field: string;
  state: string;
  module: string;
  getters: Map<string, StoreGetter>;
}

interface StoresRun {
  dir: string | null;
  stores: Map<string, Store>;
  structs: Map<string, Struct>;
  files: Map<string, string>;
  readers: Set<Component>;
  inProgress: Set<string>;
}

interface StoresScope {
  hooks: Map<string, Store>;
  storeToRefs: string | null;
  values: Map<string, Store>;
}

function storeImport(comp: Component, from: string): string | null {
  const { stores } = runOf(piniaStores);
  if (!from.startsWith(".") || stores.size === 0) return null;
  const target = resolve(ctx.rootDir, dirname(comp.file), from).replace(/\.ts$/, "");
  return [...stores.values()].some((s) => s.module === target) ? target : null;
}

function readStores(root: string, dir: string): void {
  const run = runOf(piniaStores);
  const files = listDir(root, dir, "stores").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).toSorted();
  for (const f of files) {
    const path = join(root, dir, f);
    const comp = storeHome(relative(root, path));
    comp.source = readFileSync(path, "utf8");
    const ast = parseTs(comp);
    tagAst(ast, "source");
    typesImports(comp, ast);
    const decls = ast.map((st) => (st.type === "ExportNamedDeclaration" ? st.declaration : st)).filter(Boolean);
    const interfaces = decls.filter((d) => d.type === "TSInterfaceDeclaration");
    for (const d of interfaces) {
      if (run.structs.has(d.id.name)) fail(comp, "FV1301", `\`${d.id.name}\` is declared by another store too`, d);
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
        if (id?.type !== "StringLiteral") fail(comp, "FV1302", "a store's id is a string literal", init);
        if (options?.type === "ArrowFunctionExpression" || options?.type === "FunctionExpression") {
          setupStore(comp, v.id.name, id.value, options, path);
          continue;
        }
        if (options?.type !== "ObjectExpression") fail(comp, "FV1303", "a store is `defineStore(id, { state, getters, actions })` or `defineStore(id, () => { … })`", init);
        const state = options.properties.find((p: N) => (p.key?.name ?? p.key?.value) === "state");
        const fn = state?.value ?? (state?.type === "ObjectMethod" ? state : null);
        const ret = fn?.returnType?.typeAnnotation;
        if (ret?.type !== "TSTypeReference" || !run.structs.has(ret.typeName.name)) {
          fail(comp, "FV1304", "a store's `state` declares its return type, an interface in the same file: `state: (): State => ({ … })`", state ?? init);
        }
        const getters = new Map<string, StoreGetter>();
        const getterObj = options.properties.find((p: N) => (p.key?.name ?? p.key?.value) === "getters");
        if (getterObj && getterObj.value?.type !== "ObjectExpression") fail(comp, "FV1305", "a store's `getters` is an object literal", getterObj);
        for (const g of getterObj?.value.properties ?? []) {
          const getterFn = g.type === "ObjectMethod" ? g : g.value;
          const name: string = g.key?.name ?? g.key?.value;
          if (!getterFn || !["ArrowFunctionExpression", "FunctionExpression", "ObjectMethod"].includes(getterFn.type)) {
            fail(comp, "FV1306", `getter \`${name}\` is a function of the state`, g);
          }
          let body: N = getterFn.body;
          if (body.type === "BlockStatement") {
            const only = body.body.length === 1 ? body.body[0] : null;
            body = only?.type === "ReturnStatement" ? only.argument : null;
          }
          const param = getterFn.params[0];
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

function setupStore(comp: Component, hook: string, id: string, fn: N, path: string): void {
  const run = runOf(piniaStores);
  if (fn.body.type !== "BlockStatement") fail(comp, "FV1307", "a setup store's function returns its state from a block: `() => { …; return { … } }`", fn);
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
    if (st.type !== "VariableDeclaration") fail(comp, "FV1308", `\`${st.type}\` in a setup store is not supported`, st);
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
  if (returned?.type !== "ObjectExpression") fail(comp, "FV1309", "a setup store returns an object of its state, getters and actions", returned ?? fn);
  const state: Field[] = [];
  const getters = new Map<string, StoreGetter>();
  for (const p of returned.properties) {
    if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") fail(comp, "FV1310", "a setup store returns plain names: `{ count, doubled, increment }`", p);
    const key: string = p.key.name ?? p.key.value;
    const local: string = p.value.name;
    if (refs.has(local)) state.push({ js: key, rust: snake(key), ty: markStore(refs.get(local)!) });
    else if (computeds.has(local)) getters.set(key, { param: null, body: computeds.get(local), file: comp.file, setup: true });
    else if (!others.has(local)) fail(comp, "FV1311", `\`${local}\` is not declared in the store's function`, p);
  }
  const name = id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") + "State";
  if (run.structs.has(name)) fail(comp, "FV1312", `\`${name}\` names this setup store's state; rename the interface`, fn);
  run.structs.set(name, { name, fields: state });
  run.files.set(name, comp.file);
  run.stores.set(hook, { hook, id, field: snake(id), state: name, module: path.replace(/\.ts$/, ""), getters });
}

function refType(comp: Component, init: N): Ty {
  const run = runOf(piniaStores);
  const typed = init.typeParameters?.params?.[0];
  const value = init.arguments[0];
  if (typed) {
    const ty = tyOfTs(comp, typed, run.structs);
    if (!value && absence(ty) === "null") fail(comp, "FV1313", `a \`ref<T | null>()\` with no value starts \`undefined\`, and may be set to \`null\`: ${ONE_NOTHING}; start it at \`null\``, init);
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
  return literal(value) ?? fail(comp, "FV1314", "a setup store's ref declares its type: `ref<string[]>([])`", init);
}

export function storeHome(file: string): Component {
  return blankComponent(basename(file), "stores", file, runOf(piniaStores).structs);
}

function storesStruct(): Struct {
  return {
    name: "Stores",
    fields: [...runOf(piniaStores).stores.values()].map((st) => ({ js: st.id, rust: st.field, ty: { k: "struct", name: st.state, store: true } })),
  };
}

function storesBorrow(): boolean {
  const { dir } = runOf(piniaStores);
  return dir !== null && structLifetime(storesStruct(), storeHome(dir.replace(/\/?$/, "/")));
}

function storesSource(dir: string): string {
  const { structs: states, files } = runOf(piniaStores);
  const home = storeHome(dir);
  const testDerive = (src: string) =>
    src.replace(
      "#[cfg_attr(test, derive(serde::Deserialize))]",
      `#[cfg_attr(test, derive(${src.includes("Default, serde::Serialize") ? "" : "Default, "}serde::Deserialize))]\n#[cfg_attr(test, serde(default))]`,
    );
  const structs = [...states.values()]
    .map((st) => testDerive(structSource(st, home, `/// \`${st.name}\` in \`${files.get(st.name)}\`.\n`)))
    .join("\n");
  const top = testDerive(structSource(storesStruct(), home, "/// Every store's state, keyed by id as `pinia.state.value` is: what the page sends the client.\n"));
  return `${header(dir, "the store files")}
//! The Pinia stores' state, which components read while they render on the server.

${/Cow</.test(structs) ? "use std::borrow::Cow;\n\n" : ""}${structs}
${top}`;
}

function mentions(n: N, name: string): boolean {
  if (!n || typeof n !== "object") return false;
  if (n.type === "Identifier" && n.name === name) return true;
  return Object.entries(n).some(([k, v]) => k !== "loc" && k !== "__fv" && (Array.isArray(v) ? v.some((x) => mentions(x, name)) : typeof v === "object" && mentions(v, name)));
}

function storeGetter(s: Scope, base: Val, name: string, node: N): Val | null {
  if (base.ty.k !== "struct" || !base.ty.store) return null;
  const stateName = base.ty.name;
  const store = [...runOf(piniaStores).stores.values()].find((st) => st.state === stateName);
  const g = store?.getters.get(name);
  if (!g) return null;
  const where = `getter \`${name}\` in ${g.file}`;
  if (!g.body) fail(s.comp, "FV1315", `${where} returns a single expression`, node);
  const uses = (n: N, type: string): boolean =>
    !!n && typeof n === "object" && (n.type === type || Object.entries(n).some(([k, v]) => k !== "loc" && (Array.isArray(v) ? v.some((x) => uses(x, type)) : typeof v === "object" && uses(v, type))));
  if (uses(g.body, "ThisExpression")) fail(s.comp, "FV1316", `${where} reads \`this\`; read the state through the getter's parameter`, node);
  if (g.body.type === "ArrowFunctionExpression" || g.body.type === "FunctionExpression") {
    fail(s.comp, "FV1317", `${where} returns a function, which takes arguments only the client passes`, node);
  }
  const locals = new Map<string, Val>();
  if (g.param) locals.set(g.param, { code: base.code, ty: base.ty });
  const setup = new Map<string, Val>();
  const refs = new Set<string>();
  if (g.setup) {
    const fields = runOf(piniaStores).structs.get(stateName)?.fields ?? [];
    for (const f of fields) {
      setup.set(f.js, fieldVal(s.comp, base.code, base.ty, f.js, node));
      refs.add(f.js);
    }
    for (const other of store!.getters.keys()) {
      if (other === name || !mentions(g.body, other)) continue;
      if (runOf(piniaStores).inProgress.has(`${stateName}.${other}`)) fail(s.comp, "FV1318", `${where} and \`${other}\` read each other`, node);
      runOf(piniaStores).inProgress.add(`${stateName}.${name}`);
      try {
        setup.set(other, storeGetter(s, base, other, node)!);
      } finally {
        runOf(piniaStores).inProgress.delete(`${stateName}.${name}`);
      }
      refs.add(other);
    }
  }
  try {
    return expr({ ...s, locals, narrowed: new Map(), setup, refs, propsIdent: null }, g.body);
  } catch (e) {
    if (e instanceof GenError) failIn(s.comp.file, e.code, `${where}: ${e.message.replace(/^[^:]*: /, "")}`);
    throw e;
  }
}

function markStore(ty: Ty): Ty {
  if (ty.k === "struct") return { ...ty, store: true };
  if (ty.k === "opt" || ty.k === "list" || ty.k === "record") return { ...ty, of: markStore(ty.of) };
  return ty;
}

export const piniaStores: Plugin<StoresRun, StoresScope> = {
  name: "stores",
  configure: (config) => ({
    dir: config.stores ?? null,
    stores: new Map(),
    structs: new Map(),
    files: new Map(),
    readers: new Set(),
    inProgress: new Set(),
  }),
  prepare(root) {
    const { dir } = runOf(piniaStores);
    if (dir) readStores(root, dir);
  },
  importedType(comp, file, name, local) {
    const { stores, structs } = runOf(piniaStores);
    const module = file.replace(/\.ts$/, "");
    if (![...stores.values()].some((x) => x.module === module)) return false;
    if (structs.has(name)) comp.importedTypes.set(local, { k: "struct", name, store: true });
    return true;
  },
  struct: (ty) => (ty.store ? { st: runOf(piniaStores).structs.get(ty.name), module: "stores" } : null),
  scope: () => ({ hooks: new Map(), storeToRefs: null, values: new Map() }),
  scriptImport(s, st, from) {
    const comp = s.comp;
    const own = scopeOf(piniaStores, s);
    if (storeImport(comp, from)) {
      for (const sp of st.specifiers) {
        const hook = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
        if (st.importKind === "type" || sp.importKind === "type" || (hook !== null && runOf(piniaStores).structs.has(hook))) continue;
        const store = hook ? runOf(piniaStores).stores.get(hook) : undefined;
        if (!store || store.module !== storeImport(comp, from)) fail(comp, "FV1319", "import a store by its `use…` hook", sp);
        own.hooks.set(sp.local.name, store);
      }
      return true;
    }
    if (from !== "pinia") return false;
    for (const sp of st.specifiers) {
      const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
      if (name === "storeToRefs") own.storeToRefs = sp.local.name;
      else s.clientOnly.set(sp.local.name, `\`${name}\` from Pinia does not run on the server`);
    }
    return true;
  },
  scriptBinding(s, d) {
    const comp = s.comp;
    const own = scopeOf(piniaStores, s);
    const init = d.init;
    const callee: string | null = init?.type === "CallExpression" && init.callee.type === "Identifier" ? init.callee.name : null;
    if (d.id.type === "ObjectPattern" && callee !== null && callee === own.storeToRefs) {
      const arg = init.arguments[0];
      const store = arg?.type === "Identifier" ? own.values.get(arg.name) : undefined;
      if (!store || init.arguments.length !== 1) fail(comp, "FV1320", "`storeToRefs` takes a store bound in this setup", d);
      for (const p of d.id.properties) {
        if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
          fail(comp, "FV1321", "`storeToRefs` is destructured into plain names", p);
        }
        const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
        const state: Val = { code: `fv_stores.${store.field}`, ty: { k: "struct", name: store.state, store: true } };
        s.setup.set(p.value.name, storeGetter(s, state, key, p) ?? fieldVal(comp, state.code, state.ty, key, p));
        s.refs.add(p.value.name);
      }
      runOf(piniaStores).readers.add(comp);
      return true;
    }
    const hook = d.id.type === "Identifier" && callee !== null ? own.hooks.get(callee) : undefined;
    if (!hook) return false;
    if (init.arguments.length) fail(comp, "FV1322", "a store hook takes no arguments", d);
    own.values.set(d.id.name, hook);
    s.setup.set(d.id.name, { code: `fv_stores.${hook.field}`, ty: { k: "struct", name: hook.state, store: true } });
    runOf(piniaStores).readers.add(comp);
    return true;
  },
  member: (s, base, prop, n, computed) => (computed ? null : storeGetter(s, base, prop, n)),
  params: [
    {
      name: "fv_stores",
      get ty() {
        return storesBorrow() ? "&super::stores::Stores<'_>" : "&super::stores::Stores";
      },
      get pageTy() {
        return storesBorrow() ? "&'p super::stores::Stores<'p>" : "&'p super::stores::Stores";
      },
      reads: (c) => runOf(piniaStores).readers.has(c),
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
