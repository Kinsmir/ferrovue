import { type Component, type N, type Scope, type Ty, type Val, BOOL, enumItems, enumOf, fail, INT, isAscii, literalsOf, nothing, opt, sameTy, snake, STR, strTy, UNDEF, UNION_STR, unionStr, variantPath } from "./model.ts";
import { GenError } from "./errors.ts";
import { enumListVal, knownLiteral, overVariants } from "./enums.ts";
import { ctx } from "./context.ts";
import { lookupStruct, markHome } from "./typescript.ts";
import { claim } from "./plugin.ts";
import { atom, bare, enclosed, receiver, strArg } from "./parens.ts";
import { collected, entryPart, picked, tupleParts, untypedEmpty } from "./lists.ts";
import { asCow, isTemporary, loneOf } from "./strings.ts";
import { asF64, COUNT, numberVal } from "./numbers.ts";
import { BUILTINS, builtin, isObjectCall } from "./calls.ts";
import { refuseInPlace } from "./objects.ts";
import { fresh, jsHint } from "./names.ts";
import { describeTy, expr, fieldVal, placeIn, refuseClientOnly, refuseUnavailable } from "./expr.ts";

const MATH_CONSTANTS = new Map([
  ["E", Math.E],
  ["LN10", Math.LN10],
  ["LN2", Math.LN2],
  ["LOG10E", Math.LOG10E],
  ["LOG2E", Math.LOG2E],
  ["PI", Math.PI],
  ["SQRT1_2", Math.SQRT1_2],
  ["SQRT2", Math.SQRT2],
]);

const NUMBER_CONSTANTS = new Map([
  ["EPSILON", Number.EPSILON],
  ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
  ["MAX_VALUE", Number.MAX_VALUE],
  ["MIN_SAFE_INTEGER", Number.MIN_SAFE_INTEGER],
  ["MIN_VALUE", Number.MIN_VALUE],
  ["NaN", Number.NaN],
  ["NEGATIVE_INFINITY", Number.NEGATIVE_INFINITY],
  ["POSITIVE_INFINITY", Number.POSITIVE_INFINITY],
]);

/** The value of a member access `object.property` or `object[key]`. */
export function memberOf(s: Scope, n: N): Val {
  if (refValue(s, n)) return expr(s, n.object);
  if (!n.computed && n.property.type === "Identifier" && n.property.name === "length") {
    const length = lengthOf(s, n);
    if (length !== null) return length;
  }
  return n.computed ? computedMember(s, n) : namedMember(s, n);
}

/** Whether the member access `n` reads the `.value` of a ref in setup; a refusal for any other
 * member of a ref, which in setup is the ref object. */
export function refValue(s: Scope, n: N): boolean {
  const o = n.object;
  if (o.type !== "Identifier" || !s.refs.has(o.name) || s.locals.has(o.name)) return false;
  if (!n.computed && n.property.name === "value") return true;
  if (n.computed && n.property.type === "StringLiteral" && n.property.value === "value") return false;
  const member = n.computed ? "[…]" : `.${n.property.name as string}`;
  return fail(s.comp, "FV0638", `\`${o.name}${member}\` reads a member of the ref \`${o.name}\`, which in setup has only \`.value\`: read \`${o.name}.value${member}\``, n);
}

function lengthOf(s: Scope, n: N): Val | null {
  if (isObjectCall(n.object, "entries") && n.object.arguments.length === 1) {
    const r = expr(s, n.object.arguments[0]);
    if (r.ty.k === "record") return { code: `${atom(r.code)}.len() as i64`, ty: INT, upTo: COUNT };
  }
  const base = expr(s, n.object);
  if (base.ty.k === "entry") return numberVal(2, true);
  if (base.ty.k === "list" && base.iter !== undefined) return computedLength(base.iter);
  if (untypedEmpty(base)) return numberVal(0, true);
  if (base.ty.k === "list") return { code: `${atom(base.code)}.len() as i64`, ty: INT, upTo: COUNT };
  if (base.ty.k === "str") return { code: `fv::strings::js_length(${strArg(base.code)})`, ty: INT, upTo: COUNT };
  const parts = tupleParts(s.comp, base.ty);
  if (parts !== null) return numberVal(parts, true);
  return null;
}

