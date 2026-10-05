/* Lists a template computes: array methods taking arrow functions (`filter`, `map`, `some`,
 * `every`, `find`, `findIndex`), `slice`, and `Object.keys` / `values` of a record.
 *
 * A computed list is an iterator of its items, each in one form whatever list it came from: a
 * string as a `Cow<str>` (borrowed from the props, or owned when `map` made it), a number or a
 * boolean copied, an object borrowed. That is what lets one method's result feed the next, a
 * `v-for`, `.join` or `.length`, without knowing where it came from. */

import { type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, INT, opt, sameTy, STR } from "./model.ts";
import { ctx } from "./context.ts";
import { expr, fieldVal } from "./expr.ts";
import { cond } from "./narrowing.ts";
import { asF64, isNumber } from "./numbers.ts";
import { asCow, isTemporary, lonely, meet, yieldsCow } from "./strings.ts";
import { atom, operand, strArg, UNARY } from "./parens.ts";

const COW = "std::borrow::Cow::<str>";

/** The type of a list's items, which must be one these methods can pass along. */
function itemsTy(s: Scope, v: Val, n: N): Ty {
  if (v.ty.k !== "list") return fail(s.comp, "not a list", n);
  const of = v.ty.of;
  if (!["str", "int", "float", "bool", "struct", "child"].includes(of.k)) {
    fail(s.comp, "this method takes a list of strings, numbers, booleans or objects", n);
  }
  return of;
}

/** A list as an iterator of its items, in the form a computed list holds them. */
export function items(v: Val): string {
  if (v.iter !== undefined) return v.iter;
  const of = v.ty.k === "list" || v.ty.k === "record" ? v.ty.of : v.ty;
  // A list of strings holds `Cow`s, an array literal `&str`s: either way `&**v` is the `&str`.
  if (of.k === "str") return `${atom(v.code)}.iter().map(|v| ${COW}::Borrowed(&**v))`;
  if (of.k === "struct" || of.k === "child") return `${atom(v.code)}.iter()`;
  return `${atom(v.code)}.iter().copied()`;
}

/** A computed list: its iterator, and its items collected as `code` for anything that needs a
 * `Vec`. */
export function computed(iter: string, of: Ty, lone?: boolean): Val {
  return { code: `${iter}.collect::<Vec<_>>()`, ty: { k: "list", of }, iter, ...(lone ? { lone } : {}) };
}

/** A list of any kind as the `Vec` of items a computed list collects: what a branch of `?:` or a
 * setup `let` holds, so that both branches have one type. Kept beyond the statement, its strings
 * own their text, which may live in a temporary (`name.toUpperCase().split(" ")`). */
export function collected(v: Val): string {
  const of = v.ty.k === "list" ? v.ty.of : v.ty;
  return `${items(v)}${of.k === "str" ? `.map(|v| ${COW}::Owned(v.into_owned()))` : ""}.collect::<Vec<_>>()`;
}

/** The computed list a setup `let` named `name` holds, read again by item. */
export function heldList(name: string, of: Ty, lone?: boolean): Val {
  const iter = of.k === "str" ? `${name}.iter().map(|v| ${COW}::Borrowed(&**v))` : `${name}.iter().copied()`;
  return { code: name, ty: { k: "list", of }, iter, ...(lone ? { lone } : {}) };
}

/** An item as the closure that a method hands it to sees it: `byRef` for `filter` and `find`, which
 * pass `&item`. */
function itemVal(of: Ty, param: string, byRef: boolean, lone?: boolean): Val {
  // An object's fields are read through the reference; a number or a boolean is copied out of it.
  const scalar = of.k === "int" || of.k === "float" || of.k === "bool";
  const code = of.k === "str" ? (byRef ? `&**${param}` : `&*${param}`) : byRef && scalar ? `*${param}` : param;
  return { code, ty: of, ...(lone ? { lone } : {}) };
}

/** An arrow function's body, translated with its parameters bound — the item, and the index when it
 * names one — as the closure a method takes. `enumerate` says the items must come numbered. */
