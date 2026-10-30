import { type N, type Scope, type Ty, fail, nodeName, patternNames } from "./model.ts";

export const CLIENT_HOOKS = new Set([
  "onMounted", "onBeforeMount", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeUpdate",
  "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered",
]);

export const INERT_CALLS = new Set(["defineEmits", "defineSlots", "defineOptions", "defineExpose", "defineProps", "withDefaults"]);

const EFFECTS = new Set(["watchEffect", "watchSyncEffect", "watchPostEffect"]);

const LAZY = new Set(["computed", "watch", ...CLIENT_HOOKS, ...INERT_CALLS]);

const VUE_PURE = new Set([
  "ref", "shallowRef", "reactive", "shallowReactive", "readonly", "shallowReadonly", "toRef", "toRefs", "toRaw", "markRaw", "unref",
  "isRef", "isReactive", "isReadonly", "isProxy", "isShallow", "useTemplateRef", "useId", "useAttrs", "useSlots", "useCssModule",
  "getCurrentInstance", "inject", "defineModel", "h", "defineComponent",
]);

const GLOBAL_PURE = new Set([
  "String", "Number", "Boolean", "BigInt", "Symbol", "Date", "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "structuredClone", "Map", "Set", "WeakMap", "WeakSet",
  "URL", "URLSearchParams", "RegExp", "Error", "Array",
]);

const NAMESPACE_PURE: Record<string, Set<string> | "all"> = {
  Math: "all",
  JSON: "all",
  Number: "all",
  String: "all",
  Intl: "all",
  console: "all",
  Date: new Set(["now", "parse", "UTC"]),
  Array: new Set(["isArray", "from", "of"]),
  Object: new Set(["keys", "values", "entries", "fromEntries", "freeze", "isFrozen", "is", "getPrototypeOf", "getOwnPropertyNames", "hasOwn"]),
};

const READING_METHODS = new Set([
  "at", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "entries", "every", "filter", "find", "findIndex", "findLast",
  "findLastIndex", "flat", "flatMap", "forEach", "get", "has", "includes", "indexOf", "join", "keys", "lastIndexOf", "localeCompare",
  "map", "match", "matchAll", "normalize", "padEnd", "padStart", "reduce", "reduceRight", "repeat", "replace", "replaceAll", "search",
  "slice", "some", "split", "startsWith", "substring", "toExponential", "toFixed", "toISOString", "toJSON", "toLocaleString",
  "toLowerCase", "toPrecision", "toReversed", "toSorted", "toSpliced", "toString", "toUpperCase", "trim", "trimEnd", "trimStart",
  "valueOf", "values", "with",
]);

const FRESH_METHODS = new Set([
  "concat", "filter", "flat", "flatMap", "map", "slice", "split", "toReversed", "toSorted", "toSpliced", "with", "keys", "values", "entries",
]);

const DEFERRING = new Set(["setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback"]);

const DEFERRING_METHODS = new Set(["addEventListener", "removeEventListener"]);

const ELEMENT_TYPE = /^(?:Element|HTML\w*Element|SVG\w*Element|ComponentPublicInstance|InstanceType)$/;

const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

const SKIPPED_KEYS = new Set(["type", "start", "end", "loc", "extra", "range", "typeAnnotation", "typeParameters", "typeArguments", "returnType", "leadingComments", "trailingComments", "innerComments"]);

/** The names `<script setup>` binds at its top level, with those that hold a reference to an
 * element, which setup cannot write through. */
export interface SetupNames {
  bound: Set<string>;
  elements: Set<string>;
  byPlugins: Set<string>;
}

function elementRef(init: N): boolean {
  while (init?.type === "TSAsExpression" || init?.type === "TSNonNullExpression") init = init.expression;
  if (init?.type !== "CallExpression" || init.callee.type !== "Identifier") return false;
  if (init.callee.name === "useTemplateRef") return true;
  const typed = init.typeParameters?.params?.[0];
  const named = typed?.type === "TSUnionType" ? typed.types.find((t: N) => t.type === "TSTypeReference") : typed;
  return ["ref", "shallowRef"].includes(init.callee.name) && named?.type === "TSTypeReference" && named.typeName.type === "Identifier" && ELEMENT_TYPE.test(named.typeName.name);
}

