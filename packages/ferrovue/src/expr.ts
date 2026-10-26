import { type Component, type EnumDef, type N, type Scope, type Ty, type Val, absence, BOOL, enumItems, enumOf, enumTy, fail, falsyLiteral, FLOAT, INT, isAscii, joinAbsence, joinTy, keptLiterals, literalsOf, literalTy, nodeName, nothing, NULL, opt, placeOf, refusalAt, rustStr, sameTy, snake, STR, strTy, UNDEF, UNION_STR, unionStr, variantPath, withAbsence } from "./model.ts";
import { GenError } from "./errors.ts";
import { enumEquality, enumListVal, exactlyEnum, intoEnum, knownLiteral, overVariants, refuseOutside } from "./enums.ts";
import { CONFIG_FILE } from "./config.ts";
import { ctx } from "./context.ts";
import { lookupStruct, markHome, tyOfTs } from "./typescript.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, enclosed, logical, negate, not, occurrences, receiver, strArg } from "./parens.ts";
import { collected, entryPart, heldDates, picked, sliced, spreadLiteral, typedEmpty, untypedEmpty } from "./lists.ts";
import { asCow, formatted, isTemporary, loneOf, meet, stringsEqual } from "./strings.ts";
import { arithmetic, asF64, compare, intFromF64, isCast, isNumber, negatedOrder, numberVal, power } from "./numbers.ts";
import { boolOf, checkNullTest, choice, known, literalNarrowing, narrowing, narrowTo, nullTest, pathOf, type Presence, presence, reassociated, truthTested, truthy, typeofCompare, typeofTest, typeofVal } from "./narrowing.ts";
import { BUILTINS, builtin, call, isObjectCall } from "./calls.ts";
import { constOf, namedVal } from "./constants.ts";
import { localeRefusal } from "./plugins/dates.ts";
import { objectLiteral, ownedStruct, ownedStructs, refuseInPlace, structList, untypedObject } from "./objects.ts";
import { letIn, panicky, refuses, split, splits } from "./blocks.ts";
import { assignedLet, loopIn, loopStep } from "./statements.ts";
import { refuseUnresolved } from "./resolve.ts";
import { fresh, jsHint } from "./names.ts";

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

const COMPUTE_IN_RUST = "compute the value in Rust and pass it as a prop";

function twinHelp(name: string): string {
  const module = ctx.helperModule === null ? "the module `helpers.module` names" : `\`${ctx.helperModule}\``;
  return `put \`${name}\` in ${module} with a Rust twin under \`helpers.functions\` in ${CONFIG_FILE}, or ${COMPUTE_IN_RUST}`;
}

/** Where the code a scope translates is, as a message says it: "in a template", "in a `computed`". */
export function placeIn(s: Scope): string {
  return s.within === "computed" ? "in a `computed`" : s.within === "function" ? "in a function" : s.within === "setup" ? "in setup" : "in a template";
}

function reader(s: Scope): string {
  return s.within === "computed" ? "a `computed` reads it" : s.within === "function" ? "a function reads it" : s.within === "setup" ? "setup reads it" : "the template reads it";
}

/** Refuse a name the template reads that setup binds in a way the server cannot evaluate. */
export function refuseClientOnly(s: Scope, local: string, n: N, called = false): never {
  const name: string = n?.type === "Identifier" && n.name === local ? (n.fvName ?? local) : local;
  const cause = s.refusedBy.get(local);
  if (cause) {
    const at = placeOf(s.comp, n);
    const what = `${cause.what} (${reader(s)} as \`${name}\` at ${[at.file, at.line, at.column].filter((p) => p !== undefined).join(":")})`;
    const e = new GenError(cause.code, cause.message.replace(cause.what, () => what), cause.at, what, cause.help);
    if (cause.at?.file !== s.comp.file) e.readAt = at;
    throw e;
  }
  const why = s.clientOnly.get(local)!;
  const help = !called && s.functions.has(local)
    ? `call it, as \`${name}(…)\`, which the server translates, or name it only in an event handler`
    : called || why.startsWith("it is a function") ? twinHelp(name) : `${COMPUTE_IN_RUST}, or read it only from an event handler`;
  return fail(s.comp, "FV0613", `\`${name}\` is set up in a way the server cannot evaluate: ${why}`, n, help);
}

/** Refuse a name the template reads that the server has no value for: one imported from a module
 * it does not run, or one nothing declares. */
export function refuseUnavailable(s: Scope, name: string, n: N, called = false): never {
  refuseUnresolved(s.comp, name, n);
  const from = s.imported.get(name);
  const what = called ? `\`${name}()\`` : `\`${name}\``;
  if (from !== undefined) {
    const help = called ? twinHelp(name) : `export it from \`${from}\` as a constant the compiler evaluates (\`export const ${name} = …\`), or ${COMPUTE_IN_RUST}`;
    const said = called ? `${what} calls a function imported from \`${from}\`` : `${what} is imported from \`${from}\``;
    return fail(s.comp, "FV0601", `${said}, a module the server does not run`, n, help);
  }
  const help = called ? `a template calls JavaScript's built-ins and the helpers with Rust twins under \`helpers.functions\` in ${CONFIG_FILE}; ${COMPUTE_IN_RUST}` : null;
  return fail(s.comp, "FV0601", `${what} is not available when rendering on the server`, n, help);
}

export function describeTy(ty: Ty): string {
  switch (ty.k) {
    case "str":
      return "a string";
    case "int":
      return "a number";
    case "float":
      return "a number";
    case "bool":
      return "a boolean";
    case "list":
      return "a list";
    case "record":
      return "a record";
    case "entry":
      return "a `[key, value]` pair";
    case "struct":
    case "child":
      return "an object";
    case "opt":
      if (ty.none === "null") return `${describeTy(ty.of)} or \`null\``;
      if (ty.none === "either") return `${describeTy(ty.of)}, \`null\` or \`undefined\``;
      return `an optional ${describeTy(ty.of).replace(/^an? /, "")}`;
    case "undef":
      return "`undefined`";
    case "null":
      return "`null`";
    default:
      return claim((p) => p.values?.describe?.(ty)) ?? "a value of another kind";
  }
}

