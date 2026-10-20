import { type Component, type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, INT, opt, sameTy, STR, UNDEF } from "./model.ts";
import { ctx } from "./context.ts";
import { describeTy, expr, fieldVal } from "./expr.ts";
import { cond } from "./narrowing.ts";
import { localTy } from "./rust.ts";
import { asF64, isNumber } from "./numbers.ts";
import { asCow, isTemporary, lonely, meet, yieldsCow } from "./strings.ts";
import { atom, bare, binary, enclosed, operand, strArg, UNARY } from "./parens.ts";

const COW = "std::borrow::Cow::<str>";

function itemsTy(s: Scope, v: Val, n: N): Ty {
  if (v.ty.k !== "list") throw new Error("a list method on a value that is not a list");
  const of = v.ty.of;
  if (!["str", "int", "float", "bool", "struct", "child"].includes(of.k)) {
    fail(s.comp, "FV0804", "this method takes a list of strings, numbers, booleans or objects", n);
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

export function computed(iter: string, of: Ty, lone?: boolean): Val {
  return { code: `${iter}.collect::<Vec<_>>()`, ty: { k: "list", of }, iter, ...(lone ? { lone } : {}) };
}

export function collected(v: Val): string {
  const of = v.ty.k === "list" ? v.ty.of : v.ty;
  return `${items(v)}${of.k === "str" ? `.map(|v| ${COW}::Owned(v.into_owned()))` : ""}.collect::<Vec<_>>()`;
}

export function sliced(v: Val): string {
  return v.slice ? v.code : `&${atom(v.code)}[..]`;
}

export function untypedEmpty(v: Val): boolean {
  return v.ty.k === "list" && v.ty.of.k === "undef";
}

export function typedEmpty(comp: Component, of: Ty): Val {
  return { code: `<&[${localTy(of, comp)}]>::default()`, ty: { k: "list", of }, slice: true };
}

export function heldList(name: string, of: Ty, lone?: boolean): Val {
  const iter = of.k === "str" ? `${name}.iter().map(|v| ${COW}::Borrowed(&**v))` : `${name}.iter().copied()`;
  return { code: name, ty: { k: "list", of }, iter, ...(lone ? { lone } : {}) };
}

function itemVal(of: Ty, param: string, byRef: boolean, lone?: boolean): Val {
  const scalar = of.k === "int" || of.k === "float" || of.k === "bool";
  const code = of.k === "str" ? (byRef ? `&**${param}` : `&*${param}`) : byRef && scalar ? `*${param}` : param;
  return { code, ty: of, ...(lone ? { lone } : {}) };
}

export function arrow(s: Scope, fn: N, list: Val, of: Ty, byRef: boolean, method: string, body: (inner: Scope) => string): { closure: string; enumerate: boolean } {
  const comp = s.comp;
  if (fn?.type !== "ArrowFunctionExpression" || fn.async || fn.params.length > 2) {
    fail(comp, "FV0805", `\`.${method}()\` takes an arrow function of the item, and of its index: \`x => …\`, \`(x, i) => …\`, or \`Boolean\``, fn);
  }
  if (fn.body.type === "BlockStatement") fail(comp, "FV0806", `\`.${method}()\` takes an arrow function whose body is an expression, without \`{ return … }\``, fn);
  const [item, index] = fn.params as N[];
  if (index && index.type !== "Identifier") fail(comp, "FV0807", "an arrow function's index is a plain name", index);
  const n = ++ctx.narrowCount;
  const p = of.k === "str" ? `fv_s${n}` : `fv_a${n}`;
  const i = `fv_i${n}`;
  const v = itemVal(of, p, byRef, list.lone);
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
  } else if (item) fail(comp, "FV0809", "an arrow function's item is a name, or an object pattern of an object", item);
  if (index) {
    locals.set(index.name, { code: i, ty: INT });
    bound.push(index.name);
  }
  const narrowed = new Map([...s.narrowed].filter(([path]) => !bound.some((b) => path === b || path.startsWith(`${b}.`) || path.startsWith(`${b}[`))));
  const code = body({ ...s, locals, narrowed });
  const reads = (name: string) => new RegExp(`\\b${name}\\b`).test(code);
  const pName = reads(p) ? p : "_";
  if (!index) return { closure: `|${pName}| ${code}`, enumerate: false };
  const lets = (reads(i) ? `let ${i} = ${i} as i64; ` : "");
  if (byRef) {
    const e = `fv_e${n}`;
    const itemLet = reads(p) ? `let ${p} = &${e}.1; ` : "";
    const indexLet = reads(i) ? `let ${i} = ${e}.0 as i64; ` : "";
    return { closure: `|${itemLet || indexLet ? e : "_"}| { ${itemLet}${indexLet}${code} }`, enumerate: true };
  }
  return { closure: `|(${reads(i) ? i : "_"}, ${pName})| { ${lets}${code} }`, enumerate: true };
}

function mapped(s: Scope, v: Val, n: N): string {
  switch (v.ty.k) {
    case "str":
      if (v.code.startsWith("&*fv::") && yieldsCow(v.code.slice(2))) return `${COW}::Owned(${v.code.slice(2)}.into_owned())`;
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
      return `&${operand(v.code, UNARY)}`;
    default:
      return fail(s.comp, "FV0810", `\`.map()\` makes a list of strings, numbers, booleans or objects, not ${v.ty.k === "opt" ? "optional values" : "these"}`, n);
  }
}

/** Is `n` the global `Boolean` (`.filter(Boolean)`, `Boolean(x)`), which no name in the component shadows? */
export function isBoolean(s: Scope, n: N): boolean {
  return n?.type === "Identifier" && n.name === "Boolean" && ![s.locals, s.setup, s.helpers, s.clientOnly].some((names) => names.has(n.name));
}

// JavaScript calls `Boolean` with the item alone, and it returns the item's truthiness: it is
// `x => x` where a condition is wanted, and `x => !!x` for `.map()`.
function booleanArrow(n: N, method: string): N {
  const item = { ...n, name: "fv$item" };
  const not = (argument: N): N => ({ ...n, type: "UnaryExpression", operator: "!", prefix: true, argument });
  return { ...n, type: "ArrowFunctionExpression", async: false, params: [item], body: method === "map" ? not(not(item)) : item };
}

// The items of a list of optional values that are present, as a list of the values: what
// `.filter(Boolean)` keeps of it, before it drops the falsy ones.
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
  const of = kept.map((v: Val) => (v.ty.k === "opt" ? v.ty.of : v.ty))[0];
  if (of === undefined) return computed("std::iter::empty::<bool>()", BOOL);
  if (!["str", "int", "float", "bool"].includes(of.k) || kept.some((v: Val) => !sameTy(v.ty.k === "opt" ? v.ty.of : v.ty, of))) {
    fail(comp, "FV0611", "an array literal holds strings, numbers or booleans, all of one type, each of which may be absent", n);
  }
  const options = kept.map((v: Val) => (v.ty.k === "opt" ? bare(v.code) : `Some(${bare(v.code)})`));
  const flat = `[${options.join(", ")}].into_iter().flatten()`;
  return computed(of.k === "str" ? `${flat}.map(${COW}::Borrowed)` : flat, of, kept.some((v: Val) => v.lone));
}

