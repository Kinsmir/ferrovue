/* Expressions translated to Rust, each with the type it evaluates to. */

import { type Component, type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, GenError, INT, opt, rustStr, sameTy, snake, STR, UNDEF } from "./model.ts";
import { CONFIG_FILE, ctx } from "./context.ts";
import { lookupStruct, markHome } from "./typescript.ts";
import { translate } from "./i18n.ts";
import { collected, computed, computedListMethod, items, listMethod, objectCall } from "./lists.ts";

/** The refusal for a string that may hold half of a surrogate pair, used where that half matters. */
export function lonely(what: string): string {
  return `${what} with a string that may hold half of a surrogate pair (cut by \`slice\`, \`substring\`, \`at\`, \`charAt\`, \`split("")\` and the like): JavaScript keeps the half, which can match, order or join with another where ferrovue holds U+FFFD`;
}

/** Two strings meeting, where a half of a surrogate pair — which ferrovue holds as U+FFFD — would
 * change the result:
 * - `equal`: two halves may differ, and a half never equals a literal U+FFFD;
 * - `order`: a half orders as a surrogate, below U+E000, where U+FFFD orders above — the same only
 *   against a literal of characters below U+D800, which both order after;
 * - `search`: a half searched for (`b`) matches half of a whole pair in `a`;
 * - `join`: two halves side by side join into one character.
 * A string holding U+FFFD in the data still equals, or is found in, a half: README, "Strings". */
export function meet(comp: Component, a: Val, b: Val, what: string, n: N, how: "equal" | "order" | "search" | "join"): void {
  const literal = (v: Val) => v.code.startsWith('"');
  const fffd = (v: Val) => literal(v) && v.code.includes("\u{FFFD}");
  const low = (v: Val) => literal(v) && !/[\u{D800}-\u{10FFFF}]/u.test(v.code);
  const refused =
    how === "order" ? (a.lone && !low(b)) || (b.lone && !low(a))
    : how === "join" ? a.lone && b.lone
    : how === "search" ? b.lone || (a.lone && fffd(b))
    : (a.lone && b.lone) || (a.lone && fffd(b)) || (b.lone && fffd(a));
  if (refused) fail(comp, lonely(what), n);
}

/** `lone` for a value built from these: whether any of them may hold half of a surrogate pair. */
function loneOf(...vs: (Val | undefined)[]): { lone?: true } {
  return vs.some((v) => v?.lone) ? { lone: true } : {};
}

/** Whether a string is a non-empty literal: a separator that always parts what it joins. */
function nonEmptyLiteral(v: Val): boolean {
  return /^"[^"]/.test(v.code);
}

/** Whether a string expression borrows from a temporary it builds — \`&*format!(…)\`, a call that
 * returns a \`String\` — rather than from the props or the state. Such a borrow ends with the block
 * it is in, so a branch of \`?:\` or \`||\` must hand back the string itself. */
export function isTemporary(v: Val): boolean {
  if (v.ty.k !== "str") return false;
  // A trim borrows from its argument, so it is a temporary when that is.
  const trimmed = /^fv::js_trim(?:_start|_end)?\(([^]*)\)$/.exec(v.code);
  if (trimmed?.[1] !== undefined) return isTemporary({ code: trimmed[1], ty: v.ty });
  return /^&\*(format!|fv::|fv_i18n\.|\(|\{)/.test(v.code);
}

/** A string as a \`Cow\`: borrowed when it lives on, owned when it is a temporary. The \`Cow\` is
 * itself a temporary of the whole statement, so the \`&str\` taken from it lives to its end. */
function asCow(v: Val): string {
  return isTemporary(v) ? `std::borrow::Cow::<str>::Owned((${v.code}).to_owned())` : `std::borrow::Cow::<str>::Borrowed(${v.code})`;
}

/** Whether a value is a JavaScript number: an integer or a fraction. */
export function isNumber(ty: Ty): boolean {
  return ty.k === "int" || ty.k === "float";
}

/** A number as an `f64`, as JavaScript holds every number. */
export function asF64(v: Val): string {
  if (v.f64 !== undefined) return v.f64;
  return v.ty.k === "float" ? `(${v.code})` : `((${v.code}) as f64)`;
}

/** An integer computed on doubles, as JavaScript computes it: the \`i64\` and the double it came from. */
function intFromF64(f64: string): Val {
  return { code: `(${f64} as i64)`, ty: INT, f64 };
}

/** A type as an error names it. */
export function describeTy(ty: Ty): string {
  switch (ty.k) {
    case "str":
      return "a string";
    case "int":
      return "a number";
    case "float":
      return "a number";
    case "bool":
      return "a boolean";
    case "list":
      return "a list";
    case "record":
      return "a record";
    case "struct":
    case "child":
      return "an object";
    case "opt":
      return `an optional ${describeTy(ty.of).replace(/^an? /, "")}`;
    case "undef":
      return "`undefined`";
    case "query":
      return "a query value";
    default:
      return "a value of another kind";
  }
}

export function fieldVal(comp: Component, base: string, ty: Ty, js: string, node: N): Val {
  if (ty.k !== "struct") fail(comp, `\`.${js}\` on a value that is not an object`, node);
  const { st, owner } = lookupStruct(comp, ty);
  const found = st?.fields.find((x) => x.js === js);
  if (!found) fail(comp, `\`${ty.name}\` has no field \`${js}\``, node);
  // A field of a type another component declares names that component's types.
  const f = owner === comp ? found : { ...found, ty: markHome(found.ty, owner.name) };
  // A scoped slot's props already hold borrows and copies: each field is read as it is.
  if (st!.slot) return { code: `${base}.${f.rust}`, ty: f.ty };
  const place = `${base}.${f.rust}`;
  if (f.dflt !== undefined && f.ty.k === "opt") {
    const of = f.ty.of;
    if (of.k === "str") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: STR };
    if (of.k === "list") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: of };
    return { code: `${place}.unwrap_or(${f.dflt})`, ty: of };
  }
  switch (f.ty.k) {
    case "str":
      return { code: `&*${place}`, ty: STR };
    case "html":
    case "child":
      return { code: `&${place}`, ty: f.ty };
    case "opt":
      if (f.ty.of.k === "html") return { code: `${place}.as_ref()`, ty: f.ty };
      if (f.ty.of.k === "str") return { code: `${place}.as_deref()`, ty: f.ty };
      if (f.ty.of.k === "int" || f.ty.of.k === "float" || f.ty.of.k === "bool") return { code: place, ty: f.ty };
      // An object or a list, borrowed: `Option<&T>`, which a `v-if` narrows to the `&T`.
      return { code: `${place}.as_ref()`, ty: f.ty };
    default:
      return { code: place, ty: f.ty };
  }
}

