import { type Component, type EnumDef, type N, type Scope, type Ty, type Val, BOOL, enumOf, fail, FLOAT, INT, joinTy, opt, sameTy, STR } from "./model.ts";
import { GenError } from "./errors.ts";
import { enumItemVal, enumListVal } from "./enums.ts";
import { fresh, jsHint } from "./names.ts";
import { describeTy, expr, fieldVal, statedTy, typedBy } from "./expr.ts";
import { tyNode } from "./objects.ts";
import { cond, unbound } from "./narrowing.ts";
import { localTy } from "./rust.ts";
import { asF64, isNumber } from "./numbers.ts";
import { asCow, isTemporary, yieldsCow } from "./strings.ts";
import { atom, bare, enclosed, operand, strArg, UNARY } from "./parens.ts";
import { expressionBodied } from "./blocks.ts";
import { borrowsHeld } from "./borrows.ts";
import { bindEntry, bindTuple, tupleParts } from "./destructuring.ts";
import { reduced } from "./reduce.ts";
import { flatMapped, flattened } from "./flat.ts";
import { sorted } from "./sorting.ts";
import { sameItem } from "./list-calls.ts";

export const COW = "std::borrow::Cow::<str>";

export function itemsTy(s: Scope, v: Val, n: N): Ty {
  if (v.ty.k !== "list") throw new Error("a list method on a value that is not a list");
  const of = v.ty.of;
  if (!["str", "int", "float", "bool", "date", "struct", "child", "entry"].includes(of.k)) {
    fail(s.comp, "FV0804", "this method takes a list of strings, numbers, booleans, dates or objects", n);
  }
  return of;
}

export function items(v: Val): string {
  if (v.iter !== undefined) return v.iter;
  const of = v.ty.k === "list" || v.ty.k === "record" ? v.ty.of : v.ty;
  if (of.k === "str") return `${atom(v.code)}.iter().map(|v| ${COW}::Borrowed(&**v))`;
  if (of.k === "struct" || of.k === "child") return `${atom(v.code)}.iter()`;
  return `${atom(v.code)}.iter().copied()`;
}

function enumSource(list: Val): { iter: string; def: EnumDef } | null {
  const of = list.ty.k === "list" ? list.ty.of : undefined;
  if (of === undefined || of.k === "opt") return null;
  if (list.variants?.of === list.code) return { iter: list.variants.iter, def: list.variants.def };
  if (list.enums !== undefined && list.iter !== undefined && list.iter === enumListVal(list.enums.place, list.ty, list.enums.def).iter) return { iter: `${atom(list.enums.place)}.iter().copied()`, def: list.enums.def };
  return null;
}

export function computed(iter: string, of: Ty, lone?: boolean): Val {
  return { code: `${iter}.collect::<Vec<_>>()`, ty: { k: "list", of }, iter, ...(lone ? { lone } : {}) };
}