function computedLength(iter: string): Val {
  const vec = /^(.*)\.into_iter\(\)$/s.exec(iter)?.[1];
  if (vec === undefined) {
    let at = iter.indexOf(".map(");
    while (at > 0 && !enclosed(iter.slice(at + 4))) at = iter.indexOf(".map(", at + 1);
    const mapped = at > 0 ? iter.slice(0, at) : iter;
    const held = /^(.*)\.(?:into_)?iter\(\)$/s.exec(mapped)?.[1];
    return { code: held !== undefined ? `${atom(held)}.len() as i64` : `${atom(mapped)}.count() as i64`, ty: INT, ...(held !== undefined ? { upTo: COUNT } : {}) };
  }
  return { code: vec !== undefined ? `${atom(vec)}.len() as i64` : `${atom(iter)}.count() as i64`, ty: INT, upTo: COUNT };
}

function computedMember(s: Scope, n: N): Val {
  const comp = s.comp;
  if (n.object.type === "Identifier" && n.object.name === "$setup" && n.property.type === "StringLiteral") {
    return expr(s, { ...n.property, type: "Identifier", name: n.property.value });
  }
  const base = expr(s, n.object);
  if (n.property.type === "StringLiteral") {
    const own = claim((p) => p.member?.(s, base, n.property.value, n, true));
    if (own) return own;
  }
  if (base.ty.k === "list") return indexed(s, base, n.property, n);
  if (base.ty.k === "str") return unitAt(s, base, n.property);
  if (base.ty.k === "entry") return entryAt(comp, base, n);
  const parts = tupleParts(comp, base.ty);
  if (parts !== null) {
    const at: unknown = n.property.type === "NumericLiteral" ? n.property.value : undefined;
    if (typeof at !== "number" || !Number.isInteger(at) || at < 0 || at >= parts) {
      fail(comp, "FV0612", `\`[…]\` reads a part of a tuple of ${parts} by a literal index, from \`0\` to \`${parts - 1}\``, n);
    }
    return fieldVal(comp, base.code, base.ty, String(at), n);
  }
  if (base.ty.k === "struct") {
    const byKey = fieldByKey(s, base, n.property, n);
    if (byKey !== null) return byKey;
  }
  return fail(comp, "FV0612", `computed member access of ${describeTy(base.ty)}: \`[…]\` reads an item of a list, by an integer index`, n);
}

function entryAt(comp: Component, base: Val, n: N): Val {
  if (n.property.type !== "NumericLiteral" || !Number.isInteger(n.property.value) || n.property.value < 0) {
    fail(comp, "FV0612", "`[…]` reads a part of a `[key, value]` pair by a literal index: `pair[0]` is its key and `pair[1]` its value", n);
  }
  return entryPart(base, n.property.value);
}

function namedMember(s: Scope, n: N): Val {
  const comp = s.comp;
  const prop = n.property.name as string;
  const slots = slotsObject(s, n.object);
  if (slots !== null) {
    if (!comp.slotNames.includes(prop)) fail(comp, "FV0907", `\`${slots}.${prop}\` names a slot this template does not render`, n);
    return { code: `fv_slots.${snake(prop)}.is_some()`, ty: BOOL };
  }
  if (n.object.type === "Identifier" && BUILTINS.has(n.object.name) && !s.locals.has(n.object.name) && !s.setup.has(n.object.name)) return builtinMember(s, n, prop);
  const scoped = n.object.type === "Identifier" ? scopedMember(s, n, prop) : null;
  if (scoped !== null) return scoped;
  const base = expr(s, n.object);
  const own = claim((p) => p.member?.(s, base, prop, n, false));
  if (own) return own;
  const read = base.owned ? ownedField(comp, base, prop, n) : fieldVal(comp, base.code, base.ty, prop, n);
  return base.lone && !read.lone && ["str", "struct", "list", "opt"].includes(read.ty.k) ? { ...read, lone: true } : read;
}