export function truthy(v: Val): string {
  switch (v.ty.k) {
    case "str":
      return `!(${v.code}).is_empty()`;
    case "int":
      return `(${v.code}) != 0`;
    // JavaScript's falsy numbers: 0, -0 and NaN.
    case "float":
      return `((${v.code}) != 0.0 && !(${v.code}).is_nan())`;
    case "bool":
      return `(${v.code})`;
    case "undef":
      return "false";
    case "query":
      return `(${v.code}).truthy()`;
    case "opt":
      return `(${v.code}).is_some_and(|v| ${truthy({ code: "v", ty: v.ty.of })})`;
    default:
      return "true";
  }
}

/** A value passed where `want` is expected: a present value into an optional slot is wrapped. */
export function coerce(comp: Component, v: Val, want: Ty, node: N): string {
  if (sameTy(v.ty, want)) return v.code;
  if (want.k === "opt" && v.ty.k === "undef") return "None";
  if (want.k === "opt" && sameTy(v.ty, want.of)) return `Some(${v.code})`;
  // An integer is a number too, where a fraction is expected.
  if (want.k === "float" && v.ty.k === "int") return asF64(v);
  if (want.k === "opt" && want.of.k === "float" && v.ty.k === "int") return `Some(${asF64(v)})`;
  return fail(comp, `a ${JSON.stringify(v.ty)} where ${JSON.stringify(want)} is expected`, node);
}

/** The JavaScript path an expression names — `$props.user`, `item.author.name` — or `null` when it
 * is not a plain chain of names. */
export function pathOf(n: N): string | null {
  if (n.type === "Identifier") return n.name;
  if (n.type !== "MemberExpression") return null;
  const base = pathOf(n.object);
  if (base === null) return null;
  if (!n.computed && n.property.type === "Identifier") return `${base}.${n.property.name}`;
  if (n.computed && n.property.type === "StringLiteral") return `${base}.${n.property.value}`;
  return null;
}

/** A test that an optional value is present, as TypeScript narrows on it: `x`, `x !== undefined`,
 * and, `negated`, `!x` and `x === undefined`, after which the value is present in the other branch. */
export interface Presence {
  path: string;
  /** The value bound where it is present, and its type there. */
  pattern: (name: string) => string;
  of: Ty;
  negated: boolean;
  /** Tested by truthiness, so the test itself is a boolean only when it is negated. */
  truthy: boolean;
}

export function presence(s: Scope, n: N): Presence | null {
  let target: N = n;
  let negated = false;
  let byTruth = true;
  if (n.type === "UnaryExpression" && n.operator === "!") {
    target = n.argument;
    negated = true;
  } else if (n.type === "BinaryExpression" && (n.operator === "===" || n.operator === "!==")) {
    const isUndef = (m: N) => m.type === "Identifier" && m.name === "undefined";
    if (isUndef(n.right)) target = n.left;
    else if (isUndef(n.left)) target = n.right;
    else return null;
    negated = n.operator === "===";
    byTruth = false;
  }
  const path = pathOf(target);
  if (path === null) return null;
  const v = expr(s, target);
  if (v.ty.k !== "opt") return null;
  const of: Ty = v.ty.of;
  // A truthiness test keeps JavaScript's: an empty string, a 0 and `false` are not taken — while an
  // object and a list, empty or not, always are.
  const scalar = of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool";
  const test = byTruth && scalar ? `(${v.code}).filter(|v| ${truthy({ code: "*v", ty: of })})` : v.code;
  return { path, of, negated, truthy: byTruth, pattern: (name) => `let Some(${name}) = ${test}` };
}

/** The scope with `p`'s value present, bound as `name`. */
export function narrowTo(s: Scope, p: Presence, name: string): Scope {
  return { ...s, narrowed: new Map(s.narrowed).set(p.path, { code: name, ty: p.of }) };
}

/** `if let Some(name) = … { then } else { otherwise }`, each branch translated in its own scope —
 * the value present in one of them — with `_` for a binding the branch never reads. */
function narrowing(s: Scope, p: Presence, present: (s: Scope) => string, absent: (s: Scope) => string): string {
  const name = `n${++ctx.narrowCount}`;
  const then = present(narrowTo(s, p, name));
  const otherwise = absent(s);
  const bound = new RegExp(`\\b${name}\\b`).test(then) ? name : "_";
  return `if ${p.pattern(bound)} { ${then} } else { ${otherwise} }`;
}

/* A test, as a Rust boolean. Only its truthiness is used, so `||`, `&&` and `!` combine the truthiness
 * of their operands whatever their types — where as a VALUE `a || b` is `a` or `b`, and stays held to
 * the stricter rules `expr` applies. `x && …` and `!x || …` read `x` present on the right. */
export function cond(s: Scope, n: N): string {
  if (n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&")) {
    const p = presence(s, n.left);
    if (p && p.negated === (n.operator === "||")) {
      return `(${narrowing(s, p, (inner) => cond(inner, n.right), () => String(n.operator === "||"))})`;
    }
    return `(${cond(s, n.left)} ${n.operator} ${cond(s, n.right)})`;
  }
  // Parenthesised: `truthy` of a number is `(x) != 0`, and a bare `!` would bind to `(x)` — which
  // in Rust is a bitwise NOT, not a negation of the test.
  if (n.type === "UnaryExpression" && n.operator === "!") return `!(${cond(s, n.argument)})`;
  const v = expr(s, n);
  return v.konst !== undefined ? String(v.konst) : truthy(v);
}

export function childOf(name: string): Component {
  const c = ctx.components.get(name);
  if (!c) throw new GenError(`\`Props\` is imported from ${name}.vue, which is not among the components compiled`);
  return c;
}

/** The reader's route, which the component then takes. */
export function theRoute(s: Scope, n: N): Val {
  if (!ctx.routes) fail(s.comp, `reading the route needs \`routes\` in ${CONFIG_FILE}`, n);
  s.comp.readsRoute = true;
  return { code: "fv_route", ty: { k: "route" } };
}

/** A field of the route: what `useRoute()` gives that the server knows as vue-router does. */
export function routeField(s: Scope, base: Val, prop: string, n: N): Val {
  if (base.ty.k === "params") {
    // Every parameter is a string; absent when the route has none of that name.
    return { code: `fv_route.param(${rustStr(prop)})`, ty: opt(STR) };
  }
  if (base.ty.k === "queryobj") return { code: `fv_route.query(${rustStr(prop)})`, ty: { k: "query" } };
  switch (prop) {
    case "path":
      return { code: "fv_route.path()", ty: STR };
    case "hash":
      return { code: "fv_route.hash()", ty: STR };
    case "name":
      return { code: "fv_route.name()", ty: opt(STR) };
    case "params":
      return { code: "fv_route", ty: { k: "params" } };
    case "query":
      return { code: "fv_route", ty: { k: "queryobj" } };
    case "fullPath":
      return { code: "fv_route.full_path()", ty: STR };
  }
  return fail(s.comp, `\`route.${prop}\` is not available on the server: \`path\`, \`fullPath\`, \`hash\`, \`name\`, \`params\` and \`query\` are`, n);
}

