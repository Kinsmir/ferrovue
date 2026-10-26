import { type N, type Scope, type Ty, type Val, asciiTy, BOOL, fail, FLOAT, INT, STR } from "./model.ts";
import { atom, bare, condition, operand, receiver, strArg, UNARY } from "./parens.ts";
import { formatted, lonely, stringOf } from "./strings.ts";
import { asWritten, isNumber } from "./numbers.ts";
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

/** Translates `Number.isNaN`, `isFinite`, `isInteger` and `isSafeInteger`, or returns null for another method. */
export function numberStaticCall(s: Scope, method: string, args: N[], n: N): Val | null {
  return NUMBER_TESTS.has(method) ? numberTest(s, method, args, n, false) : null;
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
