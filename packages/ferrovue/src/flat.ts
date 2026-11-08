import { type N, type Scope, type Ty, type Val, fail, FLOAT } from "./model.ts";
import { atom } from "./parens.ts";
import { arrow, collected, computed, items, itemsTy, mapped, untypedEmpty } from "./lists.ts";
import { describeTy, expr } from "./expr.ts";
import { RISKS_NEGATIVE_ZERO } from "./reduce.ts";

const FLAT_ITEMS = new Set(["str", "int", "float", "bool", "struct", "child"]);

function nested(v: Val): string {
  return v.iter ?? `${atom(v.code)}.iter()`;
}

export function flattened(s: Scope, target: Val, args: N[], n: N): Val {
  const comp = s.comp;
  if (args.length > 1) fail(comp, "FV0834", "`.flat()` takes a depth, or none", n);
  const given = args[0];
  let depth = 1;
  if (given !== undefined && !(given.type === "Identifier" && given.name === "undefined")) {
    depth = given.type === "NumericLiteral" ? Math.trunc(given.value) : given.type === "Identifier" && given.name === "Infinity" && !s.locals.has("Infinity") ? Infinity : NaN;
    if (Number.isNaN(depth)) fail(comp, "FV0834", "`.flat()` takes its depth as a literal number, or `Infinity`", given);
  }
  let of = (target.ty as { of: Ty }).of;
  let it = of.k === "list" ? nested(target) : items(target);
  for (let level = 0; level < depth && of.k === "list"; level++) {
    const inner: Ty = of.of;
    it = `${it}.flat_map(|v| ${inner.k === "list" ? "v.iter()" : items({ code: "v", ty: of })})`;
    of = inner;
  }
  let innermost = of;
  while (innermost.k === "list") innermost = innermost.of;
  if (!FLAT_ITEMS.has(innermost.k)) {
    fail(comp, "FV0834", `\`.flat()\` makes a list of strings, numbers, booleans or objects, or of lists of them, and this one's items are ${describeTy(innermost).replace(/^an? /, "")}s`, n);
  }
  return computed(it, of, target.lone);
}

export function flatMapped(s: Scope, target: Val, args: N[], n: N): Val {
  const comp = s.comp;
  if (args.length !== 1) fail(comp, "FV0813", "`.flatMap()` takes one arrow function", n);
  const of = itemsTy(s, target, n);
  const fn = args[0];
  let out: Val | undefined;
  const { closure, enumerate } = arrow(s, fn, target, of, false, "flatMap", (inner) => {
    out = expr(inner, fn.body);
    if (out.ty.k !== "list") {
      if (out.ty.k === "int" && out.f64 !== undefined && RISKS_NEGATIVE_ZERO.test(out.f64)) out = { ...out, code: out.f64, ty: FLOAT };
      return mapped(inner, out, fn.body);
    }
    if (!FLAT_ITEMS.has(out.ty.of.k)) {
      fail(comp, "FV0834", `\`.flatMap()\` makes a list of strings, numbers, booleans or objects, and its function gives ${untypedEmpty(out) ? "only `[]`, whose items have no type: give it a typed list, `[] as string[]`" : `a list of ${describeTy(out.ty.of).replace(/^an? /, "")}s`}`, fn.body);
    }
    return collected(out);
  });
  const each = `${items(target)}${enumerate ? ".enumerate()" : ""}`;
  if (out!.ty.k === "list") return computed(`${each}.flat_map(${closure})`, out!.ty.of, out!.lone);
  return computed(`${each}.map(${closure})`, out!.ty, out!.lone);
}
