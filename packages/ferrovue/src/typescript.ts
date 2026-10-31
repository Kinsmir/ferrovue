import { parse as parseJs } from "@babel/parser";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { relativePath } from "./paths.ts";
import { type Absence, type Component, type Field, type N, type Struct, type Ty, absence, blankComponent, BOOL, declaredLiterals, distinctFields, enumOf, fail, FLOAT, INT, joinAbsence, joinTy, literalTy, nodeName, opt, RUST_PRELUDE, rustStr, sameTy, snake, STR, tagAst, withAbsence } from "./model.ts";
import { GenError } from "./errors.ts";
import { declareAlias, enumField, namedBy } from "./enums.ts";
import { CONFIG_FILE, TYPES_MODULE } from "./config.ts";
import { ctx, INLINE_HTML } from "./context.ts";
import { childOf } from "./expr.ts";
import { claim } from "./plugin.ts";
import { declareConsts, enumType, exportsOf } from "./constants.ts";
import { parseTs } from "./files.ts";
import { declareFunctions } from "./functions.ts";
import { refuseUnresolved, resolveImport } from "./resolve.ts";

export function typesImports(comp: Component, body: N[]): void {
  for (const s of body) {
    if (s.type !== "ImportDeclaration" || s.source.value !== TYPES_MODULE) continue;
    for (const sp of s.specifiers) {
      if (sp.type !== "ImportSpecifier") continue;
      const name = sp.imported.name ?? sp.imported.value;
      if (name === "TrustedHtml") comp.trustedName = sp.local.name;
      if (name === "InlineHtml") comp.inlineName = sp.local.name;
      if (name === "Float") comp.floatName = sp.local.name;
    }
  }
}

export const ONE_NOTHING = "its Rust type is an `Option`, whose `None` cannot be both, as `=== null` and the props sent to the client would need";

const NULL_OR_UNDEFINED = `a type that is both \`null\` and \`undefined\`: ${ONE_NOTHING}; keep one of them`;

export const DATES_REVIVED =
  "a `Date` reaches the browser as a `Date` from a prop or a loader's result, where the compiler tells the client which values are dates; Pinia state, `provide`, `inject`, a `ref` and a `defineModel` reach it as JSON the client cannot tell from a string: pass an ISO string or a number of milliseconds and build the date with `new Date()` (see the `dates_and_prices` guide)";

/** Whether a value of the type holds a `Date` itself, or in a list or a dictionary, outside any object. */
export function bareDates(ty: Ty): boolean {
  if (ty.k === "date") return true;
  return (ty.k === "opt" || ty.k === "list" || ty.k === "record") && bareDates(ty.of);
}

function listOf(comp: Component, of: Ty, t: N): Ty {
  if ((of.k === "list" || of.k === "record" || (of.k === "opt" && (of.of.k === "list" || of.of.k === "record"))) && bareDates(of)) {
    fail(comp, "FV1810", "a list of lists or dictionaries of `Date`s: hold each inner list in an object, as `{ at: Date[] }[]`", t);
  }
  return { k: "list", of };
}

