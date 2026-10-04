/* Pinia option stores: their state, its types, and their getters. */

import { parse as parseJs } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { type Component, type Field, type N, type Ty, BOOL, fail, FLOAT, INT, opt, sameTy, snake, STR, tagAst, UNDEF } from "./model.ts";
import { ctx, type StoreGetter } from "./context.ts";
import { markStore, structOf, tyOfTs, typesImports } from "./typescript.ts";
import { patternNames, setupStatement } from "./script.ts";

/** The store module an import names, resolved and without its extension, when it is one. */
export function storeImport(comp: Component, from: string): string | null {
  if (!from.startsWith(".") || ctx.stores.size === 0) return null;
  const target = resolve(ctx.rootDir, dirname(comp.file), from).replace(/\.ts$/, "");
  return [...ctx.stores.values()].some((s) => s.module === target) ? target : null;
}

/** Every store in the configured directory, and the interfaces their files declare. */
export function readStores(root: string, dir: string): void {
  ctx.stores = new Map();
  ctx.storeStructs = new Map();
  ctx.storeFiles = new Map();
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
      if (ctx.storeStructs.has(d.id.name)) fail(comp, `\`${d.id.name}\` is declared by another store too`, d);
      ctx.storeStructs.set(d.id.name, { name: d.id.name, fields: [] });
      ctx.storeFiles.set(d.id.name, comp.file);
    }
    for (const d of interfaces) {
      const st = structOf(comp, d.id.name, d.body.body, ctx.storeStructs);
      for (const field of st.fields) field.ty = markStore(field.ty);
      ctx.storeStructs.set(d.id.name, st);
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
        if (ret?.type !== "TSTypeReference" || !ctx.storeStructs.has(ret.typeName.name)) {
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
        ctx.stores.set(v.id.name, {
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

/** A store file, as the thing its types are declared in: what errors name, and where they resolve. */
/** A setup store: \`defineStore(id, () => { …; return { … } })\`. The refs it returns are its state —
 * typed by \`ref<T>(…)\`, or by the literal they start from — the computeds it returns its getters,
 * and its functions actions, which only the client runs. */
function setupStore(comp: Component, hook: string, id: string, fn: N, path: string): void {
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
  if (ctx.storeStructs.has(name)) fail(comp, `\`${name}\` names this setup store's state; rename the interface`, fn);
  ctx.storeStructs.set(name, { name, fields: state });
  ctx.storeFiles.set(name, comp.file);
  ctx.stores.set(hook, { hook, id, field: snake(id), state: name, module: path.replace(/\.ts$/, ""), getters });
}

/** A setup store ref's type: \`ref<T>(…)\`, or what its initial literal is; optional when it has none. */
function refType(comp: Component, init: N): Ty {
  const typed = init.typeParameters?.params?.[0];
  const value = init.arguments[0];
  if (typed) {
    const ty = tyOfTs(comp, typed, ctx.storeStructs);
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

export function storeHome(file: string): Component {
  return {
    name: basename(file),
    module: "stores",
    file,
    props: { name: "Props", fields: [] },
    structs: ctx.storeStructs,
    trustedName: null,
    floatName: null,
    childProps: new Map(),
    imports: new Set(),
    slotNames: [],
    routerView: false,
    routerLink: false,
    readsRoute: false,
    usesRoute: false,
    readsStores: false,
    usesStores: false,
    readsI18n: false,
    usesI18n: false,
    readsTeleports: false,
    usesTeleports: false,
    models: new Map(),
    aliases: new Map(),
    importedTypes: new Map(),
    slotShapes: new Map(),
    scopeId: null,
    slotted: false,
    inheritAttrs: true,
    inherits: false,
    passesSlotIds: false,
  };
}