export function collected(v: Val): string {
  const vec = v.iter !== undefined ? /^(.*)\.into_iter\(\)$/s.exec(v.iter)?.[1] : undefined;
  if (vec !== undefined && /^[({]/.test(vec) && enclosed(vec)) return bare(vec);
  const of = v.ty.k === "list" ? v.ty.of : v.ty;
  if (v.iter === undefined && of.k !== "str" && of.k !== "struct" && of.k !== "child") return `${atom(v.code)}.to_vec()`;
  const each = items(v);
  return `${each}${of.k === "str" && !borrowsHeld(each) ? `.map(|v| ${COW}::Owned(v.into_owned()))` : ""}.collect::<Vec<_>>()`;
}

export function sliced(v: Val): string {
  return v.slice ? v.code : `&${atom(v.code)}[..]`;
}

export function untypedEmpty(v: Val): boolean {
  return v.ty.k === "list" && v.ty.of.k === "undef";
}

export function typedEmpty(comp: Component, of: Ty): Val {
  const held = of.k === "date" ? "f64" : of.k === "opt" && of.of.k === "date" ? "Option<f64>" : localTy(of, comp);
  return { code: `<&[${held}]>::default()`, ty: { k: "list", of }, slice: true };
}

/** A date, or a list of dates, that the server holds at `place` (a reference to one when `byRef`),
 * as an expression reads it: each date its time value. `null` for a value held as it is. */
export function heldDates(place: string, ty: Ty, byRef: boolean): Val | null {
  if (ty.k === "date") return { code: `fv::date::js_time_of(${byRef ? place : `&${place}`})`, ty };
  if (ty.k === "list" && ty.of.k === "date") return computed(`${atom(place)}.iter().map(fv::date::js_time_of)`, ty.of);
  if (ty.k === "list" && ty.of.k === "opt" && ty.of.of.k === "date") return computed(`${atom(place)}.iter().map(|v| v.as_ref().map(fv::date::js_time_of))`, ty.of);
  if (ty.k !== "opt") return null;
  if (ty.of.k === "date") return { code: `${atom(place)}.as_ref().map(fv::date::js_time_of)`, ty };
  const inner = heldDates("v", ty.of, true);
  return inner === null ? null : { code: `${atom(place)}.as_ref().map(|v| ${inner.code})`, ty };
}

export function heldList(name: string, of: Ty, lone?: boolean): Val {
  const iter = of.k === "str" ? `${name}.iter().map(|v| ${COW}::Borrowed(&**v))` : `${name}.iter().copied()`;
  return { code: name, ty: { k: "list", of }, iter, ...(lone ? { lone } : {}) };
}

export function itemVal(of: Ty, param: string, byRef: boolean, lone?: boolean): Val {
  const scalar = of.k === "int" || of.k === "float" || of.k === "bool" || of.k === "date";
  const code = of.k === "str" ? (byRef ? `&**${param}` : `&*${param}`) : byRef && scalar ? `*${param}` : param;
  return { code, ty: of, ...(lone ? { lone } : {}) };
}

export function arrow(s: Scope, fn: N, list: Val, of: Ty, byRef: boolean, method: string, body: (inner: Scope) => string, itemOf?: (param: string) => Val): { closure: string; enumerate: boolean } {
  const comp = s.comp;
  if (fn?.type !== "ArrowFunctionExpression" || fn.async || fn.params.length > 2) {
    fail(comp, "FV0805", `\`.${method}()\` takes an arrow function of the item, and of its index: \`x => …\`, \`(x, i) => …\`, or \`Boolean\``, fn);
  }
  const [item, index] = fn.params as N[];
  if (index && index.type !== "Identifier") fail(comp, "FV0807", "an arrow function's index is a plain name", index);
  const p = fresh(of.k === "str" ? "s" : "a", item?.type === "Identifier" ? jsHint(item.name) : "item");
  const i = fresh("i", index ? jsHint(index.name) : "index");
  const v = itemOf?.(p) ?? itemVal(of, p, byRef, list.lone);
  const locals = new Map(s.locals);
  const bound: string[] = [];
  if (item?.type === "Identifier") {
    locals.set(item.name, v);
    bound.push(item.name);
  } else if (item?.type === "ObjectPattern" && (of.k === "struct" || of.k === "child")) {
    for (const prop of item.properties) {
      if (prop.type !== "ObjectProperty" || prop.computed || prop.value.type !== "Identifier") {
        fail(comp, "FV0808", "a destructured arrow function parameter binds plain names, without defaults", prop);
      }
      locals.set(prop.value.name, fieldVal(comp, v.code, of, prop.key.name ?? prop.key.value, prop));
      bound.push(prop.value.name);
    }
  } else if (item?.type === "ArrayPattern" && of.k === "entry") bindEntry(comp, item, v, locals, bound, "FV0808");
  else if (item?.type === "ArrayPattern" && tupleParts(comp, of) !== null) bindTuple(comp, item, v, locals, bound, "FV0808");
  else if (item) fail(comp, "FV0809", `an arrow function's item is a name, or ${of.k === "entry" ? "an array pattern of a `[key, value]` pair" : "an object pattern of an object, or an array pattern of a tuple"}`, item);
  if (index) {
    locals.set(index.name, { code: i, ty: INT });
    bound.push(index.name);
  }
  const narrowed = unbound(s.narrowed, bound);
  const code = body({ ...s, locals, narrowed });
  const reads = (name: string) => new RegExp(`\\b${name}\\b`).test(code);
  const pName = reads(p) ? p : "_";
  const called = new RegExp(`^(fv::(?:\\w+::)*\\w+)\\(${p}\\)$`).exec(code)?.[1];
  if (!index && called !== undefined && !byRef) return { closure: called, enumerate: false };
  if (!index) return { closure: `|${pName}| ${code}`, enumerate: false };
  const lets = (reads(i) ? `let ${i} = ${i} as i64; ` : "");
  if (byRef) {
    const e = fresh("e", "entry");
    const itemLet = reads(p) ? `let ${p} = &${e}.1; ` : "";
    const indexLet = reads(i) ? `let ${i} = ${e}.0 as i64; ` : "";
    return { closure: `|${itemLet || indexLet ? e : "_"}| { ${itemLet}${indexLet}${code} }`, enumerate: true };
  }
  return { closure: `|(${reads(i) ? i : "_"}, ${pName})| { ${lets}${code} }`, enumerate: true };
}

export function mapped(s: Scope, v: Val, n: N): string {
  switch (v.ty.k) {
    case "str":
      if ((v.code.startsWith("&*fv::") || v.code.startsWith("&*fv_refusals.")) && yieldsCow(v.code.slice(2))) return `${COW}::Owned(${v.code.slice(2)}.into_owned())`;
      const item = /^&\**(fv_s\d+)$/.exec(v.code)?.[1];
      if (item !== undefined) return `${COW}::Owned(${item}.to_string())`;
      if (isTemporary(v)) return /\bfv_s\d+\b/.test(v.code) ? `${COW}::Owned(${atom(asCow(v))}.into_owned())` : asCow(v);
      return /\bfv_s\d+\b/.test(v.code) ? `${COW}::Owned(${atom(v.code)}.to_owned())` : `${COW}::Borrowed(${strArg(v.code)})`;
    case "int":
    case "float":
    case "bool":
      return v.code;
    case "struct":
    case "child":
      return v.owned ? bare(v.code) : `&${operand(v.code, UNARY)}`;
    case "entry":
      return fail(s.comp, "FV0816", "`.map()` to the `[key, value]` pairs of `Object.entries()` makes a list of pairs, which the server walks but does not keep: map each pair to its key, its value or a value made of them", n);
    default:
      return fail(s.comp, "FV0810", `\`.map()\` makes a list of strings, numbers, booleans or objects, not ${v.ty.k === "opt" ? "optional values" : "these"}`, n);
  }
}

/** Is `n` the global `Boolean` (`.filter(Boolean)`, `Boolean(x)`), which no name in the component shadows? */
export function isBoolean(s: Scope, n: N): boolean {
  return n?.type === "Identifier" && n.name === "Boolean" && ![s.locals, s.setup, s.helpers, s.clientOnly].some((names) => names.has(n.name));
}

function booleanArrow(n: N, method: string): N {
  const item = { ...n, name: "fv$item" };
  const not = (argument: N): N => ({ ...n, type: "UnaryExpression", operator: "!", prefix: true, argument });
  return { ...n, type: "ArrowFunctionExpression", async: false, params: [item], body: method === "map" ? not(not(item)) : item };
}

function present(target: Val): Val | null {
  if (target.ty.k !== "list" || target.ty.of.k !== "opt" || target.iter !== undefined) return null;
  const of = target.ty.of.of;
  const list = atom(target.code);
  switch (of.k) {
    case "str":
      return computed(`${list}.iter().filter_map(|v| v.as_deref()).map(${COW}::Borrowed)`, of, target.lone);
    case "int":
    case "float":
    case "bool":
      return computed(`${list}.iter().filter_map(|v| *v)`, of);
    case "struct":
    case "child":
      return computed(`${list}.iter().filter_map(|v| v.as_ref())`, of);
    default:
      return null;
  }
}

export function backwards(target: Val): string {
  return target.iter === undefined ? items(target) : `${target.iter}.collect::<Vec<_>>().into_iter()`;
}

/**
 * The item of `target` that `fromList` (given the list) or `fromIter` (given its items) picks, as
 * an optional value: `undefined` where the list has no item there.
 */
export function picked(s: Scope, target: Val, n: N, fromList: (list: string) => string, fromIter: (items: string) => string): Val {
  const of = target.ty.k === "list" ? target.ty.of : target.ty;
  const lone = target.lone ? { lone: true as const } : {};
  if (target.iter !== undefined) {
    const got = fromIter(target.iter);
    if (of.k === "str") return { code: `${atom(got)}.as_deref()`, ty: opt(STR), held: `${got}.map(|v| ${COW}::Owned(v.into_owned()))`, ...lone };
    if (["int", "float", "bool", "date", "struct", "child", "entry"].includes(of.k)) return { code: got, ty: opt(of), ...lone };
  } else {
    const got = fromList(atom(target.code));
    const inner = of.k === "opt" ? of.of : of;
    const flat = of.k === "opt";
    switch (inner.k) {
      case "str":
        return { code: flat ? `${got}.and_then(|v| v.as_deref())` : `${got}.map(|v| &**v)`, ty: opt(of), ...lone };
      case "int":
      case "float":
      case "bool":
      case "date":
        return { code: flat ? `${got}.and_then(|v| *v)` : `${got}.copied()`, ty: opt(of) };
      case "entry":
        return { code: `${got}.copied()`, ty: opt(of), ...lone };
      case "struct":
      case "child":
        return { code: flat ? `${got}.and_then(|v| v.as_ref())` : got, ty: opt(of) };
      default:
        break;
    }
  }
  return fail(s.comp, "FV0804", "an item is read from a list of strings, numbers, booleans or objects, each of which may be absent", n);
}

function itemsOf(s: Scope, n: N): N | undefined {
  if (n.fvTyped === undefined) return undefined;
  try {
    const ty = statedTy(s, n.fvTyped, n.fvFrom);
    const list = ty.k === "opt" ? ty.of : ty;
    return list.k === "list" ? tyNode(list.of) : undefined;
  } catch (e) {
    if (e instanceof GenError) return undefined;
    throw e;
  }
}

export function listMethod(s: Scope, target: Val, method: string, given: N[], n: N): Val | null {
  const comp = s.comp;
  const args = given.map((a) => expressionBodied(comp, a));
  if (method === "reduce" || method === "reduceRight") return reduced(s, target, method, args, n);
  if (method === "flat") return flattened(s, target, args, n);
  if (method === "flatMap") return flatMapped(s, target, args, n);
  if (method === "toReversed") {
    if (args.length !== 0) fail(comp, "FV0602", "`.toReversed()` takes no arguments", n);
    const of = itemsTy(s, target, n);
    const held = target.iter !== undefined && of.k !== "entry" && /^[\w.]+\.iter\(\)(?:\.copied\(\)|\.map\(\|v\| std::borrow::Cow::<str>::Borrowed\(&\*\*v\)\))?$/.test(target.iter);
    return computed(`${held ? target.iter : backwards(target)}.rev()`, of, target.lone);
  }
  if (method === "toSorted") return sorted(s, target, args, n);
  if (method === "sort" || method === "reverse") {
    fail(comp, "FV0832", `\`.${method}()\` changes the list in place, which a render must not do to its props or state: write \`.${method === "sort" ? "toSorted" : "toReversed"}()\`, or \`[...list].${method}(…)\``, n);
  }
  if (method === "at") {
    if (args.length !== 1) fail(comp, "FV0825", "`.at()` takes one index", n);
    const i = expr(s, args[0]);
    if (!isNumber(i.ty)) fail(comp, "FV0825", `\`.at()\` takes a number that is present, and this index is ${describeTy(i.ty)}`, args[0]);
    const f = bare(asF64(i));
    return picked(s, target, n, (list) => `fv::strings::js_item_at(${list}.iter(), ${f})`, (it) => `fv::strings::js_item_at(${it}, ${f})`);
  }
  if (method === "indexOf" || method === "lastIndexOf") {
    if (args.length !== 1) fail(comp, "FV0826", `\`.${method}()\` takes one value to look for, without a position to start from`, n);
    const of = target.ty.k === "list" ? target.ty.of : target.ty;
    const x = expr(s, args[0]);
    const v = fresh("x", "item");
    const test = sameItem(s, target, of, x, v, "FV0826", method, args[0]);
    const it = items(target);
    const found = method === "indexOf" ? `${it}.position(|${v}| ${test})` : `${backwards(target)}.rposition(|${v}| ${test})`;
    return { code: `${found}.map_or(-1, |i| i as i64)`, ty: INT };
  }
  if (method === "concat") {
    const own = itemsTy(s, target, n);
    const parts = args.map((a) => {
      const part = a?.type === "SpreadElement" ? null : expr(s, a);
      const numbers = part?.ty.k === "list" && isNumber(part.ty.of) && isNumber(own);
      if (part?.ty.k !== "list" || (!untypedEmpty(part) && !sameTy(part.ty.of, own) && !numbers)) {
        fail(comp, "FV0827", `\`.concat()\` joins lists of the list's own item type, ${describeTy(own)}`, a);
      }
      return part;
    }).filter((p) => !untypedEmpty(p));
    const of = [target, ...parts].some((p) => p.ty.k === "list" && p.ty.of.k === "float") ? FLOAT : parts.reduce((t, p) => joinTy(t, (p.ty as { of: Ty }).of), own);
    const each = (p: Val): string => (of.k === "float" && p.ty.k === "list" && p.ty.of.k === "int" ? `${items(p)}.map(|v| v as f64)` : items(p));
    const joined = parts.reduce((acc, p) => `${acc}.chain(${each(p)})`, each(target));
    return computed(joined, of, [target, ...parts].some((p) => p.lone));
  }
  if (!["filter", "map", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "slice"].includes(method)) return null;
  if (args.length === 1 && isBoolean(s, args[0])) {
    const kept = method === "filter" ? present(target) : null;
    const of = itemsTy(s, kept ?? target, n);
    if (method === "filter" && (of.k === "struct" || of.k === "child")) return kept ?? computed(items(target), of, target.lone);
    return listMethod(s, kept ?? target, method, [booleanArrow(args[0], method)], n);
  }
  const of = itemsTy(s, target, n);
  const it = items(target);
  if (method === "slice") {
    if (args.length < 1 || args.length > 2) fail(comp, "FV0811", "`.slice()` takes a start, and an end", n);
    const [start, end] = args.map((a) => expr(s, a));
    const index = (v: Val | undefined): string | null => {
      if (v === undefined || v.ty.k === "undef") return null;
      if (!isNumber(v.ty)) fail(comp, "FV0812", "`.slice()` takes numbers", n);
      return asF64(v);
    };
    const from = index(start) ?? "0.0";
    const to = index(end);
    return computed(
      `fv::strings::js_slice_items(${it}, ${from}, ${to === null ? "None" : `Some(${to})`})`,
      of,
      target.lone,
    );
  }
  if (args.length !== 1) fail(comp, "FV0813", `\`.${method}()\` takes one arrow function`, n);
  const fn = args[0];
  switch (method) {
    case "filter": {
      const { closure, enumerate } = arrow(s, fn, target, of, true, method, (inner) => cond(inner, fn.body));
      const made = computed(enumerate ? `${it}.enumerate().filter(${closure}).map(|(_, v)| v)` : `${it}.filter(${closure})`, of, target.lone);
      const src = enumSource(target);
      if (src === null) return made;
      const kept = arrow(s, fn, target, of, true, method, (inner) => cond(inner, fn.body), (p) => enumItemVal(`*${p}`, of, src.def));
      return { ...made, variants: { of: made.code, iter: kept.enumerate ? `${src.iter}.enumerate().filter(${kept.closure}).map(|(_, v)| v)` : `${src.iter}.filter(${kept.closure})`, def: src.def } };
    }
    case "map": {
      let out: Val | undefined;
      const returns = fn.returnType?.typeAnnotation ?? itemsOf(s, n);
      const body = returns && fn.body ? typedBy(fn.body, returns) : fn.body;
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => {
        out = expr({ ...inner, mapping: true }, body);
        if (out.ty.k === "int" && out.f64 !== undefined && (out.num === undefined || Object.is(out.num, -0)) && /-[\w(]|\s[*%]\s/.test(out.f64)) out = { ...out, code: out.f64, ty: FLOAT };
        return mapped(inner, out, fn.body);
      });
      const each = !enumerate && /^\|(\w+)\| \1$/.test(closure) ? it : `${it}${enumerate ? ".enumerate()" : ""}.map(${closure})`;
      if (out!.owned) return { code: `${each}.collect::<Vec<_>>()`, ty: { k: "list", of: out!.ty }, owned: true, ...(out!.lone ? { lone: true } : {}) };
      const made = computed(each, out!.ty, out!.lone);
      const src = enumSource(target);
      if (out!.ty.k !== "str" || (src === null && out!.variant === undefined)) return made;
      let def: EnumDef | undefined;
      const variants = arrow(
        s,
        fn,
        target,
        of,
        false,
        method,
        (inner) => {
          const v = expr({ ...inner, mapping: true }, body);
          if (v.variant !== undefined && v.ty.k !== "opt") def = enumOf(v.ty);
          return bare(def === undefined ? "()" : v.variant!);
        },
        src === null ? undefined : (p) => enumItemVal(p, of, src.def),
      );
      const from = src === null ? it : src.iter;
      const iter = !variants.enumerate && /^\|(\w+)\| \1$/.test(variants.closure) ? from : `${from}${variants.enumerate ? ".enumerate()" : ""}.map(${variants.closure})`;
      return def === undefined ? made : { ...made, variants: { of: made.code, iter, def } };
    }
    case "some":
    case "every": {
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => cond(inner, fn.body));
      return { code: `${it}${enumerate ? ".enumerate()" : ""}.${method === "some" ? "any" : "all"}(${closure})`, ty: BOOL };
    }
    case "find":
    case "findLast": {
      const { closure, enumerate } = arrow(s, fn, target, of, true, method, (inner) => cond(inner, fn.body));
      const from = method === "find" ? it : backwards(target);
      const rev = method === "find" ? "" : ".rev()";
      const found = enumerate ? `${from}.enumerate()${rev}.find(${closure}).map(|(_, v)| v)` : `${from}${rev}.find(${closure})`;
      const lone = target.lone ? { lone: true } : {};
      if (of.k === "str") return { code: `${atom(found)}.as_deref()`, ty: opt(STR), held: `${found}.map(|v| ${COW}::Owned(v.into_owned()))`, ...lone };
      return { code: found, ty: opt(of), ...lone };
    }
    default: {
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => cond(inner, fn.body));
      const [from, search] = method === "findIndex" ? [it, "position"] : [backwards(target), "rposition"];
      return { code: `${from}${enumerate ? ".enumerate()" : ""}.${search}(${closure}).map_or(-1, |i| i as i64)`, ty: INT };
    }
  }
}