export function setupNames(ast: N[]): SetupNames {
  const bound = new Set<string>();
  const elements = new Set<string>();
  for (const st of ast) {
    const decl = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (decl?.type === "FunctionDeclaration" && decl.id) bound.add(decl.id.name);
    if (decl?.type !== "VariableDeclaration") continue;
    for (const d of decl.declarations) {
      for (const name of patternNames(d.id)) bound.add(name);
      if (d.id.type === "Identifier" && elementRef(d.init)) elements.add(d.id.name);
    }
  }
  return { bound, elements, byPlugins: new Set() };
}

interface Frame {
  declared: Set<string>;
  params: Set<string>;
  given: boolean;
}

interface Check {
  scope: Scope;
  names: SetupNames;
  local: string;
  frames: Frame[];
  entered: Set<N>;
  via: { call: N; name: string } | null;
}

function scalar(ty: Ty | undefined): boolean {
  if (ty === undefined) return false;
  if (ty.k === "opt") return scalar(ty.of);
  return ty.k === "str" || ty.k === "int" || ty.k === "float" || ty.k === "bool" || ty.k === "null" || ty.k === "undef";
}

function own(c: Check, name: string): Frame | undefined {
  return c.frames.findLast((f) => f.declared.has(name) || f.params.has(name));
}

function param(c: Check, name: string): boolean {
  const frame = own(c, name);
  return frame !== undefined && !frame.declared.has(name);
}

function stateful(c: Check, name: string): boolean {
  const { scope, names } = c;
  const frame = own(c, name);
  if (frame !== undefined) return frame.given && !frame.declared.has(name);
  if (name === scope.propsIdent || names.elements.has(name)) return false;
  const constant = scope.consts.get(name);
  if (constant !== undefined) return constant.k !== "scalar";
  if (!names.bound.has(name)) return false;
  return !(scalar(scope.setup.get(name)?.ty) && !scope.refs.has(name));
}

function unwrapped(n: N): N {
  while (n && ["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "ParenthesizedExpression"].includes(n.type)) n = n.expression;
  return n;
}

function rootOf(n: N): N {
  n = unwrapped(n);
  while (n?.type === "MemberExpression" || n?.type === "OptionalMemberExpression") n = unwrapped(n.object);
  return n;
}

function declaredIn(fn: N, given: boolean): Frame {
  const params = new Set<string>(fn.params?.flatMap((p: N) => patternNames(p.type === "TSParameterProperty" ? p.parameter : p)) ?? []);
  const declared = new Set<string>();
  const visit = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    if (n.type === "VariableDeclarator") for (const name of patternNames(n.id)) declared.add(name);
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) declared.add(n.id.name);
    if (n.type === "CatchClause" && n.param) for (const name of patternNames(n.param)) declared.add(name);
    if (FUNCTIONS.has(n.type) && n !== fn) return;
    for (const [key, v] of Object.entries(n)) if (!SKIPPED_KEYS.has(key) && v && typeof v === "object") visit(v);
  };
  visit(fn.body);
  return { declared, params, given };
}

function scalarRead(c: Check, n: N): boolean {
  if (n.type !== "MemberExpression" || n.computed) return false;
  if (n.property.name === "length") return true;
  if (n.property.name !== "value" || n.object.type !== "Identifier") return false;
  const name: string = n.object.name;
  return own(c, name) === undefined && c.scope.refs.has(name) && scalar(c.scope.setup.get(name)?.ty);
}

function mentions(c: Check, n: N): boolean {
  if (!n || typeof n !== "object") return false;
  if (Array.isArray(n)) return n.some((x) => mentions(c, x));
  if (n.type === "Identifier") return stateful(c, n.name);
  if (scalarRead(c, n)) return false;
  if (FUNCTIONS.has(n.type)) {
    c.frames.push(declaredIn(n, false));
    try {
      return mentions(c, n.body);
    } finally {
      c.frames.pop();
    }
  }
  for (const [key, v] of Object.entries(n)) {
    if (SKIPPED_KEYS.has(key) || !v || typeof v !== "object") continue;
    if (key === "property" && !n.computed && (n.type === "MemberExpression" || n.type === "OptionalMemberExpression")) continue;
    if (key === "key" && !n.computed && (n.type === "ObjectProperty" || n.type === "ObjectMethod")) continue;
    if (key === "label") continue;
    if (mentions(c, v)) return true;
  }
  return false;
}

