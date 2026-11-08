import { type N, type Scope, type Ty, type Val } from "./model.ts";
import { fail } from "./locate.ts";
import { fresh, jsHint } from "./names.ts";
import { computed, items, itemsTy, itemVal } from "./lists.ts";
import { unbound } from "./narrowing.ts";
import { describeTy, expr } from "./expr.ts";
import { bare, strArg } from "./parens.ts";
import { asF64 } from "./numbers.ts";
import { lonely } from "./strings.ts";

function keyPath(node: N, param: string): string | null {
  while (node?.type === "ParenthesizedExpression") node = node.expression;
  if (node?.type === "Identifier") return node.name === param ? "" : null;
  if (node?.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    const base = keyPath(node.object, param);
    return base === null ? null : `${base}.${node.property.name}`;
  }
  if (node?.type === "MemberExpression" && node.computed && node.property.type === "NumericLiteral" && (node.property.value === 0 || node.property.value === 1)) {
    const base = keyPath(node.object, param);
    return base === null ? null : `${base}.[${node.property.value}]`;
  }
  return null;
}

type Shape = { path: string; ascending: boolean | null; subtracted: boolean };

function literalNumber(node: N): number | null {
  while (node?.type === "ParenthesizedExpression") node = node.expression;
  if (node?.type === "NumericLiteral") return node.value;
  if (node?.type === "UnaryExpression" && (node.operator === "-" || node.operator === "+")) {
    const x = literalNumber(node.argument);
    return x === null ? null : node.operator === "-" ? -x : x;
  }
  return null;
}

function comparatorShape(fn: N): Shape | null {
  const [a, b] = fn.params.map((p: N) => p.name as string);
  let body: N = fn.body;
  while (body?.type === "ParenthesizedExpression") body = body.expression;
  if (body?.type === "BinaryExpression" && body.operator === "-") {
    const [la, rb, lb, ra] = [keyPath(body.left, a), keyPath(body.right, b), keyPath(body.left, b), keyPath(body.right, a)];
    if (la !== null && la === rb) return { path: la, ascending: true, subtracted: true };
    if (lb !== null && lb === ra) return { path: lb, ascending: false, subtracted: true };
    return null;
  }
  let path: string | null | undefined;
  const test = (node: N, order: number): boolean | null => {
    while (node?.type === "ParenthesizedExpression") node = node.expression;
    if (node?.type !== "BinaryExpression" || !["<", ">", "<=", ">=", "===", "!=="].includes(node.operator)) return null;
    let rel: number;
    const [la, rb, lb, ra] = [keyPath(node.left, a), keyPath(node.right, b), keyPath(node.left, b), keyPath(node.right, a)];
    if (la !== null && la === rb) rel = order;
    else if (lb !== null && lb === ra) rel = -order;
    else return null;
    const p = la !== null && la === rb ? la : lb;
    if (path !== undefined && path !== p) return null;
    path = p;
    switch (node.operator) {
      case "<":
        return rel < 0;
      case ">":
        return rel > 0;
      case "<=":
        return rel <= 0;
      case ">=":
        return rel >= 0;
      case "===":
        return rel === 0;
      default:
        return rel !== 0;
    }
  };
  const result = (node: N, order: number): number | null => {
    while (node?.type === "ParenthesizedExpression") node = node.expression;
    if (node?.type === "ConditionalExpression") {
      const t = test(node.test, order);
      return t === null ? null : result(t ? node.consequent : node.alternate, order);
    }
    return literalNumber(node);
  };
  const [less, equal, greater] = [result(body, -1), result(body, 0), result(body, 1)];
  if (less === null || equal === null || greater === null || [less, equal, greater].some(Number.isNaN)) return null;
  if (Math.sign(equal) !== 0 || Math.sign(less) !== -Math.sign(greater)) return null;
  if (path === undefined || less === 0) return { path: "", ascending: null, subtracted: false };
  return { path: path ?? "", ascending: less < 0, subtracted: false };
}

function pairsRead(fn: N): N {
  const parts = new Map<string, N>();
  const params = fn.params.map((p: N, i: number) => {
    if (p?.type !== "ArrayPattern" || p.elements.length > 2 || p.elements.some((x: N) => x !== null && x.type !== "Identifier")) return p;
    const name = `fv$pair${i}`;
    p.elements.forEach((x: N, j: number) => {
      if (x) parts.set(x.name, { ...x, type: "MemberExpression", computed: true, object: { ...x, type: "Identifier", name }, property: { ...x, type: "NumericLiteral", value: j } });
    });
    return { ...p, type: "Identifier", name };
  });
  if (parts.size === 0) return fn;
  const swap = (node: N): N => {
    if (Array.isArray(node)) return node.map(swap);
    if (!node || typeof node !== "object") return node;
    if (node.type === "Identifier") return parts.get(node.name) ?? node;
    const out: N = {};
    for (const [key, v] of Object.entries(node)) out[key] = key === "loc" || key === "__fv" ? v : node.type === "MemberExpression" && key === "property" && !node.computed ? v : swap(v);
    return out;
  };
  return { ...fn, params, body: swap(fn.body) };
}