/** A TypeScript type's type. */
export function tyOfTs(comp: Component, t: N, structs: Map<string, Struct>, seen: Set<string> = new Set()): Ty {
  switch (t.type) {
    case "FvTy":
      return t.ty;
    case "TSStringKeyword":
      return STR;
    case "TSNumberKeyword":
      return INT;
    case "TSBooleanKeyword":
      return BOOL;
    case "TSArrayType":
      return listOf(comp, tyOfTs(comp, t.elementType, structs, seen), t);
    case "TSParenthesizedType":
      return tyOfTs(comp, t.typeAnnotation, structs, seen);
    case "TSIndexedAccessType":
      return indexed(comp, t, structs, seen);
    case "TSMappedType":
    case "TSTupleType": {
      const placed = placedStruct(comp, t, structs);
      if (placed !== null) return placed;
      break;
    }
    case "TSTypeLiteral": {
      const placed = placedStruct(comp, t, structs);
      if (placed !== null) return placed;
      const [sig] = t.members;
      const key = sig?.parameters?.[0]?.typeAnnotation?.typeAnnotation;
      if (t.members.length === 1 && sig.type === "TSIndexSignature" && key?.type === "TSStringKeyword" && sig.typeAnnotation) {
        return recordOf(comp, sig.typeAnnotation.typeAnnotation, structs, seen);
      }
      return fail(comp, "FV0310", "an object type in place: declare it as an interface, or as `{ [key: string]: T }` for a dictionary", t);
    }
    case "TSTypeOperator":
      if (t.operator === "readonly") return tyOfTs(comp, t.typeAnnotation, structs, seen);
      break;
    case "TSLiteralType":
      if (t.literal.type === "StringLiteral") return literalTy("str", [t.literal.value]);
      if (t.literal.type === "TemplateLiteral") return t.literal.expressions.length ? STR : literalTy("str", [t.literal.quasis[0].value.cooked]);
      if (t.literal.type === "NumericLiteral") return Number.isSafeInteger(t.literal.value) ? literalTy("int", [t.literal.value]) : Number.isInteger(t.literal.value) ? INT : FLOAT;
      if (t.literal.type === "BooleanLiteral") return BOOL;
      break;
    case "TSUnionType": {
      const isNull = (u: N) => u.type === "TSNullKeyword" || (u.type === "TSLiteralType" && u.literal.type === "NullLiteral");
      let none: Absence | null = null;
      const tys: Ty[] = [];
      for (const u of t.types) {
        if (u.type === "TSUndefinedKeyword") none = joinAbsence(none, "undefined");
        else if (isNull(u)) none = joinAbsence(none, "null");
        else {
          const ty = tyOfTs(comp, u, structs, seen);
          none = joinAbsence(none, absence(ty));
          tys.push(ty.k === "opt" ? ty.of : ty);
        }
      }
      if (none === "either") return fail(comp, "FV0311", NULL_OR_UNDEFINED, t);
      const first = tys[0];
      if (!first || tys.some((x) => !sameTy(x, first))) return fail(comp, "FV0312", "a union of different types has no Rust type", t);
      return withAbsence(tys.reduce(joinTy), none);
    }
    case "TSTypeReference": {
      const name: string | undefined = t.typeName.type === "Identifier" ? t.typeName.name : undefined;
      if (name === undefined) break;
      if ((name === "Array" || name === "ReadonlyArray") && t.typeParameters?.params?.length === 1) {
        return listOf(comp, tyOfTs(comp, t.typeParameters.params[0], structs, seen), t);
      }
      if (name === "Record" && t.typeParameters?.params?.length === 2) {
        const [key, value] = t.typeParameters.params;
        if (key.type !== "TSStringKeyword") return placedStruct(comp, t, structs) ?? fail(comp, "FV0313", "a `Record` is keyed by `string`, or by a union of string literals that are names, written as a field's type", key);
        return recordOf(comp, value, structs, seen);
      }
      if (structs.has(name)) {
        if (structs === ctx.typeStructs) reachType(name);
        else if (structs === comp.structs) reachLocal(comp, name);
        return { k: "struct", name };
      }
      if (comp.childProps.has(name)) return { k: "child", name: comp.childProps.get(name)! };
      if (name === "Date" && !comp.aliases.has(name) && !comp.importedTypes.has(name)) return { k: "date" };
      if (comp.floatName !== null && name === comp.floatName) return FLOAT;
      if (comp.inlineName !== null && name === comp.inlineName) return { k: "html", inline: true };
      if (comp.trustedName !== null && name === comp.trustedName) {
        if (ctx.trustedHtml === null) {
          fail(comp, "FV1503", `a \`TrustedHtml\` prop needs \`trustedHtml\` in ${CONFIG_FILE}: the Rust type it is, or type it \`InlineHtml\` (inline tags only, \`ferrovue::html::InlineHtml\`)`, t);
        }
        return ctx.trustedHtml === INLINE_HTML ? { k: "html", inline: true } : { k: "html" };
      }
      const imported = comp.importedTypes.get(name);
      if (imported) {
        if (imported.k === "struct" && imported.home === "types") reachType(imported.name);
        return imported;
      }
      const alias = comp.aliases.get(name);
      if (alias) {
        if (seen.has(name)) fail(comp, "FV0314", `type \`${name}\` refers to itself through an alias`, t);
        return namedBy(alias, tyOfTs(comp, alias, structs, new Set(seen).add(name)));
      }
      refuseUnresolved(comp, name, t);
      return fail(comp, "FV0315", `unsupported prop type \`${name}\`: declare it as an interface in the component, or import it from a \`.ts\` file`, t);
    }
  }
  if (t.type === "TSTupleType") return fail(comp, "FV0316", `${tupleRefusal(t) ?? "a tuple type written there"} is not supported as a prop type`, t, TUPLE_HELP);
  return fail(comp, "FV0316", `${nodeName(t)} is not supported as a prop type`, t);
}

