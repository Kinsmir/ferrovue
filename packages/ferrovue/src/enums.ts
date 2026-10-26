import { basename } from "node:path";
import { type Component, type EnumDef, type N, type Ty, type Val, asciiTy, declaredLiterals, enumOf, enumPath, enumTy, fail, isAscii, isDeclared, literalsOf, literalTy, refusalAt, REFUSALS, RUST_PRELUDE, rustStr, snake, UNION_STR, unionStr, variantPath } from "./model.ts";
import { GenError } from "./errors.ts";
import { ctx } from "./context.ts";
import { atom, bare, binary } from "./parens.ts";
import { fresh } from "./names.ts";
import { unquote } from "./strings.ts";

interface Hint {
  name: string;
  module: string;
  home: Component;
  node: N;
  key: object;
  what: string;
  members?: readonly string[];
  alias?: true;
}

const ALIASES = new WeakMap<object, Hint>();
const HINTS = new WeakMap<Ty, Hint>();

/** Record that `type` is what the alias or `enum` called `name`, declared at `decl` in `home`,
 * stands for, with the names of an enum's members. */
export function declareAlias(home: Component, name: string, type: N, decl: N, members?: readonly string[]): void {
  ALIASES.set(type, { name, module: home.module, home, node: decl, key: type, what: name, alias: true, ...(members ? { members } : {}) });
}

/** `ty`, the type the alias `type` stands for, named after the alias when it is a union of string literals. */
export function namedBy(type: N, ty: Ty): Ty {
  const hint = ALIASES.get(type);
  const inner = ty.k === "opt" ? ty.of : ty;
  const union = inner.k === "str" && (literalsOf(inner)?.length ?? 0) >= 2;
  if (hint !== undefined && !union && ctx.unions.has(hint.name)) {
    fail(hint.home, "FV0329", `\`unions\` in ferrovue.config.json names a Rust enum for \`${hint.name}\`, which is not a union of two or more string literals: remove \`${hint.name}\` from \`unions\`, or declare it as one, as \`type ${hint.name} = "a" | "b"\``, hint.node);
  }
  if (hint !== undefined && union && !HINTS.has(inner)) HINTS.set(inner, hint);
  return ty;
}

function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** The name of the variant for a literal or an enum member's name, or null when it has none. */
export function variantName(text: string): string | null {
  if (text === "") return "Empty";
  const parts = text
    .split(/[^A-Za-z0-9]+/)
    .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .filter(Boolean);
  if (!parts.length) return null;
  const name = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  if (/^[0-9]/.test(name)) return `V${name}`;
  return name === "Self" ? "Self_" : name;
}

function variantsOf(hint: Hint, literals: readonly string[]): string[] {
  const names = hint.members ?? literals;
  if (names.length !== literals.length) {
    fail(hint.home, "FV0324", `\`${hint.name}\` gives two of its members one value, and a Rust enum has one variant for each value: give each member its own value`, hint.node);
  }
  const variants: string[] = [];
  for (const text of names) {
    const name = variantName(text);
    const what = hint.members ? `the member \`${text}\`` : `the literal ${JSON.stringify(text)}`;
    if (name === null) {
      fail(hint.home, "FV0323", `${what} of \`${hint.name}\` has no letter or digit to name its variant of the Rust enum \`${hint.name}\`: use a literal with a letter or a digit`, hint.node);
    }
    const twin = variants.indexOf(name);
    if (twin >= 0) {
      const other = hint.members ? `the member \`${names[twin]}\`` : `the literal ${JSON.stringify(names[twin])}`;
      fail(hint.home, "FV0324", `${what} and ${other} of \`${hint.name}\` both name the variant \`${name}\` of its Rust enum: make them differ in their letters or digits`, hint.node);
    }
    variants.push(name);
  }
  return variants;
}

function nameable(hint: Hint, literals: readonly string[]): boolean {
  const names = (hint.members ?? literals).map(variantName);
  return names.length === literals.length && names.every((n, i) => n !== null && names.indexOf(n) === i);
}