export function fieldVal(comp: Component, base: string, ty: Ty, js: string, node: N): Val {
  if (ty.k !== "struct") {
    if (ty.k === "opt" || nothing(ty)) fail(comp, "FV0604", `\`.${js}\` of ${describeTy(ty)}, which may be absent: narrow it with \`v-if\` first, or read it with \`?.${js}\``, node);
    fail(comp, "FV0604", `\`.${js}\` of ${describeTy(ty)}, which has no field \`${js}\``, node);
  }
  const { st, owner } = lookupStruct(comp, ty);
  const found = st?.fields.find((x) => x.js === js);
  if (!found) {
    const refused = st?.refused?.get(js) ?? st?.refused?.get("");
    if (refused !== undefined) throw refused;
    fail(comp, "FV0605", `\`${ty.name}\` has no field \`${js}\``, node);
  }
  const f = owner === comp ? found : { ...found, ty: markHome(found.ty, owner.name) };
  if (st!.slot) return { code: `${base}.${f.rust}`, ty: f.ty };
  const place = `${base}.${f.rust}`;
  const items = enumItems(f.ty);
  if (items !== undefined) {
    if (f.dflt !== undefined && f.ty.k === "opt") return enumListVal(`${place}.as_deref().unwrap_or(${f.dflt})`, f.ty.of, items);
    return enumListVal(place, f.ty, items);
  }
  const def = enumOf(f.ty);
  if (def !== undefined) {
    const literal = f.dflt === undefined ? undefined : def.literals.find((l) => rustStr(l) === f.dflt);
    const variant = f.ty.k !== "opt" ? place : literal !== undefined ? `${place}.unwrap_or(${variantPath(comp, def, literal)})` : place;
    const read = f.ty.k === "opt" && literal !== undefined ? f.ty.of : f.ty;
    return { code: read.k === "opt" ? `${place}.map(${UNION_STR})` : unionStr(variant), ty: read, variant };
  }
  if (f.dflt !== undefined && f.ty.k === "opt") {
    const of = f.ty.of;
    if (of.k === "str") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: of };
    if (of.k === "list") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: of, slice: true };
    return { code: `${place}.unwrap_or(${f.dflt})`, ty: of };
  }
  const dated = heldDates(place, f.ty, false);
  if (dated !== null) return dated;
  switch (f.ty.k) {
    case "str":
      return { code: `&*${place}`, ty: f.ty };
    case "html":
    case "child":
      return { code: `&${place}`, ty: f.ty };
    case "opt":
      if (f.ty.of.k === "html") return { code: `${place}.as_ref()`, ty: f.ty };
      if (f.ty.of.k === "str") return { code: `${place}.as_deref()`, ty: f.ty };
      if (f.ty.of.k === "int" || f.ty.of.k === "float" || f.ty.of.k === "bool") return { code: place, ty: f.ty };
      return { code: `${place}.as_ref()`, ty: f.ty };
    default:
      return { code: place, ty: f.ty };
  }
}

export function holdsNothing(comp: Component, v: Val, want: Ty, node: N, where: string): void {
  const has = absence(v.ty);
  if (has === null) return;
  const takes = absence(want);
  if (takes === has || takes === "either") return;
  const is = has === "either" ? "may be `null` or `undefined`" : has === "null" ? "may be `null`" : "may be `undefined`";
  const fix = takes === null ? "narrow it with `v-if` first" : takes === "null" ? "write `?? null` after it" : "write `?? undefined` after it";
  fail(comp, "FV0606", `a value that ${is} where ${where} takes ${describeTy(want)}, which Vue would hand it as it is: ${fix}`, node);
}

export function coerce(comp: Component, v: Val, want: Ty, node: N): string {
  if (sameTy(v.ty, want)) return v.code;
  holdsNothing(comp, v, want, node, "the function");
  if (want.k === "opt" && nothing(v.ty)) return "None";
  if (want.k === "opt" && v.ty.k === "opt" && sameTy(v.ty.of, want.of)) return v.code;
  if (want.k === "opt" && sameTy(v.ty, want.of)) return `Some(${bare(v.code)})`;
  if (want.k === "float" && v.ty.k === "int") return asF64(v);
  if (want.k === "opt" && want.of.k === "float" && v.ty.k === "int") return `Some(${asF64(v)})`;
  return fail(comp, "FV0607", `a ${JSON.stringify(v.ty)} where ${JSON.stringify(want)} is expected`, node);
}

/** The compiled component `name`, whose type `type` the component `from` reads. */
export function childOf(name: string, type: string, from: Component): Component {
  const c = ctx.components.get(name);
  if (c) return c;
  const key = `${name} ${type}`;
  const importer = [from, ...ctx.components.values()].find((comp) => comp.vueTypeImports.has(key)) ?? from;
  const help = `move ${name}.vue into the components directory, or declare \`${type}\` in a \`.ts\` file and import it from there`;
  return fail(importer, "FV0512", `\`${type}\` is imported from ${name}.vue, which is not among the components compiled`, importer.vueTypeImports.get(key), help);
}

function slotsObject(s: Scope, n: N): string | null {
  if (n.type === "Identifier") return n.name === "$slots" || (s.slotsBindings.has(n.name) && !s.locals.has(n.name)) ? n.name : null;
  if (n.type !== "MemberExpression" || n.computed || n.object.type !== "Identifier") return null;
  const [owner, name]: [string, string] = [n.object.name, n.property.name];
  if (owner === "_ctx" && name === "$slots") return "$slots";
  return (owner === "$setup" || owner === "_ctx") && s.slotsBindings.has(name) ? name : null;
}

/** `n` with the type `t` given to each empty array literal and object literal it may evaluate to,
 * as an `as T` on it, and to the items of a `.map()` it ends in; `from` is the component `t` is
 * written in, where that is a `.ts` file's. */
export function typedBy(n: N, t: N, arrays = true, from?: Component): N {
  const given = (): N => ({ ...n, type: "TSAsExpression", expression: n, typeAnnotation: t, fvGiven: true, ...(from ? { fvFrom: from } : {}) });
  switch (n.type) {
    case "ArrayExpression":
      if (n.elements.length === 0) return arrays ? given() : n;
      return n.elements.some((el: N) => objectish(el)) ? given() : n;
    case "ObjectExpression":
      return given();
    case "CallExpression":
      return n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.property.name === "map" ? { ...n, fvTyped: t, ...(from ? { fvFrom: from } : {}) } : n;
    case "ParenthesizedExpression":
      return { ...n, expression: typedBy(n.expression, t, arrays, from) };
    case "ConditionalExpression":
      return { ...n, consequent: typedBy(n.consequent, t, arrays, from), alternate: typedBy(n.alternate, t, arrays, from) };
    case "LogicalExpression":
      return n.operator === "&&" ? n : { ...n, right: typedBy(n.right, t, arrays, from) };
    case "FvLet":
    case "FvSet":
      return { ...n, body: typedBy(n.body, t, arrays, from) };
    case "FvLoop":
      return { ...n, after: typedBy(n.after, t, arrays, from) };
    default:
      return n;
  }
}

