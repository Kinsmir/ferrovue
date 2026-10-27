import { type Component, type EnumDef, type N, type Scope, type Ty, type Val, absence, BOOL, enumOf, fail, falsyLiteral, FLOAT, joinTy, keptLiterals, literalsOf, nothing, opt, refusalAt, sameTy, STR, unionStr, variantPath, withAbsence } from "./model.ts";
import { enumListVal, exactlyEnum, intoEnum, knownLiteral } from "./enums.ts";
import { claim } from "./plugin.ts";
import { atom, bare, logical, strArg } from "./parens.ts";
import { sliced, untypedEmpty } from "./lists.ts";
import { asCow, isTemporary, loneOf } from "./strings.ts";
import { asF64, intFromF64, isCast, isNumber } from "./numbers.ts";
import { boolOf, known, literalNarrowing, narrowing, pathOf, type Presence, presence, reassociated, truthy } from "./narrowing.ts";
import { ownedStruct, refuseInPlace } from "./objects.ts";
import { panicky, refuses } from "./blocks.ts";
import { describeTy, expr } from "./expr.ts";

type Optional = Val & { ty: Extract<Ty, { k: "opt" }> };

type Into = (into: EnumDef, node: N) => string | null;

function isOptional(v: Val): v is Optional {
  return v.ty.k === "opt";
}

/** The value of a logical expression: `&&`, `||` or `??`. */
export function logicalOf(s: Scope, n: N): Val {
  const chained = reassociated(s, n);
  if (chained !== n) return expr(s, chained);
  if (n.operator === "&&" || n.operator === "||") {
    const present = byPresence(s, n);
    if (present !== null) return present;
  }
  return bySides(s, n);
}

function bySides(s: Scope, n: N): Val {
  const a = expr(s, n.left);
  const literals = n.operator === "??" ? null : literalNarrowing(s, n.left);
  const right = literals === null ? s : n.operator === "&&" ? literals.yes : literals.no;
  if (n.operator !== "??" && a.ty.k !== "opt" && !nothing(a.ty) && a.ty.k !== "bool" && alwaysTruthy(a.ty)) return n.operator === "&&" ? expr(right, n.right) : a;
  return combined(s, n, a, expr(right, n.right));
}

function combined(s: Scope, n: N, a: Val, b: Val): Val {
  const comp = s.comp;
  if (n.operator === "??" || (n.operator === "||" && (a.ty.k === "opt" ? a.ty.of : a.ty).k === "date")) return nullish(s, n, a, b);
  if (n.operator === "||") return orOf(s, n, a, b);
  if (n.operator === "&&" && a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "&&", b.code));
  return notBooleans(comp, n, a.ty, b.ty);
}

function byPresence(s: Scope, n: N): Val | null {
  const comp = s.comp;
  const p = presence(s, n.left);
  if (p && p.negated === (n.operator === "||") && (p.negated || !p.truthy)) {
    let right: Val | undefined;
    const code = narrowing(s, p, (inner) => (right = expr(inner, n.right)).code, () => String(n.operator === "||"));
    if (right?.ty.k === "bool") return { code, ty: BOOL };
    return notBooleans(comp, n, BOOL, right?.ty);
  }
  const absent = p && n.operator === "&&" && !p.negated ? whenAbsent(s, p, n.left) : null;
  if (absent !== null) return expr(s, { ...n, type: "ConditionalExpression", test: n.left, consequent: n.right, alternate: absent });
  if (p && n.operator === "&&" && !p.negated && p.truthy) {
    return fail(comp, "FV0614", `\`&&\` gives its left side where that is falsy, and this one, ${describeTy(expr(s, n.left).ty)}, may be falsy where it is present (\`""\`, \`0\`, \`false\`), which the value on the right cannot stand for`, n, "test it with `!= null` for a boolean, or write `?:` with the value each side gives");
  }
  return null;
}

function nullish(s: Scope, n: N, a: Val, b: Val): Val {
  const comp = s.comp;
  const own = claim((p) => p.values?.nullish?.(s, a, b, n));
  if (own) return own;
  if (nothing(a.ty)) return b;
  if (!isOptional(a)) return a;
  if (nothing(b.ty)) return { ...a, ty: withAbsence(a.ty.of, absence(b.ty)) };
  if (a.owned || b.owned) return ownedNullish(comp, n, a, b);
  if (b.iter !== undefined) fail(comp, "FV0615", "`??` falling back to a computed list", n);
  return listNullish(s, n, a, b) ?? fallbackOf(comp, n, a, b);
}

