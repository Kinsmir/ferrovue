import { basename } from "node:path";
import { type Component, type Fn, type N, type Scope, type Ty, type Val, absence, dollarNames, enumOf, fail, nodeName, nothing, patternNames, snake, takesAttrs, UNDEF, UNION_STR, unionStr } from "./model.ts";
import { GenError } from "./errors.ts";
import { CONFIG_FILE } from "./config.ts";
import { ctx } from "./context.ts";
import { definePropsType, readTypeFile, refuseDates, tyOfTs } from "./typescript.ts";
import { resolveImport } from "./resolve.ts";
import { constOfDecl, type Declared, declareConsts } from "./constants.ts";
import { localTy } from "./rust.ts";
import { expr, fieldVal, typedBy } from "./expr.ts";
import { atom, occurrences } from "./parens.ts";
import { known } from "./narrowing.ts";
import { bindingOf, bodyExpr, panicky } from "./blocks.ts";
import { annotatedStr, declaredUnion, exactlyEnum, intoEnum, knownLiteral, refField } from "./enums.ts";
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

function computedSource(comp: Component, fn: N): N | null {
  if (fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") return null;
  const body = bodyExpr(comp, fn, "a `computed`'s body");
  const returns = fn.returnType?.typeAnnotation;
  return returns ? typedBy(body, returns) : body;
}

export function setupSource(comp: Component, init: N): N | null {
  if (init.type === "CallExpression" && init.callee.type === "Identifier") {
    const name = init.callee.name;
    if ((name === "ref" || name === "shallowRef") && init.arguments.length === 1) return init.arguments[0];
    if (name === "computed") return computedSource(comp, init.arguments[0]);
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
    if (e instanceof GenError && e.code !== "FV0228") return false;
    throw e;
  }
}

function refOf(t: N): N | undefined {
  const name = t?.type === "TSTypeReference" && t.typeName.type === "Identifier" ? t.typeName.name : null;
  return (name === "ComputedRef" || name === "Ref" || name === "ShallowRef") && t.typeParameters?.params?.length === 1 ? t.typeParameters.params[0] : undefined;
}

function declaredTy(comp: Component, t: N): Ty | null {
  try {
    return tyOfTs(comp, t, comp.structs);
  } catch (e) {
    if (e instanceof GenError) return null;
    throw e;
  }
}

function statedTy(init: N): N | undefined {
  return init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression" ? init.typeAnnotation : undefined;
}

function unionRef(comp: Component, local: string, typed: N, v: Val, at: N): Val {
  if ((v.ty.k === "opt" ? v.ty.of : v.ty).k !== "str") return v;
  let ty: Ty;
  try {
    ty = refField(comp, local, typed, tyOfTs(comp, typed, comp.structs));
  } catch (e) {
    if (e instanceof GenError && e.code !== "FV0325") return v;
    throw e;
  }
  const def = enumOf(ty);
  const held = ty.k === "opt" && v.ty.k !== "opt" ? ty.of : ty;
  if (def === undefined || !exactlyEnum(v) || (held.k === "opt") !== (v.ty.k === "opt") || (held.k === "opt" && absence(held) !== absence(v.ty))) return annotatedStr(v, held);
  const into = intoEnum(comp, v, def, at);
  if (into === null) return annotatedStr(v, held);
  if (knownLiteral(v) !== undefined) return { ...v, ty: held, variant: into };
  return { code: held.k === "opt" ? `${atom(into)}.map(${UNION_STR})` : unionStr(into), ty: held, variant: into };
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

function asyncLoader(arg: N): N {
  if (arg?.type === "ObjectExpression") {
    const loader = arg.properties.find((p: N) => p.type === "ObjectProperty" && !p.computed && (p.key.name ?? p.key.value) === "loader");
    return loader?.value;
  }
  return arg;
}

function asyncCallees(ast: N[]): Set<string> {
  const callees = new Set<string>();
  for (const st of ast) {
    if (st.type !== "ImportDeclaration" || st.source.value !== "vue") continue;
    for (const sp of st.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "defineAsyncComponent") callees.add(sp.local.name);
    }
  }
  return callees;
}

function importedSpec(loader: N): N | null {
  const imported = loader?.type === "ArrowFunctionExpression" && loader.params.length === 0 ? loader.body : null;
  if (imported?.type === "ImportExpression") return imported.source;
  return imported?.type === "CallExpression" && imported.callee.type === "Import" ? imported.arguments[0] : null;
}

function asyncChild(comp: Component, d: N, callees: Set<string>): [string, string] | null {
  const init = d.init;
  if (init?.type !== "CallExpression" || init.callee.type !== "Identifier" || !callees.has(init.callee.name)) return null;
  const spec = importedSpec(asyncLoader(init.arguments[0]));
  if (d.id.type !== "Identifier" || spec?.type !== "StringLiteral" || !spec.value.endsWith(".vue")) {
    fail(comp, "FV0106", '`defineAsyncComponent` loads a component of this project, as `defineAsyncComponent(() => import("./Child.vue"))`', init);
  }
  return [d.id.name, basename(spec.value, ".vue")];
}

/** The components `<script setup>` declares with `defineAsyncComponent(() => import("./X.vue"))`,
 * by local name, each the name of the `.vue` file it loads. */
export function asyncChildren(comp: Component, ast: N[]): Map<string, string> {
  const callees = asyncCallees(ast);
  const found = new Map<string, string>();
  if (!callees.size) return found;
  for (const st of ast) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      const child = asyncChild(comp, d, callees);
      if (child !== null) found.set(...child);
    }
  }
  return found;
}