function refuse(c: Check, what: string, at: N): never {
  const shown = c.via === null ? what : `\`${c.via.name}()\`, which runs ${what.replace(/,$/, "")},`;
  return fail(
    c.scope.comp,
    "FV0105",
    `${shown} in the initial value of \`${c.local}\` runs during setup on the server, where it could change what renders, and is not translated; move it into \`onMounted\` or an event handler, or write the value as a \`computed\``,
    c.via?.call ?? at,
  );
}

function written(c: Check, target: N, at: N, what: string): void {
  const t = unwrapped(target);
  if (t?.type === "Identifier" && own(c, t.name) !== undefined) return;
  const root = rootOf(t);
  if (t?.type !== "Identifier" && root?.type === "Identifier" && own(c, root.name)?.declared.has(root.name)) return;
  refuse(c, what, at);
}

function runBody(c: Check, fn: N, given: boolean): void {
  if (c.entered.has(fn)) return;
  c.entered.add(fn);
  c.frames.push(declaredIn(fn, given));
  try {
    for (const p of fn.params ?? []) run(c, p);
    run(c, fn.body);
  } finally {
    c.frames.pop();
    c.entered.delete(fn);
  }
}

function setupFunction(c: Check, n: N): N | undefined {
  const u = unwrapped(n);
  return u?.type === "Identifier" && own(c, u.name) === undefined ? c.scope.functions.get(u.name)?.node : undefined;
}

function runFunction(c: Check, call: N, name: string, fn: N, given: boolean): void {
  const outer = c.via;
  c.via ??= { call, name };
  try {
    runBody(c, fn, given);
  } finally {
    c.via = outer;
  }
}

function callbacks(c: Check, call: N, args: N[]): void {
  for (const a of args) {
    const u = unwrapped(a);
    if (FUNCTIONS.has(u?.type)) runBody(c, u, false);
    const fn = setupFunction(c, u);
    if (fn !== undefined) runFunction(c, call, u.name, fn, false);
  }
}

function passed(c: Check, call: N, args: N[], shown: string): void {
  callbacks(c, call, args);
  const values = args.filter((a) => !FUNCTIONS.has(unwrapped(a)?.type) && setupFunction(c, a) === undefined);
  if (mentions(c, values)) refuse(c, `${shown}, given a value of setup,`, call);
}

function immediate(options: N): boolean {
  return options?.type === "ObjectExpression" && options.properties.some(
    (p: N) => p.type === "ObjectProperty" && (p.key.name ?? p.key.value) === "immediate" && !(p.value.type === "BooleanLiteral" && !p.value.value),
  );
}

function knownCall(c: Check, n: N, name: string): boolean {
  const args: N[] = n.arguments ?? [];
  if (EFFECTS.has(name)) fail(c.scope.comp, "FV0103", `\`${name}\` in the initial value of \`${c.local}\` runs once on the server, where its effect is not translated; use \`watch\` or \`onMounted\``, n);
  if (name === "onServerPrefetch") fail(c.scope.comp, "FV0104", "`onServerPrefetch` fetches on the server; pass the data in as props instead", n);
  if (name === "watch" && immediate(args[2])) fail(c.scope.comp, "FV0102", "`watch` with `immediate` runs on the server, where its effect is not translated", n);
  if (LAZY.has(name) || DEFERRING.has(name)) return true;
  if (VUE_PURE.has(name)) {
    if (name === "inject" && args[2]?.type === "BooleanLiteral" && args[2].value) callbacks(c, n, [args[1]]);
    return true;
  }
  if (!GLOBAL_PURE.has(name)) return false;
  callbacks(c, n, args);
  return true;
}

function callOfName(c: Check, n: N, name: string): void {
  const args: N[] = n.arguments ?? [];
  const local = own(c, name) !== undefined;
  if (!local && !c.names.bound.has(name) && knownCall(c, n, name)) return;
  if (!local && c.scope.helpers.has(name)) return callbacks(c, n, args);
  const fn = local ? undefined : c.scope.functions.get(name);
  if (fn !== undefined) {
    callbacks(c, n, args);
    return runFunction(c, n, name, fn.node, mentions(c, args));
  }
  if (!local && c.names.bound.has(name) && !c.names.byPlugins.has(name)) refuse(c, `\`${name}()\``, n);
  passed(c, n, args, `\`${name}()\``);
}

