import { type N, type Scope, type Val, BOOL, fail, literalTy, rustStr, STR, UNDEF } from "./model.ts";
import { constOf, ownKeys, ownKeyTest } from "./constants.ts";
import { describeTy, expr } from "./expr.ts";
import { atom, strArg } from "./parens.ts";
import { computed, COW } from "./lists.ts";

function hasOwn(s: Scope, args: N[], n: N): Val {
  if (args.length !== 2 || args.some((a) => a.type === "SpreadElement")) return fail(s.comp, "FV0814", "`Object.hasOwn()` takes an object and a key", n);
  const own = ownKeyTest(s, args[0], args[1]);
  if (own) return own.test === "true" || own.test === "false" ? { code: own.test, ty: BOOL, konst: own.test === "true" } : { code: own.test, ty: BOOL };
  const r = expr(s, args[0]);
  const key = expr(s, args[1]);
  if (r.ty.k === "record" && key.ty.k === "str") return { code: `${atom(r.code)}.get(${strArg(key.code)}).is_some()`, ty: BOOL };
  const of = r.ty.k === "record" ? `the key is ${describeTy(key.ty)}, where it takes a string that is present` : `the object is ${describeTy(r.ty)}, where it takes a constant object or a \`Record<string, T>\` prop`;
  return fail(s.comp, "FV0814", `\`Object.hasOwn()\` tests a constant object's or a record's own keys, and ${of}`, n);
}

export function objectCall(s: Scope, method: string, args: N[], n: N): Val {
  const comp = s.comp;
  if (method === "hasOwn") return hasOwn(s, args, n);
  const named = args.length === 1 ? constOf(s, args[0]) : null;
  if (named?.sym.k === "const" && named.sym.c.k === "object") {
    if (method === "keys") {
      const keys = ownKeys(named.sym.c);
      return keys.length ? { code: `[${keys.map(rustStr).join(", ")}]`, ty: { k: "list", of: literalTy("str", keys) } } : { code: "[]", ty: { k: "list", of: UNDEF } };
    }
    if (method === "values" || method === "entries") {
      return fail(comp, "FV0814", `\`Object.${method}()\` of \`${named.what}\`, a constant object, whose fields the server reads one by one: list its keys with \`Object.keys()\` and read each field by its key`, n);
    }
  }
  const r = args.length === 1 ? expr(s, args[0]) : null;
  if (r?.ty.k !== "record") return fail(comp, "FV0814", `\`Object.${method}()\` takes a \`Record<string, T>\` prop${r ? `, and this is ${describeTy(r.ty)}` : ""}`, n);
  const of = r.ty.of;
  if (method === "keys") return computed(`${atom(r.code)}.keys().map(${COW}::Borrowed)`, STR);
  if (method === "values") {
    const values = of.k === "str" ? `.values().map(|v| ${COW}::Borrowed(&**v))` : of.k === "date" ? ".values().map(fv::date::js_time_of)" : ["struct", "child", "list", "record"].includes(of.k) ? ".values()" : ".values().copied()";
    return computed(`${atom(r.code)}${values}`, of);
  }
  if (method === "entries") return computed(`${atom(r.code)}.iter()`, { k: "entry", of }, r.lone);
  return fail(comp, "FV0817", `\`Object.${method}()\` is not supported: \`keys\`, \`values\` and \`entries\` of a record are`, n);
}
