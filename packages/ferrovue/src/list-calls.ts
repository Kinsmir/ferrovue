import { type N, type Scope, type Ty, type Val, BOOL, joinedVal, STR } from "./model.ts";
import { fail } from "./locate.ts";
import { isAscii, sameTy, strTy } from "./literal-types.ts";
import { asF64, isNumber } from "./numbers.ts";
import { lonely, meet, writesAscii } from "./strings.ts";
import { atom, binary, operand, strArg, UNARY } from "./parens.ts";
import { expr } from "./expr.ts";
import { fresh } from "./names.ts";
import { items, listMethod } from "./lists.ts";

export function sameItem(s: Scope, target: Val, of: Ty, x: Val, v: string, code: "FV0801" | "FV0826", method: string, n: N): string {
  const numbers = isNumber(x.ty) && isNumber(of);
  if ((!sameTy(x.ty, of) && !numbers) || !["str", "int", "float", "bool"].includes(of.k)) {
    fail(s.comp, code, `\`.${method}()\` looks for a value of the list's own type, in a list of strings, numbers or booleans`, n);
  }
  if (of.k === "str") meet(s.comp, target, x, `\`.${method}()\``, n, "equal");
  if (of.k === "str") return `*${v} == ${x.code.startsWith("&*") ? `*${x.code.slice(2)}` : `*${operand(x.code, UNARY)}`}`;
  if (of.k === "float" && x.ty.k === "int") return binary(v, "==", asF64(x));
  if (of.k === "int" && x.ty.k === "float") return binary(`${v} as f64`, "==", x.code);
  return of.k === "bool" ? binary(v, "==", x.code) : `${v} == ${x.code}`;
}

function computedListMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  if (target.ty.k !== "list") return null;
  const of = target.ty.of;
  if (of.k === "entry" && (method === "includes" || method === "join")) {
    fail(s.comp, "FV0816", `\`.${method}()\` of the \`[key, value]\` pairs of \`Object.entries()\`, which ${method === "join" ? "writes each pair as its key and value joined by `,`" : "compares pairs as objects, and finds none"}: map the pairs to their keys or values first`, n);
  }
  if (method === "includes" && args.length === 1) {
    const x = expr(s, args[0]);
    const v = fresh("x", "item");
    const test = sameItem(s, target, of, x, v, "FV0801", "includes", args[0]);
    const nan = of.k === "float" && x.ty.k === "float" ? ` || (${v}.is_nan() && ${atom(x.code)}.is_nan())` : "";
    return { code: `${items(target)}.any(|${v}| ${test}${nan})`, ty: BOOL };
  }
  if (method === "join" && args.length <= 1) {
    if (!["str", "int", "float", "bool"].includes(of.k)) return null;
    const sep: Val = args.length ? expr(s, args[0]) : { code: '","', ty: STR };
    if (sep.ty.k !== "str") fail(s.comp, "FV0802", "`.join()` takes a string", args[0]);
    const parted = /^"[^"]/.test(sep.code);
    if (of.k === "str" && target.lone && (!parted || sep.lone)) fail(s.comp, "FV0706", lonely("`.join()` with no literal separator"), n);
    const ty = strTy(writesAscii(target.ty) && isAscii(sep.ty));
    const lone = Boolean(target.lone || sep.lone);
    if (of.k === "bool") return joinedVal(`${items(target)}.map(|v| if v { "true" } else { "false" })`, "str", strArg(sep.code), ty, lone);
    return joinedVal(items(target), of.k === "int" || of.k === "float" ? of.k : "str", strArg(sep.code), ty, lone);
  }
  return null;
}

/** Translates a method of a list, or returns null for a receiver that is no list or a method it does not know. */
export function listCall(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  if (target.ty.k !== "list") return null;
  const of = target.ty.of;
  const scalar = of.k === "str" || of.k === "int";
  const inPlace = target.iter === undefined && !target.lone && scalar;
  const listed = listMethod(s, target, method, args, n) ?? (inPlace ? null : computedListMethod(s, target, method, args, n));
  if (listed) return listed;
  return scalar ? inPlaceMethod(s, target, of, method, args) : null;
}

function inPlaceMethod(s: Scope, target: Val, of: Ty, method: string, args: N[]): Val | null {
  if (method === "includes" && args.length === 1) return inPlaceIncludes(s, target, of, args[0]);
  if (method === "join" && args.length <= 1) return inPlaceJoin(s, target, of, args);
  return null;
}

function inPlaceIncludes(s: Scope, target: Val, of: Ty, arg: N): Val {
  const v = expr(s, arg);
  if (of.k === "int" && v.ty.k === "float") return { code: `${atom(target.code)}.iter().any(|v| ${binary("*v as f64", "==", v.code)})`, ty: BOOL };
  if (!sameTy(v.ty, of)) fail(s.comp, "FV0801", "`.includes()` looks for a value of the list's own type", arg);
  if (of.k === "int") return { code: `${atom(target.code)}.contains(&${operand(v.code, UNARY)})`, ty: BOOL };
  const test = v.code === '""' ? "v.is_empty()" : binary("&**v", "==", v.code);
  return { code: `${atom(target.code)}.iter().any(|v| ${test})`, ty: BOOL };
}

function inPlaceJoin(s: Scope, target: Val, of: Ty, args: N[]): Val {
  const sep: Val = args.length ? expr(s, args[0]) : { code: '","', ty: STR };
  if (sep.ty.k !== "str") fail(s.comp, "FV0802", "`.join()` takes a string", args[0]);
  const ty = strTy(writesAscii(target.ty) && isAscii(sep.ty));
  if (of.k === "str") return joinedVal(`${atom(target.code)}.iter().map(|v| &**v)`, "str", strArg(sep.code), ty, Boolean(sep.lone));
  return joinedVal(`${atom(target.code)}.iter().copied()`, "int", strArg(sep.code), ty, Boolean(sep.lone));
}
