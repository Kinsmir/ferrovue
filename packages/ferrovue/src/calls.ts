import { type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, INT, sameTy, STR } from "./model.ts";
import { ctx } from "./context.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, condition, operand, receiver, strArg, UNARY } from "./parens.ts";
import { computedListMethod, items, listMethod, objectCall } from "./lists.ts";
import { lonely, loneOf, meet, stringMethod, stringsEqual } from "./strings.ts";
import { asF64, intFromF64, isNumber } from "./numbers.ts";
import { boolOf, truthy } from "./narrowing.ts";
import { coerce, expr } from "./expr.ts";

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
    if (callee.name === "String" && args.length === 1) {
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return a;
      if (isNumber(a.ty)) return { code: `&*fv::Js(${bare(a.code)}).to_string()`, ty: STR };
      if (a.ty.k === "bool") return { code: `if ${condition(a.code)} { "true" } else { "false" }`, ty: STR };
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
    return fail(comp, "FV0601", `\`${callee.name}()\` is not available when rendering on the server`, n);
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
      if (v.ty.k === "bool") return { code: `if ${condition(v.code)} { "true" } else { "false" }`, ty: STR };
      return { code: `&*${json(s, v, args[0])}`, ty: STR };
    }
    const own = claim((p) => p.call?.(s, n));
    if (own) return own;
    if (callee.object.type === "Identifier" && (callee.object.name === "$setup" || callee.object.name === "_ctx")) {
      const helper = s.helpers.get(method);
      if (helper) return helperCall(s, helper, args, n);
    }
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
      return fail(comp, "FV0704", `\`Math.${method}()\` is supported on numbers as \`max\`, \`min\`, \`abs\`, \`round\`, \`floor\`, \`ceil\` and \`trunc\``, n);
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
      const d = args.length ? args[0] : { type: "NumericLiteral", value: 0 };
      if (d.type !== "NumericLiteral" || !Number.isInteger(d.value) || d.value < 0 || d.value > 100) {
        fail(comp, "FV0705", "`.toFixed()` takes a literal number of digits, from 0 to 100", n);
      }
      return { code: `&*fv::js_to_fixed(${bare(asF64(target))}, ${d.value})`, ty: STR };
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
        return fail(s.comp, "FV0707", "`JSON.stringify()` of a string, a number, a boolean or a list of those, present", n);
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
