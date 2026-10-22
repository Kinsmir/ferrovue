import { basename } from "node:path";
import { type Component, type EnumDef, type N, type Ty, type Val, enumOf, enumTy, fail, literalsOf, RUST_PRELUDE, rustStr, variantPath } from "./model.ts";
import { ctx } from "./context.ts";
import { atom, binary } from "./parens.ts";
import { unquote } from "./strings.ts";

interface Hint {
  name: string;
  module: string;
  home: Component;
  node: N;
  key: object;
  what: string;
  members?: readonly string[];
}

const ALIASES = new WeakMap<object, Hint>();
const HINTS = new WeakMap<Ty, Hint>();

/** Record that `type` is what the alias or `enum` called `name`, declared at `decl` in `home`,
 * stands for, with the names of an enum's members. */
export function declareAlias(home: Component, name: string, type: N, decl: N, members?: readonly string[]): void {
  ALIASES.set(type, { name, module: home.module, home, node: decl, key: type, what: name, ...(members ? { members } : {}) });
}

/** `ty`, the type the alias `type` stands for, named after the alias when it is a union of string literals. */
export function namedBy(type: N, ty: Ty): Ty {
  const hint = ALIASES.get(type);
  const inner = ty.k === "opt" ? ty.of : ty;
  if (hint !== undefined && inner.k === "str" && (literalsOf(inner)?.length ?? 0) >= 2 && !HINTS.has(inner)) HINTS.set(inner, hint);
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
  if (RUST_PRELUDE.has(hint.name)) fail(hint.home, "FV0325", `this union is the Rust enum \`${hint.name}\`, which would hide Rust's own \`${hint.name}\` in the generated code: rename it`, hint.node);
  const def: EnumDef = { name: hint.name, module: hint.module, literals, variants: variantsOf(hint, literals), home: hint.home, node: hint.node, key: hint.key, what: hint.what };
  mod.set(hint.name, def);
  return def;
}

/** The type of the field `field` of `owner` declared at `node`: the generated enum when `ty` is a
 * union of two or more string literals, optional or nullable, and `ty` itself otherwise. */
export function enumField(comp: Component, owner: string, field: string, node: N, ty: Ty): Ty {
  const inner = ty.k === "opt" ? ty.of : ty;
  const literals = literalsOf(inner);
  if (inner.k !== "str" || literals === undefined || literals.length < 2) return ty;
  const hint = HINTS.get(inner) ?? { name: `${pascal(owner)}${pascal(field)}`, module: comp.module, home: comp, node, key: node, what: field };
  const made = enumTy(defineEnum(hint, literals as readonly string[]));
  return ty.k === "opt" ? { ...ty, of: made } : made;
}

/** The literal a string value is when it is one written in the source. */
export function knownLiteral(v: Val): string | undefined {
  return v.ty.k === "str" && /^"(?:[^"\\]|\\.)*"$/.test(v.code) ? unquote(v.code) : undefined;
}

function sameEnum(a: EnumDef, b: EnumDef): boolean {
  return a === b || (a.name === b.name && a.module === b.module);
}

/** Rust code of the enum `def`, an `Option` of it when `v` is optional, for the string value `v`;
 * null when `v` may hold a string outside the union. */
export function intoEnum(comp: Component, v: Val, def: EnumDef): string | null {
  const optional = v.ty.k === "opt";
  const from = enumOf(v.ty);
  const over = (on: string, arms: string): string => (optional ? `${atom(on)}.map(|v| match v { ${arms} })` : `match ${on} { ${arms} }`);
  if (v.variant !== undefined && from !== undefined) {
    if (sameEnum(from, def)) return v.variant;
    if (!from.literals.every((l) => def.literals.includes(l))) return null;
    return over(v.variant, from.literals.map((l) => `${variantPath(comp, from, l)} => ${variantPath(comp, def, l)}`).join(", "));
  }
  const literal = knownLiteral(v);
  if (literal !== undefined) return def.literals.includes(literal) ? variantPath(comp, def, literal) : null;
  const literals = literalsOf(optional ? (v.ty as { of: Ty }).of : v.ty);
  if (literals === undefined || !literals.every((l) => typeof l === "string" && def.literals.includes(l))) return null;
  const strings = literals as readonly string[];
  if (strings.length === 1 && !optional) return variantPath(comp, def, strings[0]!);
  return over(v.code, strings.map((l, i) => `${i === strings.length - 1 ? "_" : rustStr(l)} => ${variantPath(comp, def, l)}`).join(", "));
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
    type Err = ferrovue::ParseUnionError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
${arms((l, v) => `            ${rustStr(l)} => Ok(${name}::${v}),`)}
            _ => Err(ferrovue::ParseUnionError::new(${rustStr(name)}, s, &[${def.literals.map(rustStr).join(", ")}])),
        }
    }
}

impl TryFrom<&str> for ${name} {
    type Error = ferrovue::ParseUnionError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        s.parse()
    }
}
`;
}

/** The enums generated for the module `module`, refusing one named as another of its items in `taken`. */
export function enumsSource(module: string, taken: Iterable<string>): string {
  const defs = [...(ctx.enums.get(module)?.values() ?? [])];
  const names = new Set(taken);
  for (const def of defs) {
    if (names.has(def.name)) fail(def.home, "FV0325", `this union is the Rust enum \`${def.name}\`, and the module it is written to has another type of that name: name the union with a \`type\` alias of its own`, def.node);
  }
  return defs.map(enumSource).join("\n");
}

/** Whether the module `module` holds generated enums. */
export function hasEnums(module: string): boolean {
  return (ctx.enums.get(module)?.size ?? 0) > 0;
}
