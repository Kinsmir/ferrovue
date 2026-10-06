import { basename } from "node:path";
import { type Component, type N, type Scope, type Ty, type Val, fail, nothing, GenError, snake, takesAttrs, UNDEF } from "./model.ts";
import { CONFIG_FILE, ctx } from "./context.ts";
import { definePropsType, resolveImport, tyOfTs } from "./typescript.ts";
import { constOfDecl, type Declared, declareConsts } from "./constants.ts";
import { rustTy } from "./rust.ts";
import { expr, fieldVal } from "./expr.ts";
import { collected, heldList } from "./lists.ts";
import { bare, operand, UNARY } from "./parens.ts";
import { known } from "./narrowing.ts";
import { heldStr, isTemporary } from "./strings.ts";
import { intFromF64 } from "./numbers.ts";

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
  fail(comp, "FV0105", `\`${st.expression?.type === "CallExpression" ? `${name ?? "a call"}()` : st.expression?.type}\` in setup could change what renders, and is not translated`, st);
}

export function setupSource(init: N): N | null {
  if (init.type === "CallExpression" && init.callee.type === "Identifier") {
    const name = init.callee.name;
    if ((name === "ref" || name === "shallowRef") && init.arguments.length === 1) return init.arguments[0];
    if (name === "computed") {
      const fn = init.arguments[0];
      if (fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") return null;
      if (fn.body.type !== "BlockStatement") return fn.body;
      const only = fn.body.body.length === 1 ? fn.body.body[0] : null;
      return only?.type === "ReturnStatement" && only.argument ? only.argument : null;
    }
  }
  if (init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression" || init.type === "TSNonNullExpression") return setupSource(init.expression);
  return init;
}

function localTy(ty: Ty, comp: Component): string {
  return rustTy(ty, comp).replace(/\bCow<'a, /g, "std::borrow::Cow<").replace(/'a\b/g, "'_");
}

function emptyRef(comp: Component, init: N): Val | null {
  if (init?.type !== "CallExpression" || init.callee.type !== "Identifier" || !["ref", "shallowRef"].includes(init.callee.name)) return null;
  const typed = init.typeParameters?.params?.[0];
  const [value, ...rest] = init.arguments as N[];
  if (rest.length) return null;
  if (!value || (value.type === "Identifier" && value.name === "undefined")) return { code: "None", ty: UNDEF };
  if (!typed || value.type !== "ArrayExpression" || value.elements.length > 0) return null;
  const ty = tyOfTs(comp, typed, comp.structs);
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

export function scopeFor(comp: Component, ast: N[], components: Map<string, Component>): { scope: Scope; lets: string[] } {
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
    narrowed: new Map(),
    selfAlias: { name: null },
    helperBytes: { n: 0 },
    directives: new Map(),
    fill: false,
    vnode: false,
    attrs: comp.inherits ? (takesAttrs(comp) ? "fv_attrs.ids()" : "fv_attrs") : null,
    fallthrough: takesAttrs(comp) ? "fv_attrs" : null,
    attrsBindings: new Set(),
    slotsBindings: new Set(),
    consts: new Map(),
    sid: null,
    opaque: null,
    plugins: new Map(),
  };
  for (const p of ctx.plugins) if (p.scope) scope.plugins.set(p, p.scope(scope));
  const evaluable = (local: string, d: Declared, why: string): void => {
    try {
      scope.consts.set(local, constOfDecl(d));
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      scope.clientOnly.set(local, `${why}: ${e.message.split("\n")[0]!}`);
    }
  };
  const locals = declareConsts(comp, ast);
  const lets: string[] = [];
  const asyncs = asyncChildren(comp, ast);
  let useAttrsName: string | null = null;
  let useSlotsName: string | null = null;
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
        const file = resolveImport(comp.file, from);
        const decls = file !== null ? ctx.constDecls.get(file) : undefined;
        for (const sp of decls && st.importKind !== "type" ? st.specifiers : []) {
          const d = sp.type === "ImportSpecifier" && sp.importKind !== "type" ? decls!.get(sp.imported.name ?? sp.imported.value) : undefined;
          if (d?.exported) evaluable(sp.local.name, d, `it is imported from ${d.home.file}, where it is not a constant the compiler evaluates`);
        }
      }
      continue;
    }
    if (st.type === "FunctionDeclaration") {
      if (st.id) scope.clientOnly.set(st.id.name, "it is a function, which only an event handler may call");
      continue;
    }
    const decl = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (decl?.type === "TSInterfaceDeclaration" || decl?.type === "TSTypeAliasDeclaration") continue;
    if (decl?.type === "TSEnumDeclaration") {
      evaluable(decl.id.name, locals.get(decl.id.name)!, "it is not an enum the compiler evaluates");
      continue;
    }
    if (st.type === "ExpressionStatement") {
      if (!ctx.plugins.some((p) => p.scriptStatement?.(scope, st))) setupStatement(comp, st);
      continue;
    }
    if (st.type !== "VariableDeclaration") fail(comp, "FV0107", `\`${st.type}\` in setup is not supported`, st);
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
      const source = setupSource(init0);
      const isRef = init0.type === "CallExpression" && init0.callee.type === "Identifier" && ["ref", "shallowRef", "computed"].includes(init0.callee.name);
      if (isRef) scope.refs.add(local);
      let v: Val;
      try {
        const empty = emptyRef(comp, init0);
        if (!empty && !source) {
          scope.clientOnly.set(local, "it is not a value the server computes: only `ref(…)`, `computed(() => …)` and plain expressions are");
          continue;
        }
        v = empty ?? expr(scope, source);
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
        scope.clientOnly.set(local, e.message.replace(/^[^:]*: /, ""));
        continue;
      }
      if (nothing(v.ty) || (v.ty.k === "str" && known(v) !== undefined)) {
        scope.setup.set(local, v);
        continue;
      }
      const name = `s_${snake(local).replace(/^r#/, "")}`;
      const lone = v.lone ? { lone: true } : {};
      if (v.ty.k === "list" && v.iter !== undefined) {
        lets.push(`let ${name} = ${collected(v)};`);
        scope.setup.set(local, heldList(name, v.ty.of, v.lone));
        continue;
      }
      if (v.held !== undefined) {
        lets.push(`let ${name} = ${v.held};`);
        scope.setup.set(local, { code: `${name}.as_deref()`, ty: v.ty, ...lone });
        continue;
      }
      if (v.ty.k === "int" && v.f64 !== undefined && (v.code.endsWith(" as i64") || Object.is(v.num, -0))) {
        lets.push(`let ${name} = ${bare(v.f64)};`);
        scope.setup.set(local, { ...intFromF64(name), ...lone, ...(v.num !== undefined ? { num: v.num } : {}), ...(v.konst !== undefined ? { konst: v.konst } : {}) });
        continue;
      }
      if (isTemporary(v)) {
        lets.push(`let ${name} = ${heldStr(v)};`);
        scope.setup.set(local, { code: `&*${name}`, ty: v.ty, ...lone });
        continue;
      }
      const place = v.ty.k === "list" || v.ty.k === "record" || v.ty.k === "struct" || v.ty.k === "child";
      lets.push(`let ${name} = ${place ? `&${operand(v.code, UNARY)}` : bare(v.code)};`);
      scope.setup.set(local, { code: name, ty: v.ty, ...lone, ...(v.konst !== undefined ? { konst: v.konst } : {}) });
    }
  }
  return { scope, lets };
}