function builtinMember(s: Scope, n: N, prop: string): Val {
  const value = n.object.name === "Math" ? MATH_CONSTANTS.get(prop) : n.object.name === "Number" ? NUMBER_CONSTANTS.get(prop) : undefined;
  if (value !== undefined) return numberVal(value, Number.isSafeInteger(value));
  return builtin(s, `${n.object.name}.${prop}`, n);
}

function scopedMember(s: Scope, n: N, prop: string): Val | null {
  const comp = s.comp;
  switch (n.object.name) {
    case "$props":
      return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
    case "$setup":
    case "_ctx":
      return contextMember(s, n, prop);
    default:
      return null;
  }
}

function contextMember(s: Scope, n: N, prop: string): Val {
  const comp = s.comp;
  const global = n.object.name === "_ctx" ? claim((p) => p.global?.(s, prop, n)) : undefined;
  if (global) return global;
  if (n.object.name === "_ctx" && prop === "$attrs") {
    return fail(comp, "FV0415", "`$attrs` is bound whole, with `v-bind=\"$attrs\"`; a value read from it has no type: declare it as a prop", n);
  }
  const v = s.setup.get(prop);
  if (v) return v;
  if (prop === s.propsIdent) return { code: "props", ty: { k: "struct", name: "Props" } };
  if (s.clientOnly.has(prop)) return refuseClientOnly(s, prop, n);
  if (n.object.name === "_ctx" && comp.props.fields.some((f) => f.js === prop)) {
    return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
  }
  return refuseUnavailable(s, prop, n);
}

function slotsObject(s: Scope, n: N): string | null {
  if (n.type === "Identifier") return s.slotsBindings.has(n.name) && !s.locals.has(n.name) ? n.name : null;
  if (n.type !== "MemberExpression" || n.computed || n.object.type !== "Identifier") return null;
  const [owner, name]: [string, string] = [n.object.name, n.property.name];
  if (owner === "_ctx" && name === "$slots") return "$slots";
  return (owner === "$setup" || owner === "_ctx") && s.slotsBindings.has(name) ? name : null;
}

function indexed(s: Scope, list: Val, key: N, n: N): Val {
  if (list.owned) refuseInPlace(s.comp, "`[…]`", n);
  const i = expr(s, key);
  if (i.ty.k !== "int") {
    const getter = key.type === "CallExpression" && key.callee.type === "MemberExpression" && !key.callee.computed ? (key.callee.property.name as string) : "";
    if (i.ty.k === "float" && /^getUTC[A-Z]|^getTime$|^valueOf$/.test(getter)) {
      return fail(
        s.comp,
        "FV0824",
        `\`[…]\` reads a list's item by an integer index, and \`.${getter}()\` of a date is a \`Float\`: it is \`NaN\` for an invalid date, where \`[…]\` reads \`undefined\``,
        key,
        `\`.at(…)\` reads the item for any number, the first one for \`NaN\`; or pick the item in Rust and pass it as a prop`,
      );
    }
    const is = i.ty.k === "float" ? "a `Float`, which may hold a fraction or be `NaN`" : describeTy(i.ty);
    return fail(s.comp, "FV0824", `\`[…]\` reads a list's item by an integer index, a \`number\` that is present, and this index is ${is}: \`.at()\` takes any number`, key);
  }
  if (i.num !== undefined && i.num >= 0 && list.iter === undefined) return picked(s, list, n, (l) => (i.num === 0 ? `${l}.first()` : `${l}.get(${i.num})`), (it) => it);
  const at = `usize::try_from(${bare(i.code)}).unwrap_or(usize::MAX)`;
  return picked(s, list, n, (l) => `${l}.get(${at})`, (it) => `${atom(it)}.nth(${at})`);
}

