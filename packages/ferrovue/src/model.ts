import { parse as parseJs } from "@babel/parser";
import type { SourceMapConsumer } from "source-map-js";
import type { Plugin } from "./plugin.ts";
import type { Const } from "./constants.ts";
import { type ErrorCode, GenError, type SourceLocation } from "./errors.ts";

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
  /** For an integer computed as an `i64`, a bound on its magnitude, at most 2⁵³, within which
   * `i64` and `f64` arithmetic give the same value. */
  upTo?: number;
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

export const RUST_KEYWORDS = new Set(
  "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn abstract become box do final macro override priv typeof unsized virtual yield try".split(
    " ",
  ),
);

const NOT_RAW = new Set(["self", "Self", "super", "crate"]);

export const RUST_PRELUDE = new Set(["Option", "Some", "None", "Vec", "String", "Box", "Result", "Ok", "Err", "Cow", "Slots", "Default"]);

/** `hint` in snake case, letters and digits joined by `_`, or `value` when it has none. */
export function snakeWords(hint: string): string {
  const words = hint
    .replace(/^r#/, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return words || "value";
}

export function snake(js: string): string {
  const s = js.includes("$") ? snakeWords(js) : js.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "");
  if (NOT_RAW.has(s)) return `${s}_`;
  return RUST_KEYWORDS.has(s) ? `r#${s}` : s;
}

/** The Rust name of each of `names`, JavaScript names that share a namespace, by `rustOf`: a name
 * holding `$` takes `_2`, `_3`, … after a Rust name another of them holds. */
