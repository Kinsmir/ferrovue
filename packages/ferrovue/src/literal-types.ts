import { type Component, type N, type Ty, STR } from "./model.ts";

function canonical(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function sameTy(a: Ty, b: Ty): boolean {
  return JSON.stringify(a, canonical) === JSON.stringify(b, canonical);
}

const LITERALS = new WeakMap<Ty, readonly (string | number)[]>();

/** A string or integer type whose values are known to be among `values`, as a union of literals declares. */
export function literalTy(k: "str" | "int", values: readonly (string | number)[]): Ty {
  const ty: Ty = { k };
  LITERALS.set(ty, values);
  return ty;
}

/** The literals a string or integer type's values are known to be among, if it has them. */
export function literalsOf(ty: Ty): readonly (string | number)[] | undefined {
  return LITERALS.get(ty);
}

/** `ty`, optional or not, with the literals known of it narrowed to those `keep` holds, as
 * TypeScript narrows a union; `ty` itself when none are known, or when `keep` holds all or none. */
export function keptLiterals(ty: Ty, keep: (literal: string | number) => boolean): Ty {
  if (ty.k === "opt") {
    const of = keptLiterals(ty.of, keep);
    return of === ty.of ? ty : { ...ty, of };
  }
  const literals = LITERALS.get(ty);
  if (literals === undefined || (ty.k !== "str" && ty.k !== "int")) return ty;
  const left = literals.filter(keep);
  if (left.length === literals.length || left.length === 0) return ty;
  const made = derived([ty], literalTy(ty.k, left));
  const def = ENUMS.get(ty);
  if (def !== undefined) ENUMS.set(made, def);
  return made;
}

/** Whether a literal of a union is falsy, as `""` and `0` are. */
export function falsyLiteral(literal: string | number): boolean {
  return literal === "" || literal === 0;
}

const ASCII = new WeakSet<Ty>();

/** A string type whose values are known to hold ASCII characters only, as the string of a number
 * does: each of its UTF-16 code units is a whole character, so cutting it never leaves half of one. */
export function asciiTy(): Ty {
  const ty: Ty = { k: "str" };
  ASCII.add(ty);
  return ty;
}

/** Whether a string type's values are known to hold ASCII characters only. */
export function isAscii(ty: Ty): boolean {
  if (ty.k !== "str") return false;
  if (ASCII.has(ty)) return true;
  const literals = LITERALS.get(ty);
  return literals !== undefined && literals.every((l) => typeof l === "string" && asciiText(l));
}

/** Whether every character of `text` is ASCII. */
export function asciiText(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** A string type, known to hold ASCII characters only when `ascii` is. */
export function strTy(ascii: boolean): Ty {
  return ascii ? asciiTy() : STR;
}

/** The type of a value that is one of two, `a` with the literals known of it kept only where both have them. */
export function joinTy(a: Ty, b: Ty): Ty {
  if (a.k === "opt" || a.k === "list" || a.k === "record" || a.k === "entry") {
    const of = joinTy(a.of, b.k === a.k ? (b as { of: Ty }).of : b);
    return of === a.of ? a : { ...a, of };
  }
  const other = b.k === "opt" ? b.of : b;
  const joined = joinedScalar(a, other);
  if (a.k !== "str") return joined;
  const filled = neverEmpty(a) && neverEmpty(other);
  if (neverEmpty(joined) === filled) return joined;
  return filled ? filledTy(joined) : strTy(isAscii(joined));
}

function joinedScalar(a: Ty, other: Ty): Ty {
  const ascii = a.k === "str" && isAscii(a) && isAscii(other);
  const mine = LITERALS.get(a);
  if (mine === undefined || (a.k !== "str" && a.k !== "int")) return a.k === "str" && ASCII.has(a) && !ascii ? STR : a;
  const theirs = LITERALS.get(other);
  return theirs === undefined ? (ascii ? asciiTy() : { k: a.k }) : derived([a, other], literalTy(a.k, [...new Set([...mine, ...theirs])]));
}

const DECLARED = new WeakSet<Ty>();

const FILLED = new WeakSet<Ty>();

/** `ty`, a string type, as known to hold no empty string, as a test of its truth leaves it. */
export function filledTy(ty: Ty): Ty {
  if (ty.k !== "str" || neverEmpty(ty)) return ty;
  const left = LITERALS.get(ty)?.filter((l) => l !== "") ?? [];
  const made = left.length ? derived([ty], literalTy("str", left)) : { k: "str" as const };
  const def = ENUMS.get(ty);
  if (def !== undefined) ENUMS.set(made, def);
  if (ASCII.has(ty)) ASCII.add(made);
  FILLED.add(made);
  return made;
}

/** Whether a string type's values are known never to be the empty string. */
export function neverEmpty(ty: Ty): boolean {
  if (ty.k !== "str") return false;
  if (FILLED.has(ty)) return true;
  const literals = LITERALS.get(ty);
  return literals !== undefined && literals.length > 0 && !literals.includes("") && !DECLARED.has(ty);
}

/** `ty`, with each string type in it that holds literals and is no generated enum marked as
 * declared for a value the Rust caller holds as a string, which the compiler does not check
 * against its literals. */
export function declaredLiterals(ty: Ty): Ty {
  if (ty.k === "opt" || ty.k === "list" || ty.k === "record") declaredLiterals(ty.of);
  else if (ty.k === "str" && LITERALS.has(ty) && !ENUMS.has(ty)) DECLARED.add(ty);
  return ty;
}

/** Whether a string type's literals are declared for a value the Rust caller holds as a string. */
export function isDeclared(ty: Ty): boolean {
  return DECLARED.has(ty);
}

function derived(from: readonly Ty[], ty: Ty): Ty {
  if (from.some((t) => DECLARED.has(t))) DECLARED.add(ty);
  const names = new Map<string, string>();
  for (const t of from) for (const [literal, name] of NAMES.get(t) ?? []) names.set(literal, name);
  if (names.size) NAMES.set(ty, names);
  return ty;
}

const NAMES = new WeakMap<Ty, ReadonlyMap<string, string>>();

/** Record the names an `enum` gives the literals of the string type `ty`. */
export function nameLiterals(ty: Ty, names: ReadonlyMap<string, string>): void {
  NAMES.set(ty, names);
}

/** The name of the `enum` member each literal of the string type `ty` comes from, where it comes from one. */
export function literalNames(ty: Ty): ReadonlyMap<string, string> | undefined {
  return NAMES.get(ty);
}

/** A Rust enum generated for a union of string literals. */
export interface EnumDef {
  name: string;
  module: string;
  literals: readonly string[];
  variants: readonly string[];
  home: Component;
  node: N;
  key: object;
  /** What the source calls the union: its alias, or the field it is written in place for. */
  what: string;
  /** The path of the application's own enum `unions` in the configuration names for the alias,
   * which the compiler uses and generates no enum for. */
  rust?: string;
}

const ENUMS = new WeakMap<Ty, EnumDef>();

/** The string type of a field whose Rust type is the generated enum `def`. */
export function enumTy(def: EnumDef): Ty {
  const ty = literalTy("str", def.literals);
  ENUMS.set(ty, def);
  return ty;
}

/** The generated enum a field's type is, or makes optional. */
export function enumOf(ty: Ty): EnumDef | undefined {
  return ENUMS.get(ty.k === "opt" ? ty.of : ty);
}

/** The generated enum the items of a list are, or make optional, for a list or an optional list. */
export function enumItems(ty: Ty): EnumDef | undefined {
  const list = ty.k === "opt" ? ty.of : ty;
  return list.k === "list" ? enumOf(list.of) : undefined;
}

/** The path of a generated enum, from the module of `comp`. */
export function enumPath(comp: Component, def: EnumDef): string {
  if (def.rust !== undefined) return def.rust;
  return `${comp.module === def.module ? "" : `super::${def.module}::`}${def.name}`;
}

/** The path of the variant of `def` that stands for `literal`. */
export function variantPath(comp: Component, def: EnumDef, literal: string): string {
  return `${enumPath(comp, def)}::${def.variants[def.literals.indexOf(literal)]!}`;
}

/** The function generated code reads the literal of an enum's value with, whether the compiler
 * generated the enum or `unions` names it. */
export const UNION_STR = "fv::props::Union::as_str";

/** Rust code of the literal the enum value `code` stands for. */
export function unionStr(code: string): string {
  return `${UNION_STR}(${code})`;
}
