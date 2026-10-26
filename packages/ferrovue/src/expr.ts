import { type Component, type EnumDef, type N, type Scope, type Ty, type Val, absence, BOOL, enumItems, enumOf, enumTy, fail, falsyLiteral, FLOAT, joinAbsence, joinTy, keptLiterals, literalsOf, literalTy, nodeName, nothing, NULL, opt, placeOf, refusalAt, rustStr, sameTy, STR, UNDEF, UNION_STR, unionStr, variantPath, withAbsence } from "./model.ts";
import { GenError } from "./errors.ts";
import { annotatedStr, enumListVal, exactlyEnum, intoEnum, knownLiteral, overVariants } from "./enums.ts";
import { CONFIG_FILE } from "./config.ts";
import { ctx } from "./context.ts";
import { lookupStruct, markHome, tyOfTs } from "./typescript.ts";
import { claim } from "./plugin.ts";
import { atom, bare, enclosed, logical, occurrences, strArg } from "./parens.ts";
import { collected, heldDates, sliced, spreadLiteral, typedEmpty, untypedEmpty } from "./lists.ts";
import { asCow, formatted, isTemporary, loneOf } from "./strings.ts";
import { asF64, intFromF64, isCast, isNumber, numberVal } from "./numbers.ts";
import { boolOf, choice, known, literalNarrowing, narrowing, narrowTo, pathOf, type Presence, presence, reassociated, truthTested, truthy } from "./narrowing.ts";
import { BUILTINS, builtin, call } from "./calls.ts";
import { constOf, namedVal } from "./constants.ts";
import { localeRefusal } from "./plugins/dates.ts";
import { objectLiteral, ownedStruct, ownedStructs, refuseInPlace, structList, untypedObject } from "./objects.ts";
import { letIn, panicky, refuses, split, splits } from "./blocks.ts";
import { assignedLet, loopIn, loopStep } from "./statements.ts";
import { refuseUnresolved } from "./resolve.ts";
import { fresh, jsHint } from "./names.ts";
import { memberOf, optionalChain } from "./members.ts";
import { binaryOf, unaryOf } from "./operators.ts";

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
  const whole = expr(s, left).ty;
  if (!alwaysTruthy(whole.k === "opt" ? whole.of : p.of)) return null;
  const none = absence(whole);
  if (none === "undefined") return { type: "Identifier", name: "undefined", ...at };
  return none === "null" ? { type: "NullLiteral", ...at } : null;
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
  if (narrowed === null || from === undefined || narrowed.v.variant === undefined) return v;
  if (narrowed.v.ty.k === "opt") return byOption(s, n, v, narrowed, from);
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
  const over = (pick: (literal: string) => string | null): string | null => {
    if (optional) return null;
    return overVariants(s.comp, tested, kept, (l) => {
      const one: Scope = { ...s, narrowed: new Map(s.narrowed).set(path, { ...tested, ty: keptLiterals(enumTy(from), (k) => k === l) }) };
      ctx.trying++;
      try {
        const taken = expr(one, branch(l));
        const literals = taken.ty.k === "str" ? literalsOf(taken.ty) : undefined;
        return literals?.length === 1 && typeof literals[0] === "string" ? pick(literals[0]) : null;
      } catch (e) {
        if (e instanceof GenError) return null;
        throw e;
      } finally {
        ctx.trying--;
      }
    });
  };
  return { ...v, asEnum: { of: v.code, into, home: from, over } };
}

/** `v`, the value of `test ? a : b`, `a || b` or `a && b` where the test narrows an optional
 * value of a generated enum: one `match` over `Some` of each variant and `None`, each arm the value
 * the branch it takes gives. */
