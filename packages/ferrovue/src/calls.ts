import { type N, type Scope, type Ty, type Val, asciiTy, BOOL, fail, isAscii, sameTy, STR, strTy } from "./model.ts";
import { ctx } from "./context.ts";
import type { ErrorCode } from "./errors.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, condition, operand, receiver, strArg, UNARY } from "./parens.ts";
import { computedListMethod, isBoolean, items, listMethod, objectCall, presentLiteral } from "./lists.ts";
import { lonely, loneOf, meet, regexTest, stringMethod, stringsEqual, writesAscii } from "./strings.ts";
import { asF64, asWritten, isNumber } from "./numbers.ts";
import { boolOf, truthy } from "./narrowing.ts";
import { coerce, expr, refuseClientOnly, refuseUnavailable } from "./expr.ts";
import { callFunction } from "./functions.ts";
import { constOf, mapCall } from "./constants.ts";
import { refuseInPlace } from "./objects.ts";
import { globalCall, mathCall, numberStaticCall } from "./globals.ts";

const DIGITS = new Map<string, [ErrorCode, number, string]>([
  ["toFixed", ["FV0705", 0, "number of digits"]],
  ["toPrecision", ["FV0716", 1, "precision"]],
  ["toExponential", ["FV0717", 0, "number of digits"]],
]);

export function call(s: Scope, n: N): Val {
  const callee = n.callee;
  if (callee.type === "Identifier") return namedCall(s, n);
  if (callee.type === "MemberExpression" && !callee.computed) return memberCall(s, n);
  return fail(s.comp, "FV0603", "this call is not supported", n);
}

function namedCall(s: Scope, n: N): Val {
  const callee = n.callee;
  const args: N[] = n.arguments;
  const rendered = renderHelperCall(s, callee.name, args, n);
  if (rendered) return rendered;
  const own = claim((p) => p.call?.(s, n));
  if (own) return own;
  const mine = ownCall(s, callee, args, n);
  if (mine) return mine;
  if (isBoolean(s, callee) && args.length === 1) return boolOf(truthy(expr(s, args[0])));
  const global = !s.locals.has(callee.name) && !s.setup.has(callee.name);
  const known = globalCall(s, callee.name, args, n, global);
  if (known) return known;
  if (global && BUILTINS.has(callee.name)) return builtin(s, `${callee.name}()`, n);
  return refuseUnavailable(s, callee.name, n, true);
}

function renderHelperCall(s: Scope, name: string, args: N[], n: N): Val | null {
  switch (name) {
    case "_ssrLooseEqual":
      return looseEqual(s, args, n);
    case "_ssrIncludeBooleanAttr":
      return includeBooleanAttr(s, args);
    case "_ssrLooseContain":
      return fail(s.comp, "FV0414", "`v-model` over an array", n);
  }
  return null;
}

function looseEqual(s: Scope, args: N[], n: N): Val {
  const a = expr(s, args[0]);
  const b = expr(s, args[1]);
  if (a.ty.k === "str" && b.ty.k === "str") {
    meet(s.comp, a, b, "`v-model`", n, "equal");
    return boolOf(stringsEqual(a, b));
  }
  return fail(s.comp, "FV0413", "`v-model` comparison between these types", n);
}

function includeBooleanAttr(s: Scope, args: N[]): Val {
  const a = expr(s, args[0]);
  if (a.konst !== undefined) return a;
  if (a.ty.k === "str") return { code: "true", ty: BOOL, konst: true };
  if (a.ty.k === "opt" && a.ty.of.k === "str") return { code: `${atom(a.code)}.is_some()`, ty: BOOL };
  return boolOf(truthy(a));
}