export function dollarNames(names: Iterable<string>, rustOf: (js: string) => string = snake): Map<string, string> {
  const all = [...new Set(names)];
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const js of all.filter((n) => !n.includes("$"))) {
    out.set(js, rustOf(js));
    taken.add(rustOf(js).replace(/^r#/, ""));
  }
  for (const js of all.filter((n) => n.includes("$"))) {
    const first = rustOf(js);
    const bare = first.replace(/^r#/, "");
    let name = first;
    for (let i = 2; taken.has(name.replace(/^r#/, "")); i++) name = `${bare}_${i}`;
    taken.add(name.replace(/^r#/, ""));
    out.set(js, name);
  }
  return out;
}

/** `fields`, with each field whose JavaScript name holds `$` given a Rust name no other field holds. */
export function distinctFields<F extends Field>(fields: F[]): F[] {
  if (!fields.some((f) => f.js.includes("$"))) return fields;
  const held = new Map(fields.map((f) => [f.js, f.rust]));
  const names = dollarNames(held.keys(), (js) => (js.includes("$") ? snake(js) : held.get(js)!));
  return fields.map((f) => (f.js.includes("$") ? { ...f, rust: names.get(f.js)! } : f));
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

export function rustStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) out += `\\u{${c.toString(16)}}`;
    else out += ch;
  }
  return out + '"';
}

export function rustChar(ch: string): string {
  if (ch === "'") return "'\\''";
  if (ch === '"') return `'"'`;
  return `'${rustStr(ch).slice(1, -1)}'`;
}

const NODE_NAMES: Record<string, string> = {
  ArrayExpression: "an array literal",
  ArrowFunctionExpression: "an arrow function",
  AssignmentExpression: "an assignment",
  AwaitExpression: "`await`",
  BigIntLiteral: "a `bigint` literal",
  BinaryExpression: "an operator",
  BlockStatement: "a block",
  BreakStatement: "`break`",
  CallExpression: "a call",
  ClassDeclaration: "a class",
  ClassExpression: "a class",
  ConditionalExpression: "a conditional `? :`",
  ContinueStatement: "`continue`",
  DebuggerStatement: "`debugger`",
  DoWhileStatement: "a `do … while` loop",
  EmptyStatement: "an empty statement",
  ExportAllDeclaration: "`export *`",
  ExportDefaultDeclaration: "a default export",
  ExportNamedDeclaration: "an export",
  ExpressionStatement: "an expression statement",
  ForInStatement: "a `for … in` loop",
  ForOfStatement: "a `for … of` loop",
  ForStatement: "a `for` loop",
  FunctionDeclaration: "a function",
  FunctionExpression: "a function",
  Identifier: "a name",
  IfStatement: "an `if` statement",
  Import: "`import()`",
  ImportExpression: "`import()`",
  LabeledStatement: "a labelled statement",
  LogicalExpression: "a logical operator",
  MemberExpression: "a member access",
  MetaProperty: "`import.meta`",
  NewExpression: "`new`",
  ObjectExpression: "an object literal",
  OptionalCallExpression: "an optional call `?.()`",
  OptionalMemberExpression: "an optional member access `?.`",
  RegExpLiteral: "a regular expression",
  ReturnStatement: "`return`",
  SequenceExpression: "a comma expression",
  SpreadElement: "a spread `...`",
  Super: "`super`",
  SwitchStatement: "a `switch` statement",
  TaggedTemplateExpression: "a tagged template",
  TemplateLiteral: "a template literal",
  ThisExpression: "`this`",
  ThrowStatement: "`throw`",
  TryStatement: "a `try` statement",
  TSAnyKeyword: "`any`",
  TSArrayType: "an array type",
  TSBigIntKeyword: "`bigint`",
  TSConditionalType: "a conditional type",
  TSConstructorType: "a constructor type",
  TSDeclareFunction: "a function declared without a body",
  TSEnumDeclaration: "an enum",
  TSExportAssignment: "`export =`",
  TSFunctionType: "a function type",
  TSImportEqualsDeclaration: "`import … = require(…)`",
  TSImportType: "an `import()` type",
  TSIndexedAccessType: "an indexed access type",
  TSInferType: "an `infer` type",
  TSInstantiationExpression: "an instantiation expression",
  TSIntersectionType: "an intersection type",
  TSIntrinsicKeyword: "an intrinsic type",
  TSMappedType: "a mapped type",
  TSModuleDeclaration: "a namespace",
  TSNeverKeyword: "`never`",
  TSNonNullExpression: "a non-null assertion `!`",
  TSObjectKeyword: "`object`",
  TSSymbolKeyword: "`symbol`",
  TSTemplateLiteralType: "a template literal type",
  TSThisType: "the `this` type",
  TSTupleType: "a tuple type",
  TSTypeOperator: "a type operator (`keyof`, `readonly`, `unique`)",
  TSTypePredicate: "a type predicate",
  TSTypeQuery: "a `typeof` type",
  TSBooleanKeyword: "`boolean`",
  TSNullKeyword: "`null`",
  TSNumberKeyword: "`number`",
  TSStringKeyword: "`string`",
  TSUndefinedKeyword: "`undefined`",
  TSUnknownKeyword: "`unknown`",
  TSVoidKeyword: "`void`",
  UnaryExpression: "a unary operator",
  UpdateExpression: "`++` or `--`",
  VariableDeclaration: "a variable declaration",
  WhileStatement: "a `while` loop",
  WithStatement: "`with`",
  YieldExpression: "`yield`",
};

/** A plain name for the kind of a syntax node, as a message names it: "an arrow function", "a tuple
 * type". */
export function nodeName(node: N): string {
  const type: string = node?.type ?? "";
  const named = NODE_NAMES[type];
  if (named !== undefined) return named;
  const words = type.replace(/^TS/, "").replace(/Keyword$/, "").split(/(?=[A-Z])/).join(" ").toLowerCase();
  if (!words) return "a construct";
  return `${/^[aeiou]/.test(words) ? "an" : "a"} ${words}`;
}

/** The names a binding pattern declares, in the order they appear. */
export function patternNames(p: N): string[] {
  switch (p?.type) {
    case "Identifier":
      return [p.name];
    case "ObjectPattern":
      return p.properties.flatMap((q: N) => patternNames(q.type === "RestElement" ? q.argument : q.value));
    case "ArrayPattern":
      return p.elements.flatMap((q: N) => (q ? patternNames(q) : []));
    case "AssignmentPattern":
      return patternNames(p.left);
    case "RestElement":
      return patternNames(p.argument);
    default:
      return [];
  }
}

/** Refuse something in a file that has no source to quote, as a locale or routes file. */
export function failIn(file: string, code: ErrorCode, what: string, help: string | null = null): never {
  throw new GenError(code, `${file}: ${what}`, { file }, what, help);
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

export type Origin = "source" | "template";

export function tagAst(node: N, origin: Origin, seen: WeakSet<object> = new WeakSet()): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) tagAst(n, origin, seen);
    return;
  }
  if (typeof node.type === "string") node.__fv = origin;
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "__fv") continue;
    const v = node[key];
    if (v && typeof v === "object") tagAst(v, origin, seen);
  }
}

/** Vue's compiled template, parsed and tagged, with `$props['x']`, which Vue writes for a renamed
 * destructured prop, read as `$props.x`. */
export function templateAst(ssr: string): N {
  const program = parseJs(ssr, { sourceType: "module" }).program;
  tagAst(program, "template");
  propsByName(program);
  return program;
}

function propsByName(node: N): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) propsByName(n);
    return;
  }
  const { object, property } = node.type === "MemberExpression" && node.computed ? node : {};
  if (object?.type === "Identifier" && object.name === "$props" && property.type === "StringLiteral") {
    node.computed = false;
    node.property = { type: "Identifier", name: property.value, start: property.start, end: property.end, loc: property.loc, __fv: property.__fv };
  }
  for (const key of Object.keys(node)) if (key !== "loc") propsByName(node[key]);
}