/** The getters being translated, so that two reading each other is an error, not a loop. */
const inProgress = new Set<string>();

/** Whether an expression names \`name\` as an identifier. */
function mentions(n: N, name: string): boolean {
  if (!n || typeof n !== "object") return false;
  if (n.type === "Identifier" && n.name === name) return true;
  return Object.entries(n).some(([k, v]) => k !== "loc" && k !== "__fv" && (Array.isArray(v) ? v.some((x) => mentions(x, name)) : typeof v === "object" && mentions(v, name)));
}

/** A Pinia getter read from a store's state, `prefs.doubled`: its expression, translated with the
 * state it takes bound to that state. `null` when `name` is not a getter of that store. */
export function storeGetter(s: Scope, base: Val, name: string, node: N): Val | null {
  if (base.ty.k !== "struct" || !base.ty.store) return null;
  const stateName = base.ty.name;
  const store = [...ctx.stores.values()].find((st) => st.state === stateName);
  const g = store?.getters.get(name);
  if (!g) return null;
  const where = `getter \`${name}\` in ${g.file}`;
  if (!g.body) fail(s.comp, `${where} returns a single expression`, node);
  const uses = (n: N, type: string): boolean =>
    !!n && typeof n === "object" && (n.type === type || Object.entries(n).some(([k, v]) => k !== "loc" && (Array.isArray(v) ? v.some((x) => uses(x, type)) : typeof v === "object" && uses(v, type))));
  if (uses(g.body, "ThisExpression")) fail(s.comp, `${where} reads \`this\`; read the state through the getter's parameter`, node);
  if (g.body.type === "ArrowFunctionExpression" || g.body.type === "FunctionExpression") {
    fail(s.comp, `${where} returns a function, which takes arguments only the client passes`, node);
  }
  const locals = new Map<string, Val>();
  if (g.param) locals.set(g.param, { code: base.code, ty: base.ty });
  // A setup store's computed reads the state's refs, and the other getters, by name and `.value`.
  const setup = new Map<string, Val>();
  const refs = new Set<string>();
  if (g.setup) {
    const fields = ctx.storeStructs.get(stateName)?.fields ?? [];
    for (const f of fields) {
      setup.set(f.js, fieldVal(s.comp, base.code, base.ty, f.js, node));
      refs.add(f.js);
    }
    for (const other of store!.getters.keys()) {
      if (other === name || !mentions(g.body, other)) continue;
      if (inProgress.has(`${stateName}.${other}`)) fail(s.comp, `${where} and \`${other}\` read each other`, node);
      inProgress.add(`${stateName}.${name}`);
      try {
        setup.set(other, storeGetter(s, base, other, node)!);
      } finally {
        inProgress.delete(`${stateName}.${name}`);
      }
      refs.add(other);
    }
  }
  try {
    return expr({ ...s, locals, narrowed: new Map(), setup, refs, propsIdent: null }, g.body);
  } catch (e) {
    if (e instanceof GenError) throw new GenError(`${s.comp.file}: ${where}: ${e.message.replace(/^[^:]*: /, "")}`);
    throw e;
  }
}