function memberCall(s: Scope, n: N): Val {
  const comp = s.comp;
  const callee = n.callee;
  const args: N[] = n.arguments;
  const method = callee.property.name as string;
  if (callee.object.type === "Identifier" && callee.object.name === "Array" && method === "isArray") {
    const a = expr(s, args[0]);
    const own = claim((p) => p.values?.isArray?.(a));
    if (own) return own;
    const is = a.ty.k === "list";
    return { code: String(is), ty: BOOL, konst: is };
  }
  if (callee.object.type === "Identifier" && callee.object.name === "Object") return objectCall(s, method, args, n);
  if (callee.object.type === "Identifier" && callee.object.name === "Number") {
    const tested = numberStaticCall(s, method, args, n);
    if (tested) return tested;
  }
  if (callee.object.type === "Identifier" && callee.object.name === "JSON" && method === "stringify" && args.length === 1) {
    const v = expr(s, args[0]);
    if (v.ty.k === "bool") return { code: `if ${condition(v.code)} { "true" } else { "false" }`, ty: STR };
    return { code: `&*${json(s, v, args[0])}`, ty: STR };
  }
  if (callee.object.type === "Identifier" && callee.object.name === "JSON" && method === "stringify") {
    return fail(comp, "FV0633", "`JSON.stringify()` with a replacer or an indentation, which the server does not write: give it one value, `JSON.stringify(x)`", n);
  }
  const own = claim((p) => p.call?.(s, n));
  if (own) return own;
  if (callee.object.type === "Identifier" && (callee.object.name === "$setup" || callee.object.name === "_ctx")) {
    const mine = setupCall(s, callee.object.name, method, args, n);
    if (mine) return mine;
  }
  if (callee.object.type === "Identifier" && callee.object.name === "Math") return mathCall(s, method, args, n);
  if (callee.object.type === "Identifier" && BUILTINS.has(callee.object.name) && !s.locals.has(callee.object.name) && !s.setup.has(callee.object.name)) {
    return builtin(s, `${callee.object.name}.${method}()`, n);
  }
  if ((method === "sort" || method === "reverse") && callee.object.type === "ArrayExpression") {
    const copy = expr(s, callee.object);
    if (copy.ty.k === "list") return listMethod(s, copy, method === "sort" ? "toSorted" : "toReversed", args, n)!;
  }
  if (callee.object.type === "RegExpLiteral" && method === "test") return regexTest(s, callee.object, args, n);
  const map = callee.object.type === "Identifier" || callee.object.type === "MemberExpression" ? constOf(s, callee.object) : null;
  if (map?.sym.k === "const" && map.sym.c.k === "map") return mapCall(s, map, method, args, n);
  const literal = method === "filter" && args.length === 1 && isBoolean(s, args[0]) && callee.object.type === "ArrayExpression";
  const target = (literal ? presentLiteral(s, callee.object) : null) ?? expr(s, callee.object);
  const typed = claim((p) => p.method?.(s, target, method, args, n));
  if (typed) return typed;
  if (target.ty.k === "str") {
    const lone = loneOf(target);
    const same = strTy(isAscii(target.ty));
    switch (args.length === 0 ? method : "") {
      case "trim":
        return { code: `fv::strings::js_trim(${strArg(target.code)})`, ty: same, ...lone };
      case "trimStart":
        return { code: `fv::strings::js_trim_start(${strArg(target.code)})`, ty: same, ...lone };
      case "trimEnd":
      case "trimRight":
        return { code: `fv::strings::js_trim_end(${strArg(target.code)})`, ty: same, ...lone };
      case "trimLeft":
        return { code: `fv::strings::js_trim_start(${strArg(target.code)})`, ty: same, ...lone };
      case "toUpperCase":
        return { code: `&*${receiver(target.code)}.to_uppercase()`, ty: same, ...lone };
      case "toLowerCase":
        return { code: `&*${receiver(target.code)}.to_lowercase()`, ty: same, ...lone };
      case "toString":
        return target;
    }
    const m = stringMethod(s, target, method, args, n);
    if (m) return m;
  }
  const digits = isNumber(target.ty) && args.length <= 1 ? DIGITS.get(method) : undefined;
  if (digits) {
    const [code, low, what] = digits;
    const a = args[0];
    const given = a === undefined || (a.type === "Identifier" && a.name === "undefined") ? undefined : a.type === "NumericLiteral" ? Math.trunc(a.value) : NaN;
    if (given !== undefined && !(given >= low && given <= 100)) fail(comp, code, `\`.${method}()\` takes a literal ${what}, from ${low} to 100`, n);
    const x = bare(asF64(target));
    if (method === "toFixed") return { code: `&*fv::core::js_to_fixed(${x}, ${given ?? 0})`, ty: asciiTy() };
    if (method === "toExponential") return { code: `&*fv::core::js_to_exponential(${x}, ${given === undefined ? "None" : `Some(${given})`})`, ty: asciiTy() };
    if (given === undefined) return { code: `&*fv::core::Js(${bare(asWritten(target).code)}).to_string()`, ty: asciiTy() };
    return { code: `&*fv::core::js_to_precision(${x}, ${given})`, ty: asciiTy() };
  }
  if (isNumber(target.ty) && method === "toString" && args.length === 0) {
    return { code: `&*fv::core::Js(${bare(asWritten(target).code)}).to_string()`, ty: asciiTy() };
  }
  if (target.owned) refuseInPlace(comp, `\`.${method}()\``, n);
  if (target.ty.k === "list") {
    const inPlace = target.iter === undefined && !target.lone && (target.ty.of.k === "str" || target.ty.of.k === "int");
    const listed = listMethod(s, target, method, args, n) ?? (inPlace ? null : computedListMethod(s, target, method, args, n));
    if (listed) return listed;
  }
  if (target.ty.k === "list" && (target.ty.of.k === "str" || target.ty.of.k === "int")) {
    const of = target.ty.of;
    if (method === "includes" && args.length === 1) {
      const v = expr(s, args[0]);
      if (of.k === "int" && v.ty.k === "float") return { code: `${atom(target.code)}.iter().any(|v| ${binary("*v as f64", "==", v.code)})`, ty: BOOL };
      if (!sameTy(v.ty, of)) fail(comp, "FV0801", "`.includes()` looks for a value of the list's own type", args[0]);
      if (of.k === "int") return { code: `${atom(target.code)}.contains(&${operand(v.code, UNARY)})`, ty: BOOL };
      const test = v.code === '""' ? "v.is_empty()" : binary("&**v", "==", v.code);
      return { code: `${atom(target.code)}.iter().any(|v| ${test})`, ty: BOOL };
    }
    if (method === "join" && args.length <= 1) {
      const sep: Val = args.length ? expr(s, args[0]) : { code: '","', ty: STR };
      if (sep.ty.k !== "str") fail(comp, "FV0802", "`.join()` takes a string", args[0]);
      const each = of.k === "str" ? `${atom(target.code)}.iter().map(|v| &**v)` : `${atom(target.code)}.iter().map(|v| fv::core::Js(*v).to_string())`;
      return { code: `&*${each}.collect::<Vec<_>>().join(${strArg(sep.code)})`, ty: strTy(writesAscii(target.ty) && isAscii(sep.ty)), ...loneOf(sep) };
    }
  }
  return fail(comp, "FV0602", `\`.${method}()\` is not supported`, n);
}

