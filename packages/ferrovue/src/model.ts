import type { SourceMapConsumer } from "source-map-js";
import type { Plugin } from "./plugin.ts";
import type { Const } from "./constants.ts";

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
  | StructTy
  | { k: "html" }
  | { k: "child"; name: string }
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
}

export interface Val {
  code: string;
  ty: Ty;
  konst?: boolean;
  f64?: string;
  iter?: string;
  lone?: boolean;
  held?: string;
  num?: number;
  format?: { text: string; args: string[] };
}

export const STR: Ty = { k: "str" };

export const INT: Ty = { k: "int" };
export const FLOAT: Ty = { k: "float" };

export const BOOL: Ty = { k: "bool" };

export const UNDEF: Ty = { k: "undef" };

export const NULL: Ty = { k: "null" };

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

export function snake(js: string): string {
  const s = js.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "");
  if (NOT_RAW.has(s)) return `${s}_`;
  return RUST_KEYWORDS.has(s) ? `r#${s}` : s;
}

export function camelize(key: string): string {
  return key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
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
    else if (c < 0x20 || c === 0x7f) out += `\\u{${c.toString(16)}}`;
    else out += ch;
  }
  return out + '"';
}

export function rustChar(ch: string): string {
  if (ch === "'") return "'\\''";
  if (ch === '"') return `'"'`;
  return `'${rustStr(ch).slice(1, -1)}'`;
}

export class GenError extends Error {}

export interface Component {
  name: string;
  module: string;
  file: string;
  source?: string;
  templateMap?: SourceMapConsumer;
  templateStart?: { line: number; column: number };
  templateAst?: N;
  attrsDropped?: N;
  props: Struct;
  structs: Map<string, Struct>;
  trustedName: string | null;
  floatName: string | null;
  childProps: Map<string, string>;
  imports: Set<string>;
  slotNames: string[];
  takes: Set<string>;
  models: Map<string, string>;
  aliases: Map<string, N>;
  importedTypes: Map<string, Ty>;
  slotShapes: Map<string, Struct>;
  inheritAttrs: boolean;
  inherits: boolean;
  passesSlotIds: boolean;
  attrNames: Set<string>;
  idsInAttrs: boolean;
}

export function blankComponent(name: string, module: string, file: string, structs: Map<string, Struct> = new Map()): Component {
  return {
    name,
    module,
    file,
    props: { name: "Props", fields: [] },
    structs,
    trustedName: null,
    floatName: null,
    childProps: new Map(),
    imports: new Set(),
    slotNames: [],
    takes: new Set(),
    models: new Map(),
    aliases: new Map(),
    importedTypes: new Map(),
    slotShapes: new Map(),
    inheritAttrs: true,
    inherits: false,
    passesSlotIds: false,
    attrNames: new Set(),
    idsInAttrs: false,
  };
}

export interface Scope {
  comp: Component;
  components: Map<string, Component>;
  setup: Map<string, Val>;
  children: Map<string, string>;
  helpers: Map<string, string>;
  locals: Map<string, Val>;
  propsIdent: string | null;
  refs: Set<string>;
  clientOnly: Map<string, string>;
  narrowed: Map<string, Val>;
  selfAlias: { name: string | null };
  helperBytes: { n: number };
  directives: Map<string, string>;
  fill: boolean;
  vnode: boolean;
  attrs: string | null;
  fallthrough: string | null;
  attrsBindings: Set<string>;
  slotsBindings: Set<string>;
  consts: Map<string, Const>;
  sid: string | null;
  loop?: { item: string; over: string };
  plugins: Map<Plugin, unknown>;
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
    case "_ssrRenderComponent":
      return tagged(assetName(call.arguments[0], /^_component_/));
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

export function fail(comp: Component, what: string, node?: N): never {
  const at = locate(comp, node);
  if (!at) throw new GenError(`${comp.file}: ${what}`);
  throw new GenError(`${comp.file}:${at.line}:${at.column + 1}: ${what}${snippet(comp, at)}`);
}

function canonical(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function sameTy(a: Ty, b: Ty): boolean {
  return JSON.stringify(a, canonical) === JSON.stringify(b, canonical);
}