export function expr(s: Scope, n: N): Val {
  const comp = s.comp;
  const path = pathOf(n);
  if (path !== null) {
    const narrowed = s.narrowed.get(path);
    if (narrowed) return narrowed;
  }
  if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier" && n.property.name === "length") {
    // `Object.entries(r).length`: as many as the record has keys.
    if (isObjectCall(n.object, "entries") && n.object.arguments.length === 1) {
      const r = expr(s, n.object.arguments[0]);
      if (r.ty.k === "record") return { code: `((${r.code}).len() as i64)`, ty: INT };
    }
    const base = expr(s, n.object);
    if (base.ty.k === "list" && base.iter !== undefined) return { code: `(${base.iter}.count() as i64)`, ty: INT };
    if (base.ty.k === "list") return { code: `((${base.code}).len() as i64)`, ty: INT };
    // A JavaScript string's length counts UTF-16 code units, not the bytes Rust's `len` counts.
    if (base.ty.k === "str") return { code: `fv::js_length(${base.code})`, ty: INT };
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    // JavaScript's `+` concatenates as soon as one side is a string, writing a number in decimal —
    // which is what `{}` does with an `i64`. Two numbers would be arithmetic, which is not here.
    const joinable = (t: Ty) => t.k === "str" || isNumber(t);
    if ((a.ty.k === "str" || b.ty.k === "str") && joinable(a.ty) && joinable(b.ty)) {
      meet(comp, a, b, "`+`", n, "join");
      // A number is written as JavaScript writes it, rounded beyond 2⁵³.
      const text = (v: Val) => (isNumber(v.ty) ? `fv::Js(${v.code})` : v.code);
      return { code: `&*format!("{}{}", ${text(a)}, ${text(b)})`, ty: STR, ...loneOf(a, b) };
    }
    // Two numbers: arithmetic, as `n + 1` in a template means.
    if (a.ty.k === "int" && b.ty.k === "int") return intFromF64(`(${asF64(a)} + ${asF64(b)})`);
    if (isNumber(a.ty) && isNumber(b.ty)) return { code: `(${asF64(a)} + ${asF64(b)})`, ty: FLOAT };
    return fail(comp, "`+` joins a string to a string or a number, or adds two numbers", n);
  }
  if (n.type === "BinaryExpression" && ["-", "*", "%", "/", "<", ">", "<=", ">="].includes(n.operator)) {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    const comparison = ["<", ">", "<=", ">="].includes(n.operator);
    // Two strings, ordered as JavaScript orders them: by UTF-16 code unit.
    if (comparison && a.ty.k === "str" && b.ty.k === "str") {
      meet(comp, a, b, `\`${n.operator}\``, n, "order");
      const is = { "<": "lt", ">": "gt", "<=": "le", ">=": "ge" }[n.operator as "<"];
      return { code: `fv::js_cmp(${a.code}, ${b.code}).is_${is}()`, ty: BOOL };
    }
    if (!isNumber(a.ty) || !isNumber(b.ty)) {
      const why =
        a.ty.k === "opt" || b.ty.k === "opt"
          ? "narrow an optional one with `v-if` first"
          : `the other is ${describeTy(isNumber(a.ty) ? b.ty : a.ty)}`;
      const between = comparison ? "two numbers, or two strings," : "two numbers";
      return fail(comp, `\`${n.operator}\` is supported between ${between} that are present: ${why}`, n);
    }
    if (["<", ">", "<=", ">="].includes(n.operator)) return { code: `(${asF64(a)} ${n.operator} ${asF64(b)})`, ty: BOOL };
    // Two integers stay integers — but for `/`, which gives a fraction in JavaScript, and a `%` whose
    // divisor may be zero, which gives NaN.
    const intDivisor = n.right.type === "NumericLiteral" && Number.isInteger(n.right.value) && n.right.value !== 0;
    if (a.ty.k === "int" && b.ty.k === "int" && n.operator !== "/" && (n.operator !== "%" || intDivisor)) {
      return intFromF64(`(${asF64(a)} ${n.operator} ${asF64(b)})`);
    }
    // Doubles, as JavaScript computes: Rust's `%` on `f64` is JavaScript's, and `/` by zero is ±∞.
    return { code: `(${asF64(a)} ${n.operator} ${asF64(b)})`, ty: FLOAT };
  }
  switch (n.type) {
    case "TemplateLiteral": {
      // `${a}-${b}`: each part written as JavaScript writes it into a string.
      let fmt = "";
      const args: string[] = [];
      // The part before, when nothing lies between it and the next: two halves of a pair would join.
      let before: Val | undefined;
      let lone = false;
      n.quasis.forEach((q: N, i: number) => {
        fmt += (q.value.cooked as string).replace(/[{}]/g, (c) => c + c);
        if (q.value.cooked !== "") before = undefined;
        if (i >= n.expressions.length) return;
        const v = expr(s, n.expressions[i]);
        if (before) meet(comp, before, v, "a template literal", n.expressions[i], "join");
        before = v;
        lone ||= !!v.lone;
        if (v.ty.k === "str") args.push(v.code);
        else if (isNumber(v.ty)) args.push(`fv::Js(${v.code})`);
        else if (v.ty.k === "bool") args.push(`if ${v.code} { "true" } else { "false" }`);
        else fail(comp, "a template literal interpolates strings, numbers and booleans that are present", n.expressions[i]);
        fmt += "{}";
      });
      return { code: args.length ? `&*format!(${rustStr(fmt)}, ${args.join(", ")})` : rustStr(fmt.replace(/\{\{|\}\}/g, (c) => c[0]!)), ty: STR, ...(lone ? { lone } : {}) };
    }
    case "ArrayExpression": {
      // A list of literals or values of one scalar type, as a Rust array.
      if (n.elements.length === 0) return { code: "[]", ty: { k: "list", of: UNDEF } };
      const values = n.elements.map((el: N) => {
        if (!el || el.type === "SpreadElement") fail(comp, "an array literal holds plain values", n);
        return expr(s, el);
      });
      const of = values[0]!.ty;
      if (!(of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool") || values.some((v: Val) => !sameTy(v.ty, of))) {
        fail(comp, "an array literal holds strings, numbers or booleans, all of one type", n);
      }
      return { code: `[${values.map((v: Val) => v.code).join(", ")}]`, ty: { k: "list", of }, ...loneOf(...values) };
    }
    case "OptionalMemberExpression": {
      // `a?.b`: the field of an optional object when it is present.
      if (n.computed) return fail(comp, "computed member access", n);
      const base = expr(s, n.object);
      if (base.ty.k !== "opt") return fieldVal(comp, base.code, base.ty, n.property.name, n);
      const f = fieldVal(comp, "v", base.ty.of, n.property.name, n);
      if (f.ty.k === "opt") return { code: `(${base.code}).and_then(|v| ${f.code})`, ty: f.ty };
      return { code: `(${base.code}).map(|v| ${f.code})`, ty: opt(f.ty) };
    }
    case "StringLiteral":
      return { code: rustStr(n.value), ty: STR };
    case "NumericLiteral":
      // JavaScript's own spelling of the number is a valid Rust float literal: `0.5`, `1e-7`. An
      // integer beyond what a double holds exactly is a double too, as it is in JavaScript.
      if (!Number.isSafeInteger(n.value)) {
        const spelled = String(n.value).replace(/^\./, "0.").replace("e+", "e");
        return { code: `${/[.e]/.test(spelled) ? spelled : `${spelled}.0`}f64`, ty: FLOAT };
      }
      return { code: `${n.value}i64`, ty: INT };
    case "BooleanLiteral":
      return { code: String(n.value), ty: BOOL, konst: n.value };
    case "NullLiteral":
      // An absent prop is `undefined`, and `null` is a different value: `x === null` is false for
      // it in Vue and would be `is_none()` here.
      return fail(comp, "`null`: compare with `undefined`, which is what an absent prop is", n);
    case "Identifier": {
      if (n.name === "undefined") return { code: "None", ty: UNDEF };
      const local = s.locals.get(n.name) ?? s.setup.get(n.name);
      if (local) return local;
      if (s.clientOnly.has(n.name)) {
        return fail(comp, `\`${n.name}\` is set up in a way the server cannot evaluate: ${s.clientOnly.get(n.name)}`, n);
      }
      if (n.name === s.propsIdent) return { code: "props", ty: { k: "struct", name: "Props" } };
      return fail(comp, `\`${n.name}\` is not available when rendering on the server`, n);
    }
    case "MemberExpression": {
      // `count.value` in the script: the ref's value, which is what the binding already reads.
      if (!n.computed && n.property.name === "value" && n.object.type === "Identifier" && s.refs.has(n.object.name) && !s.locals.has(n.object.name)) {
        return expr(s, n.object);
      }
      if (n.computed) {
        if (n.object.type === "Identifier" && n.object.name === "$setup" && n.property.type === "StringLiteral") {
          return expr(s, { ...n.property, type: "Identifier", name: n.property.value });
        }
        if (n.property.type === "StringLiteral") {
          const base = expr(s, n.object);
          if (base.ty.k === "params" || base.ty.k === "queryobj") return routeField(s, base, n.property.value, n);
        }
        return fail(comp, "computed member access", n);
      }
      const prop = n.property.name as string;
      // `$slots.side`: whether the parent gave that slot any content.
      const slotsObject =
        (n.object.type === "Identifier" && n.object.name === "$slots") ||
        (n.object.type === "MemberExpression" && !n.object.computed && n.object.object.type === "Identifier" &&
          n.object.object.name === "_ctx" && n.object.property.name === "$slots");
      if (slotsObject) {
        if (!comp.slotNames.includes(prop)) fail(comp, `\`$slots.${prop}\` names a slot this template does not render`, n);
        return { code: `fv_slots.${snake(prop)}.is_some()`, ty: BOOL };
      }
      if (n.object.type === "Identifier") {
        switch (n.object.name) {
          case "$props":
            return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
          case "$setup":
          case "_ctx": {
            if (n.object.name === "_ctx" && prop === "$route") return theRoute(s, n);
            const v = s.setup.get(prop);
            if (v) return v;
            if (s.clientOnly.has(prop)) {
              return fail(comp, `\`${prop}\` is set up in a way the server cannot evaluate: ${s.clientOnly.get(prop)}`, n);
            }
            if (n.object.name === "_ctx" && comp.props.fields.some((f) => f.js === prop)) {
              return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
            }
            return fail(comp, `\`${prop}\` is not available when rendering on the server`, n);
          }
        }
      }
      const base = expr(s, n.object);
      if (base.ty.k === "route" || base.ty.k === "params" || base.ty.k === "queryobj") return routeField(s, base, prop, n);
      return storeGetter(s, base, prop, n) ?? fieldVal(comp, base.code, base.ty, prop, n);
    }
    case "CallExpression":
      return call(s, n);
    case "LogicalExpression": {
      // `x !== undefined && …` and `!x || …` / `x === undefined || …`: booleans, with `x` present on
      // the right.
      if (n.operator === "&&" || n.operator === "||") {
        const p = presence(s, n.left);
        if (p && p.negated === (n.operator === "||") && (p.negated || !p.truthy)) {
          let right: Val | undefined;
          const code = narrowing(s, p, (inner) => (right = expr(inner, n.right)).code, () => String(n.operator === "||"));
          if (right?.ty.k === "bool") return { code: `(${code})`, ty: BOOL };
          return fail(comp, `\`${n.operator}\` is supported between booleans only`, n);
        }
      }
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      if (n.operator === "??") {
        // A query value falls back for `undefined` and `null`, and stays a query value: an array
        // given more than once stays an array.
        if (a.ty.k === "query") {
          if (b.ty.k !== "str") fail(comp, "`??` after a query value takes a string", n);
          return { code: `(${a.code}).or(${b.code})`, ty: a.ty };
        }
        if (a.ty.k !== "opt") return a;
        if (b.ty.k === "undef") return a;
        if (b.iter !== undefined) fail(comp, "`??` falling back to a computed list", n);
        // A string a temporary owns: the result is one too, borrowed from the `Cow` either side gives.
        if (a.held !== undefined && b.ty.k === "str") return { code: `&*(${a.held}).unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        if (a.ty.of.k === "str" && b.ty.k === "str" && isTemporary(b)) {
          return { code: `&*(${a.code}).map(std::borrow::Cow::<str>::Borrowed).unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty.of, b.ty)) return { code: `(${a.code}).unwrap_or(${b.code})`, ty: b.ty, ...loneOf(a, b) };
        if (sameTy(a.ty, b.ty)) return { code: `(${a.code}).or(${b.code})`, ty: a.ty, ...loneOf(a, b) };
        // An integer and a fraction: both numbers in JavaScript, so a fraction here.
        if (a.ty.of.k === "float" && b.ty.k === "int") return { code: `(${a.code}).unwrap_or(${asF64(b)})`, ty: FLOAT };
        if (a.ty.of.k === "int" && b.ty.k === "float") return { code: `(${a.code}).map(|v| v as f64).unwrap_or(${b.code})`, ty: FLOAT };
        return fail(comp, "`??` between different types", n);
      }
      if (n.operator === "||") {
        if (a.ty.k === "bool" && b.ty.k === "bool") return { code: `(${a.code} || ${b.code})`, ty: BOOL };
        if (b.ty.k === "undef") {
          // `x || undefined`: the value when it is truthy, nothing otherwise.
          const inner: Ty = a.ty.k === "opt" ? a.ty.of : a.ty;
          const test = truthy({ code: "v", ty: inner });
          const src = a.ty.k === "opt" ? a.code : `Some(${a.code})`;
          return { code: `(${src}).filter(|v| ${test.replace(/\bv\b/g, "*v")})`, ty: opt(inner) };
        }
        if (a.ty.k === "str" && b.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
          return { code: `&*{ let a = ${asCow(a)}; if !a.is_empty() { a } else { ${asCow(b)} } }`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty, b.ty) && (a.ty.k === "str" || isNumber(a.ty))) {
          return { code: `{ let a = ${a.code}; if ${truthy({ code: "a", ty: a.ty })} { a } else { ${b.code} } }`, ty: a.ty, ...loneOf(a, b) };
        }
        return fail(comp, "`||` between these types", n);
      }
      if (n.operator === "&&" && a.ty.k === "bool" && b.ty.k === "bool") {
        return { code: `(${a.code} && ${b.code})`, ty: BOOL };
      }
      return fail(comp, `\`${n.operator}\` is supported between booleans only`, n);
    }
    case "UnaryExpression":
      if (n.operator === "!") {
        const a = expr(s, n.argument);
        return a.konst !== undefined
          ? { code: String(!a.konst), ty: BOOL, konst: !a.konst }
          : { code: `!(${truthy(a)})`, ty: BOOL };
      }
      if (n.operator === "-") {
        const a = expr(s, n.argument);
        if (a.ty.k === "int") return intFromF64(`(-${asF64(a)})`);
        if (a.ty.k === "float") return { code: `(-(${a.code}))`, ty: FLOAT };
      }
      return fail(comp, `unary \`${n.operator}\``, n);
    case "BinaryExpression": {
      if (n.operator !== "===" && n.operator !== "!==") fail(comp, `\`${n.operator}\``, n);
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      let eq: string;
      const scalar = (t: Ty) => t.k === "str" || t.k === "int" || t.k === "bool";
      const strish = (t: Ty) => t.k === "str" || (t.k === "opt" && t.of.k === "str");
      if (strish(a.ty) && strish(b.ty)) meet(comp, a, b, `\`${n.operator}\``, n, "equal");
      // A query value equals a string only when it is that single value.
      if (a.ty.k === "query" && b.ty.k === "str") eq = `(${a.code}).is(${b.code})`;
      else if (b.ty.k === "query" && a.ty.k === "str") eq = `(${b.code}).is(${a.code})`;
      else if (a.ty.k === "query" && b.ty.k === "undef") eq = `(${a.code}).is_undefined()`;
      else if (b.ty.k === "query" && a.ty.k === "undef") eq = `(${b.code}).is_undefined()`;
      else if (b.ty.k === "undef" && a.ty.k === "opt") eq = `(${a.code}).is_none()`;
      else if (a.ty.k === "undef" && b.ty.k === "opt") eq = `(${b.code}).is_none()`;
      else if (a.ty.k === "undef" || b.ty.k === "undef") {
        // A value that is always present — or narrowed to present — is never \`undefined\`.
        const same = a.ty.k === b.ty.k;
        const konst = n.operator === "===" ? same : !same;
        return { code: String(konst), ty: BOOL, konst };
      }
      else if (isNumber(a.ty) && isNumber(b.ty)) eq = `(${asF64(a)} == ${asF64(b)})`;
      else if (sameTy(a.ty, b.ty) && (scalar(a.ty) || (a.ty.k === "opt" && scalar(a.ty.of)))) {
        eq = `(${a.code}) == (${b.code})`;
      } else if (a.ty.k === "opt" && sameTy(a.ty.of, b.ty) && scalar(b.ty)) eq = `(${a.code}) == Some(${b.code})`;
      else if (b.ty.k === "opt" && sameTy(b.ty.of, a.ty) && scalar(a.ty)) eq = `Some(${a.code}) == (${b.code})`;
      else return fail(comp, "`===` between these types", n);
      return { code: n.operator === "===" ? eq : `!(${eq})`, ty: BOOL };
    }
    case "ConditionalExpression": {
      const t = expr(s, n.test);
      if (t.konst !== undefined) return expr(s, t.konst ? n.consequent : n.alternate);
      // A test for presence narrows the branch where the value is present, as TypeScript does.
      const p = presence(s, n.test);
      const name = p ? `n${++ctx.narrowCount}` : "";
      const a = expr(p && !p.negated ? narrowTo(s, p, name) : s, n.consequent);
      const b = expr(p && p.negated ? narrowTo(s, p, name) : s, n.alternate);
      const choose = (yes: string, no: string): string => {
        if (!p) return `if ${truthy(t)} { ${yes} } else { ${no} }`;
        const [present, absent] = p.negated ? [no, yes] : [yes, no];
        const bound = new RegExp(`\\b${name}\\b`).test(present) ? name : "_";
        return `if ${p.pattern(bound)} { ${present} } else { ${absent} }`;
      };
      const lone = loneOf(a, b);
      if (sameTy(a.ty, b.ty) && a.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
        return { code: `&*(${choose(asCow(a), asCow(b))})`, ty: STR, ...lone };
      }
      // Two lists, one of them computed: both branches collect their items, to have one type.
      if (sameTy(a.ty, b.ty) && a.ty.k === "list" && (a.iter !== undefined || b.iter !== undefined)) {
        const both = `(${choose(collected(a), collected(b))})`;
        return { code: both, ty: a.ty, iter: `${both}.into_iter()`, ...lone };
      }
      const optStr = (v: Val) => v.ty.k === "undef" || (v.ty.k === "opt" && v.ty.of.k === "str") || v.ty.k === "str";
      if (sameTy(a.ty, b.ty) && a.ty.k !== "opt") return { code: choose(a.code, b.code), ty: a.ty, ...lone };
      // An integer and a fraction: both numbers in JavaScript, so a fraction here.
      if (isNumber(a.ty) && isNumber(b.ty)) return { code: choose(asF64(a), asF64(b)), ty: FLOAT };
      if (sameTy(a.ty, b.ty) || a.ty.k === "undef" || b.ty.k === "undef" || (a.ty.k === "opt" && sameTy(a.ty.of, b.ty)) || (b.ty.k === "opt" && sameTy(b.ty.of, a.ty))) {
        const ty = opt(a.ty.k === "undef" || b.ty.k === "opt" ? b.ty : a.ty);
        if (optStr(a) && optStr(b) && (isTemporary(a) || isTemporary(b) || a.held !== undefined || b.held !== undefined)) {
          // A string built in a branch, held by an `Option<Cow>` the statement keeps.
          const held = (v: Val): string =>
            v.held ?? (v.ty.k === "undef" ? "None" : v.ty.k === "opt" ? `(${v.code}).map(std::borrow::Cow::<str>::Borrowed)` : `Some(${asCow(v)})`);
          const both = `(${choose(held(a), held(b))})`;
          return { code: `${both}.as_deref()`, ty, held: both, ...lone };
        }
        if (sameTy(a.ty, b.ty)) return { code: choose(a.code, b.code), ty: a.ty, ...lone };
        return { code: choose(coerce(comp, a, ty, n), coerce(comp, b, ty, n)), ty, ...lone };
      }
      return fail(comp, "the two branches of `?:` differ in type", n);
    }
    default:
      return fail(comp, `\`${n.type}\` is not supported in an island template`, n);
  }
}