/** The globals of JavaScript a template may name, which the server translates only some of. */
export const BUILTINS = new Set(
  "Array BigInt Boolean JSON Map Math Number Object RegExp Set String Symbol console decodeURI decodeURIComponent encodeURI encodeURIComponent isFinite isNaN parseFloat parseInt".split(" "),
);

const OF_BUILTINS: Record<string, string> = {
  Array: "`Array.isArray(x)`",
  Boolean: "`Boolean(x)` and `.filter(Boolean)`",
  JSON: "`JSON.stringify(x)`",
  Math: "`Math.max`, `min`, `abs`, `round`, `floor`, `ceil`, `trunc`, `sqrt`, `sign` and `pow`, and its constants",
  Number: "`Number(x)`, `Number.isNaN`, `isFinite`, `isInteger` and `isSafeInteger`, and its constants",
  Object: "`Object.keys`, `Object.values` and `Object.entries` of a record",
  String: "`String(x)`",
  encodeURI: "`encodeURI(s)`",
  encodeURIComponent: "`encodeURIComponent(s)`",
  isFinite: "`isFinite(n)`",
  isNaN: "`isNaN(n)`",
  parseFloat: "`parseFloat(s)`",
  parseInt: "`parseInt(s)` and `parseInt(s, radix)`",
};

