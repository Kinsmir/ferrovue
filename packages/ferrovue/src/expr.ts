/* Expressions translated to Rust, each with the type it evaluates to. */

import { type Component, type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, GenError, INT, opt, rustStr, sameTy, snake, STR, UNDEF } from "./model.ts";
import { ctx } from "./context.ts";
import { lookupStruct, markHome } from "./typescript.ts";
import { claim } from "./plugin.ts";
import { AS, atom, bare, binary, condition, enclosed, FLIPPED, ifElse, logical, negate, not, occurrences, operand, receiver, strArg, UNARY } from "./parens.ts";
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
  if (trimmed?.[1] !== undefined) return isTemporary({ code: trimmed[1].replace(/^&(?!\*)/, "&*"), ty: v.ty });
  // A borrow of anything but a field: a string built by \`format!\` or a call, or a \`Cow\` made of
  // the branches of \`?:\` or \`||\`.
  // So is an optional string with such a fallback: `x.unwrap_or(&*format!(…))`.
  return /^&\*(?![\w.]+$)/.test(v.code) || /\.unwrap_or\(&\*(?![\w.]+\)$)/.test(v.code);
}

/** A string as a \`Cow\`: borrowed when it lives on, owned when it is a temporary. The \`Cow\` is
 * itself a temporary of the whole statement, so the \`&str\` taken from it lives to its end. A
 * \`String\` built for the purpose is moved into it, and one that is already a \`Cow\` — a branch
 * of \`?:\` or \`||\` — is taken as it is. */