function arrow(s: Scope, fn: N, list: Val, of: Ty, byRef: boolean, method: string, body: (inner: Scope) => string): { closure: string; enumerate: boolean } {
  const comp = s.comp;
  if (fn?.type !== "ArrowFunctionExpression" || fn.async || fn.params.length > 2) {
    fail(comp, `\`.${method}()\` takes an arrow function of the item, and of its index: \`x => …\`, \`(x, i) => …\``, fn);
  }
  if (fn.body.type === "BlockStatement") fail(comp, `\`.${method}()\` takes an arrow function whose body is an expression, without \`{ return … }\``, fn);
  const [item, index] = fn.params as N[];
  if (index && index.type !== "Identifier") fail(comp, "an arrow function's index is a plain name", index);
  const n = ++ctx.narrowCount;
  // A string item is named apart: `map` cannot hand back a borrow of it (see `mapped`).
  const p = of.k === "str" ? `fv_s${n}` : `fv_a${n}`;
  const i = `fv_i${n}`;
  const v = itemVal(of, p, byRef, list.lone);
  const locals = new Map(s.locals);
  const bound: string[] = [];
  if (item?.type === "Identifier") {
    locals.set(item.name, v);
    bound.push(item.name);
  } else if (item?.type === "ObjectPattern" && (of.k === "struct" || of.k === "child")) {
    // `({ id, label }) => …`: each name is that field of the item.
    for (const prop of item.properties) {
      if (prop.type !== "ObjectProperty" || prop.computed || prop.value.type !== "Identifier") {
        fail(comp, "a destructured arrow function parameter binds plain names, without defaults", prop);
      }
      locals.set(prop.value.name, fieldVal(comp, v.code, of, prop.key.name ?? prop.key.value, prop));
      bound.push(prop.value.name);
    }
  } else if (item) fail(comp, "an arrow function's item is a name, or an object pattern of an object", item);
  if (index) {
    locals.set(index.name, { code: i, ty: INT });
    bound.push(index.name);
  }
  // The parameters hide whatever an outer `v-if` narrowed under the same names.
  const narrowed = new Map([...s.narrowed].filter(([path]) => !bound.some((b) => path === b || path.startsWith(`${b}.`))));
  const code = body({ ...s, locals, narrowed });
  const reads = (name: string) => new RegExp(`\\b${name}\\b`).test(code);
  const pName = reads(p) ? p : "_";
  if (!index) return { closure: `|${pName}| ${code}`, enumerate: false };
  const lets = (reads(i) ? `let ${i} = ${i} as i64; ` : "");
  if (byRef) {
    const e = `fv_e${n}`;
    const itemLet = reads(p) ? `let ${p} = &${e}.1; ` : "";
    const indexLet = reads(i) ? `let ${i} = ${e}.0 as i64; ` : "";
    return { closure: `|${itemLet || indexLet ? e : "_"}| { ${itemLet}${indexLet}${code} }`, enumerate: true };
  }
  return { closure: `|(${reads(i) ? i : "_"}, ${pName})| { ${lets}${code} }`, enumerate: true };
}

/** What `map` makes of each item: a string as a `Cow` — owned when it was built, or borrows the
 * item, which the closure owns — a number or a boolean as it is, an object borrowed. */
function mapped(s: Scope, v: Val, n: N): string {
  switch (v.ty.k) {
    case "str":
      // A routine's `Cow` may borrow the item, which the closure owns: owned.
      if (v.code.startsWith("&*fv::") && yieldsCow(v.code.slice(2))) return `${COW}::Owned(${v.code.slice(2)}.into_owned())`;
      // An item itself, of this list or one outside it, which the closure only borrows: copied.
      const item = /^&\**(fv_s\d+)$/.exec(v.code)?.[1];
      if (item !== undefined) return `${COW}::Owned(${item}.to_string())`;
      if (isTemporary(v)) return asCow(v);
      return /\bfv_s\d+\b/.test(v.code) ? `${COW}::Owned(${atom(v.code)}.to_owned())` : `${COW}::Borrowed(${strArg(v.code)})`;
    case "int":
    case "float":
    case "bool":
      return v.code;
    case "struct":
    case "child":
      return `&${operand(v.code, UNARY)}`;
    default:
      return fail(s.comp, `\`.map()\` makes a list of strings, numbers, booleans or objects, not ${v.ty.k === "opt" ? "optional values" : "these"}`, n);
  }
}