function recordOf(comp: Component, value: N, structs: Map<string, Struct>, seen: Set<string>): Ty {
  const of = tyOfTs(comp, value, structs, seen);
  const plain = (t: Ty): boolean => ["str", "int", "float", "bool", "struct", "child"].includes(t.k) || (t.k === "list" && plain(t.of));
  if (!plain(of) && of.k !== "date") fail(comp, "FV0317", "a `Record`'s values are strings, numbers, booleans, dates, objects or lists of those other than dates", value);
  return { k: "record", of };
}

export function declareTypes(comp: Component, body: N[], structs: Map<string, Struct>, aliases: Map<string, N>): N[] {
  const decls: N[] = [];
  for (const st of body) {
    const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (d?.type === "TSInterfaceDeclaration") decls.push({ name: d.id.name, members: d.body.body, node: d });
    else if (d?.type === "TSTypeAliasDeclaration") {
      const dictionary = d.typeAnnotation.members?.some((m: N) => m.type === "TSIndexSignature");
      const tuple = tupleLiteral(d.typeAnnotation);
      if (d.typeAnnotation.type === "TSTypeLiteral" && !dictionary) decls.push({ name: d.id.name, members: d.typeAnnotation.members, node: d });
      else if (tuple !== null) decls.push({ name: d.id.name, members: tuple.members, node: d });
      else {
        aliases.set(d.id.name, d.typeAnnotation);
        declareAlias(comp, d.id.name, d.typeAnnotation, d);
      }
    } else if (d?.type === "TSEnumDeclaration") {
      try {
        const type = enumType(comp, d);
        aliases.set(d.id.name, type);
        declareAlias(comp, d.id.name, type, d, d.members.map((m: N) => (m.id.type === "Identifier" ? m.id.name : m.id.value)));
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
      }
    }
  }
  const written = decls.slice();
  for (const d of written) inlineTypes(d.name, d.members, decls, aliases);
  for (const d of decls) structs.set(d.name, { name: d.name, fields: [] });
  return decls;
}

const INLINE = new WeakMap<object, string>();

