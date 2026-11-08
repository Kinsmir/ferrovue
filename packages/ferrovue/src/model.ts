import type { SourceMapConsumer } from "source-map-js";
import type { Plugin } from "./plugin.ts";
import type { Const } from "./const-decls.ts";
import type { GenError } from "./errors.ts";
import type { EnumDef } from "./literal-types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

export type Ty =
  | { k: "str" }
  | { k: "int" }
  | { k: "float" }
  | { k: "bool" }
  | { k: "undef" }
  | { k: "null" }
  | { k: "opt"; of: Ty; none?: "null" | "either" }
  | { k: "list"; of: Ty }
  | { k: "record"; of: Ty }
  | { k: "entry"; of: Ty }
  | StructTy
  | { k: "html"; inline?: true }
  | { k: "child"; name: string }
  | { k: "step" }
  | PluginTys[keyof PluginTys];

export interface StructTy {
  k: "struct";
  name: string;
  home?: string;
}

export interface PluginTys {}

export interface Field {
  js: string;
  rust: string;
  ty: Ty;
  dflt?: string;
}

export interface Struct {
  name: string;
  fields: Field[];
  slot?: true;
  refused?: Map<string, GenError>;
}

/** Whether \`st\` is a tuple's struct: its fields are named after the parts' indices, which no
 * interface's field can be, and Rust holds it as a tuple struct that serde writes as an array. */
export function isTuple(st: Struct): boolean {
  return st.fields.length > 0 && st.fields.every((f, i) => f.js === String(i));
}

/** A piece of a joined string: literal text, a value, or a Rust expression whose `Display` writes
 * text that needs no escaping and is never empty. */
export type Piece = string | Val | { shown: string };

export interface Val {
  code: string;
  ty: Ty;
  konst?: boolean;
  f64?: string;
  iter?: string;
  lone?: boolean;
  held?: string;
  slice?: boolean;
  num?: number;
  pick?: true;
  /** For a string `format!` builds, its format string and arguments, and the same value as the
   * pieces it joins. */
  format?: { text: string; args: string[]; pieces: Piece[] };
  /** For a string `?:` chooses where a branch is a join: the test the Rust `if` takes and the
   * value of each branch, while `code` is `of`. */
  branches?: { of: string; test: string; yes: Val; no: Val };
  owned?: true;
  /** For a value of a generated enum, the Rust expression of the enum (an `Option` of it when the
   * value is optional), where `code` is its string. */
  variant?: string;
  /** For a list of a generated enum's values, or an optional one, the Rust place of the list of
   * enums, where `code` and `iter` hold its strings. */
  enums?: { place: string; def: EnumDef };
  /** For a list a `.map()` computes, whose items are values of the generated enum `def`: an
   * iterator over the enums, while `code` is `of`. */
  variants?: { of: string; iter: string; def: EnumDef };
  /** For an array literal, the values of its items, while `code` is `of`. */
  literal?: { of: string; items: Val[] };
  /** For a string value made of literals the compiler knows, as a lookup table's arms: the Rust
   * expression of the same value as the generated enum `def`, null when a literal is outside it.
   * It holds while `code` is `of`. `home` is a generated enum whose members hold every literal the
   * value may be, and `over` gives one `match` over the variants it is made from, each arm the code
   * `arm` gives the literal the value is there. */
  asEnum?: { of: string; into: (def: EnumDef, node: N) => string | null; home?: EnumDef; over?: (arm: (literal: string) => string | null) => string | null };
  /** For a value of a generated enum held by `of`, where a `v-if` narrows it to the members
   * `kept`: binds in the test, for each member, the Rust code `arm` gives it, and gives the name
   * the code is bound to. */
  bound?: { of: string; kept: readonly string[]; bind: (arm: (literal: string) => string) => string };
  /** For an integer computed as an `f64`, where the template computes it, as `fv::render::Refusals::keep`
   * takes it. */
  at?: string;
  /** For the string of a number, as `String(n)` writes it, the number, while `code` is `of`. */
  numeral?: { of: string; number: Val };
  /** For a string known to hold no character HTML escapes, as the digits `.toFixed()` writes, the
   * Rust expression it holds while `code` is it. */
  plain?: string;
  /** For the string `.join()` builds, its items as an iterator of strings, integers or numbers
   * and its separator, while `code` is `of`. */
  joined?: { of: string; items: string; sep: string; each: "str" | "int" | "float" };
  /** For an integer computed as an `i64`, a bound on its magnitude, at most 2⁵³, within which
   * `i64` and `f64` arithmetic give the same value. */
  upTo?: number;
}