export function call(s: Scope, n: N): Val {
  const comp = s.comp;
  const callee = n.callee;
  const args: N[] = n.arguments;
  if (callee.type === "Identifier") {
    switch (callee.name) {
      case "_ssrLooseEqual": {
        const a = expr(s, args[0]);
        const b = expr(s, args[1]);
        if (a.ty.k === "str" && b.ty.k === "str") {
          meet(comp, a, b, "`v-model`", n, "equal");
          return { code: `(${a.code}) == (${b.code})`, ty: BOOL };
        }
        return fail(comp, "`v-model` comparison between these types", n);
      }
      case "_ssrIncludeBooleanAttr": {
        // `!!value || value === ""`: every string is included, empty or not.
        const a = expr(s, args[0]);
        if (a.konst !== undefined) return a;
        if (a.ty.k === "str") return { code: "true", ty: BOOL, konst: true };
        if (a.ty.k === "opt" && a.ty.of.k === "str") return { code: `(${a.code}).is_some()`, ty: BOOL };
        return { code: truthy(a), ty: BOOL };
      }
      case "_ssrLooseContain":
        return fail(comp, "`v-model` over an array", n);
    }
    if (s.i18nT.has(callee.name)) return translate(s, args, n);
    const helper = s.helpers.get(callee.name);
    if (helper) return helperCall(s, helper, args, n);
    if (callee.name === "String" && args.length === 1) {
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return a;
      if (isNumber(a.ty)) return { code: `&*fv::Js(${a.code}).to_string()`, ty: STR };
      if (a.ty.k === "bool") return { code: `if ${a.code} { "true" } else { "false" }`, ty: STR };
    }
    // Strings read as numbers, as JavaScript reads them: a fraction, `NaN` when there is no number.
    if (callee.name === "Number" && args.length === 1) {
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return { code: `fv::js_number(${a.code})`, ty: FLOAT };
      if (isNumber(a.ty)) return a;
      if (a.ty.k === "bool") return { code: `i64::from(${a.code})`, ty: INT };
      return fail(comp, "`Number()` takes a string, a number or a boolean that is present", n);
    }
    if ((callee.name === "parseInt" && (args.length === 1 || args.length === 2)) || (callee.name === "parseFloat" && args.length === 1)) {
      const a = expr(s, args[0]);
      // Not a number: `parseInt` reads it as a string, so `parseInt(0.0000005)` is 5.
      if (a.ty.k !== "str") fail(comp, `\`${callee.name}()\` takes a string`, args[0]);
      if (callee.name === "parseFloat") return { code: `fv::js_parse_float(${a.code})`, ty: FLOAT };
      const radix = args[1];
      if (radix && !(radix.type === "NumericLiteral" && (radix.value === 10 || radix.value === 16))) {
        fail(comp, "`parseInt()` takes a radix of 10 or 16, written as a literal", radix);
      }
      return { code: `fv::js_parse_int(${a.code}, ${radix ? radix.value : 0})`, ty: FLOAT };
    }
    return fail(comp, `\`${callee.name}()\` is not available when rendering on the server`, n);
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const method = callee.property.name as string;
    if (callee.object.type === "Identifier" && callee.object.name === "Array" && method === "isArray") {
      const a = expr(s, args[0]);
      if (a.ty.k === "query") return { code: `(${a.code}).is_array()`, ty: BOOL };
      const is = a.ty.k === "list";
      return { code: String(is), ty: BOOL, konst: is };
    }
    if (callee.object.type === "Identifier" && callee.object.name === "Object") return objectCall(s, method, args, n);
    if (callee.object.type === "Identifier" && callee.object.name === "JSON" && method === "stringify" && args.length === 1) {
      return { code: `&*${json(s, expr(s, args[0]), args[0])}`, ty: STR };
    }
    // `$t(…)` in the template, and \`t(…)\` from \`useI18n()\`.
    if (callee.object.type === "Identifier" && callee.object.name === "_ctx" && method === "$t") return translate(s, args, n);
    if (callee.object.type === "Identifier" && callee.object.name === "$setup" && s.i18nT.has(method)) return translate(s, args, n);
    if (callee.object.type === "Identifier" && (callee.object.name === "$setup" || callee.object.name === "_ctx")) {
      const helper = s.helpers.get(method);
      if (helper) return helperCall(s, helper, args, n);
    }
    // `Math`, on numbers, as JavaScript computes it.
    if (callee.object.type === "Identifier" && callee.object.name === "Math") {
      const vals = args.map((a) => expr(s, a));
      if (vals.length && vals.every((v) => isNumber(v.ty))) {
        const ints = vals.every((v) => v.ty.k === "int");
        if ((method === "max" || method === "min") && vals.length >= 2) {
          if (ints) return { code: vals.slice(1).reduce((acc, v) => `(${acc}).${method}(${v.code})`, vals[0]!.code), ty: INT };
          return { code: vals.slice(1).reduce((acc, v) => `fv::js_${method}(${acc}, ${asF64(v)})`, asF64(vals[0]!)), ty: FLOAT };
        }
        if (vals.length === 1) {
          const x = vals[0]!;
          if (method === "abs") return ints ? intFromF64(`${asF64(x)}.abs()`) : { code: `(${x.code}).abs()`, ty: FLOAT };
          if (method === "round") return { code: `fv::js_round(${asF64(x)})`, ty: FLOAT };
          if (method === "floor" || method === "ceil" || method === "trunc") return { code: `${asF64(x)}.${method}()`, ty: FLOAT };
        }
      }
      return fail(comp, `\`Math.${method}()\` is supported on numbers as \`max\`, \`min\`, \`abs\`, \`round\`, \`floor\`, \`ceil\` and \`trunc\``, n);
    }
    const target = expr(s, callee.object);
    if (target.ty.k === "str") {
      const lone = loneOf(target);
      switch (args.length === 0 ? method : "") {
        case "trim":
          return { code: `fv::js_trim(${target.code})`, ty: STR, ...lone };
        case "trimStart":
          return { code: `fv::js_trim_start(${target.code})`, ty: STR, ...lone };
        case "trimEnd":
          return { code: `fv::js_trim_end(${target.code})`, ty: STR, ...lone };
        // Unicode's default case mappings, which JavaScript and Rust both apply, final sigma included.
        case "toUpperCase":
          return { code: `&*(${target.code}).to_uppercase()`, ty: STR, ...lone };
        case "toLowerCase":
          return { code: `&*(${target.code}).to_lowercase()`, ty: STR, ...lone };
        case "toString":
          return target;
      }
      const m = stringMethod(s, target, method, args, n);
      if (m) return m;
    }
    if (isNumber(target.ty) && method === "toFixed" && args.length <= 1) {
      // The digits are a literal, as they almost always are: 0 to 100.
      const d = args.length ? args[0] : { type: "NumericLiteral", value: 0 };
      if (d.type !== "NumericLiteral" || !Number.isInteger(d.value) || d.value < 0 || d.value > 100) {
        fail(comp, "`.toFixed()` takes a literal number of digits, from 0 to 100", n);
      }
      return { code: `&*fv::js_to_fixed(${asF64(target)}, ${d.value})`, ty: STR };
    }
    if (isNumber(target.ty) && method === "toString" && args.length === 0) {
      return { code: `&*fv::Js(${target.code}).to_string()`, ty: STR };
    }
    if (target.ty.k === "list") {
      // A list the props hold, of strings or integers, is searched and joined in place below.
      const inPlace = target.iter === undefined && !target.lone && (target.ty.of.k === "str" || target.ty.of.k === "int");
      const listed = listMethod(s, target, method, args, n) ?? (inPlace ? null : computedListMethod(s, target, method, args, n));
      if (listed) return listed;
    }
    if (target.ty.k === "list" && (target.ty.of.k === "str" || target.ty.of.k === "int")) {
      const of = target.ty.of;
      if (method === "includes" && args.length === 1) {
        const v = expr(s, args[0]);
        if (!sameTy(v.ty, of)) fail(comp, "`.includes()` looks for a value of the list's own type", args[0]);
        const item = of.k === "str" ? "&**v" : "*v";
        return { code: `(${target.code}).iter().any(|v| ${item} == ${v.code})`, ty: BOOL };
      }
      if (method === "join" && args.length <= 1) {
        // JavaScript joins with a comma when given no separator.
        const sep: Val = args.length ? expr(s, args[0]) : { code: '","', ty: STR };
        if (sep.ty.k !== "str") fail(comp, "`.join()` takes a string", args[0]);
        const each = of.k === "str" ? `(${target.code}).iter().map(|v| &**v)` : `(${target.code}).iter().map(|v| fv::Js(*v).to_string())`;
        return { code: `&*${each}.collect::<Vec<_>>().join(${sep.code})`, ty: STR, ...loneOf(sep) };
      }
    }
    return fail(comp, `\`.${method}()\` is not supported`, n);
  }
  return fail(comp, "this call is not supported", n);
}