function byOption(s: Scope, n: N, v: Val, narrowed: NonNullable<ReturnType<typeof literalNarrowing>>, from: EnumDef): Val {
  const conditional = n.type === "ConditionalExpression";
  const { path, v: tested, holds, absent } = narrowed;
  const kept = (literalsOf(tested.ty.k === "opt" ? tested.ty.of : tested.ty) ?? from.literals) as readonly string[];
  const branch = (l: string | null): N => {
    const yes = l === null ? absent : holds(l);
    return conditional ? (yes ? n.consequent : n.alternate) : yes === (n.operator === "||") ? n.left : n.right;
  };
  const optional = v.ty.k === "opt";
  const arms = (code: (taken: Val) => string | null): string | null => {
    const grouped = new Map<string, string[]>();
    for (const l of [...kept, null]) {
      const one: Val = l === null ? { code: "None", ty: UNDEF } : { code: unionStr(variantPath(s.comp, from, l)), ty: keptLiterals(enumTy(from), (k) => k === l), variant: variantPath(s.comp, from, l) };
      ctx.trying++;
      let c: string | null;
      try {
        c = code(expr({ ...s, narrowed: new Map(s.narrowed).set(path, one) }, branch(l)));
      } catch (e) {
        if (e instanceof GenError) return null;
        throw e;
      } finally {
        ctx.trying--;
      }
      if (c === null) return null;
      const patterns = l === null ? ["None", ...from.literals.filter((k) => !kept.includes(k)).map((k) => `Some(${variantPath(s.comp, from, k)})`)] : [`Some(${variantPath(s.comp, from, l)})`];
      grouped.set(c, [...(grouped.get(c) ?? []), ...patterns]);
    }
    return `match ${tested.variant} { ${[...grouped].map(([c, patterns]) => `${patterns.join(" | ")} => ${bare(c)}`).join(", ")} }`;
  };
  const into = (def: EnumDef, node: N): string | null =>
    arms((taken) => {
      if (nothing(taken.ty)) return optional ? "None" : null;
      if ((taken.ty.k === "opt" ? taken.ty.of : taken.ty).k !== "str" || (taken.ty.k === "opt" && !optional)) return null;
      const code = intoEnum(s.comp, taken, def, node);
      return code === null || !optional || taken.ty.k === "opt" ? code : `Some(${bare(code)})`;
    });
  const over = (pick: (literal: string) => string | null): string | null =>
    optional
      ? null
      : arms((taken) => {
          const literals = taken.ty.k === "str" ? literalsOf(taken.ty) : undefined;
          return literals?.length === 1 && typeof literals[0] === "string" ? pick(literals[0]) : null;
        });
  return { ...v, asEnum: { of: v.code, into, home: from, over } };
}

function pickedBy(v: Val, pick: (literal: string) => string | null): string | null {
  const literal = knownLiteral(v);
  if (literal !== undefined) return pick(literal);
  return v.asEnum?.of === v.code && v.asEnum.over !== undefined ? v.asEnum.over(pick) : null;
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
      const numbers = values.every((v: Val) => isNumber(v.ty)) && values.some((v: Val) => v.ty.k === "float");
      const of = numbers ? FLOAT : values.map((v: Val) => v.ty).reduce(joinTy);
      if (!(of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool") || (!numbers && values.some((v: Val) => !sameTy(v.ty, of)))) {
        fail(comp, "FV0611", "an array literal holds strings, numbers or booleans, all of one type", n);
      }
      const code = `[${values.map((v: Val) => bare(numbers ? asF64(v) : v.code)).join(", ")}]`;
      return { code, ty: { k: "list", of }, ...loneOf(...values), literal: { of: code, items: values } };
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
    case "MemberExpression":
      return memberOf(s, n);
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
        if (a.ty.k === "opt" && pathOf(n.left) !== null && ["str", "int", "float", "bool"].includes(a.ty.of.k)) {
          return expr(s, { ...n, type: "ConditionalExpression", test: n.left, consequent: n.left, alternate: n.right });
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
      return unaryOf(s, n);
    case "BinaryExpression":
      return binaryOf(s, n);
    case "ConditionalExpression": {
      if (splits(s, n.test)) return expr(s, split(n));
      const t = truthTested(s, n.test);
      const k = known(t);
      if (k !== undefined) {
        const chosen = expr(s, k ? n.consequent : n.alternate);
        const held = chosen.variant !== undefined && chosen.ty.k === "str" ? enumOf(chosen.ty) : undefined;
        if (!untypedEmpty(chosen) && held === undefined) return chosen;
        ctx.trying++;
        try {
          const other = expr(s, k ? n.alternate : n.consequent);
          if (held !== undefined) {
            if (other.ty.k !== "str" || enumOf(other.ty) !== undefined) return chosen;
            const theirs = literalsOf(other.ty);
            return annotatedStr(chosen, theirs === undefined ? STR : literalTy("str", [...new Set([...(literalsOf(chosen.ty) ?? held.literals), ...theirs])]));
          }
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
        const over = (pick: (literal: string) => string | null): string | null => {
          const [x, y] = both!.map((v) => pickedBy(v, pick));
          return x == null || y == null ? null : choose(x, y);
        };
        return { code, ty: joinTy(a.ty, b.ty), ...lone, ...(both ? { asEnum: { of: code, into, over } } : {}) };
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