/** A list method other than `includes` and `join`: `null` when `method` is not one of them. */
export function listMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  const comp = s.comp;
  if (!["filter", "map", "some", "every", "find", "findIndex", "slice"].includes(method)) return null;
  const of = itemsTy(s, target, n);
  const it = items(target);
  if (method === "slice") {
    if (args.length < 1 || args.length > 2) fail(comp, "`.slice()` takes a start, and an end", n);
    const [start, end] = args.map((a) => expr(s, a));
    const index = (v: Val | undefined): string | null => {
      if (v === undefined || v.ty.k === "undef") return null;
      if (!isNumber(v.ty)) fail(comp, "`.slice()` takes numbers", n);
      return asF64(v);
    };
    const from = index(start) ?? "0.0";
    const to = index(end);
    return computed(
      `fv::js_slice_items(${it}, ${from}, ${to === null ? "None" : `Some(${to})`})`,
      of,
      target.lone,
    );
  }
  if (args.length !== 1) fail(comp, `\`.${method}()\` takes one arrow function`, n);
  const fn = args[0];
  switch (method) {
    case "filter": {
      const { closure, enumerate } = arrow(s, fn, target, of, true, method, (inner) => cond(inner, fn.body));
      return computed(enumerate ? `${it}.enumerate().filter(${closure}).map(|(_, v)| v)` : `${it}.filter(${closure})`, of, target.lone);
    }
    case "map": {
      let out: Val | undefined;
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => {
        out = expr(inner, fn.body);
        // An integer negated, multiplied or taken modulo may be JavaScript's -0, which a list of
        // `i64` loses: a list of fractions then. (Generated code spaces a binary `-`, never a unary one.)
        if (out.ty.k === "int" && out.f64 !== undefined && /-[\w(]|\s[*%]\s/.test(out.f64)) out = { ...out, code: out.f64, ty: FLOAT };
        return mapped(inner, out, fn.body);
      });
      return computed(`${it}${enumerate ? ".enumerate()" : ""}.map(${closure})`, out!.ty, out!.lone);
    }
    case "some":
    case "every": {
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => cond(inner, fn.body));
      return { code: `${it}${enumerate ? ".enumerate()" : ""}.${method === "some" ? "any" : "all"}(${closure})`, ty: BOOL };
    }
    case "find": {
      const { closure, enumerate } = arrow(s, fn, target, of, true, method, (inner) => cond(inner, fn.body));
      const found = enumerate ? `${it}.enumerate().find(${closure}).map(|(_, v)| v)` : `${it}.find(${closure})`;
      const lone = target.lone ? { lone: true } : {};
      // A string found is a `Cow` the statement holds, read as the `&str` an optional string is; one
      // kept beyond the statement owns its text, which may live in a temporary.
      if (of.k === "str") return { code: `${atom(found)}.as_deref()`, ty: opt(STR), held: `${found}.map(|v| ${COW}::Owned(v.into_owned()))`, ...lone };
      return { code: found, ty: opt(of), ...lone };
    }
    default: {
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => cond(inner, fn.body));
      return { code: `${it}${enumerate ? ".enumerate()" : ""}.position(${closure}).map_or(-1, |i| i as i64)`, ty: INT };
    }
  }
}

/** `Object.keys(r)`, `Object.values(r)`, and `Object.entries(r)`, which is only a `v-for`'s source. */
export function objectCall(s: Scope, method: string, args: N[], n: N): Val {
  const comp = s.comp;
  const r = args.length === 1 ? expr(s, args[0]) : null;
  if (r?.ty.k !== "record") return fail(comp, `\`Object.${method}()\` takes a \`Record<string, T>\``, n);
  const of = r.ty.of;
  if (method === "keys") return computed(`${atom(r.code)}.keys().map(${COW}::Borrowed)`, STR);
  if (method === "values") {
    if (of.k === "list") fail(comp, "`Object.values()` of a record of lists, which these methods cannot walk", n);
    const values = of.k === "str" ? `.values().map(|v| ${COW}::Borrowed(&**v))` : of.k === "struct" || of.k === "child" ? ".values()" : ".values().copied()";
    return computed(`${atom(r.code)}${values}`, of);
  }
  if (method === "entries") return fail(comp, "`Object.entries()` is supported as the source of a `v-for`: `([key, value], i) in Object.entries(r)`", n);
  return fail(comp, `\`Object.${method}()\` is not supported: \`keys\`, \`values\` and \`entries\` of a record are`, n);
}

/** `list.includes(x)` and `list.join(sep)` of a computed list, or of a list of fractions or
 * booleans. */
export function computedListMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  if (target.ty.k !== "list") return null;
  const of = target.ty.of;
  if (method === "includes" && args.length === 1) {
    const x = expr(s, args[0]);
    if (!sameTy(x.ty, of) || !["str", "int", "float", "bool"].includes(of.k)) fail(s.comp, "`.includes()` looks for a value of the list's own type", args[0]);
    if (of.k === "str") meet(s.comp, target, x, "`.includes()`", n, "equal");
    // `includes` finds `NaN`, which `==` never equals.
    const test = of.k === "str" ? `*v == ${x.code.startsWith("&*") ? `*${x.code.slice(2)}` : `*${operand(x.code, UNARY)}`}` : of.k === "float" ? `v == ${x.code} || (v.is_nan() && ${atom(x.code)}.is_nan())` : `v == ${x.code}`;
    return { code: `${items(target)}.any(|v| ${test})`, ty: BOOL };
  }
  if (method === "join" && args.length <= 1) {
    if (!["str", "int", "float", "bool"].includes(of.k)) return null;
    const sep: Val = args.length ? expr(s, args[0]) : { code: '","', ty: STR };
    if (sep.ty.k !== "str") fail(s.comp, "`.join()` takes a string", args[0]);
    // Two halves of a pair would meet where items are joined without a separator between them.
    const parted = /^"[^"]/.test(sep.code);
    if (of.k === "str" && target.lone && (!parted || sep.lone)) fail(s.comp, lonely("`.join()` with no literal separator"), n);
    const each = of.k === "str" ? "" : of.k === "bool" ? `.map(|v| if v { "true" } else { "false" })` : ".map(|v| fv::Js(v).to_string())";
    return { code: `&*${items(target)}${each}.collect::<Vec<_>>().join(${strArg(sep.code)})`, ty: STR, ...(target.lone || sep.lone ? { lone: true } : {}) };
  }
  return null;
}