/** Whether `n` is `Object.<method>(…)`. */
export function isObjectCall(n: N, method: string): boolean {
  return (
    n?.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed &&
    n.callee.object.type === "Identifier" && n.callee.object.name === "Object" && n.callee.property.name === method
  );
}

/** A string method beyond trimming and case mapping, or `null` when `method` is none of them.
 * Indices and lengths count UTF-16 code units, as JavaScript's do; a result that may hold half of a
 * surrogate pair is marked `lone`. */
function stringMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  const comp = s.comp;
  const t = target.code;
  const arity = (least: number, most: number): void => {
    if (args.length < least || args.length > most) {
      fail(comp, `\`.${method}()\` takes ${least === most ? least : `${least} to ${most}`} argument${most === 1 ? "" : "s"} here`, n);
    }
  };
  const str = (i: number): Val => {
    if (args[i]?.type === "RegExpLiteral") fail(comp, `\`.${method}()\` with a regular expression, which the server does not run: give it a string`, args[i]);
    const v = expr(s, args[i]);
    if (v.ty.k !== "str") fail(comp, `\`.${method}()\` takes a string that is present`, args[i]);
    return v;
  };
  /** A number argument as an `f64`; `fallback` when it is left out or `undefined`. */
  const num = (i: number, fallback: string): string => {
    if (args[i] === undefined) return fallback;
    const v = expr(s, args[i]);
    if (v.ty.k === "undef") return fallback;
    if (!isNumber(v.ty)) fail(comp, `\`.${method}()\` takes a number that is present`, args[i]);
    return asF64(v);
  };
  const cut = { lone: true };
  switch (method) {
    case "includes":
    case "startsWith":
    case "endsWith": {
      // Without a position: `includes(x, 3)` would start the search part way.
      arity(1, 1);
      const x = str(0);
      meet(comp, target, x, `\`.${method}()\``, n, "search");
      const rust = { includes: "contains", startsWith: "starts_with", endsWith: "ends_with" }[method];
      return { code: `(${t}).${rust}(${x.code})`, ty: BOOL };
    }
    case "indexOf":
    case "lastIndexOf": {
      arity(1, 1);
      const x = str(0);
      meet(comp, target, x, `\`.${method}()\``, n, "search");
      return { code: `fv::js_${method === "indexOf" ? "index_of" : "last_index_of"}(${t}, ${x.code})`, ty: INT };
    }
    case "slice":
    case "substring": {
      arity(0, 2);
      const end = num(1, "");
      return { code: `&*fv::js_${method}(${t}, ${num(0, "0.0")}, ${end ? `Some(${end})` : "None"})`, ty: STR, ...cut };
    }
    case "at": {
      arity(1, 1);
      const at = `fv::js_at(${t}, ${num(0, "0.0")})`;
      if (!isTemporary(target)) return { code: at, ty: opt(STR), ...cut };
      // Of a string built here, the character is copied out, to outlive it.
      const held = `${at}.map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))`;
      return { code: `(${held}).as_deref()`, ty: opt(STR), held, ...cut };
    }
    case "charAt":
      arity(0, 1);
      // It borrows from the string, so it is a temporary when the string is.
      return { code: `${isTemporary(target) ? "&*" : ""}fv::js_char_at(${t}, ${num(0, "0.0")})`, ty: STR, ...cut };
    case "split": {
      // Without a limit, and with a string separator: `split()` alone gives the whole string.
      arity(1, 1);
      const sep = str(0);
      meet(comp, target, sep, "`.split()`", n, "search");
      // An empty separator cuts between code units, so a pair in two.
      return computed(`fv::js_split(${t}, ${sep.code}).into_iter()`, STR, target.lone || !nonEmptyLiteral(sep));
    }
    case "replace":
    case "replaceAll": {
      arity(2, 2);
      if (args[1].type === "ArrowFunctionExpression" || args[1].type === "FunctionExpression") {
        fail(comp, `\`.${method}()\` with a function, which the server does not run: give it a string`, args[1]);
      }
      const [pattern, replacement] = [str(0), str(1)];
      meet(comp, target, pattern, `\`.${method}()\``, n, "search");
      meet(comp, target, replacement, `\`.${method}()\``, n, "join");
      // `replaceAll("", …)` matches between code units, which cuts every pair in two.
      const lone = target.lone || replacement.lone || (method === "replaceAll" && !nonEmptyLiteral(pattern));
      return { code: `&*fv::js_${method === "replace" ? "replace" : "replace_all"}(${t}, ${pattern.code}, ${replacement.code})`, ty: STR, ...(lone ? cut : {}) };
    }
    case "padStart":
    case "padEnd": {
      arity(1, 2);
      const fill: Val = args.length > 1 ? str(1) : { code: '" "', ty: STR };
      // The fill repeats itself, and is cut short where a pair may be: before a string starting
      // with a half, the two would join.
      const whole = fill.code.startsWith('"') && !/[\u{10000}-\u{10FFFF}]/u.test(fill.code);
      if (fill.lone || (method === "padStart" && target.lone && !whole)) fail(comp, lonely(`\`.${method}()\``), n);
      return { code: `&*fv::js_${method === "padStart" ? "pad_start" : "pad_end"}(${t}, ${num(0, "0.0")}, ${fill.code})`, ty: STR, ...(target.lone || !whole ? cut : {}) };
    }
    case "repeat": {
      arity(1, 1);
      // JavaScript throws a `RangeError` for a negative or infinite count.
      const c = args[0];
      if ((c.type === "UnaryExpression" && c.operator === "-" && c.argument.type === "NumericLiteral" && c.argument.value > 0) || (c.type === "Identifier" && c.name === "Infinity")) {
        fail(comp, "`.repeat()` with a negative or infinite count, which throws a `RangeError`", c);
      }
      // Repeated, a string ending with one half and starting with the other joins them.
      if (target.lone) fail(comp, lonely("`.repeat()`"), n);
      return { code: `&*fv::js_repeat(${t}, ${num(0, "0.0")})`, ty: STR };
    }
    case "toLocaleUpperCase":
    case "toLocaleLowerCase":
      return fail(comp, `\`.${method}()\` maps case by the locale the server runs in, which the browser need not share: use \`.${method.replace("Locale", "")}()\``, n);
  }
  return null;
}