/** The string `items.join(sep)` builds, whose items are strings, or integers or numbers written as
 * JavaScript writes them. */
export function joinedVal(items: string, each: "str" | "int" | "float", sep: string, ty: Ty, lone: boolean): Val {
  const code = `&*${items}${each === "str" ? "" : ".map(|v| fv::core::Js(v).to_string())"}.collect::<Vec<_>>().join(${sep})`;
  return { code, ty, joined: { of: code, items, sep, each }, ...(lone ? { lone: true } : {}) };
}

export const STR: Ty = { k: "str" };

export const INT: Ty = { k: "int" };
export const FLOAT: Ty = { k: "float" };

export const BOOL: Ty = { k: "bool" };

export const UNDEF: Ty = { k: "undef" };

export const NULL: Ty = { k: "null" };

/** What the statements of a loop's body give: Rust statements that end the item. */
export const STEP: Ty = { k: "step" };

export type Absence = "undefined" | "null" | "either";

export const opt = (of: Ty): Ty => (of.k !== "opt" ? { k: "opt", of } : of.none === undefined ? of : { k: "opt", of: of.of, none: "either" });

export function absence(ty: Ty): Absence | null {
  if (ty.k === "undef") return "undefined";
  if (ty.k === "null") return "null";
  if (ty.k === "opt") return ty.none ?? "undefined";
  return null;
}

export function joinAbsence(a: Absence | null, b: Absence | null): Absence | null {
  if (a === null || a === b) return b;
  if (b === null) return a;
  return "either";
}

export function withAbsence(of: Ty, none: Absence | null): Ty {
  if (none === null) return of;
  return none === "undefined" ? { k: "opt", of } : { k: "opt", of, none };
}

export function nothing(ty: Ty): boolean {
  return ty.k === "undef" || ty.k === "null";
}

