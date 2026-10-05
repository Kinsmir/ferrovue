import type { SourceMapConsumer } from "source-map-js";
import type { Plugin } from "./plugin.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

export type Ty =
  | { k: "str" }
  | { k: "int" }
  | { k: "float" }
  | { k: "bool" }
  | { k: "undef" }
  | { k: "opt"; of: Ty }
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

export const opt = (of: Ty): Ty => (of.k === "opt" ? of : { k: "opt", of });

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
    if (o.line == null || o.column == null) return null;
    const t = comp.templateStart;
    return o.line === 1 ? { line: t.line, column: t.column - 1 + o.column } : { line: t.line + o.line - 1, column: o.column };
  }
  return null;
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

export function sameTy(a: Ty, b: Ty): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