function ownedNullish(comp: Component, n: N, a: Optional, b: Val): Val {
  if (a.ty.of.k !== "struct" || !sameTy(a.ty.of, b.ty)) return refuseInPlace(comp, "`??`", n);
  const some = a.owned ? atom(a.code) : `${atom(a.code)}.cloned()`;
  const fallback = bare(ownedStruct(b));
  return { code: panicky(fallback) ? `${some}.unwrap_or_else(|| ${fallback})` : `${some}.unwrap_or(${fallback})`, ty: b.ty, owned: true, ...loneOf(a, b) };
}

function listNullish(s: Scope, n: N, a: Optional, b: Val): Val | null {
  const comp = s.comp;
  if (a.enums !== undefined && a.ty.of.k === "list" && untypedEmpty(b)) return { ...enumListVal(`${atom(a.enums.place)}.as_deref().unwrap_or(&[])`, a.ty.of, a.enums.def), ...loneOf(a, b) };
  if (a.held !== undefined && b.ty.k === "list" && !untypedEmpty(b)) fail(comp, "FV0630", "`??` after an optional chain that computes a list, falling back to another list: fall back to `[]`", n);
  if (a.ty.of.k === "list" && b.ty.k === "list" && (untypedEmpty(b) || (sameTy(a.ty.of, b.ty) && !b.code.startsWith("[")))) {
    return { code: `${atom(a.code)}${a.held !== undefined ? "" : ".map(|v| &v[..])"}.unwrap_or(${untypedEmpty(b) ? "&[]" : sliced(b)})`, ty: untypedEmpty(b) ? a.ty.of : joinTy(a.ty.of, b.ty), slice: true, ...loneOf(a, b) };
  }
  return sameList(s, n, a, b);
}

function sameList(s: Scope, n: N, a: Optional, b: Val): Val | null {
  if (a.ty.of.k === "list" && sameTy(a.ty.of, b.ty)) {
    const at = { loc: n.loc, __fv: n.__fv, start: n.start, end: n.end };
    const test = { type: "BinaryExpression", operator: "!=", left: n.left, right: { type: "NullLiteral", ...at }, ...at };
    return expr(s, { ...n, type: "ConditionalExpression", test, consequent: n.left, alternate: n.right });
  }
  return null;
}

function or(some: string, method: "unwrap_or" | "or", other: string): string {
  return refuses(other) ? `${some}.${method}_else(|| ${other})` : `${some}.${method}(${other})`;
}

function fallbackOf(comp: Component, n: N, a: Optional, b: Val): Val {
  const def = a.variant !== undefined ? enumOf(a.ty) : undefined;
  const fallback = def === undefined ? undefined : knownLiteral(b);
  if (def !== undefined && fallback !== undefined && def.literals.includes(fallback)) {
    const variant = `${atom(a.variant!)}.unwrap_or(${variantPath(comp, def, fallback)})`;
    return { code: unionStr(variant), ty: a.ty.of, variant, ...loneOf(a, b) };
  }
  return sameFallback(comp, n, a, b, widenedInto(comp, a, b, def, fallback));
}

function widenedInto(comp: Component, a: Optional, b: Val, def: EnumDef | undefined, fallback: string | undefined): Into | undefined {
  const both = def !== undefined && b.ty.k !== "opt" && b.variant !== undefined && exactlyEnum(b);
  const widened = def === undefined || (fallback === undefined && !both) ? undefined : (into: EnumDef, node: N): string | null => {
    const some = fallback === undefined || into.literals.includes(fallback) ? intoEnum(comp, a, into, node) : null;
    const other = fallback === undefined ? intoEnum(comp, b, into, node) : variantPath(comp, into, fallback);
    return some === null || other === null ? null : or(atom(some), "unwrap_or", bare(other));
  };
  return widened;
}

function sameFallback(comp: Component, n: N, a: Optional, b: Val, widened: Into | undefined): Val {
  if (a.held !== undefined && b.ty.k === "str") return { code: `&*${or(atom(a.held), "unwrap_or", asCow(b))}`, ty: STR, ...loneOf(a, b) };
  if (a.ty.of.k === "str" && b.ty.k === "str" && isTemporary(b)) {
    return { code: `&*${or(`${atom(a.code)}.map(std::borrow::Cow::<str>::Borrowed)`, "unwrap_or", asCow(b))}`, ty: STR, ...loneOf(a, b) };
  }
  if (a.ty.of.k === "int" && b.ty.k === "int" && isCast(b)) return intFromF64(`${atom(a.code)}.map(|v| v as f64).unwrap_or(${bare(asF64(b))})`, b.at ?? refusalAt(comp, n));
  if (sameTy(a.ty.of, b.ty)) {
    const code = or(atom(a.code), "unwrap_or", bare(b.code));
    return { code, ty: joinTy(a.ty.of, b.ty), ...loneOf(a, b), ...(widened ? { asEnum: { of: code, into: widened } } : {}) };
  }
  return mixedFallback(comp, n, a, b);
}

