import { type N, type Scope, type Ty, type Val, asciiTy, BOOL, fail, FLOAT, INT, refusalAt, STR } from "./model.ts";
import { atom, bare, condition, operand, receiver, strArg, UNARY } from "./parens.ts";
import { formatted, lonely, stringOf } from "./strings.ts";
import { asF64, asWritten, intFromF64, isCast, isNumber, numberVal, power } from "./numbers.ts";
import { items, objectCall, spreadExtreme } from "./lists.ts";
import { claim } from "./plugin.ts";
import { boolOf } from "./narrowing.ts";
import { describeTy, expr } from "./expr.ts";

/** Translates a call of one of JavaScript's global functions, or returns null for one it does not know. */
export function globalCall(s: Scope, name: string, args: N[], n: N, global: boolean): Val | null {
  if (name === "Number" && args.length === 1) return numberOf(s, args, n);
  if ((name === "parseInt" && (args.length === 1 || args.length === 2)) || (name === "parseFloat" && args.length === 1)) return parsed(s, name, args);
  if (!global) return null;
  switch (name) {
    case "String":
      return stringCall(s, args, n);
    case "encodeURI":
    case "encodeURIComponent":
      return encoded(s, name, args, n);
    case "isNaN":
    case "isFinite":
      return numberTest(s, name, args, n, true);
  }
  return null;
}

function stringCall(s: Scope, args: N[], n: N): Val {
  if (args.length !== 1) return fail(s.comp, "FV0723", "`String()` takes one value", n);
  const a = expr(s, args[0]);
  if (a.ty.k === "str") return a;
  if (isNumber(a.ty)) return { code: `&*fv::core::Js(${bare(asWritten(a).code)}).to_string()`, ty: asciiTy() };
  if (a.ty.k === "bool") return { code: `if ${condition(a.code)} { "true" } else { "false" }`, ty: asciiTy() };
  return formatted(s.comp, [stringOf(s.comp, a, args[0], "`String()`", "FV0723")], n, "`String()`");
}

function encoded(s: Scope, fn: string, args: N[], n: N): Val {
  const name = `\`${fn}()\``;
  if (args.length !== 1) return fail(s.comp, "FV0723", `${name} takes one value`, n);
  const a = expr(s, args[0]);
  if (a.lone) fail(s.comp, "FV0706", `${lonely(name)}; it throws a \`URIError\` on a half`, n);
  const text = a.ty.k === "str" ? a : formatted(s.comp, [stringOf(s.comp, a, args[0], name, "FV0723")], n, name);
  return { code: `&*fv::core::js_${fn === "encodeURI" ? "encode_uri" : "encode_uri_component"}(${strArg(text.code)})`, ty: STR };
}

function numberOf(s: Scope, args: N[], n: N): Val {
  const a = expr(s, args[0]);
  if (a.ty.k === "str") return { code: `fv::strings::js_number(${strArg(a.code)})`, ty: FLOAT };
  if (isNumber(a.ty)) return a;
  if (a.ty.k === "bool") return { code: `i64::from(${bare(a.code)})`, ty: INT };
  return fail(s.comp, "FV0701", "`Number()` takes a string, a number or a boolean that is present", n);
}

function parsed(s: Scope, name: string, args: N[]): Val {
  const a = expr(s, args[0]);
  if (a.ty.k !== "str") fail(s.comp, "FV0702", `\`${name}()\` takes a string`, args[0]);
  if (name === "parseFloat") return { code: `fv::strings::js_parse_float(${strArg(a.code)})`, ty: FLOAT };
  const radix = args[1];
  if (radix && !(radix.type === "NumericLiteral" && (radix.value === 10 || radix.value === 16))) {
    fail(s.comp, "FV0703", "`parseInt()` takes a radix of 10 or 16, written as a literal", radix);
  }
  return { code: `fv::strings::js_parse_int(${strArg(a.code)}, ${radix ? radix.value : 0})`, ty: FLOAT };
}

const NUMBER_TESTS = new Set(["isNaN", "isFinite", "isInteger", "isSafeInteger"]);

/** Translates a call of a method of `Array`, `Object`, `Number` or `JSON`, or returns null for one it does not know. */
export function staticCall(s: Scope, of: string, method: string, args: N[], n: N): Val | null {
  switch (of) {
    case "Array":
      return method === "isArray" ? isArray(s, args) : null;
    case "Object":
      return objectCall(s, method, args, n);
    case "Number":
      return NUMBER_TESTS.has(method) ? numberTest(s, method, args, n, false) : null;
    case "JSON":
      return method === "stringify" ? stringified(s, args, n) : null;
  }
  return null;
}

function isArray(s: Scope, args: N[]): Val {
  const a = expr(s, args[0]);
  const own = claim((p) => p.values?.isArray?.(a));
  if (own) return own;
  const is = a.ty.k === "list";
  return { code: String(is), ty: BOOL, konst: is };
}