function defineEnum(hint: Hint, literals: readonly string[]): EnumDef {
  let mod = ctx.enums.get(hint.module);
  if (mod === undefined) ctx.enums.set(hint.module, (mod = new Map()));
  const known = mod.get(hint.name);
  if (known !== undefined) {
    if (known.key === hint.key) return known;
    const variants = variantsOf(hint, literals);
    if (known.literals.join("\0") === literals.join("\0") && known.variants.join("\0") === variants.join("\0")) return known;
    fail(hint.home, "FV0325", `this union is the Rust enum \`${hint.name}\`, and ${known.home.file} declares another union of that name for the same module: name one of them with a \`type\` alias of its own`, hint.node);
  }
  const rust = hint.alias ? ctx.unions.get(hint.name) : undefined;
  if (rust === undefined && RUST_PRELUDE.has(hint.name)) fail(hint.home, "FV0325", `this union is the Rust enum \`${hint.name}\`, which would hide Rust's own \`${hint.name}\` in the generated code: rename it`, hint.node);
  const def: EnumDef = { name: hint.name, module: hint.module, literals, variants: variantsOf(hint, literals), home: hint.home, node: hint.node, key: hint.key, what: hint.what, ...(rust === undefined ? {} : { rust }) };
  if (rust !== undefined) {
    const other = ctx.mappedUnions.get(hint.name);
    if (other !== undefined && (other.literals.join("\0") !== literals.join("\0") || other.variants.join("\0") !== def.variants.join("\0"))) {
      fail(hint.home, "FV0330", `\`unions\` in ferrovue.config.json makes \`${hint.name}\` the Rust enum \`${rust}\`, and ${other.home.file} declares another \`${hint.name}\`, ${other.literals.map((l) => JSON.stringify(l)).join(" | ")}: give the two unions the same members, or name one of them with a \`type\` alias of its own`, hint.node);
    }
    if (other === undefined) ctx.mappedUnions.set(hint.name, def);
  }
  mod.set(hint.name, def);
  return def;
}

/** The type of the field `field` of `owner` declared at `node`: the generated enum when `ty` is a
 * union of two or more string literals, optional or nullable, a list of such values, or an optional
 * list of them, and `ty` itself otherwise. */
export function enumField(comp: Component, owner: string, field: string, node: N, ty: Ty): Ty {
  if (ty.k === "opt" && ty.of.k === "list") {
    const of = enumField(comp, owner, field, node, ty.of);
    return of === ty.of ? ty : { ...ty, of };
  }
  if (ty.k === "list") {
    const of = enumScalar(comp, owner, field, node, ty.of);
    return declaredLiterals(of === ty.of ? ty : { ...ty, of });
  }
  return declaredLiterals(enumScalar(comp, owner, field, node, ty));
}

function enumScalar(comp: Component, owner: string, field: string, node: N, ty: Ty): Ty {
  const inner = ty.k === "opt" ? ty.of : ty;
  const literals = literalsOf(inner);
  if (inner.k !== "str" || literals === undefined || literals.length < 2) return ty;
  const hint = HINTS.get(inner) ?? { name: `${pascal(owner)}${pascal(field)}`, module: comp.module, home: comp, node, key: node, what: field };
  const made = enumTy(defineEnum(hint, literals as readonly string[]));
  return ty.k === "opt" ? { ...ty, of: made } : made;
}

/** The list of values of the generated enum `def`, or the optional list, of type `ty` held at
 * `place`, as an expression reads it: the strings of its items, beside the list of enums. */
export function enumListVal(place: string, ty: Ty, def: EnumDef): Val {
  const list = ty.k === "opt" ? ty.of : ty;
  const item = list.k === "list" ? list.of : list;
  const literal = literalTy("str", def.literals);
  const of: Ty = item.k === "opt" ? { ...item, of: literal } : literal;
  const strings = (at: string): string =>
    item.k === "opt" ? `${at}.iter().map(|v| v.map(${UNION_STR}))` : `${at}.iter().map(|v| std::borrow::Cow::<str>::Borrowed(${unionStr("*v")}))`;
  const enums = { place, def };
  if (ty.k === "opt") {
    const held = `${atom(place)}.as_ref().map(|v| ${strings("v")}.collect::<Vec<_>>())`;
    return { code: `${held}.as_deref()`, ty: { ...ty, of: { k: "list", of } }, held, enums };
  }
  const iter = strings(atom(place));
  return { code: `${iter}.collect::<Vec<_>>()`, ty: { k: "list", of }, iter, enums };
}

