import { basename } from "node:path";
import { type Component, type N, type Scope, type Val, fail, GenError, snake, takesAttrs } from "./model.ts";
import { CONFIG_FILE, ctx } from "./context.ts";
import { definePropsType } from "./typescript.ts";
import { expr, fieldVal } from "./expr.ts";
import { collected, heldList } from "./lists.ts";
import { bare, operand, UNARY } from "./parens.ts";

export const CLIENT_HOOKS = new Set([
  "onMounted", "onBeforeMount", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeUpdate",
  "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered",
]);

export const INERT_CALLS = new Set(["defineEmits", "defineSlots", "defineOptions", "defineExpose", "defineProps", "withDefaults", "provide"]);

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
    fail(comp, "`watch` with `immediate` runs on the server, where its effect is not translated", st);
  }
  if (name === "watchEffect" || name === "watchSyncEffect" || name === "watchPostEffect") {
    fail(comp, `\`${name}\` runs once on the server, where its effect is not translated; use \`watch\` or \`onMounted\``, st);
  }
  if (name === "onServerPrefetch") fail(comp, "`onServerPrefetch` fetches on the server; pass the data in as props instead", st);
  fail(comp, `\`${st.expression?.type === "CallExpression" ? `${name ?? "a call"}()` : st.expression?.type}\` in setup could change what renders, and is not translated`, st);
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

export function scopeFor(comp: Component, ast: N[], components: Map<string, Component>): { scope: Scope; lets: string[] } {
  const scope: Scope = {
    comp,
    components,
    setup: new Map(),
    children: new Map(),
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
    sid: null,
    plugins: new Map(),
  };
  for (const p of ctx.plugins) if (p.scope) scope.plugins.set(p, p.scope(scope));
  const lets: string[] = [];
  let useAttrsName: string | null = null;
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
          if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "useAttrs") useAttrsName = sp.local.name;
        }
      } else if (ctx.helperModule !== null && from === ctx.helperModule) {
        for (const sp of st.specifiers) {
          if (!ctx.helpers[sp.imported.name]) fail(comp, `\`${sp.imported.name}\` has no Rust twin: add it to \`helpers.functions\` in ${CONFIG_FILE}`, sp);
          scope.helpers.set(sp.local.name, sp.imported.name);
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
    if (st.type === "ExpressionStatement") {
      setupStatement(comp, st);
      continue;
    }
    if (st.type !== "VariableDeclaration") fail(comp, `\`${st.type}\` in setup is not supported`, st);
    for (const d of st.declarations) {
      const init0 = d.init;
      if (d.id.type === "ObjectPattern" && definePropsType(init0)) {
        for (const p of d.id.properties) {
          if (p.type !== "ObjectProperty" || p.computed) fail(comp, "destructured props are plain names: `...rest` has no Rust type", p);
          const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
          const local = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
          if (local.type !== "Identifier") fail(comp, "destructured props are plain names", p);
          scope.setup.set(local.name, fieldVal(comp, "props", { k: "struct", name: "Props" }, key, p));
        }
        continue;
      }
      if (ctx.plugins.some((p) => p.scriptBinding?.(scope, d))) continue;
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
      if (!source) {
        scope.clientOnly.set(local, "it is not a value the server computes: only `ref(…)`, `computed(() => …)` and plain expressions are");
        continue;
      }
      let v: Val;
      try {
        v = expr(scope, source);
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
        scope.clientOnly.set(local, e.message.replace(/^[^:]*: /, ""));
        continue;
      }
      if (v.ty.k === "undef") {
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
      const place = v.ty.k === "list" || v.ty.k === "record" || v.ty.k === "struct" || v.ty.k === "child";
      lets.push(`let ${name} = ${place ? `&${operand(v.code, UNARY)}` : bare(v.code)};`);
      scope.setup.set(local, { code: name, ty: v.ty, ...lone, ...(v.konst !== undefined ? { konst: v.konst } : {}) });
    }
  }
  return { scope, lets };
}
