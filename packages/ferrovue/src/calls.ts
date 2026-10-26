import { type N, type Scope, type Val, BOOL, fail } from "./model.ts";
import { ctx } from "./context.ts";
import { claim } from "./plugin.ts";
import { atom, bare } from "./parens.ts";
import { isBoolean, listCall, listMethod, presentLiteral } from "./lists.ts";
import { meet, noArgStringMethod, regexTest, stringMethod, stringsEqual } from "./strings.ts";
import { numberMethod } from "./numbers.ts";
import { boolOf, truthy } from "./narrowing.ts";
import { coerce, expr, refuseClientOnly, refuseUnavailable } from "./expr.ts";
import { callFunction } from "./functions.ts";
import { constOf, mapCall } from "./constants.ts";
import { refuseInPlace } from "./objects.ts";
import { globalCall, mathCall, staticCall } from "./globals.ts";

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
  return globalNamedCall(s, callee.name, args, n);
}

function globalNamedCall(s: Scope, name: string, args: N[], n: N): Val {
  const global = !s.locals.has(name) && !s.setup.has(name);
  const known = globalCall(s, name, args, n, global);
  if (known) return known;
  if (global && BUILTINS.has(name)) return builtin(s, `${name}()`, n);
  return refuseUnavailable(s, name, n, true);
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
  const object = n.callee.object;
  const method = n.callee.property.name as string;
  const args: N[] = n.arguments;
  const named = object.type === "Identifier" ? namedObjectCall(s, object.name, method, args, n) : claim((p) => p.call?.(s, n));
  return named ?? methodCall(s, object, method, args, n);
}

function namedObjectCall(s: Scope, name: string, method: string, args: N[], n: N): Val | null {
  const known = staticCall(s, name, method, args, n);
  if (known) return known;
  const own = claim((p) => p.call?.(s, n));
  if (own) return own;
  const mine = name === "$setup" || name === "_ctx" ? setupCall(s, name, method, args, n) : null;
  if (mine) return mine;
  return globalObjectCall(s, name, method, args, n);
}

function globalObjectCall(s: Scope, name: string, method: string, args: N[], n: N): Val | null {
  if (name === "Math") return mathCall(s, method, args, n);
  if (BUILTINS.has(name) && !s.locals.has(name) && !s.setup.has(name)) return builtin(s, `${name}.${method}()`, n);
  return null;
}

function methodCall(s: Scope, object: N, method: string, args: N[], n: N): Val {
  const fixed = literalReceiverCall(s, object, method, args, n);
  if (fixed) return fixed;
  const literal = method === "filter" && args.length === 1 && isBoolean(s, args[0]) && object.type === "ArrayExpression";
  const target = (literal ? presentLiteral(s, object) : null) ?? expr(s, object);
  return valueMethod(s, target, method, args, n);
}

function literalReceiverCall(s: Scope, object: N, method: string, args: N[], n: N): Val | null {
  const copied = sortedCopy(s, object, method, args, n);
  if (copied) return copied;
  if (object.type === "RegExpLiteral" && method === "test") return regexTest(s, object, args, n);
  const map = object.type === "Identifier" || object.type === "MemberExpression" ? constOf(s, object) : null;
  if (map?.sym.k === "const" && map.sym.c.k === "map") return mapCall(s, map, method, args, n);
  return null;
}

function sortedCopy(s: Scope, object: N, method: string, args: N[], n: N): Val | null {
  if ((method !== "sort" && method !== "reverse") || object.type !== "ArrayExpression") return null;
  const copy = expr(s, object);
  return copy.ty.k === "list" ? listMethod(s, copy, method === "sort" ? "toSorted" : "toReversed", args, n)! : null;
}

function valueMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val {
  const typed = claim((p) => p.method?.(s, target, method, args, n));
  if (typed) return typed;
  if (target.ty.k === "str") {
    const m = (args.length === 0 ? noArgStringMethod(target, method) : null) ?? stringMethod(s, target, method, args, n);
    if (m) return m;
  }
  const numbered = numberMethod(s, target, method, args, n);
  if (numbered) return numbered;
  if (target.owned) refuseInPlace(s.comp, `\`.${method}()\``, n);
  return listCall(s, target, method, args, n) ?? fail(s.comp, "FV0602", `\`.${method}()\` is not supported`, n);
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
