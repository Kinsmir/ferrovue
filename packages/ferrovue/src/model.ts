/* The compiler's model: the types it gives values, the shapes of components and scopes, and the errors it raises. (Not `types.ts`, which is the public `ferrovue/types` module.) */

import type { SourceMapConsumer } from "source-map-js";

// Babel's AST, read structurally: every access below checks `type` before it trusts a field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

export type Ty =
  | { k: "str" }
  | { k: "int" }
  /** `Float` from `ferrovue/types`, or a fractional literal: an `f64`, a JavaScript number. */
  | { k: "float" }
  | { k: "bool" }
  | { k: "undef" }
  | { k: "opt"; of: Ty }
  | { k: "list"; of: Ty }
  /** `Record<string, T>`: an object used as a dictionary, `ferrovue::Record` in Rust, its keys in
   * JavaScript's order. */
  | { k: "record"; of: Ty }
  /** `store` marks a Pinia store's state, or a type inside it, declared in a store's own file;
   * `home` a type declared elsewhere: `"types"` for a shared `.ts` file, or the component whose
   * `.vue` file declares it. */
  | { k: "struct"; name: string; store?: true; home?: string }
  /** `TrustedHtml` from `ferrovue/types`: the configured Rust type, which `v-html` writes raw. */
  | { k: "html" }
  /** Another component's `Props`, imported from its `.vue` file: what `v-bind` hands that child. */
  | { k: "child"; name: string }
  /** `useRoute()` or `$route`: the reader's location, as vue-router resolved it. */
  | { k: "route" }
  /** `route.params`. */
  | { k: "params" }
  /** `route.query`, and one of its values: a string, \`null\`, an array of those, or absent. */
  | { k: "queryobj" }
  | { k: "query" };

export interface Field {
  js: string;
  rust: string;
  ty: Ty;
  /** For an optional prop: the Rust value Vue uses when it is absent — its declared default, or
   * `false` for a boolean, which Vue casts. Reading the prop reads this in place of `None`. */
  dflt?: string;
}

export interface Struct {
  name: string;
  fields: Field[];
  /** The props a scoped slot's outlet passes: fields that borrow from the render, read as they are. */
  slot?: true;
}

/** A translated expression: Rust source, and the type it evaluates to. `konst` is a boolean known
 * at generation time, which is how `Array.isArray` on a value that is never an array folds away. */
export interface Val {
  code: string;
  ty: Ty;
  konst?: boolean;
  /** For an integer computed from others: the same computation on doubles, before it is rounded
   * back to an \`i64\` — which keeps JavaScript's \`-0\`, so a division by it is \`-Infinity\`. */
  f64?: string;
  /** For a list a template computes — `filter`, `map`, `split`, `Object.keys` — an iterator of its
   * items, each a `Cow<str>`, a copied number or boolean, or a borrowed object. `code` is then those
   * items collected into a `Vec`. */
  iter?: string;
  /** For a string, or a list of strings: it may hold half of a surrogate pair, which JavaScript
   * keeps and ferrovue writes as U+FFFD — so two such values are never compared or joined. */
  lone?: boolean;
  /** For an optional string a temporary owns: that `Option<Cow<str>>`, whose `.as_deref()` is
   * `code`. A setup `let` keeps this. */
  held?: string;
  /** A number known at generation time: a literal, or literals JavaScript computed. */
  num?: number;
  /** For a string built by `format!`: its format string and arguments, which a string built from it
   * joins rather than formatting it again. */
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

/** Types the generated code names, which an interface of the same name would shadow. */
export const RUST_PRELUDE = new Set(["Option", "Some", "None", "Vec", "String", "Box", "Result", "Ok", "Err", "Cow", "Slots", "Default"]);

export function snake(js: string): string {
  const s = js.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "");
  return RUST_KEYWORDS.has(s) ? `r#${s}` : s;
}

