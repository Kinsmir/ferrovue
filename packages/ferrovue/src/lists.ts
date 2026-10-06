import { type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, INT, opt, sameTy, STR } from "./model.ts";
import { ctx } from "./context.ts";
import { expr, fieldVal } from "./expr.ts";
import { cond } from "./narrowing.ts";
import { asF64, isNumber } from "./numbers.ts";
import { asCow, isTemporary, lonely, meet, yieldsCow } from "./strings.ts";
import { atom, binary, operand, strArg, UNARY } from "./parens.ts";

const COW = "std::borrow::Cow::<str>";

function itemsTy(s: Scope, v: Val, n: N): Ty {
  if (v.ty.k !== "list") return fail(s.comp, "FV0803", "not a list", n);
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
    fail(comp, "FV0805", `\`.${method}()\` takes an arrow function of the item, and of its index: \`x => …\`, \`(x, i) => …\``, fn);
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
  const narrowed = new Map([...s.narrowed].filter(([path]) => !bound.some((b) => path === b || path.startsWith(`${b}.`))));
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

export function listMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  const comp = s.comp;
  if (!["filter", "map", "some", "every", "find", "findIndex", "slice"].includes(method)) return null;
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
    case "find": {
      const { closure, enumerate } = arrow(s, fn, target, of, true, method, (inner) => cond(inner, fn.body));
      const found = enumerate ? `${it}.enumerate().find(${closure}).map(|(_, v)| v)` : `${it}.find(${closure})`;
      const lone = target.lone ? { lone: true } : {};
      if (of.k === "str") return { code: `${atom(found)}.as_deref()`, ty: opt(STR), held: `${found}.map(|v| ${COW}::Owned(v.into_owned()))`, ...lone };
      return { code: found, ty: opt(of), ...lone };
    }
    default: {
      const { closure, enumerate } = arrow(s, fn, target, of, false, method, (inner) => cond(inner, fn.body));
      return { code: `${it}${enumerate ? ".enumerate()" : ""}.position(${closure}).map_or(-1, |i| i as i64)`, ty: INT };
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

export function computedListMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  if (target.ty.k !== "list") return null;
  const of = target.ty.of;
  if (method === "includes" && args.length === 1) {
    const x = expr(s, args[0]);
    const numbers = isNumber(x.ty) && isNumber(of);
    if ((!sameTy(x.ty, of) && !numbers) || !["str", "int", "float", "bool"].includes(of.k)) fail(s.comp, "FV0801", "`.includes()` looks for a value of the list's own type", args[0]);
    if (of.k === "str") meet(s.comp, target, x, "`.includes()`", n, "equal");
    const test =
      of.k === "str"
        ? `*v == ${x.code.startsWith("&*") ? `*${x.code.slice(2)}` : `*${operand(x.code, UNARY)}`}`
        : of.k === "float" && x.ty.k === "int"
          ? binary("v", "==", asF64(x))
          : of.k === "float"
            ? `v == ${x.code} || (v.is_nan() && ${atom(x.code)}.is_nan())`
            : of.k === "int" && x.ty.k === "float"
              ? binary("v as f64", "==", x.code)
              : `v == ${x.code}`;
    return { code: `${items(target)}.any(|v| ${test})`, ty: BOOL };
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