/** Refuses `what`, a use of one of JavaScript's globals the server does not translate. */
export function builtin(s: Scope, what: string, n: N): never {
  const name = /^\w+/.exec(what)![0];
  const of = OF_BUILTINS[name];
  return fail(s.comp, "FV0633", `\`${what}\` is not supported: ${of ? `of \`${name}\`, the server translates ${of}` : `the server does not translate \`${name}\``}`, n);
}

export function isObjectCall(n: N, method: string): boolean {
  return (
    n?.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed &&
    n.callee.object.type === "Identifier" && n.callee.object.name === "Object" && n.callee.property.name === method
  );
}

function json(s: Scope, v: Val, n: N): string {
  if (v.lone) fail(s.comp, "FV0706", lonely("`JSON.stringify()`"), n);
  const one = (code: string, ty: Ty): string => {
    switch (ty.k) {
      case "str":
        return `fv::strings::js_json_string(${code === "v" ? "&v" : strArg(code)})`;
      case "int":
        return `fv::core::Js(${bare(code)}).to_string()`;
      case "float":
        return `fv::strings::js_json_number(${bare(code)})`;
      case "bool":
        return `(if ${condition(code)} { "true" } else { "false" }).to_owned()`;
      default:
        return claim((p) => p.values?.json?.({ code, ty })) ?? fail(s.comp, "FV0707", "`JSON.stringify()` of a string, a number, a boolean, a date or a list of those, present", n);
    }
  };
  if (v.ty.k === "list") {
    const each = one("v", v.ty.of);
    const f = /^([\w:]+)\(v\)$/.exec(each)?.[1];
    return `format!("[{}]", ${items(v)}.map(${f ?? `|v| ${each}`}).collect::<Vec<_>>().join(","))`;
  }
  const w = asWritten(v);
  return one(w.code, w.ty);
}

function ownCall(s: Scope, callee: N, args: N[], n: N): Val | null {
  const helper = s.helpers.get(callee.name);
  if (helper) return helperCall(s, helper, args, n);
  const fn = s.locals.has(callee.name) ? undefined : s.functions.get(callee.name);
  return fn ? callFunction(s, callee.fvName ?? callee.name, fn, args, n) : null;
}

function setupCall(s: Scope, of: string, method: string, args: N[], n: N): Val | null {
  const helper = s.helpers.get(method);
  if (helper) return helperCall(s, helper, args, n);
  const fn = s.functions.get(method);
  if (fn) return callFunction(s, method, fn, args, n);
  if (s.clientOnly.has(method)) return refuseClientOnly(s, method, n, true);
  if (!s.setup.has(method) && !(of === "_ctx" && s.comp.props.fields.some((f) => f.js === method))) return refuseUnavailable(s, method, n, true);
  return null;
}

export function helperCall(s: Scope, name: string, args: N[], n: N): Val {
  const h = ctx.helpers[name]!;
  if (args.length !== h.params.length) fail(s.comp, "FV1101", `\`${name}\` takes ${h.params.length} argument(s)`, n);
  const code = args.map((a, i) => bare(coerce(s.comp, expr(s, a), h.params[i]!, a))).join(", ");
  s.helperBytes.n += h.maxLen;
  return { code: `${h.rust}(${code})`, ty: h.ret };
}
