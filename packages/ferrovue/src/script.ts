import { basename } from "node:path";
import { type Component, type N, type Scope, type Val, fail, GenError, nodeName, nothing, snake, takesAttrs, UNDEF } from "./model.ts";
import { CONFIG_FILE, ctx } from "./context.ts";
import { definePropsType, readTypeFile, refuseDates, tyOfTs } from "./typescript.ts";
import { resolveImport } from "./resolve.ts";
import { constOfDecl, type Declared, declareConsts } from "./constants.ts";
import { localTy } from "./rust.ts";
import { expr, fieldVal, typedBy } from "./expr.ts";
import { occurrences } from "./parens.ts";
import { known } from "./narrowing.ts";
import { bindingOf, bodyExpr, panicky } from "./blocks.ts";
import { functionOf } from "./functions.ts";

export const CLIENT_HOOKS = new Set([
  "onMounted", "onBeforeMount", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeUpdate",
  "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered",
]);

export const INERT_CALLS = new Set(["defineEmits", "defineSlots", "defineOptions", "defineExpose", "defineProps", "withDefaults"]);

export function setupStatement(comp: Component, st: N): void {
  const c = st.expression;
  const name = c?.type === "CallExpression" && c.callee.type === "Identifier" ? (c.callee.name as string) : null;
  if (name !== null && (CLIENT_HOOKS.has(name) || INERT_CALLS.has(name))) return;
  if (name === "watch") {
    const options = c.arguments[2];
    const immediate = options?.type === "ObjectExpression" && options.properties.some(
      (p: N) => p.type === "ObjectProperty" && (p.key.name ?? p.key.value) === "immediate" && !(p.value.type === "BooleanLiteral" && !p.value.value),
    );
    if (!immediate) return;
    fail(comp, "FV0102", "`watch` with `immediate` runs on the server, where its effect is not translated", st);
  }
  if (name === "watchEffect" || name === "watchSyncEffect" || name === "watchPostEffect") {
    fail(comp, "FV0103", `\`${name}\` runs once on the server, where its effect is not translated; use \`watch\` or \`onMounted\``, st);
  }
  if (name === "onServerPrefetch") fail(comp, "FV0104", "`onServerPrefetch` fetches on the server; pass the data in as props instead", st);
  fail(comp, "FV0105", `${st.expression?.type === "CallExpression" ? (name === null ? "a call" : `\`${name}()\``) : nodeName(st.expression)} in setup could change what renders, and is not translated`, st);
}

export function setupSource(comp: Component, init: N): N | null {
  if (init.type === "CallExpression" && init.callee.type === "Identifier") {
    const name = init.callee.name;
    if ((name === "ref" || name === "shallowRef") && init.arguments.length === 1) return init.arguments[0];
    if (name === "computed") {
      const fn = init.arguments[0];
      if (fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") return null;
      const body = bodyExpr(comp, fn, "a `computed`'s body");
      const returns = fn.returnType?.typeAnnotation;
      return returns ? typedBy(body, returns) : body;
    }
  }
  if (init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression" || init.type === "TSNonNullExpression") return setupSource(comp, init.expression);
  return init;
}

function unwrapped(n: N): N {
  while (n && ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"].includes(n.type)) n = n.expression;
  return n;
}

function constant(d: Declared): boolean {
  try {
    constOfDecl(d);
    return true;
  } catch (e) {
    if (e instanceof GenError) return false;
    throw e;
  }
}

function refOf(t: N): N | undefined {
  const name = t?.type === "TSTypeReference" && t.typeName.type === "Identifier" ? t.typeName.name : null;
  return (name === "ComputedRef" || name === "Ref" || name === "ShallowRef") && t.typeParameters?.params?.length === 1 ? t.typeParameters.params[0] : undefined;
}

function statedTy(init: N): N | undefined {
  return init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression" ? init.typeAnnotation : undefined;
}

function emptyRef(comp: Component, init: N): Val | null {
  if (init?.type !== "CallExpression" || init.callee.type !== "Identifier" || !["ref", "shallowRef"].includes(init.callee.name)) return null;
  const typed = init.typeParameters?.params?.[0];
  const [value, ...rest] = init.arguments as N[];
  if (rest.length) return null;
  if (!value || (value.type === "Identifier" && value.name === "undefined")) return { code: "None", ty: UNDEF };
  if (!typed || value.type !== "ArrayExpression" || value.elements.length > 0) return null;
  const ty = tyOfTs(comp, typed, comp.structs);
  refuseDates(comp, ty, "a `ref`", typed);
  return ty.k === "list" ? { code: `Vec::<${localTy(ty.of, comp)}>::new()`, ty } : null;
}

export function patternNames(p: N): string[] {
  switch (p?.type) {
    case "Identifier":
      return [p.name];
    case "ObjectPattern":
      return p.properties.flatMap((q: N) => patternNames(q.type === "RestElement" ? q.argument : q.value));
    case "ArrayPattern":
      return p.elements.flatMap((q: N) => (q ? patternNames(q) : []));
    case "AssignmentPattern":
      return patternNames(p.left);
    case "RestElement":
      return patternNames(p.argument);
    default:
      return [];
  }
}

function asyncLoader(arg: N): N {
  if (arg?.type === "ObjectExpression") {
    const loader = arg.properties.find((p: N) => p.type === "ObjectProperty" && !p.computed && (p.key.name ?? p.key.value) === "loader");
    return loader?.value;
  }
  return arg;
}

/** The components `<script setup>` declares with `defineAsyncComponent(() => import("./X.vue"))`,
 * by local name, each the name of the `.vue` file it loads. */
export function asyncChildren(comp: Component, ast: N[]): Map<string, string> {
  const callees = new Set<string>();
  for (const st of ast) {
    if (st.type !== "ImportDeclaration" || st.source.value !== "vue") continue;
    for (const sp of st.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "defineAsyncComponent") callees.add(sp.local.name);
    }
  }
  const found = new Map<string, string>();
  if (!callees.size) return found;
  for (const st of ast) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      const init = d.init;
      if (init?.type !== "CallExpression" || init.callee.type !== "Identifier" || !callees.has(init.callee.name)) continue;
      const loader = asyncLoader(init.arguments[0]);
      const imported = loader?.type === "ArrowFunctionExpression" && loader.params.length === 0 ? loader.body : null;
      const spec = imported?.type === "ImportExpression" ? imported.source : imported?.type === "CallExpression" && imported.callee.type === "Import" ? imported.arguments[0] : null;
      if (d.id.type !== "Identifier" || spec?.type !== "StringLiteral" || !spec.value.endsWith(".vue")) {
        fail(comp, "FV0106", '`defineAsyncComponent` loads a component of this project, as `defineAsyncComponent(() => import("./Child.vue"))`', init);
      }
      found.set(d.id.name, basename(spec.value, ".vue"));
    }
  }
  return found;
}

function mayPanic(lazies: Map<string, string>, init: string): boolean {
  if (panicky(init)) return true;
  return [...lazies.values()].some((name) => occurrences(init, name) > 0);
}

export function scopeFor(comp: Component, ast: N[], components: Map<string, Component>): { scope: Scope; lets: string[]; lazies: Map<string, string> } {
  const scope: Scope = {
    comp,
    components,
    setup: new Map(),
    children: new Map(),
    loadedLater: new Set(),
    helpers: new Map(),
    locals: new Map(),
    propsIdent: null,
    refs: new Set(),
    clientOnly: new Map(),
    imported: new Map(),
    refusedBy: new Map(),
    narrowed: new Map(),
    selfAliases: new Set(),
    helperBytes: { n: 0 },
    directives: new Map(),
    fill: false,
    vnode: false,
    attrs: comp.inherits ? (takesAttrs(comp) ? "fv_attrs.ids()" : "fv_attrs") : null,
    fallthrough: takesAttrs(comp) ? "fv_attrs" : null,
    attrsBindings: new Set(),
    slotsBindings: new Set(),
    consts: new Map(),
    functions: new Map(),
    sid: null,
    opaque: null,
    plugins: new Map(),
  };
  for (const p of ctx.plugins) if (p.scope) scope.plugins.set(p, p.scope(scope));
  const evaluable = (local: string, d: Declared, why: string, help: string | null = null): void => {
    try {
      scope.consts.set(local, constOfDecl(d));
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      scope.clientOnly.set(local, `${why}: ${e.message.split("\n")[0]!}`);
      scope.refusedBy.set(local, help === null || e.help !== null ? e : Object.assign(new GenError(e.code, e.message, e.at, e.what, help), { readAt: e.readAt }));
    }
  };
  const locals = declareConsts(comp, ast);
  const lets: string[] = [];
  const lazies = new Map<string, string>();
  const asyncs = asyncChildren(comp, ast);
  let useAttrsName: string | null = null;
  let useSlotsName: string | null = null;
  const declared = (f: { name: string; node: N }, tdzUntil?: number): void => {
    scope.functions.set(f.name, { name: f.name, node: f.node, home: comp, file: null, ...(tdzUntil !== undefined ? { tdzUntil } : {}) });
    scope.clientOnly.set(f.name, "it is a function, which the template and a `computed` may call, and only an event handler may name without calling it");
  };
  for (const st of ast) {
    const decls: N[] = st.type === "VariableDeclaration" && st.kind === "const" ? st.declarations : [st];
    for (const d of decls) {
      const f = functionOf(d);
      if (f) declared(f, st.type === "VariableDeclaration" ? st.end : undefined);
    }
  }
  for (const st of ast) {
    if (st.type === "ImportDeclaration") {
      const from: string = st.source.value;
      if (from.endsWith(".vue")) {
        const def = st.specifiers.find((x: N) => x.type === "ImportDefaultSpecifier");
        if (def) scope.children.set(def.local.name, basename(from, ".vue"));
        continue;
      }
      if (ctx.plugins.some((p) => p.scriptImport?.(scope, st, from))) continue;
      if (from === "vue") {
        for (const sp of st.specifiers) {
          if (sp.type !== "ImportSpecifier") continue;
          const imported: string = sp.imported.name ?? sp.imported.value;
          if (imported === "useAttrs") useAttrsName = sp.local.name;
          if (imported === "useSlots") useSlotsName = sp.local.name;
        }
      } else if (ctx.helperModule !== null && from === ctx.helperModule) {
        for (const sp of st.specifiers) {
          if (!ctx.helpers[sp.imported.name]) fail(comp, "FV1108", `\`${sp.imported.name}\` has no Rust twin: add it to \`helpers.functions\` in ${CONFIG_FILE}`, sp);
          scope.helpers.set(sp.local.name, sp.imported.name);
        }
      } else {
        for (const sp of st.importKind === "type" ? [] : st.specifiers) if (sp.importKind !== "type") scope.imported.set(sp.local.name, from);
        const file = resolveImport(comp.file, from);
        if (file !== null && st.importKind !== "type" && st.specifiers.some((sp: N) => sp.type === "ImportDefaultSpecifier")) readTypeFile(file);
        const decls = file !== null ? ctx.constDecls.get(file) : undefined;
        const fns = file !== null ? ctx.tsModules.get(file)?.functions : undefined;
        for (const sp of decls && st.importKind !== "type" ? st.specifiers : []) {
          const key: string | undefined = sp.type === "ImportSpecifier" && sp.importKind !== "type" ? (sp.imported.name ?? sp.imported.value) : sp.type === "ImportDefaultSpecifier" ? "default" : undefined;
          const f = key !== undefined ? fns?.get(key) : undefined;
          if (f?.exported) {
            scope.functions.set(sp.local.name, f.fn);
            scope.clientOnly.set(sp.local.name, `it is a function imported from ${f.fn.home.file}, which the template and a \`computed\` may call, and only an event handler may name without calling it`);
            continue;
          }
          const d = key !== undefined ? decls!.get(key) : undefined;
          if (d?.exported) evaluable(sp.local.name, d, `it is imported from ${d.home.file}, where it is not a constant the compiler evaluates`);
        }
      }
      continue;
    }
    if (st.type === "FunctionDeclaration") continue;
    const decl = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (decl?.type === "TSInterfaceDeclaration" || decl?.type === "TSTypeAliasDeclaration") continue;
    if (decl?.type === "TSEnumDeclaration") {
      evaluable(decl.id.name, locals.get(decl.id.name)!, "it is not an enum the compiler evaluates");
      continue;
    }
    if (st.type === "ExpressionStatement") {
      if (!ctx.plugins.some((p) => p.scriptStatement?.(scope, st, lets))) setupStatement(comp, st);
      continue;
    }
    if (st.type !== "VariableDeclaration") fail(comp, "FV0107", `${nodeName(st)} in setup is not supported`, st);
    for (const d of st.declarations) {
      const init0 = d.init;
      if (d.id.type === "ObjectPattern" && definePropsType(init0)) {
        for (const p of d.id.properties) {
          if (p.type !== "ObjectProperty" || p.computed) fail(comp, "FV0108", "destructured props are plain names: `...rest` has no Rust type", p);
          const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
          const local = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
          if (local.type !== "Identifier") fail(comp, "FV0109", "destructured props are plain names", p);
          scope.setup.set(local.name, fieldVal(comp, "props", { k: "struct", name: "Props" }, key, p));
        }
        continue;
      }
      const loaded = d.id.type === "Identifier" ? asyncs.get(d.id.name) : undefined;
      if (loaded !== undefined) {
        scope.children.set(d.id.name, loaded);
        scope.loadedLater.add(d.id.name);
        continue;
      }
      if (ctx.plugins.some((p) => p.scriptBinding?.(scope, d, lets))) continue;
      if (d.id.type !== "Identifier") {
        for (const name of patternNames(d.id)) scope.clientOnly.set(name, "it is destructured from a value the server does not have");
        continue;
      }
      const local: string = d.id.name;
      if (scope.functions.get(local)?.node === init0) continue;
      const objectDecl = locals.get(local);
      if (st.kind === "const" && objectDecl !== undefined && objectDecl.node === d && unwrapped(init0)?.type === "ObjectExpression") {
        if (!(d.id.typeAnnotation || statedTy(init0)) || constant(objectDecl)) {
          evaluable(local, objectDecl, "it is an object the compiler does not evaluate", `annotate it with an interface, \`const ${local}: Card = { … }\`, to build it as the Rust struct of that interface`);
          continue;
        }
      }
      const made = unwrapped(init0);
      if (st.kind === "const" && objectDecl !== undefined && objectDecl.node === d && made?.type === "NewExpression" && made.callee.type === "Identifier" && made.callee.name === "Map" && !locals.has("Map")) {
        evaluable(local, objectDecl, "it is a `Map` the compiler does not evaluate");
        continue;
      }
      if (useAttrsName !== null && init0?.type === "CallExpression" && init0.callee.type === "Identifier" && init0.callee.name === useAttrsName) {
        scope.attrsBindings.add(local);
        scope.clientOnly.set(local, "`useAttrs()` is bound whole, with `v-bind`; a value read from it has no type");
        continue;
      }
      if (useSlotsName !== null && init0?.type === "CallExpression" && init0.callee.type === "Identifier" && init0.callee.name === useSlotsName) {
        scope.slotsBindings.add(local);
        continue;
      }
      const model = comp.models.get(local);
      if (model !== undefined) {
        scope.setup.set(local, fieldVal(comp, "props", { k: "struct", name: "Props" }, model, d));
        scope.refs.add(local);
        continue;
      }
      if (!init0) {
        scope.clientOnly.set(local, "it has no initial value");
        continue;
      }
      if (definePropsType(init0)) {
        scope.propsIdent = local;
        continue;
      }
      const isRef = init0.type === "CallExpression" && init0.callee.type === "Identifier" && ["ref", "shallowRef", "computed"].includes(init0.callee.name);
      if (isRef) scope.refs.add(local);
      const isComputed = isRef && init0.callee.name === "computed";
      const typed = isRef ? (init0.typeParameters?.params?.[0] ?? refOf(d.id.typeAnnotation?.typeAnnotation)) : (d.id.typeAnnotation?.typeAnnotation ?? statedTy(init0));
      let v: Val;
      try {
        const untyped = setupSource(comp, init0);
        const source = untyped && typed ? typedBy(untyped, typed) : untyped;
        const empty = emptyRef(comp, init0);
        if (!empty && !source) {
          scope.clientOnly.set(local, "it is not a value the server computes: only `ref(…)`, `computed(() => …)` and plain expressions are");
          continue;
        }
        v = empty ?? expr(isComputed ? { ...scope, within: "computed" } : { ...scope, settingUpAt: st.start, within: "setup" }, source);
      } catch (e) {
        if (!(e instanceof GenError) || e.code === "FV1908") throw e;
        scope.clientOnly.set(local, e.what);
        scope.refusedBy.set(local, e);
        continue;
      }
      if (nothing(v.ty) || (v.ty.k === "str" && known(v) !== undefined)) {
        scope.setup.set(local, v);
        continue;
      }
      const name = `s_${snake(local).replace(/^r#/, "")}`;
      const { init, read } = bindingOf(v);
      const lazy = isComputed && mayPanic(lazies, init);
      lets.push(lazy ? `let ${name} = std::cell::LazyCell::new(|| ${init});` : `let ${name} = ${init};`);
      scope.setup.set(local, read(lazy && !v.owned ? `(*${name})` : name));
      if (lazy) lazies.set(local, name);
    }
  }
  return { scope, lets, lazies };
}