function stringified(s: Scope, args: N[], n: N): Val {
  if (args.length !== 1) {
    return fail(s.comp, "FV0633", "`JSON.stringify()` with a replacer or an indentation, which the server does not write: give it one value, `JSON.stringify(x)`", n);
  }
  const v = expr(s, args[0]);
  if (v.ty.k === "bool") return { code: `if ${condition(v.code)} { "true" } else { "false" }`, ty: STR };
  return { code: `&*${json(s, v, args[0])}`, ty: STR };
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
  if (isNumber(v.ty)) return presentNumberTest(method, v);
  if (!global && v.ty.k === "opt" && isNumber(v.ty.of)) return optionalNumberTest(method, v, v.ty.of);
  if (global) {
    return fail(s.comp, "FV0718", `${name} converts its argument as \`Number()\` does, which the server does for a number only: write \`Number.${method}(Number(x))\` for a string, or pass a present number`, args[0]);
  }
  return fail(s.comp, "FV0718", `${name} of ${describeTy(v.ty)}, for which it is \`false\` whatever it holds, since it does not convert its argument: pass a number, present or optional`, args[0]);
}

function presentNumberTest(method: string, v: Val): Val {
  if (v.num !== undefined) {
    const konst = (Number as unknown as Record<string, (x: number) => boolean>)[method]!(v.num);
    return { code: String(konst), ty: BOOL, konst };
  }
  return boolOf(v.ty.k === "int" ? intTest(method, v.code) : floatTest(method, v.code));
}

function optionalNumberTest(method: string, v: Val, of: Ty): Val {
  const each = of.k === "int" ? intTest(method, "v") : floatTest(method, "v");
  if (each === "false") return { code: "false", ty: BOOL, konst: false };
  return boolOf(each === "true" ? `${atom(v.code)}.is_some()` : `${atom(v.code)}.is_some_and(|v| ${each})`);
}

const ROUNDED_BY_EACH = new Set(
  "acos acosh asin asinh atan atan2 atanh cbrt cos cosh exp expm1 hypot log log10 log1p log2 sin sinh tan tanh".split(" "),
);

/** Translates a call of a method of `Math`. */
export function mathCall(s: Scope, method: string, args: N[], n: N): Val {
  if ((method === "max" || method === "min") && args.some((a) => a?.type === "SpreadElement")) return spreadExtreme(s, method, args);
  if (method === "pow" && args.length === 2) return power(s, args[0], args[1], n, "`Math.pow()`");
  if (ROUNDED_BY_EACH.has(method)) {
    return fail(s.comp, "FV0719", `\`Math.${method}()\` is computed by each JavaScript engine's own routine, which need not round its result as another engine or Rust does, so the page could show digits the browser's render does not: compute it in Rust and pass it as a prop`, n);
  }
  const vals = args.map((a) => expr(s, a));
  const done = vals.length > 0 && vals.every((v) => isNumber(v.ty)) ? numericMath(s, method, vals, n) : null;
  return done ?? fail(s.comp, "FV0704", `\`Math.${method}()\` is supported on numbers as \`max\`, \`min\`, \`abs\`, \`round\`, \`floor\`, \`ceil\`, \`trunc\`, \`sqrt\`, \`sign\` and \`pow\``, n);
}

function numericMath(s: Scope, method: string, vals: Val[], n: N): Val | null {
  const ints = vals.every((v) => v.ty.k === "int");
  if ((method === "max" || method === "min") && vals.length >= 2) return extreme(s, method, vals, ints, n);
  return vals.length === 1 ? unaryMath(s, method, vals[0]!, ints, n) : null;
}

function extreme(s: Scope, method: "max" | "min", vals: Val[], ints: boolean, n: N): Val {
  if (ints && !vals.some(isCast)) return { code: vals.slice(1).reduce((acc, v) => `${atom(acc)}.${method}(${bare(v.code)})`, vals[0]!.code), ty: INT };
  const code = vals.slice(1).reduce((acc, v) => `fv::core::js_${method}(${bare(acc)}, ${bare(asF64(v))})`, asF64(vals[0]!));
  if (ints) return intFromF64(code, vals.find(isCast)?.at ?? refusalAt(s.comp, n));
  return { code, ty: FLOAT };
}

function unaryMath(s: Scope, method: string, x: Val, ints: boolean, n: N): Val | null {
  switch (method) {
    case "abs":
      return ints ? intFromF64(`${receiver(asF64(x))}.abs()`, refusalAt(s.comp, n)) : { code: `${receiver(x.code)}.abs()`, ty: FLOAT };
    case "round":
      return { code: `fv::core::js_round(${bare(asF64(x))})`, ty: FLOAT };
    case "floor":
    case "ceil":
    case "trunc":
      return { code: `${receiver(asF64(x))}.${method}()`, ty: FLOAT };
    case "sqrt":
      return x.num !== undefined ? numberVal(Math.sqrt(x.num), false) : { code: `${receiver(asF64(x))}.sqrt()`, ty: FLOAT };
    case "sign":
      return sign(x, ints);
  }
  return null;
}

function sign(x: Val, ints: boolean): Val {
  if (x.num !== undefined) return numberVal(Math.sign(x.num), ints);
  const code = `fv::core::js_sign(${bare(asF64(x))})`;
  return ints ? intFromF64(code, null) : { code, ty: FLOAT };
}