export function asCow(v: Val): string {
  if (!isTemporary(v)) return `std::borrow::Cow::<str>::Borrowed(${bare(v.code)})`;
  const built = /^&\*(.*)$/s.exec(v.code)?.[1];
  if (built === undefined) return `std::borrow::Cow::<str>::Owned(${atom(v.code)}.to_owned())`;
  if (enclosed(built)) return bare(built);
  // A routine's `Cow` may borrow a string built in the same branch, which ends with it: owned.
  if (yieldsCow(built)) return built.startsWith("fv::") ? `std::borrow::Cow::<str>::Owned(${built}.into_owned())` : bare(built);
  // A routine that hands back part of the string it is given, as a `&str`: copied out.
  if (/^fv::js_(?:char_at|trim|trim_start|trim_end)\(/.test(built)) return `std::borrow::Cow::<str>::Owned(${built}.to_owned())`;
  return `std::borrow::Cow::<str>::Owned(${built})`;
}

/** Whether built code is a `Cow<str>` already: a runtime routine that borrows when it can
 * (`js_slice`, `js_replace`, `js_pad_start`, …), or a fallback taken from one (`.unwrap_or(Cow…)`). */
export function yieldsCow(code: string): boolean {
  // The routine's call is the whole of it: `fv::js_slice(…).to_lowercase()` is a `String`.
  const routine = /^fv::js_(?:slice|substring|replace|replace_all|pad_start|pad_end)(?=\()/.exec(code);
  if (routine !== null) return enclosed(code.slice(routine[0].length));
  // The fallback is the last call of it: `format!("{}a", x.unwrap_or(Cow…))` is a `String`.
  const fallback = code.lastIndexOf(".unwrap_or(std::borrow::Cow::<str>::");
  return fallback >= 0 && enclosed(code.slice(fallback + ".unwrap_or".length));
}

/** Whether a value is a JavaScript number: an integer or a fraction. */
export function isNumber(ty: Ty): boolean {
  return ty.k === "int" || ty.k === "float";
}

/** A number as an `f64`, as JavaScript holds every number. */
export function asF64(v: Val): string {
  if (v.f64 !== undefined) return v.f64;
  return v.ty.k === "float" ? v.code : `${operand(v.code, AS)} as f64`;
}

/** An integer computed on doubles, as JavaScript computes it: the \`i64\` and the double it came from. */
function intFromF64(f64: string): Val {
  return { code: `${operand(f64, AS)} as i64`, ty: INT, f64 };
}

/** A double as a Rust literal: JavaScript's own spelling, which Rust reads back to the same double. */
function floatLiteral(x: number): string {
  if (Number.isNaN(x)) return "f64::NAN";
  if (!Number.isFinite(x)) return x > 0 ? "f64::INFINITY" : "f64::NEG_INFINITY";
  const spelled = String(Math.abs(x)).replace("e+", "e");
  return `${x < 0 || Object.is(x, -0) ? "-" : ""}${/[.e]/.test(spelled) ? spelled : `${spelled}.0`}f64`;
}

/** A number known at generation time — a literal, or literals JavaScript computed — as an integer
 * when it is one of the operations that keep integers, a fraction otherwise. */
function numberVal(x: number, int: boolean): Val {
  if (!int) return { code: floatLiteral(x), ty: FLOAT, num: x };
  if (!Number.isSafeInteger(x)) return { ...intFromF64(floatLiteral(x)), num: x };
  // `-0` is the integer 0, and the double it came from keeps its sign.
  return { code: `${x === 0 ? 0 : x}i64`, ty: INT, f64: floatLiteral(x), num: x };
}

/** `a op b` on two numbers JavaScript computes now, as it would at run time. */
function fold(a: number, op: string, b: number): number | boolean {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "%":
      return a % b;
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case ">=":
      return a >= b;
    default:
      return a === b;
  }
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
    default:
      return claim((p) => p.values?.describe?.(ty)) ?? "a value of another kind";
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

/** A value's truthiness when it is known at generation time: a boolean constant, a string literal,
 * a number JavaScript computed. */
export function known(v: Val): boolean | undefined {
  if (v.konst !== undefined) return v.konst;
  if (v.ty.k === "str" && /^"(?:[^"\\]|\\.)*"$/.test(v.code)) return v.code !== '""';
  if (v.num !== undefined) return v.num !== 0 && !Number.isNaN(v.num);
  return undefined;
}

export function truthy(v: Val): string {
  const k = known(v);
  if (k !== undefined) return String(k);
  // Of a value one of two branches gives, each branch's own truthiness.
  const branches = v.ty.k === "str" || isNumber(v.ty) ? ifElse(v.code) : null;
  if (branches) return choice(branches.test, truthy({ code: branches.yes, ty: v.ty }), truthy({ code: branches.no, ty: v.ty }));
  switch (v.ty.k) {
    case "str":
      return `!${receiver(v.code)}.is_empty()`;
    case "int":
      return binary(v.code, "!=", "0");
    // JavaScript's falsy numbers: 0, -0 and NaN.
    case "float":
      return `${binary(v.code, "!=", "0.0")} && !${receiver(v.code)}.is_nan()`;
    case "bool":
      return v.code;
    case "undef":
      return "false";
    case "opt":
      return `${atom(v.code)}.is_some_and(|v| ${truthy({ code: "v", ty: v.ty.of })})`;
    default:
      return claim((p) => p.values?.truthy?.(v)) ?? "true";
  }
}

/** A value passed where `want` is expected: a present value into an optional slot is wrapped. */
export function coerce(comp: Component, v: Val, want: Ty, node: N): string {
  if (sameTy(v.ty, want)) return v.code;
  if (want.k === "opt" && v.ty.k === "undef") return "None";
  if (want.k === "opt" && sameTy(v.ty, want.of)) return `Some(${bare(v.code)})`;
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
  /** The `Option` the pattern matches: the value, or for a truthiness test only its truthy values. */
  option: string;
  /** The test alone, for a branch that never reads the value. */
  present: string;
  of: Ty;
  negated: boolean;
  /** Tested by truthiness, so the test itself is a boolean only when it is negated. */
  truthy: boolean;
}

export function presence(s: Scope, n: N): Presence | null {
  // A test of a plugin's own, such as a query value narrowed to a single string.
  for (const p of ctx.plugins) {
    const own = p.presence?.(s, n);
    if (own !== undefined) return own;
  }
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
  const filtered = byTruth && scalar;
  const option = filtered ? `${atom(v.code)}.filter(|v| ${truthy({ code: "*v", ty: of })})` : v.code;
  const present = filtered ? truthy(v) : `${atom(v.code)}.is_some()`;
  return { path, of, negated, truthy: byTruth, option, present, pattern: (name) => `let Some(${name}) = ${option}` };
}

/** The scope with `p`'s value present, bound as `name`. */
export function narrowTo(s: Scope, p: Presence, name: string): Scope {
  return { ...s, narrowed: new Map(s.narrowed).set(p.path, { code: name, ty: p.of }) };
}

/** `if let Some(name) = … { then } else { otherwise }`, each branch translated in its own scope —
 * the value present in one of them — with only the test for a branch that never reads it. */
function narrowing(s: Scope, p: Presence, present: (s: Scope) => string, absent: (s: Scope) => string): string {
  const name = `n${++ctx.narrowCount}`;
  const then = bare(present(narrowTo(s, p, name)));
  const otherwise = bare(absent(s));
  if (occurrences(then, name)) return `if ${p.pattern(name)} { ${then} } else { ${otherwise} }`;
  return choice(p.present, then, otherwise);
}

/** `if test { yes } else { no }`, or less when the branches allow: one value when they are the same,
 * the test itself when they are `true` and `false`. A test that binds a value keeps its branches. */
function choice(test: string, yes: string, no: string): string {
  const binds = test.startsWith("let ");
  if (yes === no && !binds) return yes;
  if (yes === "true" && no === "false" && !binds) return test;
  if (yes === "false" && no === "true" && !binds) return not(test);
  return `if ${condition(test)} { ${yes} } else { ${no} }`;
}

/* A test, as a Rust boolean. Only its truthiness is used, so `||`, `&&` and `!` combine the truthiness
 * of their operands whatever their types — where as a VALUE `a || b` is `a` or `b`, and stays held to
 * the stricter rules `expr` applies. `x && …` and `!x || …` read `x` present on the right. */
export function cond(s: Scope, n: N): string {
  if (n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&")) {
    const p = presence(s, n.left);
    if (p && p.negated === (n.operator === "||")) {
      return narrowing(s, p, (inner) => cond(inner, n.right), () => String(n.operator === "||"));
    }
    return logical(cond(s, n.left), n.operator, cond(s, n.right));
  }
  if (n.type === "UnaryExpression" && n.operator === "!") return negatedOrder(s, n.argument)?.code ?? not(cond(s, n.argument));
  return truthy(expr(s, n));
}

export function childOf(name: string): Component {
  const c = ctx.components.get(name);
  if (!c) throw new GenError(`\`Props\` is imported from ${name}.vue, which is not among the components compiled`);
  return c;
}

/** `a op b` on two numbers, on doubles as JavaScript computes it — now, when both are known. `int`
 * keeps the result an integer. */
function arithmetic(a: Val, op: string, b: Val, int: boolean): Val {
  if (a.num !== undefined && b.num !== undefined) return numberVal(fold(a.num, op, b.num) as number, int);
  const f64 = binary(asF64(a), op, asF64(b));
  return int ? intFromF64(f64) : { code: f64, ty: FLOAT };
}

/** A comparison of two numbers, as doubles. */
function compare(a: Val, op: string, b: Val): Val {
  if (a.num !== undefined && b.num !== undefined) {
    const konst = fold(a.num, op, b.num) as boolean;
    return { code: String(konst), ty: BOOL, konst };
  }
  return { code: binary(asF64(a), op, asF64(b)), ty: BOOL };
}

/** `!(a < b)` of two integers: `a >= b`, as neither is ever NaN. `null` for anything else. */
function negatedOrder(s: Scope, n: N): Val | null {
  if (n.type !== "BinaryExpression" || !(n.operator in FLIPPED)) return null;
  const a = expr(s, n.left);
  const b = expr(s, n.right);
  return a.ty.k === "int" && b.ty.k === "int" ? compare(a, FLIPPED[n.operator]!, b) : null;
}

/** A Rust string literal's text. */
export function unquote(literal: string): string {
  const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
  return literal.slice(1, -1).replace(/\\(?:u\{([0-9a-f]+)\}|(.))/g, (_, hex: string | undefined, c: string) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : (escapes[c] ?? c)));
}