function capital(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function keyLiterals(t: N, aliases: Map<string, N>, seen: Set<string> = new Set()): string[] | null {
  if (t?.type === "TSLiteralType" && t.literal.type === "StringLiteral") return [t.literal.value];
  if (t?.type === "TSParenthesizedType") return keyLiterals(t.typeAnnotation, aliases, seen);
  if (t?.type === "TSUnionType") {
    const all = t.types.map((u: N) => keyLiterals(u, aliases, seen));
    return all.some((a: string[] | null) => a === null) ? null : [...new Set(all.flat() as string[])];
  }
  const name: string | undefined = t?.type === "TSTypeReference" && t.typeName.type === "Identifier" ? t.typeName.name : undefined;
  if (name === undefined || seen.has(name) || !aliases.has(name)) return null;
  return keyLiterals(aliases.get(name), aliases, new Set(seen).add(name));
}

function keyedLiteral(t: N, aliases: Map<string, N>): N | null {
  const mapped = t?.type === "TSMappedType" && !t.nameType ? { key: t.typeParameter?.constraint, value: t.typeAnnotation, optional: t.optional === true || t.optional === "+" } : null;
  const record = t?.type === "TSTypeReference" && t.typeName.type === "Identifier" && t.typeName.name === "Record" && t.typeParameters?.params?.length === 2 && t.typeParameters.params[0].type !== "TSStringKeyword" ? { key: t.typeParameters.params[0], value: t.typeParameters.params[1], optional: false } : null;
  const keyed = mapped ?? record;
  const keys = keyed?.value ? keyLiterals(keyed.key, aliases) : null;
  if (keys === null || !keys.every((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) return null;
  const at = { loc: t.loc, start: t.start, end: t.end, __fv: t.__fv };
  return { type: "TSTypeLiteral", ...at, members: keys.map((k) => ({ type: "TSPropertySignature", ...at, key: { type: "Identifier", name: k, ...at }, computed: false, optional: keyed!.optional, typeAnnotation: { type: "TSTypeAnnotation", ...at, typeAnnotation: keyed!.value } })) };
}

const TUPLE_HELP = "a tuple is read when it has one or more parts, none optional (`?`), none a rest (`...`) and none that may be `undefined`; or declare an interface with a field for each part";

/** What keeps the tuple type \`t\` from being a struct of its parts, or null when nothing does. */
function tupleRefusal(t: N): string | null {
  if (!t.elementTypes.length) return "an empty tuple";
  for (const e of t.elementTypes) {
    if (e.type === "TSOptionalType" || (e.type === "TSNamedTupleMember" && e.optional)) return "a tuple with an optional part";
    if (e.type === "TSRestType" || (e.type === "TSNamedTupleMember" && e.elementType.type === "TSRestType")) return "a tuple with a rest part";
  }
  return null;
}

const TUPLES = new WeakMap<object>();

/** The tuple type \`t\` as an object type with a field named after each part's index, which a Rust
 * tuple struct holds and writes as an array, or null when \`t\` is no tuple of fixed parts. */
function tupleLiteral(t: N): N | null {
  if (t?.type !== "TSTupleType" || tupleRefusal(t) !== null) return null;
  const known = TUPLES.get(t);
  if (known !== undefined) return known;
  const at = { loc: t.loc, start: t.start, end: t.end, __fv: t.__fv };
  const members = t.elementTypes.map((e: N, i: number) => {
    const part = e.type === "TSNamedTupleMember" ? e.elementType : e;
    const place = { loc: e.loc, start: e.start, end: e.end, __fv: e.__fv };
    return { type: "TSPropertySignature", ...place, key: { type: "Identifier", name: String(i), ...place }, computed: false, optional: false, tuplePart: true, typeAnnotation: { type: "TSTypeAnnotation", ...place, typeAnnotation: part } };
  });
  const literal = { type: "TSTypeLiteral", ...at, members };
  TUPLES.set(t, literal);
  return literal;
}

function placedLiteral(t: N, aliases: Map<string, N>): N | null {
  switch (t?.type) {
    case "TSTypeLiteral":
      return t.members.some((m: N) => m.type === "TSIndexSignature") ? null : t;
    case "TSTupleType":
      return tupleLiteral(t) === null ? null : t;
    case "TSMappedType":
      return keyedLiteral(t, aliases) === null ? null : t;
    case "TSArrayType":
      return placedLiteral(t.elementType, aliases);
    case "TSParenthesizedType":
    case "TSTypeOperator":
      return placedLiteral(t.typeAnnotation, aliases);
    case "TSUnionType": {
      const parts = t.types.filter((u: N) => u.type !== "TSUndefinedKeyword" && u.type !== "TSNullKeyword" && !(u.type === "TSLiteralType" && u.literal.type === "NullLiteral"));
      return parts.length === 1 ? placedLiteral(parts[0], aliases) : null;
    }
    case "TSTypeReference": {
      const name: string | undefined = t.typeName.type === "Identifier" ? t.typeName.name : undefined;
      const params: N[] = t.typeParameters?.params ?? [];
      if ((name === "Array" || name === "ReadonlyArray") && params.length === 1) return placedLiteral(params[0], aliases);
      if (name === "Record" && params.length === 2) return keyedLiteral(t, aliases) === null ? placedLiteral(params[1], aliases) : t;
      return null;
    }
  }
  return null;
}

/** Name each object type written in place among the fields of \`owner\` after the field that
 * holds it, and add its declaration to \`out\`. */
export function inlineTypes(owner: string, members: N[], out: { name: string; members: N[]; node: N }[], aliases: Map<string, N>): void {
  for (const m of members) {
    if (m.type !== "TSPropertySignature" || m.key.type !== "Identifier" || !m.typeAnnotation) continue;
    const placed = placedLiteral(m.typeAnnotation.typeAnnotation, aliases);
    if (placed === null || INLINE.has(placed)) continue;
    const literal = placed.type === "TSTypeLiteral" ? placed : (tupleLiteral(placed) ?? keyedLiteral(placed, aliases)!);
    const name = `${owner}${capital(m.key.name)}`;
    INLINE.set(placed, name);
    out.push({ name, members: literal.members, node: placed });
    inlineTypes(name, literal.members, out, aliases);
  }
}

function placedStruct(comp: Component, t: N, structs: Map<string, Struct>): Ty | null {
  const name = INLINE.get(t);
  if (name === undefined) return null;
  if (structs === ctx.typeStructs) {
    reachType(name);
    return { k: "struct", name };
  }
  if (structs !== comp.structs || !comp.typeDecls.has(name)) return null;
  reachLocal(comp, name);
  return { k: "struct", name };
}

function indexed(comp: Component, t: N, structs: Map<string, Struct>, seen: Set<string>): Ty {
  const index = t.indexType;
  const key = index?.type === "TSLiteralType" && index.literal.type === "StringLiteral" ? (index.literal.value as string) : null;
  const object = tyOfTs(comp, t.objectType, structs, seen);
  const st = key === null || object.k !== "struct" ? undefined : lookupStruct(comp, object).st;
  const field = st?.fields.find((f) => f.js === key);
  if (field === undefined) {
    return fail(comp, "FV0316", `${nodeName(t)} is not supported as a prop type`, t, "an indexed type reads a field of an interface by its name, as `Card[\"size\"]`");
  }
  return field.ty;
}

export function refusePrelude(comp: Component, d: N): void {
  if (RUST_PRELUDE.has(d.name)) {
    fail(comp, "FV0318", `an interface called \`${d.name}\` would hide Rust's own \`${d.name}\` in the generated code; rename it`, d.node);
  }
}

export function readTypeFile(file: string): void {
  if (ctx.typeRead.has(file)) return;
  ctx.typeRead.add(file);
  const rel = relativePath(ctx.rootDir, file);
  const home = blankComponent(basename(rel), "types", rel, ctx.typeStructs);
  home.aliases = ctx.typeAliases;
  home.source = readFileSync(file, "utf8");
  const body = parseTs(home);
  tagAst(body, "source");
  typesImports(home, body);
  ctx.constDecls.set(file, declareConsts(home, body));
  ctx.tsModules.set(file, { home, body, functions: declareFunctions(home, body, file), exports: exportsOf(body) });
  for (const d of declareTypes(home, body, new Map(), ctx.typeAliases)) {
    const known = ctx.typeDecls.get(d.name);
    if (known === undefined && ctx.typeStructs.has(d.name)) fail(home, "FV0319", `\`${d.name}\` is declared by ${ctx.typeFiles.get(d.name)} too`, d.node);
    if (known !== undefined && ctx.typeReached.has(d.name)) fail(home, "FV0319", `\`${d.name}\` is declared by ${known[0]!.home.file} too`, d.node);
    if (known !== undefined) {
      if (known.at(-1)!.home.file === rel) known.pop();
      known.push({ home, members: d.members, node: d.node });
      continue;
    }
    ctx.typeDecls.set(d.name, [{ home, members: d.members, node: d.node }]);
    ctx.typeStructs.set(d.name, { name: d.name, fields: [] });
    ctx.typeFiles.set(d.name, rel);
  }
  for (const st of body) {
    if (st.type !== "ImportDeclaration" || st.source.value === TYPES_MODULE || st.source.value.endsWith(".vue")) continue;
    const imported = resolveImport(rel, st.source.value);
    if (imported !== null) readTypeFile(imported);
  }
}

/** Translate a type a `.ts` file declares, the first time something the server renders reaches it. */
export function reachType(name: string): void {
  const decls = ctx.typeDecls.get(name);
  if (decls === undefined || ctx.typeReached.has(name)) return;
  ctx.typeReached.add(name);
  try {
    const [first, again] = decls;
    if (again !== undefined) fail(again.home, "FV0319", `\`${name}\` is declared by ${first!.home.file} too`, again.node);
    refusePrelude(first!.home, { name, node: first!.node });
    const st = structOf(first!.home, name, first!.members, ctx.typeStructs, true);
    for (const f of st.fields) f.ty = markHome(f.ty, "types");
    ctx.typeStructs.set(name, st);
  } catch (e) {
    ctx.typeReached.delete(name);
    throw e;
  }
}

/** Translate an interface a component declares, the first time something the server renders
 * reaches it. */
export function reachLocal(comp: Component, name: string): void {
  const decl = comp.typeDecls.get(name);
  if (decl === undefined || comp.reached.has(name)) return;
  comp.reached.add(name);
  try {
    refusePrelude(comp, { name, node: decl.node });
    comp.structs.set(name, structOf(comp, name, decl.members, comp.structs, true));
  } catch (e) {
    comp.reached.delete(name);
    throw e;
  }
}

/** Refuse a type whose every field a value of it must carry, as props and store state do, where one
 * of its fields, or of the types it holds, has no Rust type. */
export function requireWhole(comp: Component, ty: Ty, seen: Set<Struct> = new Set()): void {
  if (ty.k === "opt" || ty.k === "list" || ty.k === "record") return requireWhole(comp, ty.of, seen);
  if (ty.k !== "struct") return;
  const { st, owner } = lookupStruct(comp, ty);
  if (st === undefined || seen.has(st)) return;
  seen.add(st);
  const refused = st.refused?.values().next().value;
  if (refused !== undefined) throw refused;
  for (const f of st.fields) requireWhole(owner, f.ty, seen);
}

/** Whether a value of the type holds a `Date`, itself or inside a list, a dictionary or an object. */
export function holdsDate(comp: Component, ty: Ty, seen: Set<Struct | Component> = new Set()): boolean {
  if (ty.k === "date") return true;
  if (ty.k === "opt" || ty.k === "list" || ty.k === "record") return holdsDate(comp, ty.of, seen);
  if (ty.k === "child") {
    const child = childOf(ty.name, "Props", comp);
    if (seen.has(child)) return false;
    seen.add(child);
    return child.props.fields.some((f) => holdsDate(child, f.ty, seen));
  }
  if (ty.k !== "struct") return false;
  const { st, owner } = lookupStruct(comp, ty);
  if (st === undefined || seen.has(st)) return false;
  seen.add(st);
  return st.fields.some((f) => holdsDate(owner, f.ty, seen));
}

type Plan = 1 | string | Plan[] | { [key: string]: Plan };

/** Where a value of the type holds dates, for the client to turn each one back into a `Date`, as
 * the JSON `[plan]`, or `[plan, types]` where a type holds itself: a plan is `1` for a date, `[p]`
 * for a list, `{ "*": p }` for a dictionary, an object of the fields that hold dates for an
 * interface, and the name of one of `types` for a type that holds itself. `null` where it holds
 * none. */
export function datePlan(comp: Component, ty: Ty): string | null {
  if (!holdsDate(comp, ty)) return null;
  const names = new Map<Struct | Component, string>();
  const open = new Set<Struct | Component>();
  const types: Record<string, Plan> = {};
  const named = (key: Struct | Component, name: string): string => {
    let given = names.get(key);
    if (given === undefined) {
      given = name;
      for (let i = 2; [...names.values()].includes(given); i++) given = `${name}${i}`;
      names.set(key, given);
    }
    return given;
  };
  const fields = (owner: Component, key: Struct | Component, name: string, list: Field[]): Plan => {
    if (open.has(key)) return named(key, name);
    open.add(key);
    const plan: Record<string, Plan> = {};
    for (const f of list) if (holdsDate(owner, f.ty)) plan[f.js] = of(owner, f.ty);
    open.delete(key);
    if (!names.has(key)) return plan;
    types[names.get(key)!] = plan;
    return names.get(key)!;
  };
  const of = (owner: Component, t: Ty): Plan => {
    if (t.k === "date") return 1;
    if (t.k === "opt") return of(owner, t.of);
    if (t.k === "list") return [of(owner, t.of)];
    if (t.k === "record") return { "*": of(owner, t.of) };
    if (t.k === "child") {
      const child = childOf(t.name, "Props", owner);
      return fields(child, child, t.name, child.props.fields);
    }
    if (t.k !== "struct") throw new Error(`a date plan of ${t.k}`);
    const { st, owner: home } = lookupStruct(owner, t);
    return fields(home, st!, t.name, st!.fields);
  };
  const root = of(comp, ty);
  return JSON.stringify(Object.keys(types).length ? [root, types] : [root]);
}

/** Refuse a type that holds a `Date` where `what` reaches the browser as plain JSON. */
export function refuseDates(comp: Component, ty: Ty, what: string, node: N): void {
  if (holdsDate(comp, ty)) fail(comp, "FV1806", `${what} holds a \`Date\`: ${DATES_REVIVED}`, node);
}

/** Whether `types.rs` holds the type: one built from a constant list, or a declared one something reached. */
export function typeWritten(name: string): boolean {
  return !ctx.typeDecls.has(name) || ctx.typeReached.has(name);
}

export function markHome(ty: Ty, home: string): Ty {
  if (ty.k === "struct" && !claim((p) => p.struct?.(ty)) && !ty.home && ty.name !== "Props") return { ...ty, home };
  if (ty.k === "opt" || ty.k === "list" || ty.k === "record") return { ...ty, of: markHome(ty.of, home) };
  return ty;
}

export function lookupStruct(comp: Component, ty: Ty & { k: "struct" }): { st: Struct | undefined; owner: Component; path: string } {
  const own = claim((p) => p.struct?.(ty));
  if (own) return { st: own.st, owner: comp, path: comp.module === own.module ? "" : `super::${own.module}::` };
  if (ty.home === "types") {
    reachType(ty.name);
    return { st: ctx.typeStructs.get(ty.name), owner: comp, path: comp.module === "types" ? "" : "super::types::" };
  }
  if (ty.home !== undefined && ty.home !== comp.name) {
    const owner = childOf(ty.home, ty.name, comp);
    reachLocal(owner, ty.name);
    return { st: owner.structs.get(ty.name), owner, path: `super::${owner.module}::` };
  }
  if (ty.name === "Props") return { st: comp.props, owner: comp, path: "" };
  reachLocal(comp, ty.name);
  return { st: comp.structs.get(ty.name), owner: comp, path: "" };
}

export function structOf(comp: Component, name: string, members: N[], structs: Map<string, Struct>, lenient = false, enums = true): Struct {
  const fields: Field[] = [];
  const refused = new Map<string, GenError>();
  for (const m of members) {
    try {
      fields.push(fieldOf(comp, name, m, structs, enums));
    } catch (e) {
      if (!lenient || !(e instanceof GenError)) throw e;
      const key = memberKey(m);
      if (!refused.has(key)) refused.set(key, e);
    }
  }
  return refused.size ? { name, fields: distinctFields(fields), refused } : { name, fields: distinctFields(fields) };
}

function memberKey(m: N): string {
  if (m.type !== "TSPropertySignature" && m.type !== "TSMethodSignature") return "";
  if (m.computed) return "";
  return m.key.type === "Identifier" ? m.key.name : m.key.type === "StringLiteral" ? m.key.value : "";
}

function fieldOf(comp: Component, name: string, m: N, structs: Map<string, Struct>, enums: boolean): Field {
  if (m.type !== "TSPropertySignature" || m.key.type !== "Identifier") {
    fail(comp, "FV0320", `\`${name}\` may only hold plain named fields`, m);
  }
  if (!m.typeAnnotation) {
    fail(comp, "FV0326", `\`${m.key.name}\` has no type: give it one, as \`${m.key.name}: string\``, m);
  }
  const base = tyOfTs(comp, m.typeAnnotation.typeAnnotation, structs, new Set());
  if (m.optional && absence(base) === "null") {
    fail(comp, "FV0321", `\`${m.key.name}?: T | null\` may be absent, which is \`undefined\`, or \`null\`: ${ONE_NOTHING}; declare it \`${m.key.name}: T | null\` or \`${m.key.name}?: T\``, m);
  }
  if (m.tuplePart && base.k === "opt" && base.none !== "null") {
    fail(comp, "FV0316", `part ${m.key.name} of a tuple may be \`undefined\`, which an array holds as \`null\` once written as JSON`, m, TUPLE_HELP);
  }
  const ty = m.optional && base.k !== "opt" ? opt(base) : base;
  return { js: m.key.name, rust: snake(m.key.name), ty: enums ? enumField(comp, name === "Props" ? comp.name : name, m.key.name, m, ty) : declaredLiterals(ty) };
}

export function definePropsType(call: N): N | null {
  if (call?.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "withDefaults") {
    return definePropsType(call.arguments[0]);
  }
  if (
    call?.type === "CallExpression" &&
    call.callee.type === "Identifier" &&
    call.callee.name === "defineProps"
  ) {
    return call.typeParameters?.params?.[0] ?? null;
  }
  return null;
}

export function runtimeDefaults(comp: Component, content: string): Map<string, N> {
  const out = new Map<string, N>();
  let program: N[];
  try {
    program = parseJs(content, { sourceType: "module", plugins: ["typescript"] }).program.body;
  } catch {
    return out;
  }
  const props = (o: N): N[] =>
    o?.type !== "ObjectExpression"
      ? []
      : o.properties.flatMap((p: N) => (p.type === "SpreadElement" ? props(p.argument) : [p]));
  const visit = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (n.type === "ObjectProperty" && !n.computed && (n.key.name ?? n.key.value) === "props") {
      const objects = n.value.type === "CallExpression" ? n.value.arguments : [n.value];
      for (const o of objects) {
        for (const p of props(o)) {
          if (p.type !== "ObjectProperty") continue;
          const d = props(p.value).find((q: N) => q.type === "ObjectProperty" && (q.key.name ?? q.key.value) === "default");
          if (d) out.set(p.key.name ?? p.key.value, d.value);
        }
      }
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && typeof v.type === "string") visit(v);
    }
  };
  program.forEach(visit);
  void comp;
  return out;
}

export function defaultValue(comp: Component, f: Field, node: N, written?: N): string {
  const of = f.ty.k === "opt" ? f.ty.of : f.ty;
  const def = enumOf(of);
  if (def !== undefined && node.type === "StringLiteral" && !def.literals.includes(node.value)) {
    fail(comp, "FV0322", `the default of \`${f.js}\`, ${JSON.stringify(node.value)}, is not one of its members, ${def.literals.map((l) => JSON.stringify(l)).join(" | ")}: give one of them`, written ?? node);
  }
  if (of.k === "str" && node.type === "StringLiteral") return rustStr(node.value);
  if (of.k === "int" && node.type === "NumericLiteral" && Number.isInteger(node.value)) return `${node.value}i64`;
  if (of.k === "int" && node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral" && Number.isInteger(node.argument.value)) {
    return `-${node.argument.value}i64`;
  }
  if (of.k === "bool" && node.type === "BooleanLiteral") return String(node.value);
  if (of.k === "list" && node.type === "ArrowFunctionExpression" && node.body.type === "ArrayExpression" && node.body.elements.length === 0) {
    return "&[]";
  }
  return fail(comp, "FV0322", `the default of \`${f.js}\` must be a literal of its type, or \`() => []\` for a list`, written ?? node);
}