/** `camelize` in `@vue/shared`: how Vue matches an attribute a parent passes to a declared prop. */
export function camelize(key: string): string {
  return key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

/** Whether a component declares the prop a parent passes as `key`, as `setFullProps` decides. */
export function declares(comp: Component, key: string): boolean {
  const camel = camelize(key);
  return comp.props.fields.some((f) => camelize(f.js) === camel);
}

/** Whether a component may be passed attributes beyond its props, and so takes `fv::Attrs`. */
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

/** One character as a Rust `char` literal. */
export function rustChar(ch: string): string {
  if (ch === "'") return "'\\''";
  if (ch === '"') return `'"'`;
  return `'${rustStr(ch).slice(1, -1)}'`;
}

export class GenError extends Error {}

export interface Component {
  /** `TagEditor` */
  name: string;
  /** `tag_editor` */
  module: string;
  file: string;
  /** The file's text, which an error quotes. */
  source?: string;
  /** Vue's compiled template mapped back to the template, and where the template's content starts
   * in the file, for an error found in the compiled code. */
  templateMap?: SourceMapConsumer;
  templateStart?: { line: number; column: number };
  /** A root `<Transition>` or `<KeepAlive>` around anything but one plain element — a `v-if`, a
   * `<template>` — whose content Vue's server gives no attributes and its client does. */
  attrsDropped?: N;
  props: Struct;
  structs: Map<string, Struct>;
  /** The local name `TrustedHtml` was imported under from `ferrovue/types`, if it was. */
  trustedName: string | null;
  /** The local name `Float` was imported under from `ferrovue/types`, if it was. */
  floatName: string | null;
  /** Types imported as another component's `Props`: local name → that component's name. */
  childProps: Map<string, string>;
  /** The components it imports, by name. */
  imports: Set<string>;
  /** The slots its template renders with `<slot>`, by name, in order of first appearance. */
  slotNames: string[];
  /** Whether its template holds `<RouterView>`: the page, which the server supplies. */
  routerView: boolean;
  /** Whether its template holds `<RouterLink>`. */
  routerLink: boolean;
  /** Whether it reads the route itself: `useRoute()`, or `$route` in the template. */
  readsRoute: boolean;
  /** Whether it renders a `<RouterLink>` or reads the route, itself or through a child, and so
   * takes the route. */
  usesRoute: boolean;
  /** Whether its setup reads a store. */
  readsStores: boolean;
  /** Whether it reads a store, itself or through a child, and so takes the stores' state. */
  usesStores: boolean;
  /** Whether it translates — \`$t\`, or \`useI18n()\` in setup — and whether it or a child does, and
   * so takes the request's \`I18n\`. */
  readsI18n: boolean;
  usesI18n: boolean;
  /** Whether it renders a \`<Teleport>\`, and whether it or a child does, and so takes the page's
   * \`Teleports\`. */
  readsTeleports: boolean;
  usesTeleports: boolean;
  /** `defineModel` bindings: local name → the prop it reads. */
  models: Map<string, string>;
  /** Type aliases it declares: name → the type. */
  aliases: Map<string, N>;
  /** Types it imports from elsewhere: local name → the type, marked with where it lives. */
  importedTypes: Map<string, Ty>;
  /** Its scoped slots, by name: the props each one's outlets pass, known once its render is
   * generated, which is why a child is generated before its parents. */
  slotShapes: Map<string, Struct>;
  /** `data-v-…`, the id its `<style scoped>` gives its elements, or `null` without one. */
  scopeId: string | null;
  /** Whether its scoped styles use `:slotted()`, so that its outlets pass a slot scope id. */
  slotted: boolean;
  /** `inheritAttrs` from `defineOptions`: `false` drops what a parent passes on to its root. */
  inheritAttrs: boolean;
  /** Whether a parent may hand its root scope ids — its own, those passed on to it, or a slot's —
   * which it then takes as `fv_attrs`. Known once every component is read (`scopeFlow`). */
  inherits: boolean;
  /** Whether its outlets may pass slot content a slot scope id, which the content then takes as
   * `fv_sid`. Known once every component is read, as `inherits` is. */
  passesSlotIds: boolean;
  /** The attributes a parent may pass it beyond its props, by name: what falls through to its root,
   * or to the element that binds `$attrs`. With any, its `render_scoped` takes them as
   * `fv::Attrs`. Known once every component is read (`attrsFlow`). */
  attrNames: Set<string>;
  /** Whether its `$attrs` may hold scope ids: it is the root of a component that may be handed
   * some, which passes them on as attributes. */
  idsInAttrs: boolean;
}

export interface Scope {
  comp: Component;
  components: Map<string, Component>;
  /** Setup bindings the server can evaluate: `ref(...)` and `computed(() => ...)`. */
  setup: Map<string, Val>;
  /** Imported child components, by local name. */
  children: Map<string, string>;
  /** Imported helpers, by local name → helper name. */
  helpers: Map<string, string>;
  /** Loop variables in scope. */
  locals: Map<string, Val>;
  /** The identifier `defineProps` was assigned to in the script, if any. */
  propsIdent: string | null;
  /** Setup bindings that are refs — `ref`, `computed`, `storeToRefs`, `defineModel` — which code in
   * the script reads through `.value`, and the template unwrapped. */
  refs: Set<string>;
  /** Setup bindings the server does not evaluate, and why. The template may name one only from an
   * event handler, which the server drops. */
  clientOnly: Map<string, string>;
  /** Optional values a surrounding `v-if` has found present, by the JavaScript path that named them
   * — what TypeScript narrows, and what the generated `if let` bound. */
  narrowed: Map<string, Val>;
  /** The name the compiled template resolved this component itself under, when it uses itself. */
  selfAlias: { name: string | null };
  /** What the helper calls translated so far can write, shared by every copy of the scope. */
  helperBytes: { n: number };
  /** The names the compiled template resolved `RouterLink` and `RouterView` under. */
  router: Map<string, "RouterLink" | "RouterView">;
  /** Directives the compiled template resolved by name: local → the directive's name. */
  directives: Map<string, string>;
  /** Setup bindings that are vue-i18n's \`t\`, from \`const { t } = useI18n()\`. */
  i18nT: Set<string>;
  /** Inside slot content whose emptiness is decided at run time: each push that is not a comment
   * sets the closure's `filled`, which is how Vue tells content from nothing (`ssrRenderSlot`). */
  fill: boolean;
  /** Inside a `<RouterLink>`'s slot, which Vue renders from virtual nodes rather than pushes: an
   * untaken `v-if` is `<!--v-if-->` there, not `<!---->`. */
  vnode: boolean;
  /** The Rust value of `_attrs`, the scope ids this render's root inherits, as `ssrRenderAttrs`
   * writes them; `null` when the component inherits none. */
  attrs: string | null;
  /** The Rust `fv::Attrs` a parent passes this render beyond its props — `$attrs`, and what
   * `_attrs` holds before the scope ids — or `null` when no parent passes any. */
  fallthrough: string | null;
  /** Setup bindings holding `useAttrs()`, which the template may bind as `$attrs`. */
  attrsBindings: Set<string>;
  /** The Rust value of `_scopeId` inside slot content: the slot scope id the content is given, or
   * `null` where it is always empty. */
  sid: string | null;
  /** Inside a `v-for` over a list of the props: the Rust name of its item, and the list. */
  loop?: { item: string; over: string };
}

/** Where a node came from, which decides how its position is read: `source` for an AST parsed
 * from the file itself (a script block, a store, a type file), whose positions are the file's;
 * `template` for Vue's compiled template, whose positions map back through its source map. */
export type Origin = "source" | "template";

/** Mark every node of an AST with where it came from, so that an error can point into the file. */
export function tagAst(node: N, origin: Origin, seen: WeakSet<object> = new WeakSet()): void {
  // `compileScript` links some nodes back to others, so the tree may hold cycles.
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

/** A node's position in the component's own file — line from 1, column from 0 — or `null`. */
function locate(comp: Component, node: N): { line: number; column: number } | null {
  const start = node?.loc?.start;
  if (!start) return null;
  if (node.__fv === "source") return { line: start.line, column: start.column };
  if (node.__fv === "template" && comp.templateMap && comp.templateStart) {
    const o = comp.templateMap.originalPositionFor({ line: start.line, column: start.column });
    if (o.line == null || o.column == null) return null;
    // The template's content starts partway along the `<template>` line.
    const t = comp.templateStart;
    return o.line === 1 ? { line: t.line, column: t.column - 1 + o.column } : { line: t.line + o.line - 1, column: o.column };
  }
  return null;
}

/** The source line, with a caret under the column, as rustc shows it. */
function snippet(comp: Component, at: { line: number; column: number }): string {
  const text = comp.source?.split("\n")[at.line - 1];
  if (text === undefined) return "";
  const n = String(at.line);
  // Tabs are kept, so the caret lines up whatever the tab width.
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