/** An item of a list of values of the generated enum `def`, held in the Rust variable `name`. */
export function enumItemVal(name: string, of: Ty, def: EnumDef): Val {
  const ty = enumTy(def);
  if (of.k === "opt") return { code: `${name}.map(${UNION_STR})`, ty: { ...of, of: ty }, variant: name };
  return { code: unionStr(name), ty, variant: name };
}

/** The type of the `ref` `local` typed at `node` as `ty`: as `enumField` gives it, and `ty` itself
 * when a literal of the union gives its variant no name of its own. */
export function refField(comp: Component, local: string, node: N, ty: Ty): Ty {
  const inner = ty.k === "opt" ? ty.of : ty;
  const literals = literalsOf(inner);
  if (inner.k !== "str" || literals === undefined || literals.length < 2) return ty;
  const hint = HINTS.get(inner) ?? { name: `${pascal(comp.name)}${pascal(local)}`, module: comp.module, home: comp, node, key: node, what: local };
  return nameable(hint, literals as readonly string[]) ? enumField(comp, comp.name, local, node, ty) : ty;
}

/** The generated enum of `ty` when it is a `type` alias or an `enum` of string literals whose
 * variants all have names. */
export function aliasEnum(ty: Ty): EnumDef | undefined {
  const literals = literalsOf(ty);
  const hint = HINTS.get(ty);
  if (ty.k !== "str" || literals === undefined || literals.length < 2 || hint === undefined || !nameable(hint, literals as readonly string[])) return undefined;
  return defineEnum(hint, literals as readonly string[]);
}

/** The literal a string value is when it is one written in the source. */
export function knownLiteral(v: Val): string | undefined {
  return v.ty.k === "str" && /^"(?:[^"\\]|\\.)*"$/.test(v.code) ? unquote(v.code) : undefined;
}

function sameEnum(a: EnumDef, b: EnumDef): boolean {
  return a === b || (a.rust !== undefined ? a.rust === b.rust : b.rust === undefined && a.name === b.name && a.module === b.module);
}

/** The code of the refusal of a string outside a union where the render needs its enum. */
const OUTSIDE = "FV0518";

/** Rust code of the enum `def`, an `Option` of it when `v` is optional, for the string value `v`
 * at `node`; null when `v` may hold a string outside the union. A string that is not the enum by
 * its type is parsed as it renders, and one outside the union refuses the render. */