function unitAt(s: Scope, str: Val, key: N): Val {
  const i = expr(s, key);
  if (i.ty.k !== "int") {
    return fail(s.comp, "FV0612", `\`[…]\` reads a string's character by an integer index, a \`number\` that is present, and this index is ${i.ty.k === "float" ? "a `Float`, which may hold a fraction or be `NaN`" : describeTy(i.ty)}: \`.at()\` and \`.charAt()\` take any number`, key);
  }
  const ascii = isAscii(str.ty);
  const cut = ascii ? {} : { lone: true as const };
  const at = `Some(fv::strings::js_char_at(${strArg(str.code)}, ${bare(asF64(i))})).filter(|c| !c.is_empty())`;
  if (!isTemporary(str)) return { code: at, ty: opt(strTy(ascii)), ...cut };
  const held = `${at}.map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))`;
  return { code: `${atom(held)}.as_deref()`, ty: opt(strTy(ascii)), held, ...cut };
}

function plainChain(n: N, link: N, hole: N): N {
  if (n === link) return { ...n, type: "MemberExpression", optional: undefined, object: hole };
  if (n.type === "OptionalCallExpression") return { ...n, type: "CallExpression", optional: undefined, callee: plainChain(n.callee, link, hole) };
  return { ...n, type: "MemberExpression", optional: undefined, object: plainChain(n.object, link, hole) };
}

function ownedCow(v: Val): string {
  if (!isTemporary(v)) return `std::borrow::Cow::<str>::Owned(${receiver(v.code)}.to_owned())`;
  const cow = asCow(v);
  return cow.startsWith("std::borrow::Cow::<str>::Owned(") ? cow : `std::borrow::Cow::<str>::Owned(${atom(cow)}.into_owned())`;
}

function chainHint(n: N): string {
  if (n.type === "Identifier") return jsHint(n.name);
  if (!n.computed && n.property?.type === "Identifier") return n.property.name;
  return "value";
}

/** The value of an optional chain, `a?.b` or `a?.[k]`. */
export function optionalChain(s: Scope, n: N): Val {
  const comp = s.comp;
  let link: N = n;
  while (!link.optional) {
    link = link.type === "OptionalCallExpression" ? link.callee : link.object;
    if (link?.type !== "OptionalMemberExpression" && link?.type !== "OptionalCallExpression") return fail(comp, "FV0625", `this optional chain is not supported ${placeIn(s)}`, n);
  }
  if (link.type === "OptionalCallExpression") {
    return fail(comp, "FV0629", "`?.()` calls a function that may be absent, and a template's functions are always present: write the call without `?.`", link);
  }
  const base = expr(s, link.object);
  if (base.owned) refuseInPlace(comp, "`?.`", n);
  if (nothing(base.ty)) return { code: "None", ty: UNDEF };
  const k = ++ctx.narrowCount;
  const hole: N = { ...link.object, type: "Identifier", name: `fv$o${k}` };
  const rest = plainChain(n, link, hole);
  const within = (v: Val): Scope => ({ ...s, locals: new Map(s.locals).set(hole.name, v) });
  if (base.ty.k !== "opt") return expr(within(base), rest);
  const name = fresh("o", chainHint(link.object));
  const inner = expr(within({ code: name, ty: base.ty.of, ...loneOf(base) }), rest);
  if (nothing(inner.ty)) return { code: "None", ty: UNDEF };
  const lone = loneOf(base, inner);
  const over = (body: string, flat: boolean): string => {
    if (bare(body) === name) return base.code;
    const named = new RegExp(`^([\\w:]+)\\(${name}\\)$`).exec(bare(body))?.[1];
    return `${atom(base.code)}.${flat ? "and_then" : "map"}(${named ?? `|${name}| ${bare(body)}`})`;
  };
  const heldBy = (held: string, ty: Ty): Val => ({ code: `${atom(held)}.as_deref()`, ty, held, ...lone });
  if (inner.ty.k === "list" && inner.iter !== undefined) return heldBy(over(collected(inner), false), opt(inner.ty));
  if (inner.ty.k === "opt") {
    if (inner.held !== undefined) return heldBy(over(inner.held, true), opt(inner.ty));
    if (base.held !== undefined && inner.ty.of.k === "str") return heldBy(over(`${atom(inner.code)}.map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))`, true), opt(inner.ty));
    return { code: over(inner.code, true), ty: opt(inner.ty), ...lone };
  }
  if (inner.ty.k === "str" && (isTemporary(inner) || base.held !== undefined)) return heldBy(over(ownedCow(inner), false), opt(STR));
  const place = ["list", "record", "struct"].includes(inner.ty.k) && new RegExp(`^${name}(?:\\.[\\w#]+)+$`).test(inner.code);
  return { code: over(place ? `&${inner.code}` : inner.code, false), ty: opt(inner.ty), ...lone };
}