function backwards(target: Val): string {
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
    if (["int", "float", "bool", "struct", "child"].includes(of.k)) return { code: got, ty: opt(of) };
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
        return { code: flat ? `${got}.and_then(|v| *v)` : `${got}.copied()`, ty: opt(of) };
      case "struct":
      case "child":
        return { code: flat ? `${got}.and_then(|v| v.as_ref())` : got, ty: opt(of) };
      default:
        break;
    }
  }
  return fail(s.comp, "FV0804", "an item is read from a list of strings, numbers, booleans or objects, each of which may be absent", n);
}

const RISKS_NEGATIVE_ZERO = /-[\w(]|\s[*%]\s/;

function ownedString(v: Val, acc: string): string {
  if (v.code === `&*${acc}`) return acc;
  if (v.code === '""') return "String::new()";
  const built = /^&\*(format!\(.*\))$/s.exec(v.code)?.[1];
  if (built !== undefined && enclosed(built.slice("format!".length))) return built;
  return `String::from(${bare(v.code)})`;
}

function reduced(s: Scope, target: Val, method: string, args: N[], n: N): Val {
  const comp = s.comp;
  if (args.length < 2) {
    fail(comp, "FV0828", `\`.${method}()\` takes an initial value after its function: without one, JavaScript throws a \`TypeError\` on an empty list`, n);
  }
  if (args.length > 2) fail(comp, "FV0829", `\`.${method}()\` takes a function and an initial value`, n);
  const of = itemsTy(s, target, n);
  const fn = args[0];
  if (fn?.type !== "ArrowFunctionExpression" || fn.async || fn.params.length < 2 || fn.params.length > 3 || fn.params[0].type !== "Identifier") {
    fail(comp, "FV0829", `\`.${method}()\` takes an arrow function of the accumulator, the item and its index: \`(acc, x) => …\` or \`(acc, x, i) => …\``, fn);
  }
  const accName: string = fn.params[0].name;
  const init = expr(s, args[1]);
  if (!["str", "int", "float", "bool"].includes(init.ty.k)) {
    fail(comp, "FV0829", `\`.${method}()\` accumulates a string, a number or a boolean that is present, and its initial value is ${describeTy(init.ty)}`, args[1]);
  }
  let accTy: Ty = init.ty.k === "int" && init.f64 !== undefined && RISKS_NEGATIVE_ZERO.test(init.f64) ? FLOAT : init.ty;
  let lone = !!init.lone;
  const item = { ...fn, params: fn.params.slice(1) };
  const narrowed = new Map([...s.narrowed].filter(([path]) => path !== accName && !path.startsWith(`${accName}.`) && !path.startsWith(`${accName}[`)));
  for (;;) {
    const acc = `fv_acc${++ctx.narrowCount}`;
    const accVal: Val = accTy.k === "str" ? { code: `&*${acc}`, ty: STR, ...(lone ? { lone } : {}) } : { code: acc, ty: accTy };
    const outer: Scope = { ...s, locals: new Map(s.locals).set(accName, accVal), narrowed };
    const seen = { wider: false, loner: false };
    const { closure, enumerate } = arrow(outer, item, target, of, false, method, (inner) => {
      const out = expr(inner, fn.body);
      const changes = `the function gives ${describeTy(out.ty)} where the accumulator, from its initial value, is ${describeTy(accTy)}`;
      switch (accTy.k) {
        case "str":
          if (out.ty.k !== "str") fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          if (out.lone && !lone) seen.loner = true;
          return ownedString(out, acc);
        case "int":
          if (out.ty.k === "float" || (out.ty.k === "int" && out.f64 !== undefined && RISKS_NEGATIVE_ZERO.test(out.f64))) seen.wider = true;
          else if (out.ty.k !== "int") fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          return bare(out.code);
        case "float":
          if (!isNumber(out.ty)) fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          return bare(asF64(out));
        default:
          if (out.ty.k !== "bool") fail(comp, "FV0829", `\`.${method}()\` keeps one type of accumulator, and ${changes}`, fn.body);
          return bare(out.code);
      }
    });
    if (seen.wider) {
      accTy = FLOAT;
      continue;
    }
    if (seen.loner) {
      lone = true;
      continue;
    }
    const start = accTy.k === "str" ? ownedString(init, "") : accTy.k === "float" ? bare(asF64(init)) : bare(init.code);
    const reads = new RegExp(`\\b${acc}\\b`).test(closure);
    const step = closure.replace(/^\|/, `|${reads ? acc : "_"}, `);
    const from = method === "reduce" ? `${items(target)}${enumerate ? ".enumerate()" : ""}` : `${backwards(target)}${enumerate ? ".enumerate()" : ""}.rev()`;
    const folded = `fv::js_reduce(${from}, ${start}, ${step})`;
    if (accTy.k === "str") return { code: `&*${folded}`, ty: STR, ...(lone ? { lone } : {}) };
    return { code: folded, ty: accTy };
  }
}

function keyPath(node: N, param: string): string | null {
  while (node?.type === "ParenthesizedExpression") node = node.expression;
  if (node?.type === "Identifier") return node.name === param ? "" : null;
  if (node?.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    const base = keyPath(node.object, param);
    return base === null ? null : `${base}.${node.property.name}`;
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

function sortedBy(s: Scope, target: Val, of: Ty, fn: N): Val {
  const comp = s.comp;
  const shapes = "`(a, b) => a - b`, `(a, b) => a.k - b.k` over integers, or `?:` over `<` and `>` of integers or strings giving -1, 0 and 1";
  if (fn?.type !== "ArrowFunctionExpression" || fn.async || fn.params.length !== 2 || fn.params.some((p: N) => p.type !== "Identifier") || fn.body.type === "BlockStatement") {
    fail(comp, "FV0830", `\`.toSorted()\` takes a comparator of a shape the server orders by, as JavaScript does: ${shapes}`, fn);
  }
  const k = ++ctx.narrowCount;
  const [pa, pb] = [`fv_l${k}`, `fv_r${k}`];
  const locals = new Map(s.locals).set(fn.params[0].name, itemVal(of, pa, true, target.lone)).set(fn.params[1].name, itemVal(of, pb, true, target.lone));
  const bound: string[] = fn.params.map((p: N) => p.name as string);
  const narrowed = new Map([...s.narrowed].filter(([path]) => !bound.some((b) => path === b || path.startsWith(`${b}.`) || path.startsWith(`${b}[`))));
  const inner: Scope = { ...s, locals, narrowed };
  const shape = comparatorShape(fn);
  if (shape === null) {
    expr(inner, fn.body);
    fail(comp, "FV0830", `\`.toSorted()\` takes a comparator of a shape the server orders by, as JavaScript does: ${shapes}`, fn.body);
  }
  if (shape.ascending === null) return computed(items(target), of, target.lone);
  const key = (name: string): Val => {
    let node: N = { type: "Identifier", name, loc: fn.body.loc, start: fn.body.start, end: fn.body.end };
    for (const field of shape.path.split(".").slice(1)) node = { type: "MemberExpression", computed: false, object: node, property: { type: "Identifier", name: field }, loc: fn.body.loc, start: fn.body.start, end: fn.body.end };
    return expr(inner, node);
  };
  const [ka, kb] = [key(fn.params[0].name), key(fn.params[1].name)];
  const [x, y] = shape.ascending ? [ka, kb] : [kb, ka];
  let order: string;
  if (ka.ty.k === "int") order = `fv::js_order(${bare(asF64(x))}, ${bare(asF64(y))})`;
  else if (ka.ty.k === "str" && !shape.subtracted) {
    if (ka.lone) fail(comp, "FV0706", lonely("`.toSorted()`"), fn.body);
    order = `fv::js_cmp(${strArg(x.code)}, ${strArg(y.code)})`;
  } else if (ka.ty.k === "float") {
    return fail(comp, "FV0830", "`.toSorted()` by a `Float`, which may be `NaN`: JavaScript then takes the comparator as inconsistent and each engine orders the items its own way. Sort by an integer or a string", fn.body);
  } else {
    return fail(comp, "FV0830", `\`.toSorted()\` orders by ${shape.subtracted ? "integers" : "integers or strings"}, and this key is ${describeTy(ka.ty)}`, fn.body);
  }
  const reads = (name: string) => new RegExp(`\\b${name}\\b`).test(order);
  return computed(`fv::js_sorted(${items(target)}, |${reads(pa) ? pa : "_"}, ${reads(pb) ? pb : "_"}| ${order})`, of, target.lone);
}

function sorted(s: Scope, target: Val, args: N[], n: N): Val {
  const comp = s.comp;
  const of = itemsTy(s, target, n);
  if (args.length > 1) fail(comp, "FV0830", "`.toSorted()` takes one comparator, or none", n);
  if (args.length === 1 && !(args[0].type === "Identifier" && args[0].name === "undefined")) return sortedBy(s, target, of, args[0]);
  const it = items(target);
  switch (of.k) {
    case "str":
      if (target.lone) fail(comp, "FV0706", lonely("`.toSorted()`"), n);
      return computed(`fv::js_sorted(${it}, |a, b| fv::js_cmp(a, b))`, of);
    case "int":
    case "float":
      return computed(`fv::js_sorted_by_string(${it}, |v| fv::Js(*v).to_string())`, of);
    case "bool":
      return computed(`fv::js_sorted(${it}, bool::cmp)`, of);
    default:
      return fail(comp, "FV0831", "`.toSorted()` without a comparator orders objects by `String(x)`, which is `[object Object]` for each: give it a comparator, `(a, b) => a.k - b.k`", n);
  }
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
  const of = numbers && tys.some((t) => t.k === "float") ? FLOAT : own;
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
  return { code: `${all}.fold(${start}, fv::js_${method})`, ty: FLOAT };
}

export function listMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  const comp = s.comp;
  if (method === "reduce" || method === "reduceRight") return reduced(s, target, method, args, n);
  if (method === "toReversed") {
    if (args.length !== 0) fail(comp, "FV0602", "`.toReversed()` takes no arguments", n);
    const of = itemsTy(s, target, n);
    const held = target.iter !== undefined && /^[\w.]+\.iter\(\)(?:\.copied\(\)|\.map\(\|v\| std::borrow::Cow::<str>::Borrowed\(&\*\*v\)\))?$/.test(target.iter);
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
    return picked(s, target, n, (list) => `fv::js_item_at(${list}.iter(), ${f})`, (it) => `fv::js_item_at(${it}, ${f})`);
  }
  if (method === "indexOf" || method === "lastIndexOf") {
    if (args.length !== 1) fail(comp, "FV0826", `\`.${method}()\` takes one value to look for, without a position to start from`, n);
    const of = target.ty.k === "list" ? target.ty.of : target.ty;
    const x = expr(s, args[0]);
    const v = `fv_x${++ctx.narrowCount}`;
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
    const of = [target, ...parts].some((p) => p.ty.k === "list" && p.ty.of.k === "float") ? FLOAT : own;
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
      `fv::js_slice_items(${it}, ${from}, ${to === null ? "None" : `Some(${to})`})`,
      of,
      target.lone,
    );
  }
  if (args.length !== 1) fail(comp, "FV0813", `\`.${method}()\` takes one arrow function`, n);
  const fn = args[0];
  switch (method) {
    case "filter": {
      const { closure, enumerate } = arrow(s, fn, target, of, true, method, (inner) => cond(inner, fn.body));
      return computed(enumerate ? `${it}.enumerate().filter(${closure}).map(|(_, v)| v)` : `${it}.filter(${closure})`, of, target.lone);
    }
    case "map": {
      let out: Val | undefined;
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => {
        out = expr(inner, fn.body);
        if (out.ty.k === "int" && out.f64 !== undefined && /-[\w(]|\s[*%]\s/.test(out.f64)) out = { ...out, code: out.f64, ty: FLOAT };
        return mapped(inner, out, fn.body);
      });
      return computed(`${it}${enumerate ? ".enumerate()" : ""}.map(${closure})`, out!.ty, out!.lone);
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

export function objectCall(s: Scope, method: string, args: N[], n: N): Val {
  const comp = s.comp;
  const r = args.length === 1 ? expr(s, args[0]) : null;
  if (r?.ty.k !== "record") return fail(comp, "FV0814", `\`Object.${method}()\` takes a \`Record<string, T>\``, n);
  const of = r.ty.of;
  if (method === "keys") return computed(`${atom(r.code)}.keys().map(${COW}::Borrowed)`, STR);
  if (method === "values") {
    if (of.k === "list") fail(comp, "FV0815", "`Object.values()` of a record of lists, which these methods cannot walk", n);
    const values = of.k === "str" ? `.values().map(|v| ${COW}::Borrowed(&**v))` : of.k === "struct" || of.k === "child" ? ".values()" : ".values().copied()";
    return computed(`${atom(r.code)}${values}`, of);
  }
  if (method === "entries") return fail(comp, "FV0816", "`Object.entries()` is supported as the source of a `v-for`: `([key, value], i) in Object.entries(r)`", n);
  return fail(comp, "FV0817", `\`Object.${method}()\` is not supported: \`keys\`, \`values\` and \`entries\` of a record are`, n);
}

function sameItem(s: Scope, target: Val, of: Ty, x: Val, v: string, code: "FV0801" | "FV0826", method: string, n: N): string {
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

export function computedListMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  if (target.ty.k !== "list") return null;
  const of = target.ty.of;
  if (method === "includes" && args.length === 1) {
    const x = expr(s, args[0]);
    const v = `fv_x${++ctx.narrowCount}`;
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
    const each = of.k === "str" ? "" : of.k === "bool" ? `.map(|v| if v { "true" } else { "false" })` : ".map(|v| fv::Js(v).to_string())";
    return { code: `&*${items(target)}${each}.collect::<Vec<_>>().join(${strArg(sep.code)})`, ty: STR, ...(target.lone || sep.lone ? { lone: true } : {}) };
  }
  return null;
}