function namespaced(c: Check, callee: N): boolean {
  const object = unwrapped(callee.object);
  if (object?.type !== "Identifier" || callee.computed || c.names.bound.has(object.name) || own(c, object.name) !== undefined) return false;
  const pure = NAMESPACE_PURE[object.name];
  return pure === "all" || (pure !== undefined && pure.has(callee.property.name));
}

function fresh(c: Check, n: N): boolean {
  const u = unwrapped(n);
  if (["ArrayExpression", "ObjectExpression", "NewExpression", "StringLiteral", "TemplateLiteral", "NumericLiteral"].includes(u?.type)) return true;
  const callee = u?.type === "CallExpression" || u?.type === "OptionalCallExpression" ? unwrapped(u.callee) : null;
  if (callee?.type !== "MemberExpression" && callee?.type !== "OptionalMemberExpression") return false;
  return namespaced(c, callee) || (!callee.computed && FRESH_METHODS.has(callee.property.name));
}

function callOfMember(c: Check, n: N, callee: N): void {
  const args: N[] = n.arguments ?? [];
  run(c, callee.object);
  const method: string | undefined = callee.computed ? undefined : callee.property.name;
  if (namespaced(c, callee) || (method !== undefined && READING_METHODS.has(method)) || fresh(c, callee.object)) return callbacks(c, n, args);
  if (method !== undefined && DEFERRING_METHODS.has(method)) return;
  const shown = method === undefined ? "a call" : `\`${method}()\``;
  const root = rootOf(callee.object);
  if (root?.type === "Identifier" && own(c, root.name)?.declared.has(root.name)) return callbacks(c, n, args);
  if ((root?.type === "Identifier" && param(c, root.name)) || mentions(c, callee.object)) refuse(c, `${shown} of a value of setup`, n);
  passed(c, n, args, shown);
}

function invoked(c: Check, n: N): void {
  const args: N[] = n.arguments ?? [];
  for (const a of args) run(c, a);
  if (n.type === "TaggedTemplateExpression") run(c, n.quasi);
  const callee = unwrapped(n.type === "TaggedTemplateExpression" ? n.tag : n.callee);
  if (callee?.type === "Identifier") return callOfName(c, n, callee.name);
  if (callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") return callOfMember(c, n, callee);
  if (FUNCTIONS.has(callee?.type)) {
    callbacks(c, n, args);
    return runBody(c, callee, mentions(c, args));
  }
  run(c, callee);
  passed(c, n, args, "a call");
}

function run(c: Check, n: N): void {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) {
    for (const x of n) run(c, x);
    return;
  }
  if (FUNCTIONS.has(n.type) || n.type === "ClassDeclaration" || n.type === "ClassExpression") return;
  switch (n.type) {
    case "AssignmentExpression":
      run(c, n.right);
      if (n.left.type === "MemberExpression" || n.left.type === "OptionalMemberExpression") run(c, n.left.object);
      return written(c, n.left, n, "an assignment");
    case "UpdateExpression":
      return written(c, n.argument, n, nodeName(n));
    case "UnaryExpression":
      if (n.operator === "delete") written(c, n.argument, n, "`delete`");
      return run(c, n.argument);
    case "CallExpression":
    case "OptionalCallExpression":
    case "NewExpression":
    case "TaggedTemplateExpression":
      return invoked(c, n);
    default:
      for (const [key, v] of Object.entries(n)) if (!SKIPPED_KEYS.has(key) && v && typeof v === "object") run(c, v);
  }
}

/** Refuse the initial value of a setup binding the server does not compute when running it could
 * write state the template reads: an assignment, `++`, a call of a function of setup, a call given
 * state of setup, or an effect Vue runs on the server. */
export function refuseServerWrites(scope: Scope, names: SetupNames, local: string, init: N): void {
  run({ scope, names, local, frames: [], entered: new Set(), via: null }, init);
}