function locate(comp: Component, node: N): { line: number; column: number } | null {
  const start = node?.loc?.start;
  if (!start) return null;
  if (node.__fv === "source") return { line: start.line, column: start.column };
  if (node.__fv === "template" && comp.templateMap && comp.templateStart) {
    const o = comp.templateMap.originalPositionFor({ line: start.line, column: start.column });
    if (o.line == null || o.column == null) return locateWithin(comp, node) ?? locate(comp, written(comp, node));
    const t = comp.templateStart;
    return o.line === 1 ? { line: t.line, column: t.column - 1 + o.column } : { line: t.line + o.line - 1, column: o.column };
  }
  return null;
}

/** The local of a render that holds its refusals, a `fv::render::Refusals`. */
export const REFUSALS = "fv_refusals";

/** Where `node` starts in the component's file, as `fv::render::Refusals::keep` takes it: `line, column`,
 * from 1, or `0, 0` where it is not known. */
export function refusalAt(comp: Component, node: N | undefined): string {
  const at = node ? locate(comp, node) : null;
  return at ? `${at.line}, ${at.column + 1}` : "0, 0";
}

/** `call`, a runtime call that returns a `Result` with a `fv::render::Refused`, as a value: the render
 * holds the refusal and goes on with a placeholder, and returns it once it is done. */
export function kept(call: string, at: string): string {
  return `${REFUSALS}.keep(${call}, ${at})`;
}

function locateWithin(comp: Component, node: N): { line: number; column: number } | null {
  const start = node.loc.start;
  const inner = Object.entries(node)
    .filter(([k, v]) => k !== "loc" && v && typeof v === "object")
    .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
    .filter((c: N) => c?.loc?.start)
    .toSorted((a: N, b: N) => a.start - b.start);
  for (const child of inner) {
    const at = locate(comp, child);
    if (!at) continue;
    const c = child.loc.start;
    const back = c.line === start.line ? c.column - start.column : 0;
    return { line: at.line, column: Math.max(0, at.column - back) };
  }
  return null;
}

export function sourceAt(source: string, offset: number): N {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  return { type: "VueSource", loc: { start: { line, column: offset - before.lastIndexOf("\n") - 1 } }, __fv: "source" };
}

const plain = (name: string): string => name.replace(/[-_]/g, "").toLowerCase();

function assetName(n: N, prefix: RegExp): string | null {
  if (n?.type === "Identifier") return n.name.replace(prefix, "");
  if (n?.type === "MemberExpression") return n.computed ? n.property.value : n.property.name;
  return null;
}

function written(comp: Component, node: N): N {
  const call = node.type === "VariableDeclaration" ? node.declarations[0]?.init : node.type === "ExpressionStatement" ? node.expression : node;
  const callee = call?.type === "CallExpression" && call.callee.type === "Identifier" ? (call.callee.name as string) : null;
  const tagged = (name: string | null): N => name && templateNode(comp, (el) => (plain(el.tag) === plain(name) ? el : null));
  const directive = (name: string | null): N => name && templateNode(comp, (el) => el.props.find((p: N) => p.type === 7 && plain(p.name) === plain(name)));
  switch (callee) {
    case "_ssrRenderComponent": {
      const name = assetName(call.arguments[0], /^_component_/);
      return tagged(name) ?? (name === null ? null : isAttribute(comp, (value) => value.startsWith("vue:") && plain(value.slice(4)) === plain(name), true));
    }
    case "_resolveComponent":
      return tagged(call.arguments[0]?.value ?? null);
    case "_resolveDirective":
      return directive(call.arguments[0]?.value ?? null);
    case "_ssrGetDirectiveProps":
      return directive(assetName(call.arguments[1], /^_directive_/)?.replace(/^v(?=[A-Z])/, "") ?? null);
    case "_ssrRenderSlot": {
      const name = call.arguments[1]?.value;
      return templateNode(comp, (el) => (el.tag === "slot" && (el.props.find((p: N) => p.type === 6 && p.name === "name")?.value?.content ?? "default") === name ? el : null));
    }
    default:
      return null;
  }
}