/** Literal text and values joined into one string, each value written as JavaScript writes it into
 * a string: `format!`, with string literals among the values part of its text, and a string another
 * `format!` built part of its text and arguments. */
function formatted(comp: Component, parts: (string | Val)[], n: N, what: string): Val {
  let fmt = "";
  const args: string[] = [];
  // The value before, when nothing lies between it and the next: two halves of a pair would join.
  let before: Val | undefined;
  const lone = loneOf(...parts.map((p) => (typeof p === "string" ? undefined : p)));
  for (const part of parts) {
    if (typeof part === "string" || (part.ty.k === "str" && known(part) !== undefined)) {
      const text = typeof part === "string" ? part : unquote(part.code);
      if (text !== "") before = undefined;
      fmt += text.replace(/[{}]/g, (c) => c + c);
      continue;
    }
    if (before) meet(comp, before, part, what, n, "join");
    before = part;
    if (part.format) {
      fmt += part.format.text;
      args.push(...part.format.args);
      continue;
    }
    // A string written by `Display` is written as it is: `fv::Js(n)` rather than its `to_string()`.
    if (part.ty.k === "str") args.push(receiver(part.code).replace(/^(fv::Js\(.*\))\.to_string\(\)$/s, "$1"));
    else if (isNumber(part.ty)) args.push(`fv::Js(${bare(part.code)})`);
    else if (part.ty.k === "bool") args.push(`if ${condition(part.code)} { "true" } else { "false" }`);
    else fail(comp, "a template literal interpolates strings, numbers and booleans that are present", n);
    fmt += "{}";
  }
  if (!args.length) return { code: rustStr(fmt.replace(/\{\{|\}\}/g, (c) => c[0]!)), ty: STR };
  // One string and nothing else is that string.
  const one = parts.filter((p) => (typeof p === "string" ? p !== "" : p.code !== '""'));
  if (fmt === "{}" && one.length === 1 && typeof one[0] !== "string" && one[0]!.ty.k === "str") return one[0]!;
  return { code: `&*format!(${rustStr(fmt)}, ${args.join(", ")})`, ty: STR, format: { text: fmt, args }, ...lone };
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
      if (r.ty.k === "record") return { code: `${atom(r.code)}.len() as i64`, ty: INT };
    }
    const base = expr(s, n.object);
    if (base.ty.k === "list" && base.iter !== undefined) {
      // A list split out is a `Vec` already, whose length is known.
      const vec = /^(.*)\.into_iter\(\)$/s.exec(base.iter)?.[1];
      // Nor does a `map` at the end change how many there are.
      if (vec === undefined) {
        const at = base.iter.lastIndexOf(".map(");
        const mapped = at > 0 && enclosed(base.iter.slice(at + 4)) ? base.iter.slice(0, at) : base.iter;
        // What is left may walk a `Vec` that is held, whose length is known.
        const held = /^(.*)\.iter\(\)$/s.exec(mapped)?.[1];
        return { code: held !== undefined ? `${atom(held)}.len() as i64` : `${atom(mapped)}.count() as i64`, ty: INT };
      }
      return { code: vec !== undefined ? `${atom(vec)}.len() as i64` : `${atom(base.iter)}.count() as i64`, ty: INT };
    }
    if (base.ty.k === "list") return { code: `${atom(base.code)}.len() as i64`, ty: INT };
    // A JavaScript string's length counts UTF-16 code units, not the bytes Rust's `len` counts.
    if (base.ty.k === "str") return { code: `fv::js_length(${strArg(base.code)})`, ty: INT };
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
      return formatted(comp, [a, b], n, "`+`");
    }
    // Two numbers: arithmetic, as `n + 1` in a template means.
    if (isNumber(a.ty) && isNumber(b.ty)) return arithmetic(a, "+", b, a.ty.k === "int" && b.ty.k === "int");
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
      return { code: `fv::js_cmp(${strArg(a.code)}, ${strArg(b.code)}).is_${is}()`, ty: BOOL };
    }
    if (!isNumber(a.ty) || !isNumber(b.ty)) {
      const why =
        a.ty.k === "opt" || b.ty.k === "opt"
          ? "narrow an optional one with `v-if` first"
          : `the other is ${describeTy(isNumber(a.ty) ? b.ty : a.ty)}`;
      const between = comparison ? "two numbers, or two strings," : "two numbers";
      return fail(comp, `\`${n.operator}\` is supported between ${between} that are present: ${why}`, n);
    }
    if (["<", ">", "<=", ">="].includes(n.operator)) return compare(a, n.operator, b);
    // Two integers stay integers — but for `/`, which gives a fraction in JavaScript, and a `%` whose
    // divisor may be zero, which gives NaN.
    const intDivisor = n.right.type === "NumericLiteral" && Number.isInteger(n.right.value) && n.right.value !== 0;
    const int = a.ty.k === "int" && b.ty.k === "int" && n.operator !== "/" && (n.operator !== "%" || intDivisor);
    // Doubles, as JavaScript computes: Rust's `%` on `f64` is JavaScript's, and `/` by zero is ±∞.
    return arithmetic(a, n.operator, b, int);
  }
  switch (n.type) {
    case "TemplateLiteral": {
      // `${a}-${b}`: each part written as JavaScript writes it into a string.
      const parts: (string | Val)[] = [];
      n.quasis.forEach((q: N, i: number) => {
        parts.push(q.value.cooked as string);
        if (i < n.expressions.length) parts.push(expr(s, n.expressions[i]));
      });
      return formatted(comp, parts, n, "a template literal");
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
      return { code: `[${values.map((v: Val) => bare(v.code)).join(", ")}]`, ty: { k: "list", of }, ...loneOf(...values) };
    }
    case "OptionalMemberExpression": {
      // `a?.b`: the field of an optional object when it is present.
      if (n.computed) return fail(comp, "computed member access", n);
      const base = expr(s, n.object);
      if (base.ty.k !== "opt") return fieldVal(comp, base.code, base.ty, n.property.name, n);
      const f = fieldVal(comp, "v", base.ty.of, n.property.name, n);
      if (f.ty.k === "opt") return { code: `${atom(base.code)}.and_then(|v| ${f.code})`, ty: f.ty };
      return { code: `${atom(base.code)}.map(|v| ${f.code})`, ty: opt(f.ty) };
    }
    case "StringLiteral":
      return { code: rustStr(n.value), ty: STR };
    case "NumericLiteral":
      // JavaScript's own spelling of the number is a valid Rust float literal: `0.5`, `1e-7`. An
      // integer beyond what a double holds exactly is a double too, as it is in JavaScript.
      return numberVal(n.value, Number.isSafeInteger(n.value));
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
          const own = claim((p) => p.member?.(s, base, n.property.value, n, true));
          if (own) return own;
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
            // A global a plugin provides: `$route`.
            const global = n.object.name === "_ctx" ? claim((p) => p.global?.(s, prop, n)) : undefined;
            if (global) return global;
            if (n.object.name === "_ctx" && prop === "$attrs") {
              return fail(comp, "`$attrs` is bound whole, with `v-bind=\"$attrs\"`; a value read from it has no type: declare it as a prop", n);
            }
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
      return claim((p) => p.member?.(s, base, prop, n, false)) ?? fieldVal(comp, base.code, base.ty, prop, n);
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
          if (right?.ty.k === "bool") return { code, ty: BOOL };
          return fail(comp, `\`${n.operator}\` is supported between booleans only`, n);
        }
      }
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      if (n.operator === "??") {
        const own = claim((p) => p.values?.nullish?.(s, a, b, n));
        if (own) return own;
        if (a.ty.k !== "opt") return a;
        if (b.ty.k === "undef") return a;
        if (b.iter !== undefined) fail(comp, "`??` falling back to a computed list", n);
        // A string a temporary owns: the result is one too, borrowed from the `Cow` either side gives.
        if (a.held !== undefined && b.ty.k === "str") return { code: `&*${atom(a.held)}.unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        if (a.ty.of.k === "str" && b.ty.k === "str" && isTemporary(b)) {
          return { code: `&*${atom(a.code)}.map(std::borrow::Cow::<str>::Borrowed).unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty.of, b.ty)) return { code: `${atom(a.code)}.unwrap_or(${bare(b.code)})`, ty: b.ty, ...loneOf(a, b) };
        if (sameTy(a.ty, b.ty)) return { code: `${atom(a.code)}.or(${bare(b.code)})`, ty: a.ty, ...loneOf(a, b) };
        // An integer and a fraction: both numbers in JavaScript, so a fraction here.
        if (a.ty.of.k === "float" && b.ty.k === "int") return { code: `${atom(a.code)}.unwrap_or(${bare(asF64(b))})`, ty: FLOAT };
        if (a.ty.of.k === "int" && b.ty.k === "float") return { code: `${atom(a.code)}.map(|v| v as f64).unwrap_or(${bare(b.code)})`, ty: FLOAT };
        return fail(comp, "`??` between different types", n);
      }
      if (n.operator === "||") {
        if (a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "||", b.code));
        if (b.ty.k === "undef") {
          // `x || undefined`: the value when it is truthy, nothing otherwise.
          const inner: Ty = a.ty.k === "opt" ? a.ty.of : a.ty;
          const src = a.ty.k === "opt" ? atom(a.code) : `Some(${bare(a.code)})`;
          return { code: `${src}.filter(|v| ${truthy({ code: "*v", ty: inner })})`, ty: opt(inner) };
        }
        if (a.ty.k === "str" && b.ty.k === "str" && known(a) !== undefined) return known(a) ? a : b;
        if (a.ty.k === "str" && b.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
          return { code: `&*{ let a = ${asCow(a)}; if !a.is_empty() { a } else { ${asCow(b)} } }`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty, b.ty) && (a.ty.k === "str" || isNumber(a.ty))) {
          const k = known(a);
          if (k !== undefined) return k ? a : b;
          const otherwise = a.ty.k === "str" ? strArg(b.code) : bare(b.code);
          return { code: `{ let a = ${bare(a.code)}; if ${truthy({ code: "a", ty: a.ty })} { a } else { ${otherwise} } }`, ty: a.ty, ...loneOf(a, b) };
        }
        return fail(comp, "`||` between these types", n);
      }
      if (n.operator === "&&" && a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "&&", b.code));
      return fail(comp, `\`${n.operator}\` is supported between booleans only`, n);
    }
    case "UnaryExpression":
      if (n.operator === "!") {
        return negatedOrder(s, n.argument) ?? boolOf(not(truthy(expr(s, n.argument))));
      }
      if (n.operator === "-") {
        const a = expr(s, n.argument);
        if (isNumber(a.ty) && a.num !== undefined) return numberVal(-a.num, a.ty.k === "int");
        if (a.ty.k === "int") return intFromF64(negate(asF64(a)));
        if (a.ty.k === "float") return { code: negate(a.code), ty: FLOAT };
      }
      return fail(comp, `unary \`${n.operator}\``, n);
    case "BinaryExpression": {
      if (n.operator !== "===" && n.operator !== "!==") fail(comp, `\`${n.operator}\``, n);
      // A test a plugin translates whole: `typeof route.query.q === "string"`.
      const whole = claim((p) => p.equality?.(s, n));
      if (whole) return whole;
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      let eq: string;
      const scalar = (t: Ty) => t.k === "str" || t.k === "int" || t.k === "bool";
      const strish = (t: Ty) => t.k === "str" || (t.k === "opt" && t.of.k === "str");
      if (strish(a.ty) && strish(b.ty)) meet(comp, a, b, `\`${n.operator}\``, n, "equal");
      // A value of a plugin's type, compared as the plugin compares it.
      const own = claim((p) => p.values?.equals?.(a, b));
      if (own !== undefined) eq = own;
      else if (b.ty.k === "undef" && a.ty.k === "opt") eq = `${atom(a.code)}.is_none()`;
      else if (a.ty.k === "undef" && b.ty.k === "opt") eq = `${atom(b.code)}.is_none()`;
      else if (a.ty.k === "undef" || b.ty.k === "undef") {
        // A value that is always present — or narrowed to present — is never \`undefined\`.
        const same = a.ty.k === b.ty.k;
        const konst = n.operator === "===" ? same : !same;
        return { code: String(konst), ty: BOOL, konst };
      }
      else if (isNumber(a.ty) && isNumber(b.ty)) eq = compare(a, "==", b).code;
      // Two string literals are compared now.
      else if (a.ty.k === "str" && b.ty.k === "str" && known(a) !== undefined && known(b) !== undefined) eq = String(unquote(a.code) === unquote(b.code));
      else if (a.ty.k === "str" && b.ty.k === "str" && (a.code === '""' || b.code === '""')) {
        // A string compared with the empty one: whether it is empty.
        eq = `${receiver(a.code === '""' ? b.code : a.code)}.is_empty()`;
      } else if (a.ty.k === "bool" && b.ty.k === "bool" && (a.konst !== undefined || b.konst !== undefined)) {
        // A boolean compared with `true` is itself, with `false` its negation.
        const [k, other] = a.konst !== undefined ? [a.konst, b.code] : [b.konst!, a.code];
        eq = k ? other : not(other);
      } else if (sameTy(a.ty, b.ty) && (scalar(a.ty) || (a.ty.k === "opt" && scalar(a.ty.of)))) {
        eq = binary(a.code, "==", b.code);
      } else if (a.ty.k === "opt" && sameTy(a.ty.of, b.ty) && scalar(b.ty)) eq = binary(a.code, "==", `Some(${bare(b.code)})`);
      else if (b.ty.k === "opt" && sameTy(b.ty.of, a.ty) && scalar(a.ty)) eq = binary(`Some(${bare(a.code)})`, "==", b.code);
      else return fail(comp, "`===` between these types", n);
      return boolOf(n.operator === "===" ? eq : not(eq));
    }
    case "ConditionalExpression": {
      const t = expr(s, n.test);
      const k = known(t);
      if (k !== undefined) return expr(s, k ? n.consequent : n.alternate);
      // A test for presence narrows the branch where the value is present, as TypeScript does.
      const p = presence(s, n.test);
      const name = p ? `n${++ctx.narrowCount}` : "";
      const a = expr(p && !p.negated ? narrowTo(s, p, name) : s, n.consequent);
      const b = expr(p && p.negated ? narrowTo(s, p, name) : s, n.alternate);
      // Two branches alike are one value, whatever the test.
      if (sameTy(a.ty, b.ty) && a.code === b.code && (!name || !occurrences(a.code, name))) return a;
      // A string in the second branch is coerced to the `&str` of the first.
      const second = (code: string) => (a.ty.k === "str" ? strArg(code) : bare(code));
      const choose = (yes: string, no: string): string => {
        if (!p) return choice(truthy(t), bare(yes), second(no));
        const [present, absent] = p.negated ? [bare(no), second(yes)] : [bare(yes), second(no)];
        // `x ? x : undefined` is the `Option` itself.
        if (present === `Some(${name})` && absent === "None") return p.option;
        // `x ? x : y`: the value, or the fallback.
        if (present === name) return `${atom(p.option)}.unwrap_or(${absent})`;
        if (occurrences(present, name)) return `if ${p.pattern(name)} { ${present} } else { ${absent} }`;
        return choice(p.present, present, absent);
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
            v.held ?? (v.ty.k === "undef" ? "None" : v.ty.k === "opt" ? `${atom(v.code)}.map(std::borrow::Cow::<str>::Borrowed)` : `Some(${asCow(v)})`);
          const both = atom(choose(held(a), held(b)));
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

/** A boolean computed at run time, or known now when it folded to a constant. */
export function boolOf(code: string): Val {
  return code === "true" || code === "false" ? { code, ty: BOOL, konst: code === "true" } : { code, ty: BOOL };
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
          return boolOf(binary(a.code, "==", b.code));
        }
        return fail(comp, "`v-model` comparison between these types", n);
      }
      case "_ssrIncludeBooleanAttr": {
        // `!!value || value === ""`: every string is included, empty or not.
        const a = expr(s, args[0]);
        if (a.konst !== undefined) return a;
        if (a.ty.k === "str") return { code: "true", ty: BOOL, konst: true };
        if (a.ty.k === "opt" && a.ty.of.k === "str") return { code: `${atom(a.code)}.is_some()`, ty: BOOL };
        return boolOf(truthy(a));
      }
      case "_ssrLooseContain":
        return fail(comp, "`v-model` over an array", n);
    }
    // A plugin's function, such as \`t(…)\` from \`useI18n()\`.
    const own = claim((p) => p.call?.(s, n));
    if (own) return own;
    const helper = s.helpers.get(callee.name);
    if (helper) return helperCall(s, helper, args, n);
    if (callee.name === "String" && args.length === 1) {
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return a;
      if (isNumber(a.ty)) return { code: `&*fv::Js(${bare(a.code)}).to_string()`, ty: STR };
      if (a.ty.k === "bool") return { code: `if ${condition(a.code)} { "true" } else { "false" }`, ty: STR };
    }
    // Strings read as numbers, as JavaScript reads them: a fraction, `NaN` when there is no number.
    if (callee.name === "Number" && args.length === 1) {
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return { code: `fv::js_number(${strArg(a.code)})`, ty: FLOAT };
      if (isNumber(a.ty)) return a;
      if (a.ty.k === "bool") return { code: `i64::from(${bare(a.code)})`, ty: INT };
      return fail(comp, "`Number()` takes a string, a number or a boolean that is present", n);
    }
    if ((callee.name === "parseInt" && (args.length === 1 || args.length === 2)) || (callee.name === "parseFloat" && args.length === 1)) {
      const a = expr(s, args[0]);
      // Not a number: `parseInt` reads it as a string, so `parseInt(0.0000005)` is 5.
      if (a.ty.k !== "str") fail(comp, `\`${callee.name}()\` takes a string`, args[0]);
      if (callee.name === "parseFloat") return { code: `fv::js_parse_float(${strArg(a.code)})`, ty: FLOAT };
      const radix = args[1];
      if (radix && !(radix.type === "NumericLiteral" && (radix.value === 10 || radix.value === 16))) {
        fail(comp, "`parseInt()` takes a radix of 10 or 16, written as a literal", radix);
      }
      return { code: `fv::js_parse_int(${strArg(a.code)}, ${radix ? radix.value : 0})`, ty: FLOAT };
    }
    return fail(comp, `\`${callee.name}()\` is not available when rendering on the server`, n);
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const method = callee.property.name as string;
    if (callee.object.type === "Identifier" && callee.object.name === "Array" && method === "isArray") {
      const a = expr(s, args[0]);
      const own = claim((p) => p.values?.isArray?.(a));
      if (own) return own;
      const is = a.ty.k === "list";
      return { code: String(is), ty: BOOL, konst: is };
    }
    if (callee.object.type === "Identifier" && callee.object.name === "Object") return objectCall(s, method, args, n);
    if (callee.object.type === "Identifier" && callee.object.name === "JSON" && method === "stringify" && args.length === 1) {
      const v = expr(s, args[0]);
      // A boolean is one of two literals, which need no `String`.
      if (v.ty.k === "bool") return { code: `if ${condition(v.code)} { "true" } else { "false" }`, ty: STR };
      return { code: `&*${json(s, v, args[0])}`, ty: STR };
    }
    // A plugin's function, such as `$t(…)` in the template.
    const own = claim((p) => p.call?.(s, n));
    if (own) return own;
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
          if (ints) return { code: vals.slice(1).reduce((acc, v) => `${atom(acc)}.${method}(${bare(v.code)})`, vals[0]!.code), ty: INT };
          return { code: vals.slice(1).reduce((acc, v) => `fv::js_${method}(${bare(acc)}, ${bare(asF64(v))})`, asF64(vals[0]!)), ty: FLOAT };
        }
        if (vals.length === 1) {
          const x = vals[0]!;
          if (method === "abs") return ints ? intFromF64(`${receiver(asF64(x))}.abs()`) : { code: `${receiver(x.code)}.abs()`, ty: FLOAT };
          if (method === "round") return { code: `fv::js_round(${bare(asF64(x))})`, ty: FLOAT };
          if (method === "floor" || method === "ceil" || method === "trunc") return { code: `${receiver(asF64(x))}.${method}()`, ty: FLOAT };
        }
      }
      return fail(comp, `\`Math.${method}()\` is supported on numbers as \`max\`, \`min\`, \`abs\`, \`round\`, \`floor\`, \`ceil\` and \`trunc\``, n);
    }
    const target = expr(s, callee.object);
    if (target.ty.k === "str") {
      const lone = loneOf(target);
      switch (args.length === 0 ? method : "") {
        case "trim":
          return { code: `fv::js_trim(${strArg(target.code)})`, ty: STR, ...lone };
        case "trimStart":
          return { code: `fv::js_trim_start(${strArg(target.code)})`, ty: STR, ...lone };
        case "trimEnd":
          return { code: `fv::js_trim_end(${strArg(target.code)})`, ty: STR, ...lone };
        // Unicode's default case mappings, which JavaScript and Rust both apply, final sigma included.
        case "toUpperCase":
          return { code: `&*${receiver(target.code)}.to_uppercase()`, ty: STR, ...lone };
        case "toLowerCase":
          return { code: `&*${receiver(target.code)}.to_lowercase()`, ty: STR, ...lone };
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
      return { code: `&*fv::js_to_fixed(${bare(asF64(target))}, ${d.value})`, ty: STR };
    }
    if (isNumber(target.ty) && method === "toString" && args.length === 0) {
      return { code: `&*fv::Js(${bare(target.code)}).to_string()`, ty: STR };
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
        if (of.k === "int") return { code: `${atom(target.code)}.contains(&${operand(v.code, UNARY)})`, ty: BOOL };
        const test = v.code === '""' ? "v.is_empty()" : binary("&**v", "==", v.code);
        return { code: `${atom(target.code)}.iter().any(|v| ${test})`, ty: BOOL };
      }
      if (method === "join" && args.length <= 1) {
        // JavaScript joins with a comma when given no separator.
        const sep: Val = args.length ? expr(s, args[0]) : { code: '","', ty: STR };
        if (sep.ty.k !== "str") fail(comp, "`.join()` takes a string", args[0]);
        const each = of.k === "str" ? `${atom(target.code)}.iter().map(|v| &**v)` : `${atom(target.code)}.iter().map(|v| fv::Js(*v).to_string())`;
        return { code: `&*${each}.collect::<Vec<_>>().join(${strArg(sep.code)})`, ty: STR, ...loneOf(sep) };
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
  // As an argument, where a `&str` parameter coerces the borrow.
  const t = strArg(target.code);
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
      return { code: `${receiver(target.code)}.${rust}(${bare(x.code)})`, ty: BOOL };
    }
    case "indexOf":
    case "lastIndexOf": {
      arity(1, 1);
      const x = str(0);
      meet(comp, target, x, `\`.${method}()\``, n, "search");
      return { code: `fv::js_${method === "indexOf" ? "index_of" : "last_index_of"}(${t}, ${strArg(x.code)})`, ty: INT };
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
      return { code: `${atom(held)}.as_deref()`, ty: opt(STR), held, ...cut };
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
      return computed(`fv::js_split(${t}, ${strArg(sep.code)}).into_iter()`, STR, target.lone || !nonEmptyLiteral(sep));
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
      return { code: `&*fv::js_${method === "replace" ? "replace" : "replace_all"}(${t}, ${strArg(pattern.code)}, ${strArg(replacement.code)})`, ty: STR, ...(lone ? cut : {}) };
    }
    case "padStart":
    case "padEnd": {
      arity(1, 2);
      const fill: Val = args.length > 1 ? str(1) : { code: '" "', ty: STR };
      // The fill repeats itself, and is cut short where a pair may be: before a string starting
      // with a half, the two would join.
      const whole = fill.code.startsWith('"') && !/[\u{10000}-\u{10FFFF}]/u.test(fill.code);
      if (fill.lone || (method === "padStart" && target.lone && !whole)) fail(comp, lonely(`\`.${method}()\``), n);
      return { code: `&*fv::js_${method === "padStart" ? "pad_start" : "pad_end"}(${t}, ${num(0, "0.0")}, ${strArg(fill.code)})`, ty: STR, ...(target.lone || !whole ? cut : {}) };
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
        return `fv::js_json_string(${code === "v" ? "&v" : strArg(code)})`;
      case "int":
        return `fv::Js(${bare(code)}).to_string()`;
      case "float":
        return `fv::js_json_number(${bare(code)})`;
      case "bool":
        return `(if ${condition(code)} { "true" } else { "false" }).to_owned()`;
      default:
        return fail(s.comp, "`JSON.stringify()` of a string, a number, a boolean or a list of those, present", n);
    }
  };
  if (v.ty.k === "list") {
    // A routine of the item alone is mapped as itself, without a closure around it.
    const each = one("v", v.ty.of);
    const f = /^([\w:]+)\(v\)$/.exec(each)?.[1];
    return `format!("[{}]", ${items(v)}.map(${f ?? `|v| ${each}`}).collect::<Vec<_>>().join(","))`;
  }
  return one(v.code, v.ty);
}

export function helperCall(s: Scope, name: string, args: N[], n: N): Val {
  const h = ctx.helpers[name]!;
  if (args.length !== h.params.length) fail(s.comp, `\`${name}\` takes ${h.params.length} argument(s)`, n);
  const code = args.map((a, i) => bare(coerce(s.comp, expr(s, a), h.params[i]!, a))).join(", ");
  s.helperBytes.n += h.maxLen;
  return { code: `${h.rust}(${code})`, ty: h.ret };
}