export function camelize(key: string): string {
  return key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

export function namesSelf(comp: Component, tag: string): boolean {
  const camel = camelize(tag);
  return camel.charAt(0).toUpperCase() + camel.slice(1) === comp.name;
}

export function declares(comp: Component, key: string): boolean {
  const camel = camelize(key);
  return comp.props.fields.some((f) => camelize(f.js) === camel);
}

export function takesAttrs(comp: Component): boolean {
  return comp.attrNames.size > 0;
}

export interface Component {
  name: string;
  module: string;
  file: string;
  source?: string;
  templateMap?: SourceMapConsumer;
  templateStart?: { line: number; column: number };
  templateAst?: N;
  attrsDropped?: N;
  propsAt?: N;
  cssVarsAt?: N[];
  props: Struct;
  structs: Map<string, Struct>;
  typeDecls: Map<string, { members: N[]; node: N }>;
  reached: Set<string>;
  trustedName: string | null;
  inlineName: string | null;
  floatName: string | null;
  childProps: Map<string, string>;
  imports: Set<string>;
  slotNames: string[];
  takes: Set<string>;
  models: Map<string, string>;
  aliases: Map<string, N>;
  importedTypes: Map<string, Ty>;
  /** The specifier of each type imported from a `.vue` file, by the file's name and the type's name. */
  vueTypeImports: Map<string, N>;
  /** Names imported from a module that resolves to no `.ts` file of the project, with its specifier. */
  unresolved: Map<string, string>;
  slotShapes: Map<string, Struct>;
  inheritAttrs: boolean;
  inherits: boolean;
  passesSlotIds: boolean;
  attrNames: Set<string>;
  /** Names like a listener's (`on1`, `onSale`) the component may be passed beyond its props, which
   * its attributes hold; `""` stands for a name not known when compiling. */
  listenerAttrs: Set<string>;
  idsInAttrs: boolean;
  /** A `<textarea>`, or an `<input>` with `v-model`, at the root, which reads `value` and `type`
   * from the attributes passed to the component. */
  rootControl?: { node: N; tag: string };
}

export function blankComponent(name: string, module: string, file: string, structs: Map<string, Struct> = new Map()): Component {
  return {
    name,
    module,
    file,
    props: { name: "Props", fields: [] },
    structs,
    typeDecls: new Map(),
    reached: new Set(),
    trustedName: null,
    inlineName: null,
    floatName: null,
    childProps: new Map(),
    imports: new Set(),
    slotNames: [],
    takes: new Set(),
    models: new Map(),
    aliases: new Map(),
    importedTypes: new Map(),
    vueTypeImports: new Map(),
    unresolved: new Map(),
    slotShapes: new Map(),
    inheritAttrs: true,
    inherits: false,
    passesSlotIds: false,
    attrNames: new Set(),
    listenerAttrs: new Set(),
    idsInAttrs: false,
  };
}

/** A function the server may call: declared in `<script setup>`, or exported from a `.ts` file
 * (`file`), whose body is translated where it is called. */
export interface Fn {
  name: string;
  node: N;
  home: Component;
  file: string | null;
  /** For a function `const` declares in `<script setup>`, where its declaration ends: setup code
   * before it that calls it throws a `ReferenceError`. */
  tdzUntil?: number;
  /** For a function a body declares (`const f = (…) => …`), the scope it was declared in, whose
   * names it reads. */
  captured?: Scope;
}

export interface Scope {
  comp: Component;
  components: Map<string, Component>;
  setup: Map<string, Val>;
  children: Map<string, string>;
  loadedLater: Set<string>;
  helpers: Map<string, string>;
  locals: Map<string, Val>;
  propsIdent: string | null;
  refs: Set<string>;
  clientOnly: Map<string, string>;
  imported: Map<string, string>;
  refusedBy: Map<string, GenError>;
  narrowed: Map<string, Val>;
  selfAliases: Set<string>;
  temps: Set<string>;
  helperBytes: { n: number };
  directives: Map<string, string>;
  fill: boolean;
  vnode: boolean;
  attrs: string | null;
  fallthrough: string | null;
  attrsBindings: Set<string>;
  slotsBindings: Set<string>;
  consts: Map<string, Const>;
  functions: Map<string, Fn>;
  /** Where the setup statement being evaluated starts, while setup runs it (not in a `computed`,
   * which runs when the render reads it). */
  settingUpAt?: number | undefined;
  /** What the code being translated is part of, as a message names it: the template when absent. */
  within?: "computed" | "function" | "setup" | undefined;
  sid: string | null;
  opaque: string | null;
  loop?: { item: string; over: string } | undefined;
  /** The type each `let` a body assigns again was declared with, by its name in the body. */
  lets?: Map<string, { ty: Ty; node?: N; js: string }> | undefined;
  /** The `for` loop whose body is being translated, which its `break`, `continue` and `return` end. */
  frame?: LoopFrame | undefined;
  plugins: Map<Plugin, unknown>;
  mapping?: true | undefined;
  typesFrom?: Component;
}

/** What a `let` a loop carries from one item to the next holds, or what its `return`s give: a
 * string, a number or a boolean, which may be absent. */
export interface Cell {
  kind: "str" | "num" | "bool";
  none: Absence | null;
  int: boolean;
  ascii: boolean;
  lone: boolean;
}

/** A `let` a loop carries: its Rust variable, how the body reads it, and where its ends assign it. */
export interface LoopState {
  name: string;
  rust: string;
  cell: Cell;
  read: Val;
  liveBreak: boolean;
  assigned: number;
}

/** A loop being translated: the `let`s it carries, and what its body's ends found, which may have
 * it translated again. */
export interface LoopFrame {
  states: LoopState[];
  slot: Cell | null;
  slotName: string;
  retry: boolean;
  nexts: number;
  once: boolean;
}