function mixedFallback(comp: Component, n: N, a: Optional, b: Val): Val {
  if (b.ty.k === "opt" && sameTy(a.ty.of, b.ty.of)) return { code: or(atom(a.code), "or", bare(b.code)), ty: joinTy(a.ty, b.ty), ...loneOf(a, b) };
  if (a.ty.of.k === "float" && b.ty.k === "int") return { code: or(atom(a.code), "unwrap_or", bare(asF64(b))), ty: FLOAT };
  if (a.ty.of.k === "int" && b.ty.k === "float") return { code: or(`${atom(a.code)}.map(|v| v as f64)`, "unwrap_or", bare(b.code)), ty: FLOAT };
  return n.operator === "??" ? fail(comp, "FV0616", "`??` between different types", n) : fail(comp, "FV0617", "`||` between these types", n);
}

function orOf(s: Scope, n: N, a: Val, b: Val): Val {
  const comp = s.comp;
  if (a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "||", b.code));
  if (a.ty.k === "str" && (b.ty.k === "str" || b.ty.k === "undef") && known(a) !== undefined) return known(a) ? a : b;
  if (b.ty.k === "undef") return orUndefined(a);
  if (a.ty.k === "opt" && pathOf(n.left) !== null && ["str", "int", "float", "bool"].includes(a.ty.of.k)) {
    return expr(s, { ...n, type: "ConditionalExpression", test: n.left, consequent: n.left, alternate: n.right });
  }
  return orValues(comp, n, a, b);
}

function orValues(comp: Component, n: N, a: Val, b: Val): Val {
  if (a.ty.k === "str" && b.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
    return { code: `&*{ let a = ${asCow(a)}; if !a.is_empty() { a } else { ${asCow(b)} } }`, ty: STR, ...loneOf(a, b) };
  }
  if (sameTy(a.ty, b.ty) && (a.ty.k === "str" || isNumber(a.ty))) return orSame(comp, n, a, b);
  return fail(comp, "FV0617", "`||` between these types", n);
}

function orUndefined(a: Val): Val {
  const inner: Ty = keptLiterals(a.ty.k === "opt" ? a.ty.of : a.ty, (l) => !falsyLiteral(l));
  const src = a.ty.k === "opt" ? atom(a.code) : `Some(${bare(a.code)})`;
  return { code: `${src}.filter(|v| ${truthy({ code: "*v", ty: inner })})`, ty: opt(inner) };
}

function orSame(comp: Component, n: N, a: Val, b: Val): Val {
  const k = known(a);
  if (k !== undefined) return k ? a : b;
  if (a.ty.k === "int" && (isCast(a) || isCast(b))) return intFromF64(`{ let a = ${bare(asF64(a))}; if a != 0.0 { a } else { ${bare(asF64(b))} } }`, a.at ?? b.at ?? refusalAt(comp, n));
  const otherwise = a.ty.k === "str" ? strArg(b.code) : bare(b.code);
  return { code: `{ let a = ${bare(a.code)}; if ${truthy({ code: "a", ty: a.ty })} { a } else { ${otherwise} } }`, ty: joinTy(keptLiterals(a.ty, (l) => !falsyLiteral(l)), b.ty), ...loneOf(a, b) };
}

function notBooleans(comp: Component, n: N, left: Ty, right: Ty | undefined): never {
  const [side, ty] = left.k === "bool" ? ["right", right] : ["left", left];
  const what = `\`${n.operator}\` is supported between booleans only${ty ? `, and its ${side} side is ${describeTy(ty)}` : ""}`;
  const absent = ty !== undefined && (ty.k === "opt" || nothing(ty));
  const help = absent ? `test it with \`!= null\` for a boolean, or write \`?:\` with the value each side gives` : "write a comparison for a boolean, or `?:` with the value each side gives";
  return fail(comp, "FV0614", what, n, help);
}

function alwaysTruthy(ty: Ty): boolean {
  if (ty.k === "html") return false;
  const literals = literalsOf(ty);
  if (literals !== undefined && literals.length > 0) return literals.every((l) => l !== "" && l !== 0);
  return truthy({ code: "v", ty }) === "true";
}

/** What `a && b` gives where `a` is absent, for an `a` whose present values are all truthy: `b`
 * when it is present, and `a` itself, `undefined` or `null`, when it is not. */
function whenAbsent(s: Scope, p: Presence, left: N): N | null {
  if (!p.truthy) return null;
  const at = { loc: left.loc, __fv: left.__fv, start: left.start, end: left.end };
  if (p.pick) return { type: "Identifier", name: "undefined", ...at };
  const whole = expr(s, left).ty;
  if (!alwaysTruthy(whole.k === "opt" ? whole.of : p.of)) return null;
  const none = absence(whole);
  if (none === "undefined") return { type: "Identifier", name: "undefined", ...at };
  return none === "null" ? { type: "NullLiteral", ...at } : null;
}