/** `JSON.stringify(v)` as a Rust `String`: of a string, a number, a boolean, or a list of those. */
function json(s: Scope, v: Val, n: N): string {
  // A half of a pair is written as an escape, `"\ud83e"`, which ferrovue cannot know to write.
  if (v.lone) fail(s.comp, lonely("`JSON.stringify()`"), n);
  const one = (code: string, ty: Ty): string => {
    switch (ty.k) {
      case "str":
        return `fv::js_json_string(&${code})`;
      case "int":
        return `fv::Js(${code}).to_string()`;
      case "float":
        return `fv::js_json_number(${code})`;
      case "bool":
        return `(if ${code} { "true" } else { "false" }).to_owned()`;
      default:
        return fail(s.comp, "`JSON.stringify()` of a string, a number, a boolean or a list of those, present", n);
    }
  };
  if (v.ty.k === "list") return `format!("[{}]", ${items(v)}.map(|v| ${one("v", v.ty.of)}).collect::<Vec<_>>().join(","))`;
  return one(`(${v.code})`, v.ty);
}

export function helperCall(s: Scope, name: string, args: N[], n: N): Val {
  const h = ctx.helpers[name]!;
  if (args.length !== h.params.length) fail(s.comp, `\`${name}\` takes ${h.params.length} argument(s)`, n);
  const code = args.map((a, i) => coerce(s.comp, expr(s, a), h.params[i]!, a)).join(", ");
  s.helperBytes.n += h.maxLen;
  return { code: `${h.rust}(${code})`, ty: h.ret };
}