function covering(comp: Component, node: N): ((loc: N) => boolean) | null {
  const at = locate(comp, node);
  if (!at) return null;
  const pos = [at.line, at.column + 1];
  const before = (a: number[], b: number[]): boolean => a[0]! < b[0]! || (a[0] === b[0] && a[1]! <= b[1]!);
  return (loc: N): boolean => before([loc.start.line, loc.start.column], pos) && before(pos, [loc.end.line, loc.end.column]);
}

/** The element of the template whose `v-html` compiled to `node`, with the nodes around it, the nearest first. */
export function vHtmlElement(comp: Component, node: N): { el: N; around: N[] } | null {
  const within = covering(comp, node);
  if (!within || !comp.templateAst) return null;
  const visit = (n: N, around: N[]): { el: N; around: N[] } | null => {
    if (n.type === 1 && n.props.some((p: N) => p.type === 7 && p.name === "html" && within(p.loc))) return { el: n, around };
    for (const c of n.children ?? []) {
      const found = visit(c, [n, ...around]);
      if (found) return found;
    }
    return null;
  };
  return visit(comp.templateAst, []);
}

/** The template element holding the directive the compiled `node` came from. */
export function directiveOwner(comp: Component, node: N): N {
  const within = covering(comp, node);
  if (!within || !comp.templateAst) return null;
  const visit = (n: N): N => {
    if (n.type === 1 && n.props.some((p: N) => p.type === 7 && within(p.loc))) return n;
    for (const c of n.children ?? []) {
      const found = visit(c);
      if (found) return found;
    }
    return null;
  };
  return visit(comp.templateAst);
}

/** Where the template's first static `is` attribute whose value `test` takes is written, or where
 * its element starts with `element`. */
export function isAttribute(comp: Component, test: (value: string) => boolean, element = false): N {
  const found = templateNode(comp, (el) => {
    const is = el.props.find((p: N) => p.type === 6 && p.name === "is" && p.value !== undefined && test(p.value.content));
    return is === undefined ? null : element ? el : is;
  });
  return found;
}

function templateNode(comp: Component, test: (el: N) => N): N {
  const visit = (n: N): N => {
    const found = n.type === 1 ? test(n) : null;
    if (found) return found;
    for (const c of n.children ?? []) {
      const inner = visit(c);
      if (inner) return inner;
    }
    return null;
  };
  const found = comp.templateAst ? visit(comp.templateAst) : null;
  return found && { type: "VueTemplate", loc: { start: { line: found.loc.start.line, column: found.loc.start.column - 1 } }, __fv: "source" };
}

function snippet(comp: Component, at: { line: number; column: number }): string {
  const text = comp.source?.split("\n")[at.line - 1];
  if (text === undefined) return "";
  const n = String(at.line);
  const lead = text.slice(0, at.column).replace(/[^\t]/g, " ");
  return `\n ${n} | ${text}\n ${" ".repeat(n.length)} | ${lead}^`;
}

function locateEnd(node: N): { endLine: number; endColumn: number } | null {
  const end = node?.__fv === "source" ? node.loc?.end : null;
  return end ? { endLine: end.line, endColumn: end.column + 1 } : null;
}

/** Where `node` is in the component. */
export function placeOf(comp: Component, node: N): SourceLocation {
  const at = locate(comp, node);
  return at ? { file: comp.file, line: at.line, column: at.column + 1 } : { file: comp.file };
}

export function fail(comp: Component, code: ErrorCode, what: string, node?: N, help: string | null = null): never {
  const at = locate(comp, node);
  if (!at) throw new GenError(code, `${comp.file}: ${what}`, { file: comp.file }, what, help);
  const where = { file: comp.file, line: at.line, column: at.column + 1, ...locateEnd(node) };
  throw new GenError(code, `${comp.file}:${at.line}:${at.column + 1}: ${what}${snippet(comp, at)}`, where, what, help);
}

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