export function intoEnum(comp: Component, v: Val, def: EnumDef, node: N): string | null {
  const optional = v.ty.k === "opt";
  const from = enumOf(v.ty);
  const over = (on: string, arms: string): string => (optional ? `${atom(on)}.map(|v| match v { ${arms} })` : on.startsWith("{") ? `{ let v = ${on}; match v { ${arms} } }` : `match ${on} { ${arms} }`);
  const literal = knownLiteral(v);
  if (literal !== undefined) return def.literals.includes(literal) ? variantPath(comp, def, literal) : null;
  if (v.variant !== undefined && from !== undefined) {
    const kept = (literalsOf(optional ? (v.ty as { of: Ty }).of : v.ty) ?? from.literals) as readonly string[];
    if (sameEnum(from, def) && kept.length === from.literals.length) return v.variant;
    if (!kept.every((l) => def.literals.includes(l))) return null;
    if (kept.length === 1 && !optional) return variantPath(comp, def, kept[0]!);
    const made = v.asEnum !== undefined && v.asEnum.of === v.code ? v.asEnum.into(def, node) : null;
    if (made !== null) return made;
    const one = optional ? null : overVariants(comp, v, kept, (l) => (def.literals.includes(l) ? variantPath(comp, def, l) : null));
    if (one !== null) return one;
    const left = from.literals.filter((l) => !kept.includes(l));
    const arms = kept.map((l, i) => `${[l, ...(i === kept.length - 1 ? left : [])].map((k) => variantPath(comp, from, k)).join(" | ")} => ${variantPath(comp, def, l)}`);
    return over(v.variant, arms.join(", "));
  }
  if (v.asEnum !== undefined && v.asEnum.of === v.code) return v.asEnum.into(def, node);
  const literals = literalsOf(optional ? (v.ty as { of: Ty }).of : v.ty);
  if (literals === undefined || !literals.every((l) => typeof l === "string" && def.literals.includes(l))) return null;
  const strings = literals as readonly string[];
  if (!isDeclared(optional ? (v.ty as { of: Ty }).of : v.ty)) {
    if (strings.length === 1 && !optional) return variantPath(comp, def, strings[0]!);
    return over(v.code, strings.map((l, i) => `${i === strings.length - 1 ? "_" : rustStr(l)} => ${variantPath(comp, def, l)}`).join(", "));
  }
  const refused = `${REFUSALS}.keep(Err::<(), _>(fv::render::Refused::new(${rustStr(OUTSIDE)}, format!("{fv_e}: the template needs one of them here, and Vue would write the string itself: check the value before rendering"))), ${refusalAt(comp, node)})`;
  const parse = (on: string): string => {
    const subject = /^&\*+[\w.]+$/.test(on) ? on.replace(/^&\*+/, "") : atom(on);
    return def.rust === undefined ? `${subject}.parse::<${enumPath(comp, def)}>()` : `${subject}.parse_union::<${def.rust}>(${rustStr(def.name)}, &[${def.literals.map(rustStr).join(", ")}])`;
  };
  const parsed = (on: string): string => `match ${parse(on)} { Ok(fv_u) => fv_u, Err(fv_e) => { ${refused}; ${variantPath(comp, def, def.literals[0]!)} } }`;
  return optional ? `${atom(v.code)}.map(|v| ${parsed("v")})` : parsed(v.code);
}

function armsOver(comp: Component, def: EnumDef, literals: readonly string[], code: (literal: string) => string): string {
  const arms = new Map<string, string[]>();
  for (const l of literals) {
    const c = code(l);
    arms.set(c, [...(arms.get(c) ?? []), variantPath(comp, def, l)]);
  }
  return [...arms].map(([c, patterns]) => `${patterns.join(" | ")} => ${bare(c)}`).join(", ");
}

/** For the value `v` of a generated enum, narrowed to its members `kept`, the code `arm` gives each
 * of them: where a `v-if` narrows it, the name the test binds the code to, and otherwise one
 * `match` over its variants, whose arms for the members left out are the code `arm` gives them
 * too. Null when an arm is. */
export function overVariants(comp: Component, v: Val, kept: readonly string[], arm: (literal: string) => string | null): string | null {
  const from = enumOf(v.ty);
  if (from === undefined || v.variant === undefined || v.ty.k === "opt") return null;
  const codes = new Map<string, string>();
  for (const l of kept) {
    const c = arm(l);
    if (c === null) return null;
    codes.set(l, c);
  }
  if (kept.length === 1) return codes.get(kept[0]!)!;
  const bound = v.bound;
  if (bound !== undefined && bound.of === v.variant && bound.kept.length === kept.length && kept.every((l) => bound.kept.includes(l))) return bound.bind((l) => codes.get(l)!);
  for (const l of from.literals) {
    const c = codes.has(l) ? codes.get(l)! : arm(l);
    if (c === null) return null;
    codes.set(l, c);
  }
  return `match ${v.variant} { ${armsOver(comp, from, from.literals, (l) => codes.get(l)!)} }`;
}

/** Where a `v-if` narrows `v`, a value of a generated enum, to its members `kept`: `v` as the
 * branch reads it, which binds the code each conversion of it needs to a name made from `hint`,
 * and the test that binds the names `reads` finds, null when it finds none. */