function sortedBy(s: Scope, target: Val, of: Ty, given: N): Val {
  const comp = s.comp;
  const fn = of.k === "entry" && given?.type === "ArrowFunctionExpression" ? pairsRead(given) : given;
  const shapes = "`(a, b) => a - b`, `(a, b) => a.k - b.k` over integers, or `?:` over `<` and `>` of integers or strings giving -1, 0 and 1";
  if (fn?.type !== "ArrowFunctionExpression" || fn.async || fn.params.length !== 2 || fn.params.some((p: N) => p.type !== "Identifier") || fn.body.type === "BlockStatement") {
    fail(comp, "FV0830", `\`.toSorted()\` takes a comparator of a shape the server orders by, as JavaScript does: ${shapes}`, fn);
  }
  const [pa, pb] = [fresh("l", jsHint(fn.params[0].name)), fresh("r", jsHint(fn.params[1].name))];
  const locals = new Map(s.locals).set(fn.params[0].name, itemVal(of, pa, true, target.lone)).set(fn.params[1].name, itemVal(of, pb, true, target.lone));
  const bound: string[] = fn.params.map((p: N) => p.name as string);
  const narrowed = unbound(s.narrowed, bound);
  const inner: Scope = { ...s, locals, narrowed };
  const shape = comparatorShape(fn);
  if (shape === null) {
    expr(inner, fn.body);
    fail(comp, "FV0830", `\`.toSorted()\` takes a comparator of a shape the server orders by, as JavaScript does: ${shapes}`, fn.body);
  }
  if (shape.ascending === null) return computed(items(target), of, target.lone);
  const key = (name: string): Val => {
    let node: N = { type: "Identifier", name, loc: fn.body.loc, start: fn.body.start, end: fn.body.end };
    for (const field of shape.path.split(".").slice(1)) {
      const index = /^\[(\d)\]$/.exec(field)?.[1];
      const property = index === undefined ? { type: "Identifier", name: field } : { type: "NumericLiteral", value: Number(index) };
      node = { type: "MemberExpression", computed: index !== undefined, object: node, property, loc: fn.body.loc, start: fn.body.start, end: fn.body.end };
    }
    return expr(inner, node);
  };
  const [ka, kb] = [key(fn.params[0].name), key(fn.params[1].name)];
  const [x, y] = shape.ascending ? [ka, kb] : [kb, ka];
  let order: string;
  if (ka.ty.k === "int") order = `fv::strings::js_order(${bare(asF64(x))}, ${bare(asF64(y))})`;
  else if (ka.ty.k === "str" && !shape.subtracted) {
    if (ka.lone) fail(comp, "FV0706", lonely("`.toSorted()`"), fn.body);
    order = `fv::strings::js_cmp(${strArg(x.code)}, ${strArg(y.code)})`;
  } else if (ka.ty.k === "float") {
    return fail(comp, "FV0830", "`.toSorted()` by a `Float`, which may be `NaN`: JavaScript then takes the comparator as inconsistent and each engine orders the items its own way. Sort by an integer or a string", fn.body);
  } else {
    return fail(comp, "FV0830", `\`.toSorted()\` orders by ${shape.subtracted ? "integers" : "integers or strings"}, and this key is ${describeTy(ka.ty)}`, fn.body);
  }
  const reads = (name: string) => new RegExp(`\\b${name}\\b`).test(order);
  return computed(`fv::strings::js_sorted(${items(target)}, |${reads(pa) ? pa : "_"}, ${reads(pb) ? pb : "_"}| ${order})`, of, target.lone);
}

export function sorted(s: Scope, target: Val, args: N[], n: N): Val {
  const comp = s.comp;
  const of = itemsTy(s, target, n);
  if (args.length > 1) fail(comp, "FV0830", "`.toSorted()` takes one comparator, or none", n);
  if (args.length === 1 && !(args[0].type === "Identifier" && args[0].name === "undefined")) return sortedBy(s, target, of, args[0]);
  const it = items(target);
  switch (of.k) {
    case "str":
      if (target.lone) fail(comp, "FV0706", lonely("`.toSorted()`"), n);
      return computed(`fv::strings::js_sorted(${it}, |a, b| fv::strings::js_cmp(a, b))`, of);
    case "int":
    case "float":
      return computed(`fv::strings::js_sorted_by_string(${it}, |v| fv::core::Js(*v).to_string())`, of);
    case "bool":
      return computed(`fv::strings::js_sorted(${it}, bool::cmp)`, of);
    case "date":
      return fail(comp, "FV1804", "`.toSorted()` without a comparator orders dates by `String(x)`, which writes each in the time zone of the machine running it: sort the dates in Rust and pass them sorted (see the `dates_and_prices` guide)", n);
    case "entry":
      return fail(comp, "FV0816", "`.toSorted()` without a comparator orders the `[key, value]` pairs of `Object.entries()` by `String(pair)`, the key and the value joined by `,`, which the server does not write for each pair: give it a comparator, `([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)` or `(a, b) => a[1] - b[1]`", n);
    default:
      return fail(comp, "FV0831", "`.toSorted()` without a comparator orders objects by `String(x)`, which is `[object Object]` for each: give it a comparator, `(a, b) => a.k - b.k`", n);
  }
}
