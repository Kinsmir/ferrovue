import { type Component, type N, type Scope, type Ty, type Val, absence, BOOL, fail, FLOAT, GenError, INT, joinAbsence, nodeName, nothing, NULL, opt, rustStr, sameTy, snake, STR, UNDEF, withAbsence } from "./model.ts";
import { CONFIG_FILE, ctx } from "./context.ts";
import { lookupStruct, markHome, tyOfTs } from "./typescript.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, enclosed, logical, negate, not, occurrences, receiver, strArg } from "./parens.ts";
import { collected, picked, sliced, spreadLiteral, typedEmpty, untypedEmpty } from "./lists.ts";
import { asCow, formatted, isTemporary, loneOf, meet, stringsEqual } from "./strings.ts";
import { arithmetic, asF64, compare, intFromF64, isNumber, negatedOrder, numberVal, power } from "./numbers.ts";
import { boolOf, checkNullTest, choice, known, narrowing, narrowTo, nullTest, pathOf, presence, truthy, typeofCompare, typeofTest, typeofVal } from "./narrowing.ts";
import { BUILTINS, builtin, call, isObjectCall } from "./calls.ts";
import { constOf, constVal } from "./constants.ts";
import { localeRefusal } from "./plugins/dates.ts";

const MATH_CONSTANTS = new Map(["E", "LN10", "LN2", "LOG10E", "LOG2E", "PI", "SQRT1_2", "SQRT2"].map((k) => [k, Math[k as "PI"]]));

const NUMBER_CONSTANTS = new Map(
  ["EPSILON", "MAX_SAFE_INTEGER", "MAX_VALUE", "MIN_SAFE_INTEGER", "MIN_VALUE", "NaN", "NEGATIVE_INFINITY", "POSITIVE_INFINITY"].map((k) => [k, Number[k as "NaN"]]),
);

/** Why a `computed` whose body is a block of statements is left to the client. */
export const MANY_STATEMENTS = "it is a `computed` whose body is a block of statements: the server evaluates a body that is one expression or a single `return`";

const COMPUTE_IN_RUST = "compute the value in Rust and pass it as a prop";

function twinHelp(name: string): string {
  const module = ctx.helperModule === null ? "the module `helpers.module` names" : `\`${ctx.helperModule}\``;
  return `put \`${name}\` in ${module} with a Rust twin under \`helpers.functions\` in ${CONFIG_FILE}, or ${COMPUTE_IN_RUST}`;
}

/** Refuse a name the template reads that setup binds in a way the server cannot evaluate. */
export function refuseClientOnly(s: Scope, name: string, n: N, called = false): never {
  const why = s.clientOnly.get(name)!;
  const help = why === MANY_STATEMENTS
    ? `write the body as one expression, as \`computed(() => (a ? b : c))\`, or as a single \`return\`, or ${COMPUTE_IN_RUST}`
    : called || why.startsWith("it is a function") ? twinHelp(name) : `${COMPUTE_IN_RUST}, or read it only from an event handler`;
  return fail(s.comp, "FV0613", `\`${name}\` is set up in a way the server cannot evaluate: ${why}`, n, help);
}

/** Refuse a name the template reads that the server has no value for: one imported from a module
 * it does not run, or one nothing declares. */