export function variantBinder(comp: Component, v: Val, kept: readonly string[], hint: string, reads: (name: string) => boolean): { val: Val; test: () => string | null } {
  const from = enumOf(v.ty)!;
  const asked: { name: string; codes: string[] }[] = [];
  const bind = (arm: (literal: string) => string): string => {
    const codes = kept.map(arm);
    const known = asked.find((a) => a.codes.join("\0") === codes.join("\0"));
    if (known !== undefined) return known.name;
    const name = fresh("n", hint);
    asked.push({ name, codes });
    return name;
  };
  const test = (): string | null => {
    const used = asked.filter((a) => reads(a.name));
    if (!used.length) return null;
    const tuple = (parts: string[]): string => (parts.length === 1 ? parts[0]! : `(${parts.join(", ")})`);
    const some = (l: string): string => `Some(${bare(tuple(used.map((a) => a.codes[kept.indexOf(l)]!)))})`;
    const pattern = `Some(${tuple(used.map((a) => a.name))})`;
    const outer = v.bound;
    if (outer !== undefined && outer.of === v.variant) return `let ${pattern} = ${outer.bind((l) => (kept.includes(l) ? some(l) : "None"))}`;
    return `let ${pattern} = match ${v.variant} { ${armsOver(comp, from, from.literals, (l) => (kept.includes(l) ? some(l) : "None"))} }`;
  };
  return { val: { ...v, bound: { of: v.variant!, kept, bind } }, test };
}

interface Unproven {
  comp: Component;
  node: N;
  what: string;
  members: readonly (string | number)[];
  outside: readonly (string | number)[] | null;
}

const UNPROVEN = new WeakMap<Ty, Unproven>();

/** `v` as the string type `want` it is annotated with: a value of a generated enum is a string of
 * `want` where `want` is `string` or a union of more literals than the enum's, and `v` itself
 * otherwise. */
export function annotatedStr(v: Val, want: Ty): Val {
  const from = enumOf(v.ty);
  const inner = want.k === "opt" ? want.of : want;
  if (v.variant === undefined || from === undefined || inner.k !== "str" || enumOf(inner) !== undefined) return v;
  const literals = literalsOf(inner);
  const held = literalsOf(v.ty.k === "opt" ? v.ty.of : v.ty) ?? from.literals;
  if (literals !== undefined && (literals.length <= held.length || !held.every((l) => literals.includes(l)))) return v;
  return { code: v.code, ty: v.ty.k === "opt" ? { ...v.ty, of: inner } : inner };
}

/** `v`, the value of `what`, declared as `want`: where `want` is a union of string literals and
 * the compiler cannot show that `v`, computed by `node`, is among them, a value that refuses a
 * use of it as the union, where it is declared. */
export function declaredUnion(comp: Component, v: Val, want: Ty, what: string, node: N): Val {
  const members = literalsOf(want.k === "opt" ? want.of : want);
  const base = v.ty.k === "opt" ? v.ty.of : v.ty;
  if (members === undefined || (want.k === "opt" ? want.of : want).k !== "str" || base.k !== "str" || v.variant !== undefined) return v;
  const literals = literalsOf(base);
  const outside = literals === undefined ? null : literals.filter((l) => !members.includes(l));
  if (outside !== null && outside.length === 0) return v;
  const marked: Ty = literals === undefined ? (isAscii(base) ? asciiTy() : { k: "str" }) : literalTy("str", literals);
  UNPROVEN.set(marked, { comp, node, what, members, outside });
  return { ...v, ty: v.ty.k === "opt" ? { ...v.ty, of: marked } : marked };
}

/** Refuse a use of `v` as a union of string literals, where `v` is declared as the union and the
 * compiler cannot show it is among its members. */
export function refuseUnproven(v: Val): void {
  const u = UNPROVEN.get(v.ty.k === "opt" ? v.ty.of : v.ty);
  if (u === undefined) return;
  const union = u.members.map((l) => JSON.stringify(l)).join(" | ");
  const may = u.outside === null ? "any string" : u.outside.map((l) => JSON.stringify(l)).join(" or ");
  fail(
    u.comp,
    "FV0111",
    `${u.what} is typed as one of ${union}, and the compiler finds it may be ${may}: it narrows a string by \`===\` or \`!==\` with a literal, by its truth and by \`||\`, in \`?:\`, \`&&\` and \`v-if\`; narrow the value by one of these, or give each branch a member of the union`,
    u.node,
  );
}