function objectish(n: N): boolean {
  while (n?.type === "ParenthesizedExpression") n = n.expression;
  return n?.type === "ObjectExpression" || (n?.type === "ConditionalExpression" && (objectish(n.consequent) || objectish(n.alternate)));
}

/** The type a `typedBy` annotation `t` states, read where it is written. */
export function statedTy(s: Scope, t: N, from?: Component): Ty {
  const home = from ?? s.typesFrom ?? s.comp;
  const ty = tyOfTs(home, t, home.structs);
  return home.structs === ctx.typeStructs && home !== s.comp ? markHome(ty, "types") : ty;
}

function stated(s: Scope, n: N): Val {
  const comp = s.comp;
  const keyword = n.type === "TSAsExpression" ? "as" : "satisfies";
  const t = n.typeAnnotation;
  if (t.type === "TSTypeReference" && t.typeName.type === "Identifier" && t.typeName.name === "const" && !t.typeParameters) return expr(s, n.expression);
  let inner: N = n.expression;
  while (inner.type === "ParenthesizedExpression") inner = inner.expression;
  let want: Ty;
  try {
    want = statedTy(s, t, n.fvFrom);
  } catch (e) {
    if (!(e instanceof GenError) || !n.fvGiven || inner.type !== "ArrayExpression" || inner.elements.length > 0) throw e;
    return expr(s, n.expression);
  }
  const list = want.k === "opt" ? want.of : want;
  if (inner.type === "ObjectExpression") {
    if (list.k === "struct") return objectLiteral(s, inner, list);
    if (list.k === "record") return fail(comp, "FV0634", "an object literal given where a `Record` is taken, which the server reads from Rust: pass the dictionary as a prop", inner);
    if (n.fvGiven) return expr(s, n.expression);
    return fail(comp, "FV0628", `\`${keyword}\` states ${describeTy(want)} of an object literal`, n);
  }
  if (inner.type === "ArrayExpression" && inner.elements.length > 0 && list.k === "list" && list.of.k === "struct") return structList(s, inner, list.of);
  if (inner.type === "ArrayExpression" && inner.elements.length === 0) {
    if (list.k === "list") return typedEmpty(comp, list.of);
    if (n.fvGiven) return expr(s, n.expression);
    return fail(comp, "FV0628", `\`${keyword}\` gives an empty array literal ${describeTy(want)}, which it is not`, n);
  }
  const v = expr(s, n.fvGiven ? n.expression : typedBy(n.expression, t));
  if (sameTy(v.ty, want) || (isNumber(v.ty) && isNumber(want)) || (want.k === "opt" && sameTy(v.ty, want.of))) return v;
  return fail(comp, "FV0628", `\`${keyword}\` states ${describeTy(want)} of ${describeTy(v.ty)}, which the server keeps as it is: write the value with the type it has`, n);
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
  if (!alwaysTruthy(p.of)) return null;
  const none = absence(expr(s, left).ty);
  if (none === "undefined") return { type: "Identifier", name: "undefined", ...at };
  return none === "null" ? { type: "NullLiteral", ...at } : null;
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

function optionalChain(s: Scope, n: N): Val {
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

/** How a value is turned into text where it is shown: `{{ }}` and attribute values leave out
 * `null` and `undefined`, and a template literal writes them. */
export type Shown = "text" | "attr" | "template";

function asText(s: Scope, n: N, how: Shown): N {
  let inner = n;
  while (inner.type === "ParenthesizedExpression") inner = inner.expression;
  if (inner.type === "ConditionalExpression") return { ...inner, consequent: asText(s, inner.consequent, how), alternate: asText(s, inner.alternate, how) };
  let v: Val;
  try {
    v = expr(s, n);
  } catch (e) {
    if (e instanceof GenError) return n;
    throw e;
  }
  const at = { loc: n.loc, __fv: n.__fv, start: n.start, end: n.end };
  const quasi = { type: "TemplateElement", value: { raw: "", cooked: "" }, ...at };
  const written: N = { type: "TemplateLiteral", quasis: [quasi, { ...quasi, tail: true }], expressions: [n], ...at };
  if (how === "template") return ["int", "float", "bool", "list", "opt", "undef", "null"].includes(v.ty.k) ? written : n;
  const of = v.ty.k === "opt" ? v.ty.of : v.ty;
  if (nothing(v.ty) || !["int", "float", "bool"].includes(of.k)) return n;
  if (v.ty.k !== "opt") return written;
  const test = { type: "BinaryExpression", operator: "==", left: n, right: { type: "NullLiteral", ...at }, ...at };
  return { type: "ConditionalExpression", test, consequent: { type: "Identifier", name: "undefined", ...at }, alternate: written, ...at };
}

/** A value where it is shown as text: a \`?:\` whose branches differ in type is written as JavaScript
 * writes each branch, as \`how\` shows it. */
export function shown(s: Scope, n: N, how: Shown): Val {
  try {
    return expr(s, n);
  } catch (e) {
    if (!(e instanceof GenError) || e.code !== "FV0623") throw e;
    let inner = n;
    while (inner.type === "ParenthesizedExpression") inner = inner.expression;
    if (inner.type !== "ConditionalExpression") throw e;
    return expr(s, asText(s, inner, how));
  }
}

export function expr(s: Scope, n: N): Val {
  const v = exprOf(s, n);
  return n.type === "ConditionalExpression" || (n.type === "LogicalExpression" && n.operator !== "??") ? byVariant(s, n, v) : v;
}

/** `v`, the value of `test ? a : b`, `a || b` or `a && b` where the test narrows a value of a
 * generated enum: as another enum, one `match` over its variants, each arm the value the branch it
 * takes gives. */
function byVariant(s: Scope, n: N, v: Val): Val {
  if ((v.ty.k === "opt" ? v.ty.of : v.ty).k !== "str") return v;
  const conditional = n.type === "ConditionalExpression";
  const narrowed = literalNarrowing(s, conditional ? n.test : n.left, true);
  const from = narrowed === null ? undefined : enumOf(narrowed.v.ty);
  if (narrowed === null || from === undefined || narrowed.v.variant === undefined || narrowed.v.ty.k === "opt") return v;
  const { path, v: tested, holds } = narrowed;
  const kept = (literalsOf(tested.ty) ?? from.literals) as readonly string[];
  const branch = (l: string): N => (conditional ? (holds(l) ? n.consequent : n.alternate) : holds(l) === (n.operator === "||") ? n.left : n.right);
  const optional = v.ty.k === "opt";
  const before = v.asEnum?.of === v.code ? v.asEnum.into : undefined;
  const into = (def: EnumDef, node: N): string | null => {
    const arm = (l: string): string | null => {
      const one: Scope = { ...s, narrowed: new Map(s.narrowed).set(path, { ...tested, ty: keptLiterals(enumTy(from), (k) => k === l) }) };
      ctx.trying++;
      try {
        const taken = expr(one, branch(l));
        if (nothing(taken.ty)) return optional ? "None" : null;
        if ((taken.ty.k === "opt" ? taken.ty.of : taken.ty).k !== "str" || (taken.ty.k === "opt" && !optional)) return null;
        const code = intoEnum(s.comp, taken, def, node);
        return code === null || !optional || taken.ty.k === "opt" ? code : `Some(${bare(code)})`;
      } catch (e) {
        if (e instanceof GenError) return null;
        throw e;
      } finally {
        ctx.trying--;
      }
    };
    return overVariants(s.comp, tested, kept, arm) ?? before?.(def, node) ?? intoEnum(s.comp, { code: v.code, ty: v.ty }, def, node);
  };
  return { ...v, asEnum: { of: v.code, into } };
}

function exprOf(s: Scope, n: N): Val {
  const comp = s.comp;
  const path = pathOf(n);
  if (path !== null) {
    const narrowed = s.narrowed.get(path);
    if (narrowed && !narrowed.pick) return narrowed;
  }
  const named = constOf(s, n);
  if (named) return namedVal(named, { comp, node: n });
  if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier" && n.property.name === "length") {
    if (isObjectCall(n.object, "entries") && n.object.arguments.length === 1) {
      const r = expr(s, n.object.arguments[0]);
      if (r.ty.k === "record") return { code: `${atom(r.code)}.len() as i64`, ty: INT };
    }
    const base = expr(s, n.object);
    if (base.ty.k === "entry") return numberVal(2, true);
    if (base.ty.k === "list" && base.iter !== undefined) {
      const vec = /^(.*)\.into_iter\(\)$/s.exec(base.iter)?.[1];
      if (vec === undefined) {
        let at = base.iter.indexOf(".map(");
        while (at > 0 && !enclosed(base.iter.slice(at + 4))) at = base.iter.indexOf(".map(", at + 1);
        const mapped = at > 0 ? base.iter.slice(0, at) : base.iter;
        const held = /^(.*)\.iter\(\)$/s.exec(mapped)?.[1];
        return { code: held !== undefined ? `${atom(held)}.len() as i64` : `${atom(mapped)}.count() as i64`, ty: INT };
      }
      return { code: vec !== undefined ? `${atom(vec)}.len() as i64` : `${atom(base.iter)}.count() as i64`, ty: INT };
    }
    if (untypedEmpty(base)) return numberVal(0, true);
    if (base.ty.k === "list") return { code: `${atom(base.code)}.len() as i64`, ty: INT };
    if (base.ty.k === "str") return { code: `fv::strings::js_length(${strArg(base.code)})`, ty: INT };
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    const joinable = (t: Ty) => t.k === "str" || isNumber(t);
    if ((a.ty.k === "str" || b.ty.k === "str") && joinable(a.ty) && joinable(b.ty)) {
      meet(comp, a, b, "`+`", n, "join");
      return formatted(comp, [a, b], n, "`+`");
    }
    if (isNumber(a.ty) && isNumber(b.ty)) return arithmetic(a, "+", b, a.ty.k === "int" && b.ty.k === "int", refusalAt(comp, n));
    return fail(comp, "FV0608", "`+` joins a string to a string or a number, or adds two numbers", n);
  }
  if (n.type === "BinaryExpression" && n.operator === "**") return power(s, n.left, n.right, n, "`**`");
  if (n.type === "BinaryExpression" && (n.operator === "in" || n.operator === "instanceof")) {
    const what =
      n.operator === "in"
        ? "tests whether an object has a key, which the server does not translate: for a record, write `Object.keys(r).includes(key)`"
        : "tests an object's prototype, which the server's typed values do not carry: each value's type is known when compiling";
    return fail(comp, "FV0631", `\`${n.operator}\` ${what}`, n);
  }
  if (n.type === "BinaryExpression" && ["&", "|", "^", "<<", ">>", ">>>"].includes(n.operator)) {
    return fail(comp, "FV0632", `\`${n.operator}\` works on the 32-bit integers JavaScript converts its operands to, which the server does not translate: compute it in Rust and pass it as a prop`, n);
  }
  if (n.type === "BinaryExpression" && ["-", "*", "%", "/", "<", ">", "<=", ">="].includes(n.operator)) {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    const comparison = ["<", ">", "<=", ">="].includes(n.operator);
    const ordered = comparison ? claim((p) => p.values?.order?.(a, n.operator, b)) : undefined;
    if (ordered) return ordered;
    if (comparison && a.ty.k === "str" && b.ty.k === "str") {
      meet(comp, a, b, `\`${n.operator}\``, n, "order");
      const is = { "<": "lt", ">": "gt", "<=": "le", ">=": "ge" }[n.operator as "<"];
      return { code: `fv::strings::js_cmp(${strArg(a.code)}, ${strArg(b.code)}).is_${is}()`, ty: BOOL };
    }
    if (!isNumber(a.ty) || !isNumber(b.ty)) {
      const why =
        a.ty.k === "opt" || b.ty.k === "opt"
          ? "narrow an optional one with `v-if` first"
          : `the other is ${describeTy(isNumber(a.ty) ? b.ty : a.ty)}`;
      const between = comparison ? "two numbers, two strings or two dates" : "two numbers";
      return fail(comp, "FV0609", `\`${n.operator}\` is supported between ${between} that are present: ${why}`, n);
    }
    if (["<", ">", "<=", ">="].includes(n.operator)) return compare(a, n.operator, b);
    const intDivisor = n.right.type === "NumericLiteral" && Number.isInteger(n.right.value) && n.right.value !== 0;
    const int = a.ty.k === "int" && b.ty.k === "int" && n.operator !== "/" && (n.operator !== "%" || intDivisor);
    return arithmetic(a, n.operator, b, int, refusalAt(comp, n));
  }
  switch (n.type) {
    case "TemplateLiteral": {
      const parts: (string | Val)[] = [];
      n.quasis.forEach((q: N, i: number) => {
        parts.push(q.value.cooked as string);
        if (i < n.expressions.length) parts.push(shown(s, n.expressions[i], "template"));
      });
      return formatted(comp, parts, n, "a template literal");
    }
    case "ArrayExpression": {
      if (n.elements.length === 0) return { code: "[]", ty: { k: "list", of: UNDEF } };
      if (n.elements.some((el: N) => el?.type === "SpreadElement")) return spreadLiteral(s, n);
      const values = n.elements.map((el: N) => {
        if (!el) fail(comp, "FV0610", "an array literal holds plain values, without holes", n);
        return expr(s, el);
      });
      const of = values.map((v: Val) => v.ty).reduce(joinTy);
      if (!(of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool") || values.some((v: Val) => !sameTy(v.ty, of))) {
        fail(comp, "FV0611", "an array literal holds strings, numbers or booleans, all of one type", n);
      }
      return { code: `[${values.map((v: Val) => bare(v.code)).join(", ")}]`, ty: { k: "list", of }, ...loneOf(...values) };
    }
    case "OptionalMemberExpression":
    case "OptionalCallExpression":
      return optionalChain(s, n);
    case "StringLiteral":
      return { code: rustStr(n.value), ty: literalTy("str", [n.value]) };
    case "NumericLiteral":
      return numberVal(n.value, Number.isSafeInteger(n.value));
    case "BooleanLiteral":
      return { code: String(n.value), ty: BOOL, konst: n.value };
    case "NullLiteral":
      return { code: "None", ty: NULL };
    case "Identifier": {
      if (n.name === "undefined") return { code: "None", ty: UNDEF };
      const local = s.locals.get(n.name) ?? s.setup.get(n.name);
      if (local) return local;
      if (s.clientOnly.has(n.name)) return refuseClientOnly(s, n.name, n);
      if (n.name === s.propsIdent) return { code: "props", ty: { k: "struct", name: "Props" } };
      if (n.name === "Infinity" || n.name === "NaN") return numberVal(Number(n.name), false);
      if (n.name === "Intl") return localeRefusal(s, "`Intl`", n);
      if (BUILTINS.has(n.name)) return builtin(s, n.name, n);
      return refuseUnavailable(s, n.name, n);
    }
    case "MemberExpression": {
      if (!n.computed && n.property.name === "value" && n.object.type === "Identifier" && s.refs.has(n.object.name) && !s.locals.has(n.object.name)) {
        return expr(s, n.object);
      }
      if (n.computed) {
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
        if (base.ty.k === "entry") {
          if (n.property.type !== "NumericLiteral" || !Number.isInteger(n.property.value) || n.property.value < 0) {
            fail(comp, "FV0612", "`[…]` reads a part of a `[key, value]` pair by a literal index: `pair[0]` is its key and `pair[1]` its value", n);
          }
          return entryPart(base, n.property.value);
        }
        return fail(comp, "FV0612", `computed member access of ${describeTy(base.ty)}: \`[…]\` reads an item of a list, by an integer index`, n);
      }
      const prop = n.property.name as string;
      const slots = slotsObject(s, n.object);
      if (slots !== null) {
        if (!comp.slotNames.includes(prop)) fail(comp, "FV0907", `\`${slots}.${prop}\` names a slot this template does not render`, n);
        return { code: `fv_slots.${snake(prop)}.is_some()`, ty: BOOL };
      }
      if (n.object.type === "Identifier" && BUILTINS.has(n.object.name) && !s.locals.has(n.object.name) && !s.setup.has(n.object.name)) {
        const value = n.object.name === "Math" ? MATH_CONSTANTS.get(prop) : n.object.name === "Number" ? NUMBER_CONSTANTS.get(prop) : undefined;
        if (value !== undefined) return numberVal(value, Number.isSafeInteger(value));
        return builtin(s, `${n.object.name}.${prop}`, n);
      }
      if (n.object.type === "Identifier") {
        switch (n.object.name) {
          case "$props":
            return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
          case "$setup":
          case "_ctx": {
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
        }
      }
      const base = expr(s, n.object);
      const own = claim((p) => p.member?.(s, base, prop, n, false));
      if (own) return own;
      const read = base.owned ? ownedField(comp, base, prop, n) : fieldVal(comp, base.code, base.ty, prop, n);
      return base.lone && !read.lone && ["str", "struct", "list", "opt"].includes(read.ty.k) ? { ...read, lone: true } : read;
    }
    case "CallExpression":
      return call(s, n);
    case "LogicalExpression": {
      const chained = reassociated(s, n);
      if (chained !== n) return expr(s, chained);
      if (n.operator === "&&" || n.operator === "||") {
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
      }
      const a = expr(s, n.left);
      const literals = n.operator === "??" ? null : literalNarrowing(s, n.left);
      const right = literals === null ? s : n.operator === "&&" ? literals.yes : literals.no;
      if (n.operator !== "??" && a.ty.k !== "opt" && !nothing(a.ty) && a.ty.k !== "bool" && alwaysTruthy(a.ty)) return n.operator === "&&" ? expr(right, n.right) : a;
      const b = expr(right, n.right);
      if (n.operator === "??" || (n.operator === "||" && (a.ty.k === "opt" ? a.ty.of : a.ty).k === "date")) {
        const own = claim((p) => p.values?.nullish?.(s, a, b, n));
        if (own) return own;
        if (nothing(a.ty)) return b;
        if (a.ty.k !== "opt") return a;
        if (nothing(b.ty)) return { ...a, ty: withAbsence(a.ty.of, absence(b.ty)) };
        if (a.owned || b.owned) {
          if (a.ty.of.k !== "struct" || !sameTy(a.ty.of, b.ty)) return refuseInPlace(comp, "`??`", n);
          const some = a.owned ? atom(a.code) : `${atom(a.code)}.cloned()`;
          const fallback = bare(ownedStruct(b));
          return { code: panicky(fallback) ? `${some}.unwrap_or_else(|| ${fallback})` : `${some}.unwrap_or(${fallback})`, ty: b.ty, owned: true, ...loneOf(a, b) };
        }
        if (b.iter !== undefined) fail(comp, "FV0615", "`??` falling back to a computed list", n);
        if (a.enums !== undefined && a.ty.of.k === "list" && untypedEmpty(b)) return { ...enumListVal(`${atom(a.enums.place)}.as_deref().unwrap_or(&[])`, a.ty.of, a.enums.def), ...loneOf(a, b) };
        if (a.held !== undefined && b.ty.k === "list" && !untypedEmpty(b)) fail(comp, "FV0630", "`??` after an optional chain that computes a list, falling back to another list: fall back to `[]`", n);
        if (a.ty.of.k === "list" && b.ty.k === "list" && (untypedEmpty(b) || (sameTy(a.ty.of, b.ty) && !b.code.startsWith("[")))) {
          return { code: `${atom(a.code)}${a.held !== undefined ? "" : ".map(|v| &v[..])"}.unwrap_or(${untypedEmpty(b) ? "&[]" : sliced(b)})`, ty: untypedEmpty(b) ? a.ty.of : joinTy(a.ty.of, b.ty), slice: true, ...loneOf(a, b) };
        }
        if (a.ty.of.k === "list" && sameTy(a.ty.of, b.ty)) {
          const at = { loc: n.loc, __fv: n.__fv, start: n.start, end: n.end };
          const test = { type: "BinaryExpression", operator: "!=", left: n.left, right: { type: "NullLiteral", ...at }, ...at };
          return expr(s, { ...n, type: "ConditionalExpression", test, consequent: n.left, alternate: n.right });
        }
        const def = a.variant !== undefined ? enumOf(a.ty) : undefined;
        const fallback = def === undefined ? undefined : knownLiteral(b);
        if (def !== undefined && fallback !== undefined && def.literals.includes(fallback)) {
          const variant = `${atom(a.variant!)}.unwrap_or(${variantPath(comp, def, fallback)})`;
          return { code: unionStr(variant), ty: a.ty.of, variant, ...loneOf(a, b) };
        }
        const or = (some: string, method: "unwrap_or" | "or", other: string): string => (refuses(other) ? `${some}.${method}_else(|| ${other})` : `${some}.${method}(${other})`);
        const both = def !== undefined && b.ty.k !== "opt" && b.variant !== undefined && exactlyEnum(b);
        const widened = def === undefined || (fallback === undefined && !both) ? undefined : (into: EnumDef, node: N): string | null => {
          const some = fallback === undefined || into.literals.includes(fallback) ? intoEnum(comp, a, into, node) : null;
          const other = fallback === undefined ? intoEnum(comp, b, into, node) : variantPath(comp, into, fallback);
          return some === null || other === null ? null : or(atom(some), "unwrap_or", bare(other));
        };
        if (a.held !== undefined && b.ty.k === "str") return { code: `&*${or(atom(a.held), "unwrap_or", asCow(b))}`, ty: STR, ...loneOf(a, b) };
        if (a.ty.of.k === "str" && b.ty.k === "str" && isTemporary(b)) {
          return { code: `&*${or(`${atom(a.code)}.map(std::borrow::Cow::<str>::Borrowed)`, "unwrap_or", asCow(b))}`, ty: STR, ...loneOf(a, b) };
        }
        if (a.ty.of.k === "int" && b.ty.k === "int" && isCast(b)) return intFromF64(`${atom(a.code)}.map(|v| v as f64).unwrap_or(${bare(asF64(b))})`, b.at ?? refusalAt(comp, n));
        if (sameTy(a.ty.of, b.ty)) {
          const code = or(atom(a.code), "unwrap_or", bare(b.code));
          return { code, ty: joinTy(a.ty.of, b.ty), ...loneOf(a, b), ...(widened ? { asEnum: { of: code, into: widened } } : {}) };
        }
        if (b.ty.k === "opt" && sameTy(a.ty.of, b.ty.of)) return { code: or(atom(a.code), "or", bare(b.code)), ty: joinTy(a.ty, b.ty), ...loneOf(a, b) };
        if (a.ty.of.k === "float" && b.ty.k === "int") return { code: or(atom(a.code), "unwrap_or", bare(asF64(b))), ty: FLOAT };
        if (a.ty.of.k === "int" && b.ty.k === "float") return { code: or(`${atom(a.code)}.map(|v| v as f64)`, "unwrap_or", bare(b.code)), ty: FLOAT };
        return n.operator === "??" ? fail(comp, "FV0616", "`??` between different types", n) : fail(comp, "FV0617", "`||` between these types", n);
      }
      if (n.operator === "||") {
        if (a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "||", b.code));
        if (a.ty.k === "str" && (b.ty.k === "str" || b.ty.k === "undef") && known(a) !== undefined) return known(a) ? a : b;
        if (b.ty.k === "undef") {
          const inner: Ty = keptLiterals(a.ty.k === "opt" ? a.ty.of : a.ty, (l) => !falsyLiteral(l));
          const src = a.ty.k === "opt" ? atom(a.code) : `Some(${bare(a.code)})`;
          return { code: `${src}.filter(|v| ${truthy({ code: "*v", ty: inner })})`, ty: opt(inner) };
        }
        if (a.ty.k === "str" && b.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
          return { code: `&*{ let a = ${asCow(a)}; if !a.is_empty() { a } else { ${asCow(b)} } }`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty, b.ty) && (a.ty.k === "str" || isNumber(a.ty))) {
          const k = known(a);
          if (k !== undefined) return k ? a : b;
          if (a.ty.k === "int" && (isCast(a) || isCast(b))) return intFromF64(`{ let a = ${bare(asF64(a))}; if a != 0.0 { a } else { ${bare(asF64(b))} } }`, a.at ?? b.at ?? refusalAt(comp, n));
          const otherwise = a.ty.k === "str" ? strArg(b.code) : bare(b.code);
          return { code: `{ let a = ${bare(a.code)}; if ${truthy({ code: "a", ty: a.ty })} { a } else { ${otherwise} } }`, ty: joinTy(keptLiterals(a.ty, (l) => !falsyLiteral(l)), b.ty), ...loneOf(a, b) };
        }
        return fail(comp, "FV0617", "`||` between these types", n);
      }
      if (n.operator === "&&" && a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "&&", b.code));
      return notBooleans(comp, n, a.ty, b.ty);
    }
    case "UnaryExpression":
      if (n.operator === "!") {
        return negatedOrder(s, n.argument) ?? boolOf(not(truthy(truthTested(s, n.argument))));
      }
      if (n.operator === "-") {
        const a = expr(s, n.argument);
        if (isNumber(a.ty) && a.num !== undefined) return numberVal(-a.num, a.ty.k === "int");
        if (a.ty.k === "int") return intFromF64(negate(asF64(a)), refusalAt(comp, n));
        if (a.ty.k === "float") return { code: negate(a.code), ty: FLOAT };
      }
      if (n.operator === "typeof") return typeofVal(s, n);
      return fail(comp, "FV0618", `unary \`${n.operator}\``, n);
    case "BinaryExpression": {
      const tested = typeofCompare(n);
      if (tested) return claim((p) => p.equality?.(s, n)) ?? typeofTest(s, tested, n);
      const test = nullTest(n);
      if (n.operator !== "===" && n.operator !== "!==" && !test) {
        const [a, b] = [expr(s, n.left), expr(s, n.right)];
        claim((p) => p.values?.refuseEquality?.(s, a, b, n));
      }
      if (n.operator !== "===" && n.operator !== "!==" && !test) fail(comp, "FV0619", `\`${n.operator}\`: \`==\` and \`!=\` compare with \`null\` or \`undefined\` only; use \`===\``, n);
      const whole = claim((p) => p.equality?.(s, n));
      if (whole) return whole;
      if (test) {
        const v = expr(s, test.target);
        const none = absence(v.ty);
        if (v.ty.k === "opt") {
          checkNullTest(s, test, v);
          const is = `${atom(v.code)}.is_none()`;
          return boolOf(test.is ? is : not(is));
        }
        if (none !== null) {
          const konst = (!test.strict || none === test.literal) === test.is;
          return { code: String(konst), ty: BOOL, konst };
        }
        if (!test.strict && claim((p) => p.values?.describe?.(v.ty)) === undefined) {
          return { code: String(!test.is), ty: BOOL, konst: !test.is };
        }
        if (!test.strict) fail(comp, "FV0620", `\`${n.operator}\` of ${describeTy(v.ty)}: compare with \`${test.is ? "===" : "!=="} undefined\``, n);
      }
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      let eq: string;
      const scalar = (t: Ty) => t.k === "str" || t.k === "int" || t.k === "bool";
      const strish = (t: Ty) => t.k === "str" || (t.k === "opt" && t.of.k === "str");
      if (strish(a.ty) && strish(b.ty)) meet(comp, a, b, `\`${n.operator}\``, n, "equal");
      claim((p) => p.values?.refuseEquality?.(s, a, b, n));
      refuseOutside(comp, a, b, n);
      const own = claim((p) => p.values?.equals?.(a, b));
      const byEnum = knownLiteral(a) !== undefined && knownLiteral(b) !== undefined ? null : enumEquality(comp, a, b);
      if (own !== undefined) eq = own;
      else if (byEnum !== null) eq = byEnum;
      else if ((nothing(b.ty) && a.ty.k === "opt") || (nothing(a.ty) && b.ty.k === "opt")) {
        const [v, literal] = a.ty.k === "opt" ? [a, b] : [b, a];
        checkNullTest(s, { target: n, literal: literal.ty.k === "null" ? "null" : "undefined", strict: true, is: n.operator === "===" }, v);
        eq = `${atom(v.code)}.is_none()`;
      } else if (nothing(a.ty) || nothing(b.ty)) {
        const other = nothing(a.ty) ? b.ty : a.ty;
        const opaque = nothing(other) ? undefined : claim((p) => p.values?.describe?.(other));
        if (opaque !== undefined) fail(comp, "FV0621", `\`${n.operator}\` between ${opaque} and ${describeTy(nothing(a.ty) ? a.ty : b.ty)}`, n);
        const same = a.ty.k === b.ty.k;
        const konst = n.operator === "===" ? same : !same;
        return { code: String(konst), ty: BOOL, konst };
      }
      else if (isNumber(a.ty) && isNumber(b.ty)) eq = compare(a, "==", b).code;
      else if (a.ty.k === "str" && b.ty.k === "str") eq = stringsEqual(a, b);
      else if (a.ty.k === "bool" && b.ty.k === "bool" && (a.konst !== undefined || b.konst !== undefined)) {
        const [k, other] = a.konst !== undefined ? [a.konst, b.code] : [b.konst!, a.code];
        eq = k ? other : not(other);
      } else if (sameTy(a.ty, b.ty) && (scalar(a.ty) || (a.ty.k === "opt" && scalar(a.ty.of)))) {
        eq = binary(a.code, "==", b.code);
      } else if (a.ty.k === "opt" && sameTy(a.ty.of, b.ty) && scalar(b.ty)) eq = binary(a.code, "==", `Some(${bare(b.code)})`);
      else if (b.ty.k === "opt" && sameTy(b.ty.of, a.ty) && scalar(a.ty)) eq = binary(`Some(${bare(a.code)})`, "==", b.code);
      else return fail(comp, "FV0622", "`===` between these types", n);
      return boolOf(n.operator === "===" ? eq : not(eq));
    }
    case "ConditionalExpression": {
      if (splits(s, n.test)) return expr(s, split(n));
      const t = truthTested(s, n.test);
      const k = known(t);
      if (k !== undefined) {
        const chosen = expr(s, k ? n.consequent : n.alternate);
        if (!untypedEmpty(chosen)) return chosen;
        ctx.trying++;
        try {
          const other = expr(s, k ? n.alternate : n.consequent);
          return other.ty.k === "list" && other.ty.of.k !== "undef" ? typedEmpty(comp, other.ty.of) : chosen;
        } catch (e) {
          if (!(e instanceof GenError)) throw e;
          return chosen;
        } finally {
          ctx.trying--;
        }
      }
      const p = presence(s, n.test);
      const name = p ? fresh("n", jsHint(p.path)) : "";
      const literals = p ? null : literalNarrowing(s, n.test);
      let a = expr(p && !p.negated ? narrowTo(s, p, name) : (literals?.yes ?? s), n.consequent);
      let b = expr(p && p.negated ? narrowTo(s, p, name) : (literals?.no ?? s), n.alternate);
      if (sameTy(a.ty, b.ty) && a.code === b.code && (!name || !occurrences(a.code, name))) return a;
      const placed = (v: Val): Val => (["struct", "child", "record"].includes(v.ty.k) && /^\w+(?:\.[\w#]+)+$/.test(v.code) ? { ...v, code: `&${v.code}` } : v);
      [a, b] = [placed(a), placed(b)];
      const [emptyA, emptyB] = [untypedEmpty(a), untypedEmpty(b)];
      if (emptyA && b.ty.k === "list") a = { ...a, ty: b.ty };
      if (emptyB && a.ty.k === "list") b = { ...b, ty: a.ty };
      const second = (code: string) => (a.ty.k === "str" ? strArg(code) : bare(code));
      const choose = (yes: string, no: string): string => {
        if (!p) return choice(truthy(t), bare(yes), second(no));
        const [present, absent] = p.negated ? [bare(no), second(yes)] : [bare(yes), second(no)];
        if (present === `Some(${name})` && absent === "None") return p.option;
        if (present === name) return `${atom(p.option)}.unwrap_or(${absent})`;
        if (absent === "None" && present.startsWith("Some(") && enclosed(present.slice(4))) return `${atom(p.option)}.map(|${name}| ${bare(present.slice(5, -1))})`;
        if (occurrences(present, name)) return `if ${p.pattern(name)} { ${present} } else { ${absent} }`;
        return choice(p.present, present, absent);
      };
      const lone = loneOf(a, b);
      if (a.owned || b.owned) {
        const owned = ownedChoice(comp, a, b, n);
        if (owned !== null) return { code: choose(owned.a, owned.b), ty: owned.ty, owned: true, ...lone };
      }
      if (sameTy(a.ty, b.ty) && a.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
        return { code: `&*(${choose(asCow(a), asCow(b))})`, ty: STR, ...lone };
      }
      if (sameTy(a.ty, b.ty) && a.ty.k === "list" && a.ty.of.k !== "undef") {
        const owned = (v: Val, empty: boolean): boolean => !empty && (v.iter !== undefined || v.code.startsWith("["));
        if (owned(a, emptyA) || owned(b, emptyB)) {
          const both = `(${choose(emptyA ? "Vec::new()" : collected(a), emptyB ? "Vec::new()" : collected(b))})`;
          return { code: both, ty: joinTy(a.ty, b.ty), iter: `${both}.into_iter()`, ...lone };
        }
        return { code: choose(emptyA ? "&[]" : sliced(a), emptyB ? "&[]" : sliced(b)), ty: joinTy(a.ty, b.ty), slice: true, ...lone };
      }
      const optStr = (v: Val) => nothing(v.ty) || (v.ty.k === "opt" && v.ty.of.k === "str") || v.ty.k === "str";
      if (a.ty.k === "int" && b.ty.k === "int" && (isCast(a) || isCast(b))) return intFromF64(choose(asF64(a), asF64(b)), a.at ?? b.at ?? refusalAt(comp, n));
      if (sameTy(a.ty, b.ty) && a.ty.k !== "opt") {
        const code = choose(a.code, b.code);
        const both = a.ty.k === "str" && exactlyEnum(a) && exactlyEnum(b) ? [a, b] : null;
        const into = (def: EnumDef, node: N): string | null => {
          const [x, y] = both!.map((v) => intoEnum(comp, v, def, node));
          return x == null || y == null ? null : choose(x, y);
        };
        return { code, ty: joinTy(a.ty, b.ty), ...lone, ...(both ? { asEnum: { of: code, into } } : {}) };
      }
      if (isNumber(a.ty) && isNumber(b.ty)) return { code: choose(asF64(a), asF64(b)), ty: FLOAT };
      const base = (ty: Ty): Ty | null => (ty.k === "opt" ? ty.of : nothing(ty) ? null : ty);
      const [baseA, baseB] = [base(a.ty), base(b.ty)];
      const of = baseA !== null && baseB !== null ? joinTy(baseA, baseB) : (baseA ?? baseB);
      if (of !== null && (baseA === null || baseB === null || sameTy(baseA, baseB))) {
        const ty = withAbsence(of, joinAbsence(absence(a.ty), absence(b.ty)));
        if (optStr(a) && optStr(b) && (isTemporary(a) || isTemporary(b) || a.held !== undefined || b.held !== undefined)) {
          const held = (v: Val): string =>
            v.held ?? (nothing(v.ty) ? "None" : v.ty.k === "opt" ? `${atom(v.code)}.map(std::borrow::Cow::<str>::Borrowed)` : `Some(${asCow(v)})`);
          const both = atom(choose(held(a), held(b)));
          return { code: `${both}.as_deref()`, ty, held: both, ...lone };
        }
        if (sameTy(a.ty, b.ty)) return { code: choose(a.code, b.code), ty: joinTy(a.ty, b.ty), ...lone };
        const code = choose(coerce(comp, a, ty, n), coerce(comp, b, ty, n));
        const parts = of.k === "str" && [a, b].every((v) => nothing(v.ty) || exactlyEnum(v)) ? [a, b] : null;
        const into = (def: EnumDef, node: N): string | null => {
          const [x, y] = parts!.map((v) => (nothing(v.ty) ? "None" : intoEnum(comp, v, def, node)));
          const some = (made: string, v: Val): string => (made === "None" || v.ty.k === "opt" ? made : `Some(${bare(made)})`);
          return x == null || y == null ? null : choose(some(x, a), some(y, b));
        };
        return { code, ty, ...lone, ...(parts ? { asEnum: { of: code, into } } : {}) };
      }
      return fail(comp, "FV0623", "the two branches of `?:` differ in type", n);
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return stated(s, n);
    case "FvLet":
      return letIn(s, n);
    case "FvSet":
      return assignedLet(s, n);
    case "FvLoop":
      return loopIn(s, n);
    case "FvStep":
      return loopStep(s, n);
    case "NewExpression": {
      const own = claim((p) => p.construct?.(s, n));
      if (own) return own;
      const made = n.callee.type === "Identifier" ? n.callee.name : n.callee.type === "MemberExpression" && !n.callee.computed ? `${n.callee.object.name ?? "…"}.${n.callee.property.name}` : "…";
      return fail(comp, "FV0624", `\`new ${made}(…)\` builds an object the server has no twin for: compute the value in Rust and pass it as a prop`, n);
    }
    case "ObjectExpression":
      return untypedObject(s, n);
    default:
      if (n.type === "RegExpLiteral") return fail(comp, "FV0710", `a regular expression ${placeIn(s)}, which the server does not run`, n);
      if (n.type === "AwaitExpression" && s.within !== undefined) {
        return fail(comp, "FV0625", `\`await\` inside an expression is not supported ${placeIn(s)}`, n, "await a loader as a statement of its own, `const x = await loadX(…)`, and read `x`");
      }
      return fail(comp, "FV0625", `${nodeName(n)} is not supported ${placeIn(s)}`, n);
  }
}

function ownedChoice(comp: Component, a: Val, b: Val, n: N): { a: string; b: string; ty: Ty } | null {
  const base = (ty: Ty): Ty | null => (ty.k === "opt" ? ty.of : nothing(ty) ? null : ty);
  const [ba, bb] = [base(a.ty), base(b.ty)];
  const of = ba ?? bb;
  if (of === null || (ba !== null && bb !== null && !sameTy(ba, bb))) return null;
  const ty = withAbsence(of, joinAbsence(absence(a.ty), absence(b.ty)));
  if (ty.k === "opt" && ty.of.k !== "struct") {
    return fail(comp, "FV0636", "`?:` between a list built from object literals and `undefined` or `null`, which the server does not hold as an optional list: type the value as the list, `Row[]`, with `[]` for none", n);
  }
  const empty = (v: Val): boolean => v.code === "[]" || untypedEmpty(v);
  const own = (v: Val): string => {
    if (nothing(v.ty)) return "None";
    if (ty.k === "opt") return v.ty.k === "opt" ? (v.owned ? v.code : `${atom(v.code)}.cloned()`) : `Some(${bare(ownedStruct(v))})`;
    if (ty.k === "struct") return ownedStruct(v);
    if (ty.k === "list" && ty.of.k === "struct") return empty(v) ? "Vec::new()" : ownedStructs(v);
    if (ty.k === "list") return v.owned ? v.code : empty(v) ? "Vec::new()" : v.iter !== undefined ? collected(v) : `${atom(v.code)}.to_vec()`;
    return v.code;
  };
  if (ty.k !== "opt" && ty.k !== "struct" && ty.k !== "list") return null;
  return { a: own(a), b: own(b), ty };
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