export function refuseUnavailable(s: Scope, name: string, n: N, called = false): never {
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
  if (f.dflt !== undefined && f.ty.k === "opt") {
    const of = f.ty.of;
    if (of.k === "str") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: STR };
    if (of.k === "list") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: of, slice: true };
    return { code: `${place}.unwrap_or(${f.dflt})`, ty: of };
  }
  switch (f.ty.k) {
    case "str":
      return { code: `&*${place}`, ty: STR };
    case "html":
    case "child":
      return { code: `&${place}`, ty: f.ty };
    case "date":
      return { code: `fv::js_time_of(&${place})`, ty: f.ty };
    case "opt":
      if (f.ty.of.k === "date") return { code: `${place}.as_ref().map(fv::js_time_of)`, ty: f.ty };
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

export function childOf(name: string): Component {
  const c = ctx.components.get(name);
  if (!c) throw new GenError("FV0512", `\`Props\` is imported from ${name}.vue, which is not among the components compiled`);
  return c;
}

function slotsObject(s: Scope, n: N): string | null {
  if (n.type === "Identifier") return n.name === "$slots" || (s.slotsBindings.has(n.name) && !s.locals.has(n.name)) ? n.name : null;
  if (n.type !== "MemberExpression" || n.computed || n.object.type !== "Identifier") return null;
  const [owner, name]: [string, string] = [n.object.name, n.property.name];
  if (owner === "_ctx" && name === "$slots") return "$slots";
  return (owner === "$setup" || owner === "_ctx") && s.slotsBindings.has(name) ? name : null;
}

/** `n` with the type `t` given to each empty array literal it may evaluate to, as an `as T[]` on it. */
export function typedBy(n: N, t: N): N {
  switch (n.type) {
    case "ArrayExpression":
      return n.elements.length === 0 ? { ...n, type: "TSAsExpression", expression: n, typeAnnotation: t, fvGiven: true } : n;
    case "ParenthesizedExpression":
      return { ...n, expression: typedBy(n.expression, t) };
    case "ConditionalExpression":
      return { ...n, consequent: typedBy(n.consequent, t), alternate: typedBy(n.alternate, t) };
    case "LogicalExpression":
      return n.operator === "&&" ? n : { ...n, right: typedBy(n.right, t) };
    default:
      return n;
  }
}

function stated(s: Scope, n: N): Val {
  const comp = s.comp;
  const keyword = n.type === "TSAsExpression" ? "as" : "satisfies";
  const t = n.typeAnnotation;
  if (t.type === "TSTypeReference" && t.typeName.type === "Identifier" && t.typeName.name === "const" && !t.typeParameters) return expr(s, n.expression);
  let want: Ty;
  try {
    want = tyOfTs(comp, t, comp.structs);
  } catch (e) {
    if (!(e instanceof GenError) || !n.fvGiven) throw e;
    return expr(s, n.expression);
  }
  const list = want.k === "opt" ? want.of : want;
  let inner: N = n.expression;
  while (inner.type === "ParenthesizedExpression") inner = inner.expression;
  if (inner.type === "ArrayExpression" && inner.elements.length === 0) {
    if (list.k === "list") return typedEmpty(comp, list.of);
    if (n.fvGiven) return expr(s, n.expression);
    return fail(comp, "FV0628", `\`${keyword}\` gives an empty array literal ${describeTy(want)}, which it is not`, n);
  }
  const v = expr(s, typedBy(n.expression, t));
  if (sameTy(v.ty, want) || (isNumber(v.ty) && isNumber(want)) || (want.k === "opt" && sameTy(v.ty, want.of))) return v;
  return fail(comp, "FV0628", `\`${keyword}\` states ${describeTy(want)} of ${describeTy(v.ty)}, which the server keeps as it is: write the value with the type it has`, n);
}

function indexed(s: Scope, list: Val, key: N, n: N): Val {
  const i = expr(s, key);
  if (i.ty.k !== "int") {
    const is = i.ty.k === "float" ? "a `Float`, which may hold a fraction" : describeTy(i.ty);
    return fail(s.comp, "FV0824", `\`[…]\` reads a list's item by an integer index, a \`number\` that is present, and this index is ${is}: \`.at()\` takes any number`, key);
  }
  if (i.num !== undefined && i.num >= 0 && list.iter === undefined) return picked(s, list, n, (l) => (i.num === 0 ? `${l}.first()` : `${l}.get(${i.num})`), (it) => it);
  const at = `usize::try_from(${bare(i.code)}).unwrap_or(usize::MAX)`;
  return picked(s, list, n, (l) => `${l}.get(${at})`, (it) => `${atom(it)}.nth(${at})`);
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

function optionalChain(s: Scope, n: N): Val {
  const comp = s.comp;
  let link: N = n;
  while (!link.optional) {
    link = link.type === "OptionalCallExpression" ? link.callee : link.object;
    if (link?.type !== "OptionalMemberExpression" && link?.type !== "OptionalCallExpression") return fail(comp, "FV0625", "this optional chain is not supported in a template", n);
  }
  if (link.type === "OptionalCallExpression") {
    return fail(comp, "FV0629", "`?.()` calls a function that may be absent, and a template's functions are always present: write the call without `?.`", link);
  }
  const base = expr(s, link.object);
  if (nothing(base.ty)) return { code: "None", ty: UNDEF };
  const k = ++ctx.narrowCount;
  const hole: N = { ...link.object, type: "Identifier", name: `fv$o${k}` };
  const rest = plainChain(n, link, hole);
  const within = (v: Val): Scope => ({ ...s, locals: new Map(s.locals).set(hole.name, v) });
  if (base.ty.k !== "opt") return expr(within(base), rest);
  const name = `fv_o${k}`;
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

export function expr(s: Scope, n: N): Val {
  const comp = s.comp;
  const path = pathOf(n);
  if (path !== null) {
    const narrowed = s.narrowed.get(path);
    if (narrowed) return narrowed;
  }
  const named = constOf(s, n);
  if (named) return constVal(named.c, { comp, node: n, what: named.what });
  if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier" && n.property.name === "length") {
    if (isObjectCall(n.object, "entries") && n.object.arguments.length === 1) {
      const r = expr(s, n.object.arguments[0]);
      if (r.ty.k === "record") return { code: `${atom(r.code)}.len() as i64`, ty: INT };
    }
    const base = expr(s, n.object);
    if (base.ty.k === "list" && base.iter !== undefined) {
      const vec = /^(.*)\.into_iter\(\)$/s.exec(base.iter)?.[1];
      if (vec === undefined) {
        const at = base.iter.lastIndexOf(".map(");
        const mapped = at > 0 && enclosed(base.iter.slice(at + 4)) ? base.iter.slice(0, at) : base.iter;
        const held = /^(.*)\.iter\(\)$/s.exec(mapped)?.[1];
        return { code: held !== undefined ? `${atom(held)}.len() as i64` : `${atom(mapped)}.count() as i64`, ty: INT };
      }
      return { code: vec !== undefined ? `${atom(vec)}.len() as i64` : `${atom(base.iter)}.count() as i64`, ty: INT };
    }
    if (base.ty.k === "list") return { code: `${atom(base.code)}.len() as i64`, ty: INT };
    if (base.ty.k === "str") return { code: `fv::js_length(${strArg(base.code)})`, ty: INT };
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    const joinable = (t: Ty) => t.k === "str" || isNumber(t);
    if ((a.ty.k === "str" || b.ty.k === "str") && joinable(a.ty) && joinable(b.ty)) {
      meet(comp, a, b, "`+`", n, "join");
      return formatted(comp, [a, b], n, "`+`");
    }
    if (isNumber(a.ty) && isNumber(b.ty)) return arithmetic(a, "+", b, a.ty.k === "int" && b.ty.k === "int");
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
      return { code: `fv::js_cmp(${strArg(a.code)}, ${strArg(b.code)}).is_${is}()`, ty: BOOL };
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
    return arithmetic(a, n.operator, b, int);
  }
  switch (n.type) {
    case "TemplateLiteral": {
      const parts: (string | Val)[] = [];
      n.quasis.forEach((q: N, i: number) => {
        parts.push(q.value.cooked as string);
        if (i < n.expressions.length) parts.push(expr(s, n.expressions[i]));
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
      const of = values[0]!.ty;
      if (!(of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool") || values.some((v: Val) => !sameTy(v.ty, of))) {
        fail(comp, "FV0611", "an array literal holds strings, numbers or booleans, all of one type", n);
      }
      return { code: `[${values.map((v: Val) => bare(v.code)).join(", ")}]`, ty: { k: "list", of }, ...loneOf(...values) };
    }
    case "OptionalMemberExpression":
    case "OptionalCallExpression":
      return optionalChain(s, n);
    case "StringLiteral":
      return { code: rustStr(n.value), ty: STR };
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
      return claim((p) => p.member?.(s, base, prop, n, false)) ?? fieldVal(comp, base.code, base.ty, prop, n);
    }
    case "CallExpression":
      return call(s, n);
    case "LogicalExpression": {
      if (n.operator === "&&" || n.operator === "||") {
        const p = presence(s, n.left);
        if (p && p.negated === (n.operator === "||") && (p.negated || !p.truthy)) {
          let right: Val | undefined;
          const code = narrowing(s, p, (inner) => (right = expr(inner, n.right)).code, () => String(n.operator === "||"));
          if (right?.ty.k === "bool") return { code, ty: BOOL };
          return fail(comp, "FV0614", `\`${n.operator}\` is supported between booleans only`, n);
        }
      }
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      if (n.operator === "??" || (n.operator === "||" && (a.ty.k === "opt" ? a.ty.of : a.ty).k === "date")) {
        const own = claim((p) => p.values?.nullish?.(s, a, b, n));
        if (own) return own;
        if (nothing(a.ty)) return b;
        if (a.ty.k !== "opt") return a;
        if (nothing(b.ty)) return { ...a, ty: withAbsence(a.ty.of, absence(b.ty)) };
        if (b.iter !== undefined) fail(comp, "FV0615", "`??` falling back to a computed list", n);
        if (a.held !== undefined && b.ty.k === "list" && !untypedEmpty(b)) fail(comp, "FV0630", "`??` after an optional chain that computes a list, falling back to another list: fall back to `[]`", n);
        if (a.ty.of.k === "list" && b.ty.k === "list" && (untypedEmpty(b) || (sameTy(a.ty.of, b.ty) && !b.code.startsWith("[")))) {
          return { code: `${atom(a.code)}${a.held !== undefined ? "" : ".map(|v| &v[..])"}.unwrap_or(${untypedEmpty(b) ? "&[]" : sliced(b)})`, ty: a.ty.of, slice: true, ...loneOf(a, b) };
        }
        if (a.held !== undefined && b.ty.k === "str") return { code: `&*${atom(a.held)}.unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        if (a.ty.of.k === "str" && b.ty.k === "str" && isTemporary(b)) {
          return { code: `&*${atom(a.code)}.map(std::borrow::Cow::<str>::Borrowed).unwrap_or(${asCow(b)})`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty.of, b.ty)) return { code: `${atom(a.code)}.unwrap_or(${bare(b.code)})`, ty: b.ty, ...loneOf(a, b) };
        if (b.ty.k === "opt" && sameTy(a.ty.of, b.ty.of)) return { code: `${atom(a.code)}.or(${bare(b.code)})`, ty: b.ty, ...loneOf(a, b) };
        if (a.ty.of.k === "float" && b.ty.k === "int") return { code: `${atom(a.code)}.unwrap_or(${bare(asF64(b))})`, ty: FLOAT };
        if (a.ty.of.k === "int" && b.ty.k === "float") return { code: `${atom(a.code)}.map(|v| v as f64).unwrap_or(${bare(b.code)})`, ty: FLOAT };
        return n.operator === "??" ? fail(comp, "FV0616", "`??` between different types", n) : fail(comp, "FV0617", "`||` between these types", n);
      }
      if (n.operator === "||") {
        if (a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "||", b.code));
        if (b.ty.k === "undef") {
          const inner: Ty = a.ty.k === "opt" ? a.ty.of : a.ty;
          const src = a.ty.k === "opt" ? atom(a.code) : `Some(${bare(a.code)})`;
          return { code: `${src}.filter(|v| ${truthy({ code: "*v", ty: inner })})`, ty: opt(inner) };
        }
        if (a.ty.k === "str" && b.ty.k === "str" && known(a) !== undefined) return known(a) ? a : b;
        if (a.ty.k === "str" && b.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
          return { code: `&*{ let a = ${asCow(a)}; if !a.is_empty() { a } else { ${asCow(b)} } }`, ty: STR, ...loneOf(a, b) };
        }
        if (sameTy(a.ty, b.ty) && (a.ty.k === "str" || isNumber(a.ty))) {
          const k = known(a);
          if (k !== undefined) return k ? a : b;
          const otherwise = a.ty.k === "str" ? strArg(b.code) : bare(b.code);
          return { code: `{ let a = ${bare(a.code)}; if ${truthy({ code: "a", ty: a.ty })} { a } else { ${otherwise} } }`, ty: a.ty, ...loneOf(a, b) };
        }
        return fail(comp, "FV0617", "`||` between these types", n);
      }
      if (n.operator === "&&" && a.ty.k === "bool" && b.ty.k === "bool") return boolOf(logical(a.code, "&&", b.code));
      return fail(comp, "FV0614", `\`${n.operator}\` is supported between booleans only`, n);
    }
    case "UnaryExpression":
      if (n.operator === "!") {
        return negatedOrder(s, n.argument) ?? boolOf(not(truthy(expr(s, n.argument))));
      }
      if (n.operator === "-") {
        const a = expr(s, n.argument);
        if (isNumber(a.ty) && a.num !== undefined) return numberVal(-a.num, a.ty.k === "int");
        if (a.ty.k === "int") return intFromF64(negate(asF64(a)));
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
      const own = claim((p) => p.values?.equals?.(a, b));
      if (own !== undefined) eq = own;
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
      const t = expr(s, n.test);
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
      const name = p ? `n${++ctx.narrowCount}` : "";
      let a = expr(p && !p.negated ? narrowTo(s, p, name) : s, n.consequent);
      let b = expr(p && p.negated ? narrowTo(s, p, name) : s, n.alternate);
      if (sameTy(a.ty, b.ty) && a.code === b.code && (!name || !occurrences(a.code, name))) return a;
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
      if (sameTy(a.ty, b.ty) && a.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
        return { code: `&*(${choose(asCow(a), asCow(b))})`, ty: STR, ...lone };
      }
      if (sameTy(a.ty, b.ty) && a.ty.k === "list" && a.ty.of.k !== "undef") {
        const owned = (v: Val, empty: boolean): boolean => !empty && (v.iter !== undefined || v.code.startsWith("["));
        if (owned(a, emptyA) || owned(b, emptyB)) {
          const both = `(${choose(emptyA ? "Vec::new()" : collected(a), emptyB ? "Vec::new()" : collected(b))})`;
          return { code: both, ty: a.ty, iter: `${both}.into_iter()`, ...lone };
        }
        return { code: choose(emptyA ? "&[]" : sliced(a), emptyB ? "&[]" : sliced(b)), ty: a.ty, slice: true, ...lone };
      }
      const optStr = (v: Val) => nothing(v.ty) || (v.ty.k === "opt" && v.ty.of.k === "str") || v.ty.k === "str";
      if (sameTy(a.ty, b.ty) && a.ty.k !== "opt") return { code: choose(a.code, b.code), ty: a.ty, ...lone };
      if (isNumber(a.ty) && isNumber(b.ty)) return { code: choose(asF64(a), asF64(b)), ty: FLOAT };
      const base = (ty: Ty): Ty | null => (ty.k === "opt" ? ty.of : nothing(ty) ? null : ty);
      const [baseA, baseB] = [base(a.ty), base(b.ty)];
      const of = baseA ?? baseB;
      if (of !== null && (baseA === null || baseB === null || sameTy(baseA, baseB))) {
        const ty = withAbsence(of, joinAbsence(absence(a.ty), absence(b.ty)));
        if (optStr(a) && optStr(b) && (isTemporary(a) || isTemporary(b) || a.held !== undefined || b.held !== undefined)) {
          const held = (v: Val): string =>
            v.held ?? (nothing(v.ty) ? "None" : v.ty.k === "opt" ? `${atom(v.code)}.map(std::borrow::Cow::<str>::Borrowed)` : `Some(${asCow(v)})`);
          const both = atom(choose(held(a), held(b)));
          return { code: `${both}.as_deref()`, ty, held: both, ...lone };
        }
        if (sameTy(a.ty, b.ty)) return { code: choose(a.code, b.code), ty: a.ty, ...lone };
        return { code: choose(coerce(comp, a, ty, n), coerce(comp, b, ty, n)), ty, ...lone };
      }
      return fail(comp, "FV0623", "the two branches of `?:` differ in type", n);
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return stated(s, n);
    case "NewExpression": {
      const own = claim((p) => p.construct?.(s, n));
      if (own) return own;
      const made = n.callee.type === "Identifier" ? n.callee.name : n.callee.type === "MemberExpression" && !n.callee.computed ? `${n.callee.object.name ?? "…"}.${n.callee.property.name}` : "…";
      return fail(comp, "FV0624", `\`new ${made}(…)\` builds an object the server has no twin for: compute the value in Rust and pass it as a prop`, n);
    }
    default:
      return fail(comp, "FV0625", `${nodeName(n)} is not supported in a template`, n);
  }
}