function mayPanic(lazies: Map<string, string>, init: string): boolean {
  if (panicky(init)) return true;
  return [...lazies.values()].some((name) => occurrences(init, name) > 0);
}

interface Setup {
  comp: Component;
  scope: Scope;
  locals: Map<string, Declared>;
  asyncs: Map<string, string>;
  setupNames: Map<string, string>;
  lets: string[];
  lazies: Map<string, string>;
  useAttrsName: string | null;
  useSlotsName: string | null;
}

function emptyScope(comp: Component, components: Map<string, Component>): Scope {
  return {
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
    temps: new Set(),
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
}

function evaluable(scope: Scope, local: string, d: Declared, why: string, help: string | null = null): void {
  try {
    scope.consts.set(local, constOfDecl(d));
  } catch (e) {
    if (!(e instanceof GenError)) throw e;
    scope.clientOnly.set(local, `${why}: ${e.message.split("\n")[0]!}`);
    scope.refusedBy.set(local, help === null || e.help !== null ? e : Object.assign(new GenError(e.code, e.message, e.at, e.what, help), { readAt: e.readAt }));
  }
}

function numericConsts(scope: Scope, locals: Map<string, Declared>): void {
  for (const [local, d] of locals) {
    try {
      const c = constOfDecl(d);
      if (c.k === "scalar" && typeof c.js === "number") scope.consts.set(local, c);
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
    }
  }
}

function declared(scope: Scope, f: { name: string; node: N }, tdzUntil?: number): void {
  scope.functions.set(f.name, { name: f.name, node: f.node, home: scope.comp, file: null, ...(tdzUntil !== undefined ? { tdzUntil } : {}) });
  scope.clientOnly.set(f.name, "it is a function, which the template and a `computed` may call, and only an event handler may name without calling it");
}

function declareFunctions(scope: Scope, ast: N[]): void {
  for (const st of ast) {
    const decls: N[] = st.type === "VariableDeclaration" && st.kind === "const" ? st.declarations : [st];
    for (const d of decls) {
      const f = functionOf(d);
      if (f) declared(scope, f, st.type === "VariableDeclaration" ? st.end : undefined);
    }
  }
}

function setupNamesOf(ast: N[]): Map<string, string> {
  const bound = ast.flatMap((st: N) => (st.type === "VariableDeclaration" ? st.declarations.flatMap((d: N) => (d.id.type === "Identifier" ? [d.id.name as string] : [])) : []));
  return dollarNames(bound, (js) => `s_${snake(js).replace(/^r#/, "")}`);
}

function vueImport(s: Setup, st: N): void {
  for (const sp of st.specifiers) {
    if (sp.type !== "ImportSpecifier") continue;
    const imported: string = sp.imported.name ?? sp.imported.value;
    if (imported === "useAttrs") s.useAttrsName = sp.local.name;
    if (imported === "useSlots") s.useSlotsName = sp.local.name;
  }
}

function helperImport(scope: Scope, st: N): void {
  for (const sp of st.specifiers) {
    if (!ctx.helpers[sp.imported.name]) fail(scope.comp, "FV1108", `\`${sp.imported.name}\` has no Rust twin: add it to \`helpers.functions\` in ${CONFIG_FILE}`, sp);
    scope.helpers.set(sp.local.name, sp.imported.name);
  }
}

function importedKey(sp: N): string | undefined {
  if (sp.type === "ImportSpecifier" && sp.importKind !== "type") return sp.imported.name ?? sp.imported.value;
  return sp.type === "ImportDefaultSpecifier" ? "default" : undefined;
}

type ModuleFunctions = Map<string, { fn: Fn; exported: boolean }> | undefined;

function importedValue(scope: Scope, sp: N, decls: Map<string, Declared>, fns: ModuleFunctions): void {
  const key = importedKey(sp);
  if (key === undefined) return;
  const f = fns?.get(key);
  if (f?.exported) {
    scope.functions.set(sp.local.name, f.fn);
    scope.clientOnly.set(sp.local.name, `it is a function imported from ${f.fn.home.file}, which the template and a \`computed\` may call, and only an event handler may name without calling it`);
    return;
  }
  const d = decls.get(key);
  if (d?.exported) evaluable(scope, sp.local.name, d, `it is imported from ${d.home.file}, where it is not a constant the compiler evaluates`);
}

function moduleValues(scope: Scope, st: N, file: string): void {
  if (st.specifiers.some((sp: N) => sp.type === "ImportDefaultSpecifier")) readTypeFile(file);
  const decls = ctx.constDecls.get(file);
  if (decls === undefined) return;
  const fns = ctx.tsModules.get(file)?.functions;
  for (const sp of st.specifiers) importedValue(scope, sp, decls, fns);
}

function moduleImport(scope: Scope, st: N, from: string): void {
  const typeOnly = st.importKind === "type";
  for (const sp of typeOnly ? [] : st.specifiers) if (sp.importKind !== "type") scope.imported.set(sp.local.name, from);
  const file = resolveImport(scope.comp.file, from);
  if (file !== null && !typeOnly) moduleValues(scope, st, file);
}

function scriptImport(s: Setup, st: N): void {
  const from: string = st.source.value;
  if (from.endsWith(".vue")) {
    const def = st.specifiers.find((x: N) => x.type === "ImportDefaultSpecifier");
    if (def) s.scope.children.set(def.local.name, basename(from, ".vue"));
    return;
  }
  if (ctx.plugins.some((p) => p.scriptImport?.(s.scope, st, from))) return;
  if (from === "vue") vueImport(s, st);
  else if (ctx.helperModule !== null && from === ctx.helperModule) helperImport(s.scope, st);
  else moduleImport(s.scope, st, from);
}

function destructuredProps(comp: Component, scope: Scope, pattern: N): void {
  for (const p of pattern.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(comp, "FV0108", "destructured props are plain names: `...rest` has no Rust type", p);
    const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    const local = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
    if (local.type !== "Identifier") fail(comp, "FV0109", "destructured props are plain names", p);
    scope.setup.set(local.name, fieldVal(comp, "props", { k: "struct", name: "Props" }, key, p));
  }
}

function asyncBinding(s: Setup, d: N): boolean {
  const loaded = d.id.type === "Identifier" ? s.asyncs.get(d.id.name) : undefined;
  if (loaded === undefined) return false;
  s.scope.children.set(d.id.name, loaded);
  s.scope.loadedLater.add(d.id.name);
  return true;
}

function objectConstant(scope: Scope, d: N, local: string, objectDecl: Declared): boolean {
  if ((d.id.typeAnnotation || statedTy(d.init)) && !constant(objectDecl)) return false;
  evaluable(scope, local, objectDecl, "it is an object the compiler does not evaluate", `annotate it with an interface, \`const ${local}: Card = { … }\`, to build it as the Rust struct of that interface`);
  return true;
}

function newMap(s: Setup, made: N): boolean {
  return made?.type === "NewExpression" && made.callee.type === "Identifier" && made.callee.name === "Map" && !s.locals.has("Map");
}

function constantBinding(s: Setup, st: N, d: N, local: string): boolean {
  const objectDecl = s.locals.get(local);
  if (st.kind !== "const" || objectDecl === undefined || objectDecl.node !== d) return false;
  const made = unwrapped(d.init);
  if (made?.type === "ObjectExpression") return objectConstant(s.scope, d, local, objectDecl);
  if (!newMap(s, made)) return false;
  evaluable(s.scope, local, objectDecl, "it is a `Map` the compiler does not evaluate");
  return true;
}

function calls(init: N, callee: string | null): boolean {
  return callee !== null && init?.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === callee;
}

function attrsOrSlotsBinding(s: Setup, local: string, init: N): boolean {
  if (calls(init, s.useAttrsName)) {
    s.scope.attrsBindings.add(local);
    s.scope.clientOnly.set(local, "`useAttrs()` is bound whole, with `v-bind`; a value read from it has no type");
    return true;
  }
  if (!calls(init, s.useSlotsName)) return false;
  s.scope.slotsBindings.add(local);
  return true;
}

function modelBinding(s: Setup, local: string, d: N): boolean {
  const model = s.comp.models.get(local);
  if (model === undefined) return false;
  s.scope.setup.set(local, fieldVal(s.comp, "props", { k: "struct", name: "Props" }, model, d));
  s.scope.refs.add(local);
  return true;
}

interface SetupInit {
  local: string;
  init: N;
  at: number;
  isRef: boolean;
  isComputed: boolean;
  typed: N | undefined;
}

function typedAs(d: N, isRef: boolean): N | undefined {
  const declaredAs = d.id.typeAnnotation?.typeAnnotation;
  return isRef ? (d.init.typeParameters?.params?.[0] ?? refOf(declaredAs)) : (declaredAs ?? statedTy(d.init));
}

function setupInit(st: N, d: N): SetupInit {
  const init = d.init;
  const isRef = init.type === "CallExpression" && init.callee.type === "Identifier" && ["ref", "shallowRef", "computed"].includes(init.callee.name);
  const isComputed = isRef && init.callee.name === "computed";
  return { local: d.id.name, init, at: st.start, isRef, isComputed, typed: typedAs(d, isRef) };
}

function annotatedUnion(comp: Component, b: SetupInit, annotation: N, v: Val, untyped: N): Val {
  if ((v.ty.k === "opt" ? v.ty.of : v.ty).k !== "str") return v;
  const kind = b.isComputed ? "`computed`" : b.isRef ? `\`${b.init.callee.name}\`` : "constant";
  const want = declaredTy(comp, annotation);
  return want === null ? v : declaredUnion(comp, annotatedStr(v, want), want, `\`${b.local}\`, a ${kind},`, untyped);
}

function setupScope(scope: Scope, b: SetupInit): Scope {
  return b.isComputed ? { ...scope, within: "computed" } : { ...scope, settingUpAt: b.at, within: "setup" };
}

function annotationOf(b: SetupInit): N | undefined {
  return b.typed ?? (b.isComputed ? b.init.arguments[0]?.returnType?.typeAnnotation : undefined);
}

function annotated(comp: Component, b: SetupInit, v: Val, empty: Val | null, untyped: N | null): Val {
  const annotation = annotationOf(b);
  if (b.isRef && annotation && !empty) v = unionRef(comp, b.local, annotation, v, b.init.arguments[0] ?? b.init);
  return annotation && untyped ? annotatedUnion(comp, b, annotation, v, untyped) : v;
}

function setupValue(scope: Scope, b: SetupInit): Val | null {
  const comp = scope.comp;
  const untyped = setupSource(comp, b.init);
  const source = untyped && b.typed ? typedBy(untyped, b.typed) : untyped;
  const empty = emptyRef(comp, b.init);
  if (!empty && !source) return null;
  return annotated(comp, b, empty ?? expr(setupScope(scope, b), source), empty, untyped);
}

function bindValue(s: Setup, local: string, v: Val, isComputed: boolean): void {
  if (nothing(v.ty) || (v.ty.k === "str" && known(v) !== undefined)) {
    s.scope.setup.set(local, v);
    return;
  }
  const name = s.setupNames.get(local)!;
  const { init, read } = bindingOf(v);
  const lazy = isComputed && mayPanic(s.lazies, init);
  s.lets.push(lazy ? `let ${name} = std::cell::LazyCell::new(|| ${init});` : `let ${name} = ${init};`);
  s.scope.setup.set(local, read(lazy && !v.owned ? `(*${name})` : name));
  if (lazy) s.lazies.set(local, name);
}

function valueBinding(s: Setup, st: N, d: N): void {
  const b = setupInit(st, d);
  if (b.isRef) s.scope.refs.add(b.local);
  let v: Val | null;
  try {
    v = setupValue(s.scope, b);
  } catch (e) {
    if (!(e instanceof GenError) || e.code === "FV1908") throw e;
    s.scope.clientOnly.set(b.local, e.what);
    s.scope.refusedBy.set(b.local, e);
    return;
  }
  if (v === null) {
    s.scope.clientOnly.set(b.local, "it is not a value the server computes: only `ref(…)`, `computed(() => …)` and plain expressions are");
    return;
  }
  bindValue(s, b.local, v, b.isComputed);
}

function namedBinding(s: Setup, st: N, d: N): void {
  const local: string = d.id.name;
  if (s.scope.functions.get(local)?.node === d.init) return;
  if (constantBinding(s, st, d, local) || attrsOrSlotsBinding(s, local, d.init) || modelBinding(s, local, d)) return;
  if (!d.init) {
    s.scope.clientOnly.set(local, "it has no initial value");
    return;
  }
  if (definePropsType(d.init)) {
    s.scope.propsIdent = local;
    return;
  }
  valueBinding(s, st, d);
}

function setupBinding(s: Setup, st: N, d: N): void {
  if (d.id.type === "ObjectPattern" && definePropsType(d.init)) return destructuredProps(s.comp, s.scope, d.id);
  if (asyncBinding(s, d)) return;
  if (ctx.plugins.some((p) => p.scriptBinding?.(s.scope, d, s.lets))) return;
  if (d.id.type === "Identifier") return namedBinding(s, st, d);
  for (const name of patternNames(d.id)) s.scope.clientOnly.set(name, "it is destructured from a value the server does not have");
}

function declaresNoValue(st: N, decl: N): boolean {
  return st.type === "FunctionDeclaration" || decl?.type === "TSInterfaceDeclaration" || decl?.type === "TSTypeAliasDeclaration";
}

function expressionStatement(s: Setup, st: N): void {
  if (!ctx.plugins.some((p) => p.scriptStatement?.(s.scope, st, s.lets))) setupStatement(s.comp, st);
}

function setupTopLevel(s: Setup, st: N): void {
  if (st.type === "ImportDeclaration") return scriptImport(s, st);
  const decl = st.type === "ExportNamedDeclaration" ? st.declaration : st;
  if (declaresNoValue(st, decl)) return;
  if (decl?.type === "TSEnumDeclaration") return evaluable(s.scope, decl.id.name, s.locals.get(decl.id.name)!, "it is not an enum the compiler evaluates");
  if (st.type === "ExpressionStatement") return expressionStatement(s, st);
  if (st.type !== "VariableDeclaration") fail(s.comp, "FV0107", `${nodeName(st)} in setup is not supported`, st);
  for (const d of st.declarations) setupBinding(s, st, d);
}

export function scopeFor(comp: Component, ast: N[], components: Map<string, Component>): { scope: Scope; lets: string[]; lazies: Map<string, string> } {
  const scope = emptyScope(comp, components);
  for (const p of ctx.plugins) if (p.scope) scope.plugins.set(p, p.scope(scope));
  const locals = declareConsts(comp, ast);
  numericConsts(scope, locals);
  const asyncs = asyncChildren(comp, ast);
  declareFunctions(scope, ast);
  const s: Setup = { comp, scope, locals, asyncs, setupNames: setupNamesOf(ast), lets: [], lazies: new Map(), useAttrsName: null, useSlotsName: null };
  for (const st of ast) setupTopLevel(s, st);
  return { scope, lets: s.lets, lazies: s.lazies };
}
