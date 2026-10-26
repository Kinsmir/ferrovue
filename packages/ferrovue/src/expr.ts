import { type Component, type EnumDef, type N, type Scope, type Ty, type Val, absence, BOOL, enumItems, enumOf, enumTy, fail, FLOAT, joinTy, keptLiterals, literalsOf, literalTy, nodeName, nothing, NULL, placeOf, rustStr, sameTy, UNDEF, UNION_STR, unionStr, variantPath } from "./model.ts";
import { GenError } from "./errors.ts";
import { enumListVal, intoEnum, overVariants } from "./enums.ts";
import { CONFIG_FILE } from "./config.ts";
import { ctx } from "./context.ts";
import { lookupStruct, markHome, tyOfTs } from "./typescript.ts";
import { claim } from "./plugin.ts";
import { bare } from "./parens.ts";
import { heldDates, spreadLiteral, typedEmpty } from "./lists.ts";
import { formatted, loneOf } from "./strings.ts";
import { asF64, isNumber, numberVal } from "./numbers.ts";
import { literalNarrowing, pathOf } from "./narrowing.ts";
import { BUILTINS, builtin, call } from "./calls.ts";
import { constOf, namedVal } from "./constants.ts";
import { localeRefusal } from "./plugins/dates.ts";
import { objectLiteral, structList, untypedObject } from "./objects.ts";
import { letIn } from "./blocks.ts";
import { assignedLet, loopIn, loopStep } from "./statements.ts";
import { refuseUnresolved } from "./resolve.ts";
import { memberOf, optionalChain } from "./members.ts";
import { binaryOf, unaryOf } from "./operators.ts";
import { logicalOf } from "./logical.ts";
import { conditionalOf } from "./conditional.ts";

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
    case "LogicalExpression":
      return logicalOf(s, n);
    case "UnaryExpression":
      return unaryOf(s, n);
    case "BinaryExpression":
      return binaryOf(s, n);
    case "ConditionalExpression":
      return conditionalOf(s, n);
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
