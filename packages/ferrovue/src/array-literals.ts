import { type N, type Scope, type Ty, type Val, BOOL, FLOAT, UNDEF } from "./model.ts";
import { fail } from "./locate.ts";
import { joinTy, sameTy } from "./literal-types.ts";
import { describeTy, expr } from "./expr.ts";
import { computed, COW, items, untypedEmpty } from "./lists.ts";
import { bare } from "./parens.ts";
import { asF64, isNumber } from "./numbers.ts";
import { asCow } from "./strings.ts";

/**
 * An array literal some of whose items may be absent, filtered by `Boolean`
 * (`[name, title].filter(Boolean)`): the items that are present, as a list. `null` when none may
 * be absent, which is an ordinary array literal.
 */
export function presentLiteral(s: Scope, n: N): Val | null {
  const comp = s.comp;
  if (n.elements.some((el: N) => el?.type === "SpreadElement")) return null;
  const values = n.elements.map((el: N) => {
    if (!el) fail(comp, "FV0610", "an array literal holds plain values", n);
    return expr(s, el);
  });
  if (!values.some((v: Val) => v.ty.k === "opt" || v.ty.k === "null" || v.ty.k === "undef")) return null;
  const kept = values.filter((v: Val) => v.ty.k !== "null" && v.ty.k !== "undef");
  const bases: Ty[] = kept.map((v: Val) => (v.ty.k === "opt" ? v.ty.of : v.ty));
  const of = bases.length ? bases.reduce(joinTy) : undefined;
  if (of === undefined) return computed("std::iter::empty::<bool>()", BOOL);
  if (!["str", "int", "float", "bool"].includes(of.k) || kept.some((v: Val) => !sameTy(v.ty.k === "opt" ? v.ty.of : v.ty, of))) {
    fail(comp, "FV0611", "an array literal holds strings, numbers or booleans, all of one type, each of which may be absent", n);
  }
  const options = kept.map((v: Val) => (v.ty.k === "opt" ? bare(v.code) : `Some(${bare(v.code)})`));
  const flat = `[${options.join(", ")}].into_iter().flatten()`;
  return computed(of.k === "str" ? `${flat}.map(${COW}::Borrowed)` : flat, of, kept.some((v: Val) => v.lone));
}

/** An array literal holding spread lists (`[...a, x, ...b]`): the items of each part in turn, as a computed list. */
export function spreadLiteral(s: Scope, n: N): Val {
  const comp = s.comp;
  const parts = n.elements.map((el: N) => {
    if (!el) fail(comp, "FV0610", "an array literal holds plain values, without holes", n);
    if (el.type !== "SpreadElement") return { one: expr(s, el), node: el };
    const list = expr(s, el.argument);
    if (list.ty.k !== "list") fail(comp, "FV0833", `\`...\` in an array literal spreads a list, and this is ${describeTy(list.ty)}`, el);
    return { list, node: el };
  }).filter((p: { list?: Val }) => p.list === undefined || !untypedEmpty(p.list));
  const tys: Ty[] = parts.map((p: { one?: Val; list?: Val }) => (p.list ? (p.list.ty as { of: Ty }).of : p.one!.ty));
  if (tys.length === 0) return { code: "[]", ty: { k: "list", of: UNDEF } };
  const own = tys[0]!;
  const numbers = tys.every(isNumber);
  const scalar = ["str", "int", "float", "bool"].includes(own.k);
  const objects = (own.k === "struct" || own.k === "child") && parts.every((p: { list?: Val }) => p.list !== undefined);
  if ((!scalar && !objects) || (!numbers && tys.some((t) => !sameTy(t, own)))) {
    const bad = parts.find((_: unknown, i: number) => !sameTy(tys[i]!, own)) ?? parts[0];
    fail(comp, "FV0833", "an array literal spreads lists of one item type, strings, numbers, booleans or objects, and holds plain values of that type beside them (numbers whether `number` or `Float`)", bad.node);
  }
  const of = numbers && tys.some((t) => t.k === "float") ? FLOAT : tys.reduce(joinTy);
  const pieces: string[] = [];
  let plain: string[] = [];
  const flush = () => {
    if (plain.length) pieces.push(`[${plain.join(", ")}]${pieces.length ? "" : ".into_iter()"}`);
    plain = [];
  };
  for (const p of parts as { one?: Val; list?: Val }[]) {
    if (p.list) {
      flush();
      pieces.push(of.k === "float" && p.list.ty.k === "list" && p.list.ty.of.k === "int" ? `${items(p.list)}.map(|v| v as f64)` : items(p.list));
    } else {
      const v = p.one!;
      plain.push(of.k === "str" ? asCow(v) : of.k === "float" ? bare(asF64(v)) : bare(v.code));
    }
  }
  flush();
  const lone = parts.some((p: { one?: Val; list?: Val }) => (p.list ?? p.one)!.lone);
  return computed(pieces.slice(1).reduce((acc, piece) => `${acc}.chain(${piece})`, pieces[0]!), of, lone);
}

/** `Math.max(...xs)` and `Math.min(...xs)`: every number of the parts folded from `-Infinity` or `Infinity`, as JavaScript folds them. */
export function spreadExtreme(s: Scope, method: "max" | "min", args: N[]): Val {
  const pieces = args.map((a) => {
    if (a?.type === "SpreadElement") {
      const list = expr(s, a.argument);
      if (list.ty.k !== "list" || (!isNumber(list.ty.of) && !untypedEmpty(list))) fail(s.comp, "FV0704", `\`Math.${method}(...xs)\` spreads a list of numbers, and this is ${list.ty.k === "list" ? "a list of other values" : describeTy(list.ty)}`, a);
      if (untypedEmpty(list)) return null;
      return list.ty.of.k === "int" ? `${items(list)}.map(|v| v as f64)` : items(list);
    }
    const v = expr(s, a);
    if (!isNumber(v.ty)) fail(s.comp, "FV0704", `\`Math.${method}()\` takes numbers that are present`, a);
    return `std::iter::once(${bare(asF64(v))})`;
  }).filter((p): p is string => p !== null);
  const start = method === "max" ? "f64::NEG_INFINITY" : "f64::INFINITY";
  if (pieces.length === 0) return { code: start, ty: FLOAT, num: method === "max" ? -Infinity : Infinity };
  const all = pieces.slice(1).reduce((acc, piece) => `${acc}.chain(${piece})`, pieces[0]!);
  return { code: `${all}.fold(${start}, fv::core::js_${method})`, ty: FLOAT };
}
