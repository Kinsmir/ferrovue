/* `<script setup>` read: what the server evaluates, and what stays on the client. */

import { basename } from "node:path";
import { type Component, type N, type Scope, type Val, fail, GenError, snake, STR } from "./model.ts";
import { type Store, CONFIG_FILE, ctx } from "./context.ts";
import { definePropsType } from "./typescript.ts";
import { expr, fieldVal, storeGetter, theRoute } from "./expr.ts";
import { storeImport } from "./stores.ts";
import { bare, operand, UNARY } from "./parens.ts";

/** Lifecycle hooks, which never run on the server: setup may register them freely. */
export const CLIENT_HOOKS = new Set([
  "onMounted", "onBeforeMount", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeUpdate",
  "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered",
]);

/** Compiler macros and calls with no effect on the server's render. */
export const INERT_CALLS = new Set(["defineEmits", "defineSlots", "defineOptions", "defineExpose", "defineProps", "withDefaults", "provide"]);

/** A statement in setup that is a call on its own: allowed only when it cannot change the render. */
export function setupStatement(comp: Component, st: N): void {
  const c = st.expression;
  const name = c?.type === "CallExpression" && c.callee.type === "Identifier" ? (c.callee.name as string) : null;
  if (name !== null && (CLIENT_HOOKS.has(name) || INERT_CALLS.has(name))) return;
  if (name === "watch") {
    // A watcher's callback runs on the server only with `immediate`, and could then change state.
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

/** What a setup binding's value is computed from: `ref(x)` and `shallowRef(x)` hold `x`,
 * `computed(() => x)` is `x`, and a plain `const y = x` is `x`. */
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

/** The names a destructuring pattern binds. */
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
    router: new Map(),
    directives: new Map(),
    i18nT: new Set(),
    fill: false,
    vnode: false,
  };
  const lets: string[] = [];
  const storeHooks = new Map<string, Store>();
  let storeToRefsName: string | null = null;
  let useRouteName: string | null = null;
  let useI18nName: string | null = null;
  /** Setup bindings holding a store, by name. */
  const storeValues = new Map<string, Store>();
  for (const st of ast) {
    if (st.type === "ImportDeclaration") {
      const from: string = st.source.value;
      if (from.endsWith(".vue")) {
        const def = st.specifiers.find((x: N) => x.type === "ImportDefaultSpecifier");
        if (def) scope.children.set(def.local.name, basename(from, ".vue"));
      } else if (storeImport(comp, from)) {
        for (const sp of st.specifiers) {
          const hook = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
          // A type from the store's file, which `readComponent` has already resolved.
          if (st.importKind === "type" || sp.importKind === "type" || (hook !== null && ctx.storeStructs.has(hook))) continue;
          const store = hook ? ctx.stores.get(hook) : undefined;
          if (!store || store.module !== storeImport(comp, from)) fail(comp, "import a store by its `use…` hook", sp);
          storeHooks.set(sp.local.name, store);
        }
      } else if (from === "vue-router") {
        for (const sp of st.specifiers) {
          const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
          if (name === "useRoute") useRouteName = sp.local.name;
          else if (name === "RouterLink" || name === "RouterView") scope.router.set(sp.local.name, name);
          else scope.clientOnly.set(sp.local.name, `\`${name}\` from vue-router does not run on the server`);
        }
      } else if (from === "vue-i18n") {
        for (const sp of st.specifiers) {
          const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
          if (name === "useI18n") useI18nName = sp.local.name;
          else scope.clientOnly.set(sp.local.name, `\`${name}\` from vue-i18n does not run on the server`);
        }
      } else if (from === "pinia") {
        for (const sp of st.specifiers) {
          const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
          if (name === "storeToRefs") storeToRefsName = sp.local.name;
          else scope.clientOnly.set(sp.local.name, `\`${name}\` from Pinia does not run on the server`);
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
    // Setup runs on the server too, so a statement there can change what renders: `x.value = ...`
    // after a `ref`, an `if`, a loop. None of it is translated, so none of it may exist.
    if (st.type !== "VariableDeclaration") fail(comp, `\`${st.type}\` in setup is not supported`, st);
    for (const d of st.declarations) {
      const init0 = d.init;
      // `const { size = "md", label: l } = defineProps<...>()`: each name reads that prop, whose
      // default `compileScript` already resolved.
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
      const calls = (name: string | null) =>
        name !== null && init0?.type === "CallExpression" && init0.callee.type === "Identifier" && init0.callee.name === name;
      // `const { t, locale } = useI18n()`: \`t\` translates, \`locale\` is the request's locale.
      if (d.id.type === "ObjectPattern" && calls(useI18nName)) {
        for (const p of d.id.properties) {
          if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
            fail(comp, "`useI18n()` is destructured into plain names", p);
          }
          const key: string = p.key.name ?? p.key.value;
          if (key === "t") scope.i18nT.add(p.value.name);
          else if (key === "locale") {
            scope.setup.set(p.value.name, { code: "fv_i18n.locale()", ty: STR });
            scope.refs.add(p.value.name);
          } else scope.clientOnly.set(p.value.name, `\`${key}\` from \`useI18n()\` does not run on the server`);
        }
        comp.readsI18n = true;
        continue;
      }
      // `const { density, label: l } = storeToRefs(prefs)`: each name is that field of the state.
      if (d.id.type === "ObjectPattern" && calls(storeToRefsName)) {
        const arg = init0.arguments[0];
        const store = arg?.type === "Identifier" ? storeValues.get(arg.name) : undefined;
        if (!store || init0.arguments.length !== 1) fail(comp, "`storeToRefs` takes a store bound in this setup", d);
        for (const p of d.id.properties) {
          if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
            fail(comp, "`storeToRefs` is destructured into plain names", p);
          }
          const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
          const state: Val = { code: `fv_stores.${store.field}`, ty: { k: "struct", name: store.state, store: true } };
          scope.setup.set(p.value.name, storeGetter(scope, state, key, p) ?? fieldVal(comp, state.code, state.ty, key, p));
          scope.refs.add(p.value.name);
        }
        comp.readsStores = true;
        continue;
      }
      if (d.id.type !== "Identifier") {
        // Destructuring anything else: client-side state the template may not read.
        for (const name of patternNames(d.id)) scope.clientOnly.set(name, "it is destructured from a value the server does not have");
        continue;
      }
      const local: string = d.id.name;
      // `const prefs = usePrefs()`: the store's state, as the server was given it.
      const hook = init0?.type === "CallExpression" && init0.callee.type === "Identifier" ? storeHooks.get(init0.callee.name) : undefined;
      if (hook) {
        if (init0.arguments.length) fail(comp, "a store hook takes no arguments", d);
        storeValues.set(local, hook);
        scope.setup.set(local, { code: `fv_stores.${hook.field}`, ty: { k: "struct", name: hook.state, store: true } });
        comp.readsStores = true;
        continue;
      }
      // `const route = useRoute()`: the reader's location.
      if (useRouteName !== null && init0?.type === "CallExpression" && init0.callee.type === "Identifier" && init0.callee.name === useRouteName) {
        scope.setup.set(local, theRoute(scope, d));
        continue;
      }
      // `const model = defineModel<string>()`: the model's prop.
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
      // Evaluated once, as setup is on the server. A value the server cannot evaluate is client-side
      // state — a template ref, an element, a `reactive` object — which the template may still name
      // from an event handler; a reference the server needs fails in `expr` with this reason.
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
      // A list or an object is a place in the props: borrowed, never moved out of them.
      const place = v.ty.k === "list" || v.ty.k === "struct" || v.ty.k === "child";
      lets.push(`let ${name} = ${place ? `&${operand(v.code, UNARY)}` : bare(v.code)};`);
      scope.setup.set(local, { code: name, ty: v.ty, ...(v.konst !== undefined ? { konst: v.konst } : {}) });
    }
  }
  return { scope, lets };
}
