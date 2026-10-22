import { type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, INT, sameTy, STR } from "./model.ts";
import { ctx } from "./context.ts";
import type { Code } from "./errors.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, condition, operand, receiver, strArg, UNARY } from "./parens.ts";
import { computedListMethod, isBoolean, items, listMethod, objectCall, presentLiteral, spreadExtreme } from "./lists.ts";
import { formatted, lonely, loneOf, meet, stringMethod, stringOf, stringsEqual } from "./strings.ts";
import { asF64, intFromF64, isNumber, numberVal, power } from "./numbers.ts";
import { boolOf, truthy } from "./narrowing.ts";
import { coerce, describeTy, expr, refuseClientOnly, refuseUnavailable } from "./expr.ts";
import { callFunction } from "./functions.ts";

const DIGITS = new Map<string, [Code, number, string]>([
  ["toFixed", ["FV0705", 0, "number of digits"]],
  ["toPrecision", ["FV0716", 1, "precision"]],
  ["toExponential", ["FV0717", 0, "number of digits"]],
]);

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
          return boolOf(stringsEqual(a, b));
        }
        return fail(comp, "FV0413", "`v-model` comparison between these types", n);
      }
      case "_ssrIncludeBooleanAttr": {
        const a = expr(s, args[0]);
        if (a.konst !== undefined) return a;
        if (a.ty.k === "str") return { code: "true", ty: BOOL, konst: true };
        if (a.ty.k === "opt" && a.ty.of.k === "str") return { code: `${atom(a.code)}.is_some()`, ty: BOOL };
        return boolOf(truthy(a));
      }
      case "_ssrLooseContain":
        return fail(comp, "FV0414", "`v-model` over an array", n);
    }
    const own = claim((p) => p.call?.(s, n));
    if (own) return own;
    const helper = s.helpers.get(callee.name);
    if (helper) return helperCall(s, helper, args, n);
    const fn = s.locals.has(callee.name) ? undefined : s.functions.get(callee.name);
    if (fn) return callFunction(s, callee.name, fn, args, n);
    if (isBoolean(s, callee) && args.length === 1) return boolOf(truthy(expr(s, args[0])));
    const global = !s.locals.has(callee.name) && !s.setup.has(callee.name);
    if (callee.name === "String" && global) {
      if (args.length !== 1) return fail(comp, "FV0723", "`String()` takes one value", n);
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return a;
      if (isNumber(a.ty)) return { code: `&*fv::Js(${bare(a.code)}).to_string()`, ty: STR };
      if (a.ty.k === "bool") return { code: `if ${condition(a.code)} { "true" } else { "false" }`, ty: STR };
      return formatted(comp, [stringOf(comp, a, args[0], "`String()`", "FV0723")], n, "`String()`");
    }
    if ((callee.name === "encodeURIComponent" || callee.name === "encodeURI") && global) {
      const name = `\`${callee.name}()\``;
      if (args.length !== 1) return fail(comp, "FV0723", `${name} takes one value`, n);
      const a = expr(s, args[0]);
      if (a.lone) fail(comp, "FV0706", `${lonely(name)}; it throws a \`URIError\` on a half`, n);
      const text = a.ty.k === "str" ? a : formatted(comp, [stringOf(comp, a, args[0], name, "FV0723")], n, name);
      return { code: `&*fv::js_${callee.name === "encodeURI" ? "encode_uri" : "encode_uri_component"}(${strArg(text.code)})`, ty: STR };
    }
    if (callee.name === "Number" && args.length === 1) {
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return { code: `fv::js_number(${strArg(a.code)})`, ty: FLOAT };
      if (isNumber(a.ty)) return a;
      if (a.ty.k === "bool") return { code: `i64::from(${bare(a.code)})`, ty: INT };
      return fail(comp, "FV0701", "`Number()` takes a string, a number or a boolean that is present", n);
    }
    if ((callee.name === "parseInt" && (args.length === 1 || args.length === 2)) || (callee.name === "parseFloat" && args.length === 1)) {
      const a = expr(s, args[0]);
      if (a.ty.k !== "str") fail(comp, "FV0702", `\`${callee.name}()\` takes a string`, args[0]);
      if (callee.name === "parseFloat") return { code: `fv::js_parse_float(${strArg(a.code)})`, ty: FLOAT };
      const radix = args[1];
      if (radix && !(radix.type === "NumericLiteral" && (radix.value === 10 || radix.value === 16))) {
        fail(comp, "FV0703", "`parseInt()` takes a radix of 10 or 16, written as a literal", radix);
      }
      return { code: `fv::js_parse_int(${strArg(a.code)}, ${radix ? radix.value : 0})`, ty: FLOAT };
    }
    if ((callee.name === "isNaN" || callee.name === "isFinite") && global) return numberTest(s, callee.name, args, n, true);
    if (global && BUILTINS.has(callee.name)) return builtin(s, `${callee.name}()`, n);
    return refuseUnavailable(s, callee.name, n, true);
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
    if (callee.object.type === "Identifier" && callee.object.name === "Number" && NUMBER_TESTS.has(method)) return numberTest(s, method, args, n, false);
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
      const helper = s.helpers.get(method);
      if (helper) return helperCall(s, helper, args, n);
      const fn = s.functions.get(method);
      if (fn) return callFunction(s, method, fn, args, n);
      if (s.clientOnly.has(method)) return refuseClientOnly(s, method, n, true);
      if (!s.setup.has(method) && !(callee.object.name === "_ctx" && comp.props.fields.some((f) => f.js === method))) return refuseUnavailable(s, method, n, true);
    }
    if (callee.object.type === "Identifier" && callee.object.name === "Math") {
      if ((method === "max" || method === "min") && args.some((a) => a?.type === "SpreadElement")) return spreadExtreme(s, method, args);
      if (method === "pow" && args.length === 2) return power(s, args[0], args[1], n, "`Math.pow()`");
      if (ROUNDED_BY_EACH.has(method)) {
        return fail(comp, "FV0719", `\`Math.${method}()\` is computed by each JavaScript engine's own routine, which need not round its result as another engine or Rust does, so the page could show digits the browser's render does not: compute it in Rust and pass it as a prop`, n);
      }
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
          if (method === "sqrt") return x.num !== undefined ? numberVal(Math.sqrt(x.num), false) : { code: `${receiver(asF64(x))}.sqrt()`, ty: FLOAT };
          if (method === "sign") {
            if (x.num !== undefined) return numberVal(Math.sign(x.num), ints);
            const sign = `fv::js_sign(${bare(asF64(x))})`;
            return ints ? intFromF64(sign) : { code: sign, ty: FLOAT };
          }
        }
      }
      return fail(comp, "FV0704", `\`Math.${method}()\` is supported on numbers as \`max\`, \`min\`, \`abs\`, \`round\`, \`floor\`, \`ceil\`, \`trunc\`, \`sqrt\`, \`sign\` and \`pow\``, n);
    }
    if (callee.object.type === "Identifier" && BUILTINS.has(callee.object.name) && !s.locals.has(callee.object.name) && !s.setup.has(callee.object.name)) {
      return builtin(s, `${callee.object.name}.${method}()`, n);
    }
    if ((method === "sort" || method === "reverse") && callee.object.type === "ArrayExpression") {
      const copy = expr(s, callee.object);
      if (copy.ty.k === "list") return listMethod(s, copy, method === "sort" ? "toSorted" : "toReversed", args, n)!;
    }
    const literal = method === "filter" && args.length === 1 && isBoolean(s, args[0]) && callee.object.type === "ArrayExpression";
    const target = (literal ? presentLiteral(s, callee.object) : null) ?? expr(s, callee.object);
    const typed = claim((p) => p.method?.(s, target, method, args, n));
    if (typed) return typed;
    if (target.ty.k === "str") {
      const lone = loneOf(target);
      switch (args.length === 0 ? method : "") {
        case "trim":
          return { code: `fv::js_trim(${strArg(target.code)})`, ty: STR, ...lone };
        case "trimStart":
          return { code: `fv::js_trim_start(${strArg(target.code)})`, ty: STR, ...lone };
        case "trimEnd":
        case "trimRight":
          return { code: `fv::js_trim_end(${strArg(target.code)})`, ty: STR, ...lone };
        case "trimLeft":
          return { code: `fv::js_trim_start(${strArg(target.code)})`, ty: STR, ...lone };
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
    const digits = isNumber(target.ty) && args.length <= 1 ? DIGITS.get(method) : undefined;
    if (digits) {
      const [code, low, what] = digits;
      const a = args[0];
      const given = a === undefined || (a.type === "Identifier" && a.name === "undefined") ? undefined : a.type === "NumericLiteral" ? Math.trunc(a.value) : NaN;
      if (given !== undefined && !(given >= low && given <= 100)) fail(comp, code, `\`.${method}()\` takes a literal ${what}, from ${low} to 100`, n);
      const x = bare(asF64(target));
      if (method === "toFixed") return { code: `&*fv::js_to_fixed(${x}, ${given ?? 0})`, ty: STR };
      if (method === "toExponential") return { code: `&*fv::js_to_exponential(${x}, ${given === undefined ? "None" : `Some(${given})`})`, ty: STR };
      if (given === undefined) return { code: `&*fv::Js(${bare(target.code)}).to_string()`, ty: STR };
      return { code: `&*fv::js_to_precision(${x}, ${given})`, ty: STR };
    }
    if (isNumber(target.ty) && method === "toString" && args.length === 0) {
      return { code: `&*fv::Js(${bare(target.code)}).to_string()`, ty: STR };
    }
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
        const each = of.k === "str" ? `${atom(target.code)}.iter().map(|v| &**v)` : `${atom(target.code)}.iter().map(|v| fv::Js(*v).to_string())`;
        return { code: `&*${each}.collect::<Vec<_>>().join(${strArg(sep.code)})`, ty: STR, ...loneOf(sep) };
      }
    }
    return fail(comp, "FV0602", `\`.${method}()\` is not supported`, n);
  }
  return fail(comp, "FV0603", "this call is not supported", n);
}