/** Whether `intoEnum` turns `v` into the enum without a `match` on its string. */
export function exactlyEnum(v: Val): boolean {
  return (v.variant !== undefined && enumOf(v.ty) !== undefined) || knownLiteral(v) !== undefined || v.asEnum?.of === v.code;
}

/** Refuse a comparison of a value of a generated enum with a literal outside its union. */
export function refuseOutside(comp: Component, a: Val, b: Val, n: N): void {
  for (const [v, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const def = enumOf(v.ty);
    const literal = def === undefined ? undefined : knownLiteral(other);
    if (def !== undefined && literal !== undefined && !def.literals.includes(literal)) {
      fail(comp, "FV0637", `${JSON.stringify(literal)} is not one of ${def.literals.map((l) => JSON.stringify(l)).join(" | ")}, the members of \`${def.name}\`, so the comparison is always ${n.operator === "!==" ? "true" : "false"}: compare with one of its members`, n);
    }
  }
}

/** `a === b` where one side is a value of a generated enum the compiler holds as the enum: a
 * comparison of variants. */
export function enumEquality(comp: Component, a: Val, b: Val): string | null {
  const [da, db] = [enumOf(a.ty), enumOf(b.ty)];
  if (da !== undefined && db !== undefined && a.variant !== undefined && b.variant !== undefined && sameEnum(da, db) && a.ty.k === b.ty.k) return binary(a.variant, "==", b.variant);
  const [def, v, other] = da !== undefined && a.variant !== undefined ? [da, a, b] : db !== undefined && b.variant !== undefined ? [db, b, a] : [undefined, a, b];
  const literal = def === undefined ? undefined : knownLiteral(other);
  if (def === undefined || literal === undefined || !def.literals.includes(literal)) return null;
  const path = variantPath(comp, def, literal);
  return binary(v.variant!, "==", v.ty.k === "opt" ? `Some(${path})` : path);
}

/** For a `match` over the members `keys` of the value `on`, where the value is known to be one of
 * them: the subject, each key's pattern, and the pattern of the last arm, which takes the members
 * left out too. `exhaustive` when the patterns cover every value the subject's type holds, so the
 * last arm needs no `_`. */
export function matchOver(
  comp: Component,
  on: Val,
  keys: readonly (string | number)[],
): { subject: string; pattern: (keys: readonly (string | number)[]) => string; last: (keys: readonly (string | number)[]) => string; exhaustive: boolean } {
  const def = on.variant !== undefined ? enumOf(on.ty) : undefined;
  if (def !== undefined && on.ty.k !== "opt" && keys.every((k) => typeof k === "string" && def.literals.includes(k))) {
    const pattern = (ks: readonly (string | number)[]): string => ks.map((k) => variantPath(comp, def, k as string)).join(" | ");
    const rest = def.literals.filter((l) => !keys.includes(l));
    return { subject: on.variant!, pattern, last: (ks) => pattern([...ks, ...rest]), exhaustive: true };
  }
  const pattern = (ks: readonly (string | number)[]): string => ks.map((k) => (typeof k === "string" ? rustStr(k) : String(k))).join(" | ");
  return { subject: on.code, pattern, last: () => "_", exhaustive: false };
}

function words(name: string): string[] {
  return name.split(/(?=[A-Z])/).filter(Boolean);
}

function variantNamesLinted(def: EnumDef): boolean {
  const own = words(def.name);
  const starts = (w: string[], p: string[]): boolean => p.length <= w.length && p.every((x, i) => w[i] === x);
  const ends = (w: string[], p: string[]): boolean => p.length <= w.length && p.every((x, i) => w[w.length - p.length + i] === x);
  const all = def.variants.map(words);
  if (all.some((w) => starts(w, own) || ends(w, own))) return true;
  if (all.length < 3) return false;
  const first = all[0]!;
  return all.every((w) => w.length > 1 && w[0] === first[0]) || all.every((w) => w.length > 1 && w.at(-1) === first.at(-1));
}

function enumSource(def: EnumDef): string {
  const name = def.name;
  const union = def.literals.map(rustStr).join(" | ");
  const from = def.module === "types" || def.module === "stores" ? def.home.file : basename(def.home.file);
  const variants = def.literals.map((l, i) => `    #[serde(rename = ${rustStr(l)})]\n    ${def.variants[i]},`).join("\n");
  const arms = (f: (l: string, v: string) => string): string => def.literals.map((l, i) => f(l, def.variants[i]!)).join("\n");
  const lint = variantNamesLinted(def) ? `#[allow(clippy::enum_variant_names, reason = "the variants are named after the union's literals")]\n` : "";
  return `/// \`${def.what}\` in \`${from}\`: \`${union}\`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
${lint}pub enum ${name} {
${variants}
}

impl ${name} {
    /// Every member, in the order the union declares them.
    pub const ALL: [${name}; ${def.literals.length}] = [${def.variants.map((v) => `${name}::${v}`).join(", ")}];

    /// The string literal this member stands for.
    pub const fn as_str(self) -> &'static str {
        match self {
${arms((l, v) => `            ${name}::${v} => ${rustStr(l)},`)}
        }
    }
}

impl std::fmt::Display for ${name} {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ${name} {
    type Err = ferrovue::props::ParseUnionError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
${arms((l, v) => `            ${rustStr(l)} => Ok(${name}::${v}),`)}
            _ => Err(ferrovue::props::ParseUnionError::new(${rustStr(name)}, s, &[${def.literals.map(rustStr).join(", ")}])),
        }
    }
}

impl TryFrom<&str> for ${name} {
    type Error = ferrovue::props::ParseUnionError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl ferrovue::props::Union for ${name} {
    const ALL: &'static [Self] = &${name}::ALL;

    fn as_str(self) -> &'static str {
        ${name}::as_str(self)
    }
}
`;
}

function mappedSource(def: EnumDef): string {
  const path = def.rust!;
  const from = def.module === "types" || def.module === "stores" ? def.home.file : basename(def.home.file);
  const union = def.literals.map(rustStr).join(" | ");
  return `// \`${def.what}\` in \`${from}\`: \`${union}\`.
// \`unions\` in ferrovue.config.json names the enum \`${path}\` for it, which has a variant
// of each name below and no other.
const _: fn(${path}) = |v| match v {
${def.variants.map((v) => `    ${path}::${v} => {}`).join("\n")}
};

#[cfg(test)]
#[test]
fn ${snake(def.name)}_gives_each_member_its_literal() {
    ferrovue::props::check_union::<${path}>(${rustStr(path)}, &[${def.literals.map((l, i) => `(${path}::${def.variants[i]}, ${rustStr(l)})`).join(", ")}]);
}
`;
}

/** The enums generated for the module `module`, refusing one named as another of its items in
 * `taken`, and the checks of the enums `unions` names for its unions. */
export function enumsSource(module: string, taken: Iterable<string>): string {
  const defs = [...(ctx.enums.get(module)?.values() ?? [])];
  const names = new Set(taken);
  for (const def of defs) {
    if (def.rust === undefined && names.has(def.name)) fail(def.home, "FV0325", `this union is the Rust enum \`${def.name}\`, and the module it is written to has another type of that name: name the union with a \`type\` alias of its own`, def.node);
  }
  return defs.map((def) => (def.rust === undefined ? enumSource(def) : mappedSource(def))).join("\n");
}

/** Whether the type `ty` holds the enum `unions` names for a union, alone, optional or in a list. */
export function holdsMapped(ty: Ty): boolean {
  if (enumOf(ty)?.rust !== undefined) return true;
  return (ty.k === "opt" || ty.k === "list") && holdsMapped(ty.of);
}

/** Refuse an alias `unions` names that no prop or field of the compiled components is typed with. */
export function refuseUnusedUnions(file: string): void {
  for (const [alias, path] of ctx.unions) {
    if (!ctx.mappedUnions.has(alias)) {
      throw new GenError("FV1120", `\`unions.${alias}\` in ${file} names \`${path}\` for \`${alias}\`, and no prop or field of the components is typed with a union of that name: remove the entry, or name the alias as a \`.ts\` file or a component declares it`, { file });
    }
  }
}

/** Whether the module `module` holds generated enums. */
export function hasEnums(module: string): boolean {
  return (ctx.enums.get(module)?.size ?? 0) > 0;
}