function fieldByKey(s: Scope, base: Val, key: N, n: N): Val | null {
  const k = expr(s, key);
  const literal = knownLiteral(k);
  if (literal !== undefined) {
    ctx.trying++;
    try {
      return fieldVal(s.comp, base.code, base.ty, literal, n);
    } catch (e) {
      if (e instanceof GenError) return null;
      throw e;
    } finally {
      ctx.trying--;
    }
  }
  const def = k.variant !== undefined && k.ty.k === "str" ? enumOf(k.ty) : undefined;
  if (def === undefined) return null;
  const kept = (literalsOf(k.ty) ?? def.literals) as readonly string[];
  const fields = kept.map((l) => fieldVal(s.comp, base.code, base.ty, l, n));
  if (!fields.every((f) => sameTy(f.ty, fields[0]!.ty) && !f.owned && f.iter === undefined)) return null;
  const arm = (f: Val): string => (f.ty.k === "str" && f.code.startsWith("&*") ? `std::ops::Deref::deref(&${f.code.slice(2)})` : bare(f.code));
  const code = overVariants(s.comp, k, kept, (l) => arm(fields[Math.max(kept.indexOf(l), 0)]!)) ?? `match ${k.variant} { ${kept.map((l, i) => `${variantPath(s.comp, def, l)} => ${arm(fields[i]!)}`).join(", ")} }`;
  return { code, ty: fields[0]!.ty };
}

function ownedField(comp: Component, base: Val, js: string, n: N): Val {
  if (base.ty.k !== "struct") return fieldVal(comp, base.code, base.ty, js, n);
  fieldVal(comp, "fv", base.ty, js, n);
  const { st, owner } = lookupStruct(comp, base.ty);
  const f = st!.fields.find((x) => x.js === js)!;
  const ty = owner === comp ? f.ty : markHome(f.ty, owner.name);
  const place = `${atom(base.code)}.${f.rust}`;
  const lone = base.lone ? { lone: true as const } : {};
  const items = enumItems(ty);
  if (items !== undefined) return enumListVal(`(${place})`, ty, items);
  const def = enumOf(ty);
  if (def !== undefined) return { code: ty.k === "opt" ? `${place}.map(${UNION_STR})` : unionStr(place), ty, variant: place };
  if (ty.k === "str") return { code: `&*(${place})`, ty, ...lone };
  if (ty.k === "int" || ty.k === "float" || ty.k === "bool") return { code: place, ty };
  if (ty.k === "struct" || ty.k === "list") return { code: `(${place})`, ty, owned: true, ...lone };
  if (ty.k === "opt") {
    if (ty.of.k === "str") return { code: `(${place}).as_deref()`, ty, held: `(${place})`, ...lone };
    if (ty.of.k === "int" || ty.of.k === "float" || ty.of.k === "bool") return { code: `(${place})`, ty };
  }
  return refuseInPlace(comp, `\`.${js}\`, ${describeTy(ty)},`, n);
}