const NUMBER_TESTS = new Set(["isNaN", "isFinite", "isInteger", "isSafeInteger"]);

const ROUNDED_BY_EACH = new Set(
  "acos acosh asin asinh atan atan2 atanh cbrt cos cosh exp expm1 hypot log log10 log1p log2 sin sinh tan tanh".split(" "),
);

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

function floatTest(method: string, x: string): string {
  switch (method) {
    case "isNaN":
      return `${receiver(x)}.is_nan()`;
    case "isFinite":
      return `${receiver(x)}.is_finite()`;
    case "isInteger":
      return `${receiver(x)}.fract() == 0.0`;
    default:
      return /^[\w.]+$/.test(x) ? `${x}.fract() == 0.0 && ${x}.abs() <= 9_007_199_254_740_991.0` : `matches!(${bare(x)}, v if v.fract() == 0.0 && v.abs() <= 9_007_199_254_740_991.0)`;
  }
}

function intTest(method: string, x: string): string {
  if (method === "isSafeInteger") return `(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&${operand(x, UNARY)})`;
  return String(method !== "isNaN");
}

function numberTest(s: Scope, method: string, args: N[], n: N, global: boolean): Val {
  const name = global ? `\`${method}()\`` : `\`Number.${method}()\``;
  if (args.length !== 1) return fail(s.comp, "FV0718", `${name} takes one number`, n);
  const v = expr(s, args[0]);
  if (isNumber(v.ty)) {
    if (v.num !== undefined) {
      const konst = (Number as unknown as Record<string, (x: number) => boolean>)[method]!(v.num);
      return { code: String(konst), ty: BOOL, konst };
    }
    return boolOf(v.ty.k === "int" ? intTest(method, v.code) : floatTest(method, v.code));
  }
  if (!global && v.ty.k === "opt" && isNumber(v.ty.of)) {
    const each = v.ty.of.k === "int" ? intTest(method, "v") : floatTest(method, "v");
    if (each === "false") return { code: "false", ty: BOOL, konst: false };
    return boolOf(each === "true" ? `${atom(v.code)}.is_some()` : `${atom(v.code)}.is_some_and(|v| ${each})`);
  }
  if (global) {
    return fail(s.comp, "FV0718", `${name} converts its argument as \`Number()\` does, which the server does for a number only: write \`Number.${method}(Number(x))\` for a string, or pass a present number`, args[0]);
  }
  return fail(s.comp, "FV0718", `${name} of ${describeTy(v.ty)}, for which it is \`false\` whatever it holds, since it does not convert its argument: pass a number, present or optional`, args[0]);
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
        return `fv::js_json_string(${code === "v" ? "&v" : strArg(code)})`;
      case "int":
        return `fv::Js(${bare(code)}).to_string()`;
      case "float":
        return `fv::js_json_number(${bare(code)})`;
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
  return one(v.code, v.ty);
}

export function helperCall(s: Scope, name: string, args: N[], n: N): Val {
  const h = ctx.helpers[name]!;
  if (args.length !== h.params.length) fail(s.comp, "FV1101", `\`${name}\` takes ${h.params.length} argument(s)`, n);
  const code = args.map((a, i) => bare(coerce(s.comp, expr(s, a), h.params[i]!, a))).join(", ");
  s.helperBytes.n += h.maxLen;
  return { code: `${h.rust}(${code})`, ty: h.ret };
}
