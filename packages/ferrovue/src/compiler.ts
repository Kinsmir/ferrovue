/* ferrovue's compiler: `.vue` → Rust render functions.
 *
 * The input is not the template. It is what `@vue/compiler-sfc` compiles the template to for
 * server rendering — straight-line `_push` calls, `if`, `_ssrRenderList`, and a handful of
 * `@vue/server-renderer` helpers — so element structure, attribute order, whitespace and the
 * fragment markers are decided by Vue, and this file only has to translate a small, closed
 * vocabulary of JavaScript into Rust that writes the same bytes. The generated code calls the
 * `ferrovue` crate for everything Vue's runtime does.
 *
 * Anything outside that vocabulary is an error naming the component and the construct, never a
 * best guess: a guess that is wrong by one byte is a hydration mismatch in a browser, found by a
 * reader.
 *
 * A project describes itself in `ferrovue.config.json` at its root — see `Config` — and runs the
 * `ferrovue` command there. `generate()` is also what a drift test calls, so the committed files can
 * be held to exactly what this produces. */

import { compileScript, compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import { parse as parseJs } from "@babel/parser";
import { escapeHtml, hyphenate, isBooleanAttr, isSSRSafeAttrName, parseStringStyle, propsToAttrMap } from "@vue/shared";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

// Babel's AST, read structurally: every access below checks `type` before it trusts a field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/* ── Types ───────────────────────────────────────────────────────────────────────────────── */

type Ty =
  | { k: "str" }
  | { k: "int" }
  | { k: "bool" }
  | { k: "undef" }
  | { k: "opt"; of: Ty }
  | { k: "list"; of: Ty }
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
  | { k: "params" };

interface Field {
  js: string;
  rust: string;
  ty: Ty;
  /** For an optional prop: the Rust value Vue uses when it is absent — its declared default, or
   * `false` for a boolean, which Vue casts. Reading the prop reads this in place of `None`. */
  dflt?: string;
}

interface Struct {
  name: string;
  fields: Field[];
  /** The props a scoped slot's outlet passes: fields that borrow from the render, read as they are. */
  slot?: true;
}

/** A translated expression: Rust source, and the type it evaluates to. `konst` is a boolean known
 * at generation time, which is how `Array.isArray` on a value that is never an array folds away. */
interface Val {
  code: string;
  ty: Ty;
  konst?: boolean;
}

const STR: Ty = { k: "str" };
const INT: Ty = { k: "int" };
const BOOL: Ty = { k: "bool" };
const UNDEF: Ty = { k: "undef" };
const opt = (of: Ty): Ty => (of.k === "opt" ? of : { k: "opt", of });

/* ── Configuration ───────────────────────────────────────────────────────────────────────── */

/** A type a helper takes or returns, as the configuration spells it. */
export type TypeName = "string" | "string?" | "int" | "int?" | "bool";

/** A function a template may call, and the Rust function that is its twin. */
export interface HelperSpec {
  /** The Rust path the generated code calls, e.g. `crate::helpers::format_count`. */
  rust: string;
  params: TypeName[];
  returns: TypeName;
  /** The longest string it returns, which is what a call adds to the buffer reservation. */
  maxLen?: number;
}

/** What `ferrovue.config.json` holds. Paths are relative to the project root. */
export interface Config {
  /** The directory of `.vue` files to compile. */
  components: string;
  /** The directory the Rust modules are written to. Everything in it is replaced. */
  out: string;
  /** The module components import their helpers from, and the Rust twin of each export. */
  helpers?: { module: string; functions: Record<string, HelperSpec> };
  /** The Rust type a `TrustedHtml` prop is, which must implement `ferrovue::TrustedHtml`, e.g.
   * `crate::sanitize::SafeHtml`. A type that borrows names the props' lifetime, `'a`:
   * `crate::render::Trusted<'a>`. Without it, a component cannot use `v-html` at all. */
  trustedHtml?: string;
  /** A JSON file listing the app's routes as vue-router paths (`/users/:id`), which `<RouterLink>`
   * resolves against. Without it, a component cannot use `<RouterLink>`. */
  routes?: string;
  /** The router, in full: its routes file, the history's base, and the class names
   * `createRouter` gives active links. `routes` alone is shorthand for `{ routes }`. */
  router?: { routes: string; base?: string; linkActiveClass?: string; linkExactActiveClass?: string };
  /** The directory of Pinia stores (`.ts` files), whose state a component may read while it renders
   * on the server. */
  stores?: string;
  /** Custom directives that render nothing on the server — no `getSSRProps` — by name, without
   * `v-`: `["focus", "click-outside"]`. Any other custom directive is refused, since the server
   * cannot know what its `getSSRProps` would add. */
  clientDirectives?: string[];
}

export const CONFIG_FILE = "ferrovue.config.json";

/** Read the project's configuration. */
export function loadConfig(root: string): Config {
  const raw = JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")) as Partial<Config>;
  if (typeof raw.components !== "string" || typeof raw.out !== "string") {
    throw new GenError(`${CONFIG_FILE} needs \`components\` and \`out\` directories`);
  }
  return raw as Config;
}

function tyOfName(name: TypeName): Ty {
  switch (name) {
    case "string":
      return STR;
    case "string?":
      return opt(STR);
    case "int":
      return INT;
    case "int?":
      return opt(INT);
    case "bool":
      return BOOL;
    default:
      throw new GenError(`unknown helper type \`${String(name)}\``);
  }
}

/** The helpers of the configuration being compiled: name → Rust twin, typed. */
let HELPERS: Record<string, { rust: string; params: Ty[]; ret: Ty; maxLen: number }> = {};
let HELPER_MODULE: string | null = null;
let TRUSTED_HTML: string | null = null;
/** A route as the routes file lists it: a vue-router path, and the name it may have. */
interface RouteDef {
  path: string;
  name?: string;
}

/** Custom directives declared to render nothing on the server. */
let CLIENT_DIRECTIVES: Set<string> = new Set();

/** The configured routes, when there are any. */
let ROUTES: RouteDef[] | null = null;
/** The history's base, and the class names active links take, from the configured router. */
let ROUTER_BASE = "";
let LINK_ACTIVE = "router-link-active";
let LINK_EXACT_ACTIVE = "router-link-exact-active";

/** A Pinia option store: `export const usePrefs = defineStore("prefs", { state: (): PrefsState => ... })`. */
interface Store {
  /** `usePrefs` */
  hook: string;
  /** `prefs`: its key in `pinia.state.value`. */
  id: string;
  /** `prefs`: its field in the generated `Stores`. */
  field: string;
  /** `PrefsState`: the interface its state is. */
  state: string;
  /** The file, without its extension, as an import names it once resolved. */
  module: string;
  /** Its getters: name → the parameter that names the state, and the expression returned. */
  getters: Map<string, { param: string | null; body: N; file: string }>;
}

/** The configured stores, by hook name, and every interface their files declare. */
let STORES: Map<string, Store> = new Map();
let STORE_STRUCTS: Map<string, Struct> = new Map();
/** The store file each of those interfaces is declared in. */
let STORE_FILES: Map<string, string> = new Map();
/** The project root, for resolving a component's imports. */
let ROOT_DIR = "";
/** Interfaces and object types declared in shared `.ts` files that components import, and type
 * aliases there; the file each comes from. They are written once, to `types.rs`. */
let TYPE_STRUCTS: Map<string, Struct> = new Map();
let TYPE_ALIASES: Map<string, N> = new Map();
let TYPE_FILES: Map<string, string> = new Map();
/** The shared files read so far. */
let TYPE_READ: Set<string> = new Set();

/** Where `TrustedHtml` comes from. Only that import names the type `v-html` will write raw. */
export const TYPES_MODULE = "ferrovue/types";

const RUST_KEYWORDS = new Set(
  "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn abstract become box do final macro override priv typeof unsized virtual yield try".split(
    " ",
  ),
);

/** Types the generated code names, which an interface of the same name would shadow. */
const RUST_PRELUDE = new Set(["Option", "Some", "None", "Vec", "String", "Box", "Result", "Ok", "Err", "Cow", "Slots", "Default"]);

function snake(js: string): string {
  const s = js.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "");
  return RUST_KEYWORDS.has(s) ? `r#${s}` : s;
}

function rustStr(s: string): string {
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

export class GenError extends Error {}

/* ── One component ───────────────────────────────────────────────────────────────────────── */

interface Component {
  /** `TagEditor` */
  name: string;
  /** `tag_editor` */
  module: string;
  file: string;
  props: Struct;
  structs: Map<string, Struct>;
  /** The local name `TrustedHtml` was imported under from `ferrovue/types`, if it was. */
  trustedName: string | null;
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
  /** `defineModel` bindings: local name → the prop it reads. */
  models: Map<string, string>;
  /** Type aliases it declares: name → the type. */
  aliases: Map<string, N>;
  /** Types it imports from elsewhere: local name → the type, marked with where it lives. */
  importedTypes: Map<string, Ty>;
  /** Its scoped slots, by name: the props each one's outlets pass, known once its render is
   * generated, which is why a child is generated before its parents. */
  slotShapes: Map<string, Struct>;
}

interface Scope {
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
  /** Inside slot content whose emptiness is decided at run time: each push that is not a comment
   * sets the closure's `filled`, which is how Vue tells content from nothing (`ssrRenderSlot`). */
  fill: boolean;
  /** Inside a `<RouterLink>`'s slot, which Vue renders from virtual nodes rather than pushes: an
   * untaken `v-if` is `<!--v-if-->` there, not `<!---->`. */
  vnode: boolean;
}

function fail(comp: Component, what: string, node?: N): never {
  const at = node?.loc ? ` (line ${node.loc.start.line})` : "";
  throw new GenError(`${comp.file}${at}: ${what}`);
}

function tyOfTs(comp: Component, t: N, structs: Map<string, Struct>, seen: Set<string> = new Set()): Ty {
  switch (t.type) {
    case "TSStringKeyword":
      return STR;
    case "TSNumberKeyword":
      return INT;
    case "TSBooleanKeyword":
      return BOOL;
    case "TSArrayType":
      return { k: "list", of: tyOfTs(comp, t.elementType, structs, seen) };
    case "TSParenthesizedType":
      return tyOfTs(comp, t.typeAnnotation, structs, seen);
    case "TSTypeOperator":
      // `readonly string[]`: the same list, which the server never writes to anyway.
      if (t.operator === "readonly") return tyOfTs(comp, t.typeAnnotation, structs, seen);
      break;
    case "TSLiteralType":
      // A literal type is a value of its kind: `"sm"` a string, `3` a number.
      if (t.literal.type === "StringLiteral" || t.literal.type === "TemplateLiteral") return STR;
      if (t.literal.type === "NumericLiteral" && Number.isInteger(t.literal.value)) return INT;
      if (t.literal.type === "BooleanLiteral") return BOOL;
      break;
    case "TSUnionType": {
      // `"sm" | "md"` is a string; `T | undefined` is an optional `T`. `null` is a different value.
      const parts: N[] = t.types.filter((u: N) => u.type !== "TSUndefinedKeyword");
      if (t.types.some((u: N) => u.type === "TSNullKeyword" || (u.type === "TSLiteralType" && u.literal.type === "NullLiteral"))) {
        return fail(comp, "`null` in a type: use `undefined`, which is what an absent value is", t);
      }
      const tys = parts.map((u) => tyOfTs(comp, u, structs, seen));
      const first = tys[0];
      if (!first || tys.some((x) => !sameTy(x, first))) return fail(comp, "a union of different types has no Rust type", t);
      return parts.length < t.types.length ? opt(first) : first;
    }
    case "TSTypeReference": {
      const name: string | undefined = t.typeName.type === "Identifier" ? t.typeName.name : undefined;
      if (name === undefined) break;
      // `Array<T>` and `ReadonlyArray<T>`, as `T[]`.
      if ((name === "Array" || name === "ReadonlyArray") && t.typeParameters?.params?.length === 1) {
        return { k: "list", of: tyOfTs(comp, t.typeParameters.params[0], structs, seen) };
      }
      if (structs.has(name)) return { k: "struct", name };
      if (comp.childProps.has(name)) return { k: "child", name: comp.childProps.get(name)! };
      if (comp.trustedName !== null && name === comp.trustedName) {
        if (TRUSTED_HTML === null) {
          fail(comp, `a \`TrustedHtml\` prop needs \`trustedHtml\` in ${CONFIG_FILE}: the Rust type it is`, t);
        }
        return { k: "html" };
      }
      const imported = comp.importedTypes.get(name);
      if (imported) return imported;
      const alias = comp.aliases.get(name);
      if (alias) {
        if (seen.has(name)) fail(comp, `type \`${name}\` refers to itself through an alias`, t);
        return tyOfTs(comp, alias, structs, new Set(seen).add(name));
      }
      return fail(comp, `unsupported prop type \`${name}\`: declare it as an interface in the component, or import it from a \`.ts\` file`, t);
    }
  }
  return fail(comp, `unsupported prop type \`${t.type}\``, t);
}

/** Every local name an interface or object type alias declares a struct for, and every other
 * alias: what a type in that block may name. */
function declareTypes(comp: Component, body: N[], structs: Map<string, Struct>, aliases: Map<string, N>): N[] {
  const decls: N[] = [];
  for (const st of body) {
    const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (d?.type === "TSInterfaceDeclaration") decls.push({ name: d.id.name, members: d.body.body, node: d });
    else if (d?.type === "TSTypeAliasDeclaration") {
      if (d.typeAnnotation.type === "TSTypeLiteral") decls.push({ name: d.id.name, members: d.typeAnnotation.members, node: d });
      else aliases.set(d.id.name, d.typeAnnotation);
    }
  }
  for (const d of decls) {
    if (RUST_PRELUDE.has(d.name)) {
      fail(comp, `an interface called \`${d.name}\` would hide Rust's own \`${d.name}\` in the generated code; rename it`, d.node);
    }
    structs.set(d.name, { name: d.name, fields: [] });
  }
  return decls;
}

/** A relative import's file, resolved as a bundler resolves a TypeScript import. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(ROOT_DIR, dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")]) {
    try {
      if (statSync(candidate).isFile() && candidate.endsWith(".ts")) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

/** A shared `.ts` file of types, read once: its interfaces and object types become structs in
 * `types.rs`, its other aliases are resolved where they are used. */
function readTypeFile(file: string): void {
  if (TYPE_READ.has(file)) return;
  TYPE_READ.add(file);
  const rel = relative(ROOT_DIR, file);
  const home = storeHome(rel);
  home.structs = TYPE_STRUCTS;
  home.aliases = TYPE_ALIASES;
  const body: N[] = parseJs(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript"] }).program.body;
  const before = new Set(TYPE_STRUCTS.keys());
  const local = new Map<string, Struct>();
  const decls = declareTypes(home, body, local, TYPE_ALIASES);
  for (const d of decls) {
    if (before.has(d.name)) fail(home, `\`${d.name}\` is declared by ${TYPE_FILES.get(d.name)} too`, d.node);
    TYPE_STRUCTS.set(d.name, local.get(d.name)!);
    TYPE_FILES.set(d.name, rel);
  }
  for (const d of decls) {
    const st = structOf(home, d.name, d.members, TYPE_STRUCTS);
    for (const f of st.fields) f.ty = markHome(f.ty, "types");
    TYPE_STRUCTS.set(d.name, st);
  }
}

/** A type read in the file that declares it, marked with where it lives for readers elsewhere. */
function markHome(ty: Ty, home: string): Ty {
  if (ty.k === "struct" && !ty.store && !ty.home && ty.name !== "Props") return { ...ty, home };
  if (ty.k === "opt" || ty.k === "list") return { ...ty, of: markHome(ty.of, home) };
  return ty;
}

/** Where a struct type is declared: its fields, the component whose types its fields name, and
 * the path the generated code names it by. */
function lookupStruct(comp: Component, ty: Ty & { k: "struct" }): { st: Struct | undefined; owner: Component; path: string } {
  // Named from the module being written: plainly within its own, by path from any other.
  if (ty.store) return { st: STORE_STRUCTS.get(ty.name), owner: comp, path: comp.module === "stores" ? "" : "super::stores::" };
  if (ty.home === "types") return { st: TYPE_STRUCTS.get(ty.name), owner: comp, path: comp.module === "types" ? "" : "super::types::" };
  if (ty.home !== undefined && ty.home !== comp.name) {
    const owner = childOf(ty.home);
    return { st: owner.structs.get(ty.name), owner, path: `super::${owner.module}::` };
  }
  return { st: ty.name === "Props" ? comp.props : comp.structs.get(ty.name), owner: comp, path: "" };
}

function structOf(comp: Component, name: string, members: N[], structs: Map<string, Struct>): Struct {
  const fields: Field[] = [];
  for (const m of members) {
    if (m.type !== "TSPropertySignature" || m.key.type !== "Identifier") {
      fail(comp, `\`${name}\` may only hold plain named fields`, m);
    }
    const base = tyOfTs(comp, m.typeAnnotation.typeAnnotation, structs);
    if (m.optional && base.k === "opt") {
      fields.push({ js: m.key.name, rust: snake(m.key.name), ty: base });
      continue;
    }
    fields.push({ js: m.key.name, rust: snake(m.key.name), ty: m.optional ? opt(base) : base });
  }
  return { name, fields };
}

/** The type literal (or interface) `defineProps<...>()` was given, seen through `withDefaults`. */
function definePropsType(call: N): N | null {
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

/** The `default` of each prop in the runtime declaration `compileScript` wrote, by prop name. */
function runtimeDefaults(comp: Component, content: string): Map<string, N> {
  const out = new Map<string, N>();
  let program: N[];
  try {
    program = parseJs(content, { sourceType: "module", plugins: ["typescript"] }).program.body;
  } catch {
    return out;
  }
  /** An object literal's properties, with `...{ … }` spreads opened, as `defineModel` writes them. */
  const props = (o: N): N[] =>
    o?.type !== "ObjectExpression"
      ? []
      : o.properties.flatMap((p: N) => (p.type === "SpreadElement" ? props(p.argument) : [p]));
  const visit = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (n.type === "ObjectProperty" && !n.computed && (n.key.name ?? n.key.value) === "props") {
      // `props: { … }`, or `_mergeModels({ … }, { … })` when there is a `defineModel`.
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

/** A prop's default as a Rust value of its type: a literal, or an empty list from `() => []`. */
function defaultValue(comp: Component, f: Field, node: N): string {
  const of = f.ty.k === "opt" ? f.ty.of : f.ty;
  if (of.k === "str" && node.type === "StringLiteral") return rustStr(node.value);
  if (of.k === "int" && node.type === "NumericLiteral" && Number.isInteger(node.value)) return `${node.value}i64`;
  if (of.k === "int" && node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral" && Number.isInteger(node.argument.value)) {
    return `-${node.argument.value}i64`;
  }
  if (of.k === "bool" && node.type === "BooleanLiteral") return String(node.value);
  if (of.k === "list" && node.type === "ArrowFunctionExpression" && node.body.type === "ArrayExpression" && node.body.elements.length === 0) {
    return "&[]";
  }
  return fail(comp, `the default of \`${f.js}\` must be a literal of its type, or \`() => []\` for a list`, node);
}

function readComponent(file: string, root: string): { comp: Component; ast: N[]; ssr: string } {
  const name = basename(file, ".vue");
  const source = readFileSync(file, "utf8");
  const { descriptor, errors } = parseSfc(source, { filename: file });
  const rel = relative(root, file);
  const comp: Component = {
    name,
    module: snake(name),
    file: rel,
    props: { name: "Props", fields: [] },
    structs: new Map(),
    trustedName: null,
    childProps: new Map(),
    imports: new Set(),
    slotNames: [],
    routerView: false,
    routerLink: false,
    readsRoute: false,
    usesRoute: false,
    readsStores: false,
    usesStores: false,
    models: new Map(),
    aliases: new Map(),
    importedTypes: new Map(),
    slotShapes: new Map(),
  };
  if (errors.length) fail(comp, String(errors[0]));
  if (!descriptor.scriptSetup || !descriptor.template) {
    fail(comp, "an island needs `<script setup lang=\"ts\">` and a `<template>`");
  }
  // A global `<style>` block changes no markup. A scoped one adds `data-v-…` attributes whose hash
  // the bundler chooses, a CSS module renames classes, and `v-bind()` in CSS writes variables onto
  // the root: none of which the server can know.
  for (const st of descriptor.styles) {
    if (st.scoped) fail(comp, "`<style scoped>` adds `data-v-` attributes whose id the bundler chooses; use a global `<style>` or a stylesheet");
    if (st.module) fail(comp, "`<style module>` renames classes in the bundler; use a global `<style>` or a stylesheet");
  }
  if (descriptor.cssVars.length) fail(comp, "`v-bind()` in `<style>` sets variables the server does not render; bind `:style` instead");

  const script = compileScript(descriptor, { id: name });
  const ast: N[] = script.scriptSetupAst ?? [];
  // A plain `<script>` beside the setup one may declare the types the setup block uses.
  const plainAst: N[] = script.scriptAst ?? [];

  for (const s of [...plainAst, ...ast]) {
    if (s.type !== "ImportDeclaration" || !s.source.value.endsWith(".vue")) continue;
    const from = basename(s.source.value, ".vue");
    if (s.specifiers.some((sp: N) => sp.type === "ImportDefaultSpecifier")) comp.imports.add(from);
    for (const sp of s.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "Props") {
        comp.childProps.set(sp.local.name, from);
      }
    }
  }
  for (const s of [...plainAst, ...ast]) {
    if (s.type !== "ImportDeclaration" || s.source.value !== TYPES_MODULE) continue;
    for (const sp of s.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "TrustedHtml") {
        comp.trustedName = sp.local.name;
      }
    }
  }

  // Types imported from elsewhere: a store's file, a shared `.ts` file, or another component.
  for (const st of [...plainAst, ...ast]) {
    if (st.type !== "ImportDeclaration") continue;
    const from: string = st.source.value;
    for (const sp of st.specifiers) {
      if (sp.type !== "ImportSpecifier") continue;
      const name: string = sp.imported.name ?? sp.imported.value;
      if (from.endsWith(".vue")) {
        if (name !== "Props") comp.importedTypes.set(sp.local.name, { k: "struct", name, home: basename(from, ".vue") });
        continue;
      }
      const isType = st.importKind === "type" || sp.importKind === "type";
      const file = resolveImport(comp.file, from);
      if (!file) continue;
      const module = file.replace(/\.ts$/, "");
      if ([...STORES.values()].some((x) => x.module === module)) {
        if (STORE_STRUCTS.has(name)) comp.importedTypes.set(sp.local.name, { k: "struct", name, store: true });
        continue;
      }
      if (HELPER_MODULE !== null && from === HELPER_MODULE && !isType) continue;
      readTypeFile(file);
      if (TYPE_STRUCTS.has(name)) comp.importedTypes.set(sp.local.name, { k: "struct", name, home: "types" });
      else if (TYPE_ALIASES.has(name)) comp.aliases.set(sp.local.name, TYPE_ALIASES.get(name));
    }
  }

  // Interfaces in two passes: every name first, so one may name another declared after it, or
  // itself — a tree node's children are tree nodes.
  const decls = declareTypes(comp, [...plainAst, ...ast], comp.structs, comp.aliases);
  for (const d of decls) comp.structs.set(d.name, structOf(comp, d.name, d.members, comp.structs));
  let propsTy: N = null;
  for (const s of ast) {
    const call = s.type === "ExpressionStatement" ? s.expression : s.type === "VariableDeclaration" ? s.declarations[0]?.init : null;
    const inner = call?.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "withDefaults" ? call.arguments[0] : call;
    if (inner?.type === "CallExpression" && inner.callee.type === "Identifier" && inner.callee.name === "defineProps" && !inner.typeParameters) {
      fail(comp, "props are declared with a type, `defineProps<{ ... }>()`: a runtime declaration has no Rust type", inner);
    }
    const found = definePropsType(call);
    if (found) propsTy = found;
  }
  // A component without `defineProps` takes no props.
  if (!propsTy) {
    // nothing to read
  } else if (propsTy.type === "TSTypeLiteral") {
    comp.props = structOf(comp, "Props", propsTy.members, comp.structs);
  } else if (propsTy.type === "TSTypeReference" && comp.structs.has(propsTy.typeName.name)) {
    comp.props = { name: "Props", fields: comp.structs.get(propsTy.typeName.name)!.fields };
  } else {
    fail(comp, "`defineProps` takes a type literal or an interface declared in the same block", propsTy);
  }

  // `defineModel`: a prop of its own (`modelValue` unless named), which the binding reads.
  for (const st of ast) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      const call = d.init;
      if (call?.type !== "CallExpression" || call.callee.type !== "Identifier" || call.callee.name !== "defineModel") continue;
      const t = call.typeParameters?.params?.[0];
      if (!t) fail(comp, "`defineModel` needs its type: `defineModel<string>()`", call);
      const named = call.arguments[0]?.type === "StringLiteral" ? call.arguments[0].value : "modelValue";
      const options = call.arguments.find((a: N) => a.type === "ObjectExpression");
      const required = options?.properties.some(
        (p: N) => p.type === "ObjectProperty" && (p.key.name ?? p.key.value) === "required" && p.value.type === "BooleanLiteral" && p.value.value,
      );
      const base = tyOfTs(comp, t, comp.structs);
      comp.props.fields.push({ js: named, rust: snake(named), ty: required ? base : opt(base) });
      comp.models.set(d.id.name, named);
    }
  }

  // What Vue uses for an absent optional prop: the default `compileScript` resolved — from
  // `withDefaults`, a destructured default, or `defineModel`'s options — or `false` for a boolean.
  const defaults = runtimeDefaults(comp, script.content);
  for (const f of comp.props.fields) {
    if (f.ty.k !== "opt") continue;
    const node = defaults.get(f.js);
    if (node) f.dflt = defaultValue(comp, f, node);
    else if (f.ty.of.k === "bool") f.dflt = "false";
  }

  const compiled = compileTemplate({
    source: descriptor.template!.content,
    filename: file,
    id: name,
    ssr: true,
    ssrCssVars: [],
    compilerOptions: { bindingMetadata: script.bindings },
  });
  if (compiled.errors.length) fail(comp, String(compiled.errors[0]));
  for (const m of compiled.code.matchAll(/_ssrRenderSlot\(_ctx\.\$slots, "([^"]+)"/g)) {
    if (!comp.slotNames.includes(m[1]!)) comp.slotNames.push(m[1]!);
  }
  // Resolved by name, as globally registered components are, or imported from `vue-router`.
  const imported = (name: string) =>
    [...plainAst, ...ast].some(
      (st) => st.type === "ImportDeclaration" && st.source.value === "vue-router" &&
        st.specifiers.some((sp: N) => sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === name),
    );
  comp.routerLink = compiled.code.includes('_resolveComponent("RouterLink")') || imported("RouterLink");
  comp.routerView = compiled.code.includes('_resolveComponent("RouterView")') || imported("RouterView");
  comp.readsRoute = compiled.code.includes("_ctx.$route");
  return { comp, ast, ssr: compiled.code };
}

/* ── Expressions ─────────────────────────────────────────────────────────────────────────── */

function fieldVal(comp: Component, base: string, ty: Ty, js: string, node: N): Val {
  if (ty.k !== "struct") fail(comp, `\`.${js}\` on a value that is not an object`, node);
  const { st, owner } = lookupStruct(comp, ty);
  const found = st?.fields.find((x) => x.js === js);
  if (!found) fail(comp, `\`${ty.name}\` has no field \`${js}\``, node);
  // A field of a type another component declares names that component's types.
  const f = owner === comp ? found : { ...found, ty: markHome(found.ty, owner.name) };
  // A scoped slot's props already hold borrows and copies: each field is read as it is.
  if (st!.slot) return { code: `${base}.${f.rust}`, ty: f.ty };
  const place = `${base}.${f.rust}`;
  if (f.dflt !== undefined && f.ty.k === "opt") {
    const of = f.ty.of;
    if (of.k === "str") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: STR };
    if (of.k === "list") return { code: `${place}.as_deref().unwrap_or(${f.dflt})`, ty: of };
    return { code: `${place}.unwrap_or(${f.dflt})`, ty: of };
  }
  switch (f.ty.k) {
    case "str":
      return { code: `&*${place}`, ty: STR };
    case "html":
    case "child":
      return { code: `&${place}`, ty: f.ty };
    case "opt":
      if (f.ty.of.k === "html") return { code: `${place}.as_ref()`, ty: f.ty };
      if (f.ty.of.k === "str") return { code: `${place}.as_deref()`, ty: f.ty };
      if (f.ty.of.k === "int" || f.ty.of.k === "bool") return { code: place, ty: f.ty };
      // An object or a list, borrowed: `Option<&T>`, which a `v-if` narrows to the `&T`.
      return { code: `${place}.as_ref()`, ty: f.ty };
    default:
      return { code: place, ty: f.ty };
  }
}

function truthy(v: Val): string {
  switch (v.ty.k) {
    case "str":
      return `!(${v.code}).is_empty()`;
    case "int":
      return `(${v.code}) != 0`;
    case "bool":
      return `(${v.code})`;
    case "undef":
      return "false";
    case "opt":
      return `(${v.code}).is_some_and(|v| ${truthy({ code: "v", ty: v.ty.of })})`;
    default:
      return "true";
  }
}

function sameTy(a: Ty, b: Ty): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A value passed where `want` is expected: a present value into an optional slot is wrapped. */
function coerce(comp: Component, v: Val, want: Ty, node: N): string {
  if (sameTy(v.ty, want)) return v.code;
  if (want.k === "opt" && v.ty.k === "undef") return "None";
  if (want.k === "opt" && sameTy(v.ty, want.of)) return `Some(${v.code})`;
  return fail(comp, `a ${JSON.stringify(v.ty)} where ${JSON.stringify(want)} is expected`, node);
}

/** The JavaScript path an expression names — `$props.user`, `item.author.name` — or `null` when it
 * is not a plain chain of names. */
function pathOf(n: N): string | null {
  if (n.type === "Identifier") return n.name;
  if (n.type !== "MemberExpression") return null;
  const base = pathOf(n.object);
  if (base === null) return null;
  if (!n.computed && n.property.type === "Identifier") return `${base}.${n.property.name}`;
  if (n.computed && n.property.type === "StringLiteral") return `${base}.${n.property.value}`;
  return null;
}

let narrowCount = 0;

/* A test, as a Rust boolean. Only its truthiness is used, so `||`, `&&` and `!` combine the truthiness
 * of their operands whatever their types — where as a VALUE `a || b` is `a` or `b`, and stays held to
 * the stricter rules `expr` applies. */
function cond(s: Scope, n: N): string {
  if (n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&")) {
    return `(${cond(s, n.left)} ${n.operator} ${cond(s, n.right)})`;
  }
  // Parenthesised: `truthy` of a number is `(x) != 0`, and a bare `!` would bind to `(x)` — which
  // in Rust is a bitwise NOT, not a negation of the test.
  if (n.type === "UnaryExpression" && n.operator === "!") return `!(${cond(s, n.argument)})`;
  const v = expr(s, n);
  return v.konst !== undefined ? String(v.konst) : truthy(v);
}

/** Every component being compiled, by name, for a type that names another one's props. */
let ALL: Map<string, Component> = new Map();

function childOf(name: string): Component {
  const c = ALL.get(name);
  if (!c) throw new GenError(`\`Props\` is imported from ${name}.vue, which is not among the components compiled`);
  return c;
}

/** The reader's route, which the component then takes. */
function theRoute(s: Scope, n: N): Val {
  if (!ROUTES) fail(s.comp, `reading the route needs \`routes\` in ${CONFIG_FILE}`, n);
  s.comp.readsRoute = true;
  return { code: "fv_route", ty: { k: "route" } };
}

/** A field of the route: what `useRoute()` gives that the server knows as vue-router does. */
function routeField(s: Scope, base: Val, prop: string, n: N): Val {
  if (base.ty.k === "params") {
    // Every parameter is a string; absent when the route has none of that name.
    return { code: `fv_route.param(${rustStr(prop)})`, ty: opt(STR) };
  }
  switch (prop) {
    case "path":
      return { code: "fv_route.path()", ty: STR };
    case "hash":
      return { code: "fv_route.hash()", ty: STR };
    case "name":
      return { code: "fv_route.name()", ty: opt(STR) };
    case "params":
      return { code: "fv_route", ty: { k: "params" } };
  }
  return fail(s.comp, `\`route.${prop}\` is not available on the server: \`path\`, \`hash\`, \`name\` and \`params\` are`, n);
}

/** A Pinia getter read from a store's state, `prefs.doubled`: its expression, translated with the
 * state it takes bound to that state. `null` when `name` is not a getter of that store. */
function storeGetter(s: Scope, base: Val, name: string, node: N): Val | null {
  if (base.ty.k !== "struct" || !base.ty.store) return null;
  const stateName = base.ty.name;
  const store = [...STORES.values()].find((st) => st.state === stateName);
  const g = store?.getters.get(name);
  if (!g) return null;
  const where = `getter \`${name}\` in ${g.file}`;
  if (!g.body) fail(s.comp, `${where} returns a single expression`, node);
  const uses = (n: N, type: string): boolean =>
    !!n && typeof n === "object" && (n.type === type || Object.entries(n).some(([k, v]) => k !== "loc" && (Array.isArray(v) ? v.some((x) => uses(x, type)) : typeof v === "object" && uses(v, type))));
  if (uses(g.body, "ThisExpression")) fail(s.comp, `${where} reads \`this\`; read the state through the getter's parameter`, node);
  if (g.body.type === "ArrowFunctionExpression" || g.body.type === "FunctionExpression") {
    fail(s.comp, `${where} returns a function, which takes arguments only the client passes`, node);
  }
  const locals = new Map<string, Val>();
  if (g.param) locals.set(g.param, { code: base.code, ty: base.ty });
  try {
    return expr({ ...s, locals, narrowed: new Map(), setup: new Map(), propsIdent: null }, g.body);
  } catch (e) {
    if (e instanceof GenError) throw new GenError(`${s.comp.file}: ${where}: ${e.message.replace(/^[^:]*: /, "")}`);
    throw e;
  }
}

function expr(s: Scope, n: N): Val {
  const comp = s.comp;
  const path = pathOf(n);
  if (path !== null) {
    const narrowed = s.narrowed.get(path);
    if (narrowed) return narrowed;
  }
  if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier" && n.property.name === "length") {
    const base = expr(s, n.object);
    if (base.ty.k === "list") return { code: `((${base.code}).len() as i64)`, ty: INT };
    // A JavaScript string's length counts UTF-16 code units, not the bytes Rust's `len` counts.
    if (base.ty.k === "str") return { code: `fv::js_length(${base.code})`, ty: INT };
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    // JavaScript's `+` concatenates as soon as one side is a string, writing a number in decimal —
    // which is what `{}` does with an `i64`. Two numbers would be arithmetic, which is not here.
    const joinable = (t: Ty) => t.k === "str" || t.k === "int";
    if ((a.ty.k === "str" || b.ty.k === "str") && joinable(a.ty) && joinable(b.ty)) {
      return { code: `&*format!("{}{}", ${a.code}, ${b.code})`, ty: STR };
    }
    // Two numbers: arithmetic, as `n + 1` in a template means.
    if (a.ty.k === "int" && b.ty.k === "int") return { code: `(${a.code} + ${b.code})`, ty: INT };
    return fail(comp, "`+` joins a string to a string or a number, or adds two numbers", n);
  }
  if (n.type === "BinaryExpression" && ["-", "*", "%", "/", "<", ">", "<=", ">="].includes(n.operator)) {
    const a = expr(s, n.left);
    const b = expr(s, n.right);
    if (a.ty.k !== "int" || b.ty.k !== "int") {
      return fail(comp, `\`${n.operator}\` is supported between two numbers that are present: ${a.ty.k === "opt" || b.ty.k === "opt" ? "narrow an optional one with `v-if` first" : "strings compare by UTF-16 code unit in JavaScript"}`, n);
    }
    if (n.operator === "/") return fail(comp, "`/` gives a fraction, and only integers are supported", n);
    // JavaScript's `%` keeps the dividend's sign, as Rust's does; only a zero divisor differs (NaN
    // against a panic), so the divisor must be a literal that is not zero.
    if (n.operator === "%" && !(n.right.type === "NumericLiteral" && n.right.value !== 0)) {
      return fail(comp, "`%` takes a literal divisor that is not zero", n);
    }
    const ty = ["<", ">", "<=", ">="].includes(n.operator) ? BOOL : INT;
    return { code: `(${a.code} ${n.operator} ${b.code})`, ty };
  }
  switch (n.type) {
    case "TemplateLiteral": {
      // `${a}-${b}`: each part written as JavaScript writes it into a string.
      let fmt = "";
      const args: string[] = [];
      n.quasis.forEach((q: N, i: number) => {
        fmt += (q.value.cooked as string).replace(/[{}]/g, (c) => c + c);
        if (i >= n.expressions.length) return;
        const v = expr(s, n.expressions[i]);
        if (v.ty.k === "str" || v.ty.k === "int") args.push(v.code);
        else if (v.ty.k === "bool") args.push(`if ${v.code} { "true" } else { "false" }`);
        else fail(comp, "a template literal interpolates strings, numbers and booleans that are present", n.expressions[i]);
        fmt += "{}";
      });
      return { code: args.length ? `&*format!(${rustStr(fmt)}, ${args.join(", ")})` : rustStr(fmt.replace(/\{\{|\}\}/g, (c) => c[0]!)), ty: STR };
    }
    case "ArrayExpression": {
      // A list of literals or values of one scalar type, as a Rust array.
      if (n.elements.length === 0) return { code: "[]", ty: { k: "list", of: UNDEF } };
      const items = n.elements.map((el: N) => {
        if (!el || el.type === "SpreadElement") fail(comp, "an array literal holds plain values", n);
        return expr(s, el);
      });
      const of = items[0]!.ty;
      if (!(of.k === "str" || of.k === "int" || of.k === "bool") || items.some((v: Val) => !sameTy(v.ty, of))) {
        fail(comp, "an array literal holds strings, numbers or booleans, all of one type", n);
      }
      return { code: `[${items.map((v: Val) => v.code).join(", ")}]`, ty: { k: "list", of } };
    }
    case "OptionalMemberExpression": {
      // `a?.b`: the field of an optional object when it is present.
      if (n.computed) return fail(comp, "computed member access", n);
      const base = expr(s, n.object);
      if (base.ty.k !== "opt") return fieldVal(comp, base.code, base.ty, n.property.name, n);
      const f = fieldVal(comp, "v", base.ty.of, n.property.name, n);
      if (f.ty.k === "opt") return { code: `(${base.code}).and_then(|v| ${f.code})`, ty: f.ty };
      return { code: `(${base.code}).map(|v| ${f.code})`, ty: opt(f.ty) };
    }
    case "StringLiteral":
      return { code: rustStr(n.value), ty: STR };
    case "NumericLiteral":
      if (!Number.isInteger(n.value)) fail(comp, "only integer literals", n);
      return { code: `${n.value}i64`, ty: INT };
    case "BooleanLiteral":
      return { code: String(n.value), ty: BOOL, konst: n.value };
    case "NullLiteral":
      // An absent prop is `undefined`, and `null` is a different value: `x === null` is false for
      // it in Vue and would be `is_none()` here.
      return fail(comp, "`null`: compare with `undefined`, which is what an absent prop is", n);
    case "Identifier": {
      if (n.name === "undefined") return { code: "None", ty: UNDEF };
      const local = s.locals.get(n.name) ?? s.setup.get(n.name);
      if (local) return local;
      if (s.clientOnly.has(n.name)) {
        return fail(comp, `\`${n.name}\` is set up in a way the server cannot evaluate: ${s.clientOnly.get(n.name)}`, n);
      }
      if (n.name === s.propsIdent) return { code: "props", ty: { k: "struct", name: "Props" } };
      return fail(comp, `\`${n.name}\` is not available when rendering on the server`, n);
    }
    case "MemberExpression": {
      // `count.value` in the script: the ref's value, which is what the binding already reads.
      if (!n.computed && n.property.name === "value" && n.object.type === "Identifier" && s.refs.has(n.object.name) && !s.locals.has(n.object.name)) {
        return expr(s, n.object);
      }
      if (n.computed) {
        if (n.object.type === "Identifier" && n.object.name === "$setup" && n.property.type === "StringLiteral") {
          return expr(s, { ...n.property, type: "Identifier", name: n.property.value });
        }
        if (n.property.type === "StringLiteral") {
          const base = expr(s, n.object);
          if (base.ty.k === "params") return routeField(s, base, n.property.value, n);
        }
        return fail(comp, "computed member access", n);
      }
      const prop = n.property.name as string;
      // `$slots.side`: whether the parent gave that slot any content.
      const slotsObject =
        (n.object.type === "Identifier" && n.object.name === "$slots") ||
        (n.object.type === "MemberExpression" && !n.object.computed && n.object.object.type === "Identifier" &&
          n.object.object.name === "_ctx" && n.object.property.name === "$slots");
      if (slotsObject) {
        if (!comp.slotNames.includes(prop)) fail(comp, `\`$slots.${prop}\` names a slot this template does not render`, n);
        return { code: `fv_slots.${snake(prop)}.is_some()`, ty: BOOL };
      }
      if (n.object.type === "Identifier") {
        switch (n.object.name) {
          case "$props":
            return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
          case "$setup":
          case "_ctx": {
            if (n.object.name === "_ctx" && prop === "$route") return theRoute(s, n);
            const v = s.setup.get(prop);
            if (v) return v;
            if (s.clientOnly.has(prop)) {
              return fail(comp, `\`${prop}\` is set up in a way the server cannot evaluate: ${s.clientOnly.get(prop)}`, n);
            }
            if (n.object.name === "_ctx" && comp.props.fields.some((f) => f.js === prop)) {
              return fieldVal(comp, "props", { k: "struct", name: "Props" }, prop, n);
            }
            return fail(comp, `\`${prop}\` is not available when rendering on the server`, n);
          }
        }
      }
      const base = expr(s, n.object);
      if (base.ty.k === "route" || base.ty.k === "params") return routeField(s, base, prop, n);
      return storeGetter(s, base, prop, n) ?? fieldVal(comp, base.code, base.ty, prop, n);
    }
    case "CallExpression":
      return call(s, n);
    case "LogicalExpression": {
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      if (n.operator === "??") {
        if (a.ty.k !== "opt") return a;
        if (b.ty.k === "undef") return a;
        if (sameTy(a.ty.of, b.ty)) return { code: `(${a.code}).unwrap_or(${b.code})`, ty: b.ty };
        if (sameTy(a.ty, b.ty)) return { code: `(${a.code}).or(${b.code})`, ty: a.ty };
        return fail(comp, "`??` between different types", n);
      }
      if (n.operator === "||") {
        if (a.ty.k === "bool" && b.ty.k === "bool") return { code: `(${a.code} || ${b.code})`, ty: BOOL };
        if (b.ty.k === "undef") {
          // `x || undefined`: the value when it is truthy, nothing otherwise.
          const inner: Ty = a.ty.k === "opt" ? a.ty.of : a.ty;
          const test = truthy({ code: "v", ty: inner });
          const src = a.ty.k === "opt" ? a.code : `Some(${a.code})`;
          return { code: `(${src}).filter(|v| ${test.replace(/\bv\b/g, "*v")})`, ty: opt(inner) };
        }
        if (sameTy(a.ty, b.ty) && (a.ty.k === "str" || a.ty.k === "int")) {
          return { code: `{ let a = ${a.code}; if ${truthy({ code: "a", ty: a.ty })} { a } else { ${b.code} } }`, ty: a.ty };
        }
        return fail(comp, "`||` between these types", n);
      }
      if (n.operator === "&&" && a.ty.k === "bool" && b.ty.k === "bool") {
        return { code: `(${a.code} && ${b.code})`, ty: BOOL };
      }
      return fail(comp, `\`${n.operator}\` is supported between booleans only`, n);
    }
    case "UnaryExpression":
      if (n.operator === "!") {
        const a = expr(s, n.argument);
        return a.konst !== undefined
          ? { code: String(!a.konst), ty: BOOL, konst: !a.konst }
          : { code: `!(${truthy(a)})`, ty: BOOL };
      }
      if (n.operator === "-") {
        const a = expr(s, n.argument);
        if (a.ty.k === "int") return { code: `(-${a.code})`, ty: INT };
      }
      return fail(comp, `unary \`${n.operator}\``, n);
    case "BinaryExpression": {
      if (n.operator !== "===" && n.operator !== "!==") fail(comp, `\`${n.operator}\``, n);
      const a = expr(s, n.left);
      const b = expr(s, n.right);
      let eq: string;
      const scalar = (t: Ty) => t.k === "str" || t.k === "int" || t.k === "bool";
      if (b.ty.k === "undef" && a.ty.k === "opt") eq = `(${a.code}).is_none()`;
      else if (a.ty.k === "undef" && b.ty.k === "opt") eq = `(${b.code}).is_none()`;
      else if (sameTy(a.ty, b.ty) && (scalar(a.ty) || (a.ty.k === "opt" && scalar(a.ty.of)))) {
        eq = `(${a.code}) == (${b.code})`;
      } else if (a.ty.k === "opt" && sameTy(a.ty.of, b.ty) && scalar(b.ty)) eq = `(${a.code}) == Some(${b.code})`;
      else if (b.ty.k === "opt" && sameTy(b.ty.of, a.ty) && scalar(a.ty)) eq = `Some(${a.code}) == (${b.code})`;
      else return fail(comp, "`===` between these types", n);
      return { code: n.operator === "===" ? eq : `!(${eq})`, ty: BOOL };
    }
    case "ConditionalExpression": {
      const t = expr(s, n.test);
      if (t.konst !== undefined) return expr(s, t.konst ? n.consequent : n.alternate);
      const a = expr(s, n.consequent);
      const b = expr(s, n.alternate);
      if (sameTy(a.ty, b.ty)) return { code: `if ${truthy(t)} { ${a.code} } else { ${b.code} }`, ty: a.ty };
      if (a.ty.k === "undef" || b.ty.k === "undef" || (a.ty.k === "opt" && sameTy(a.ty.of, b.ty)) || (b.ty.k === "opt" && sameTy(b.ty.of, a.ty))) {
        const ty = opt(a.ty.k === "undef" || b.ty.k === "opt" ? b.ty : a.ty);
        return {
          code: `if ${truthy(t)} { ${coerce(comp, a, ty, n)} } else { ${coerce(comp, b, ty, n)} }`,
          ty,
        };
      }
      return fail(comp, "the two branches of `?:` differ in type", n);
    }
    default:
      return fail(comp, `\`${n.type}\` is not supported in an island template`, n);
  }
}

function call(s: Scope, n: N): Val {
  const comp = s.comp;
  const callee = n.callee;
  const args: N[] = n.arguments;
  if (callee.type === "Identifier") {
    switch (callee.name) {
      case "_ssrLooseEqual": {
        const a = expr(s, args[0]);
        const b = expr(s, args[1]);
        if (a.ty.k === "str" && b.ty.k === "str") return { code: `(${a.code}) == (${b.code})`, ty: BOOL };
        return fail(comp, "`v-model` comparison between these types", n);
      }
      case "_ssrIncludeBooleanAttr": {
        // `!!value || value === ""`: every string is included, empty or not.
        const a = expr(s, args[0]);
        if (a.konst !== undefined) return a;
        if (a.ty.k === "str") return { code: "true", ty: BOOL, konst: true };
        if (a.ty.k === "opt" && a.ty.of.k === "str") return { code: `(${a.code}).is_some()`, ty: BOOL };
        return { code: truthy(a), ty: BOOL };
      }
      case "_ssrLooseContain":
        return fail(comp, "`v-model` over an array", n);
    }
    const helper = s.helpers.get(callee.name);
    if (helper) return helperCall(s, helper, args, n);
    if (callee.name === "String" && args.length === 1) {
      const a = expr(s, args[0]);
      if (a.ty.k === "str") return a;
      if (a.ty.k === "int") return { code: `&*(${a.code}).to_string()`, ty: STR };
      if (a.ty.k === "bool") return { code: `if ${a.code} { "true" } else { "false" }`, ty: STR };
    }
    return fail(comp, `\`${callee.name}()\` is not available when rendering on the server`, n);
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const method = callee.property.name as string;
    if (callee.object.type === "Identifier" && callee.object.name === "Array" && method === "isArray") {
      const a = expr(s, args[0]);
      const is = a.ty.k === "list";
      return { code: String(is), ty: BOOL, konst: is };
    }
    if (callee.object.type === "Identifier" && (callee.object.name === "$setup" || callee.object.name === "_ctx")) {
      const helper = s.helpers.get(method);
      if (helper) return helperCall(s, helper, args, n);
    }
    // `Math.max(a, b, …)`, `Math.min`, `Math.abs`, over integers.
    if (callee.object.type === "Identifier" && callee.object.name === "Math") {
      const vals = args.map((a) => expr(s, a));
      if (vals.length && vals.every((v) => v.ty.k === "int")) {
        if ((method === "max" || method === "min") && vals.length >= 2) {
          return { code: vals.slice(1).reduce((acc, v) => `(${acc}).${method}(${v.code})`, vals[0]!.code), ty: INT };
        }
        if (method === "abs" && vals.length === 1) return { code: `(${vals[0]!.code}).abs()`, ty: INT };
      }
      return fail(comp, `\`Math.${method}()\` is supported on integers as \`max\`, \`min\` and \`abs\``, n);
    }
    const target = expr(s, callee.object);
    const strArg = (i: number): string => {
      const v = expr(s, args[i]);
      if (v.ty.k !== "str") fail(comp, `\`.${method}()\` takes a string`, args[i]);
      return v.code;
    };
    if (target.ty.k === "str") {
      switch (args.length === 0 ? method : "") {
        case "trim":
          return { code: `fv::js_trim(${target.code})`, ty: STR };
        case "trimStart":
          return { code: `fv::js_trim_start(${target.code})`, ty: STR };
        case "trimEnd":
          return { code: `fv::js_trim_end(${target.code})`, ty: STR };
        // Unicode's default case mappings, which JavaScript and Rust both apply, final sigma included.
        case "toUpperCase":
          return { code: `&*(${target.code}).to_uppercase()`, ty: STR };
        case "toLowerCase":
          return { code: `&*(${target.code}).to_lowercase()`, ty: STR };
        case "toString":
          return target;
      }
      if (args.length === 1 && method === "includes") return { code: `(${target.code}).contains(${strArg(0)})`, ty: BOOL };
      if (args.length === 1 && method === "startsWith") return { code: `(${target.code}).starts_with(${strArg(0)})`, ty: BOOL };
      if (args.length === 1 && method === "endsWith") return { code: `(${target.code}).ends_with(${strArg(0)})`, ty: BOOL };
    }
    if (target.ty.k === "int" && method === "toString" && args.length === 0) {
      return { code: `&*(${target.code}).to_string()`, ty: STR };
    }
    if (target.ty.k === "list" && (target.ty.of.k === "str" || target.ty.of.k === "int")) {
      const of = target.ty.of;
      if (method === "includes" && args.length === 1) {
        const v = expr(s, args[0]);
        if (!sameTy(v.ty, of)) fail(comp, "`.includes()` looks for a value of the list's own type", args[0]);
        const item = of.k === "str" ? "&**v" : "*v";
        return { code: `(${target.code}).iter().any(|v| ${item} == ${v.code})`, ty: BOOL };
      }
      if (method === "join" && args.length <= 1) {
        // JavaScript joins with a comma when given no separator.
        const sep = args.length ? strArg(0) : '","';
        const items = of.k === "str" ? `(${target.code}).iter().map(|v| &**v)` : `(${target.code}).iter().map(|v| v.to_string())`;
        return { code: `&*${items}.collect::<Vec<_>>().join(${sep})`, ty: STR };
      }
    }
    return fail(comp, `\`.${method}()\` is not supported`, n);
  }
  return fail(comp, "this call is not supported", n);
}

function helperCall(s: Scope, name: string, args: N[], n: N): Val {
  const h = HELPERS[name]!;
  if (args.length !== h.params.length) fail(s.comp, `\`${name}\` takes ${h.params.length} argument(s)`, n);
  const code = args.map((a, i) => coerce(s.comp, expr(s, a), h.params[i]!, a)).join(", ");
  s.helperBytes.n += h.maxLen;
  return { code: `${h.rust}(${code})`, ty: h.ret };
}

/* ── Output ──────────────────────────────────────────────────────────────────────────────── */

/** Statements, with adjacent literal pushes merged into one `push_str`. */
class Emitter {
  lines: string[] = [];
  /** Bytes of literal markup written once per render, part of what `render` reserves up front. */
  literalBytes = 0;
  /** Rust expressions for the rest of the reservation: a loop's markup once per item. */
  perItem: string[] = [];
  private pending = "";
  private depth = 1;

  lit(s: string): void {
    this.pending += s;
    this.literalBytes += Buffer.byteLength(s);
  }

  stmt(code: string): void {
    this.flush();
    this.lines.push("    ".repeat(this.depth) + code);
  }

  open(code: string): void {
    this.stmt(code ? code + " {" : "{");
    this.depth++;
  }

  close(tail = ""): void {
    this.flush();
    this.depth--;
    this.lines.push("    ".repeat(this.depth) + "}" + tail);
    // `} else {` closes one block and opens the next.
    if (tail.endsWith("{")) this.depth++;
  }

  flush(): void {
    if (!this.pending) return;
    const text = this.pending;
    this.pending = "";
    this.lines.push("    ".repeat(this.depth) + `out.push_str(${rustStr(text)});`);
  }
}

/** `toDisplayString`, escaped. */
function interpolate(e: Emitter, v: Val): void {
  switch (v.ty.k) {
    case "str":
      e.stmt(`fv::escape_into(out, ${v.code});`);
      return;
    case "int":
      e.stmt(`fv::push_int(out, ${v.code});`);
      return;
    case "bool":
      e.stmt(`out.push_str(if ${v.code} { "true" } else { "false" });`);
      return;
    case "undef":
      return;
    case "opt":
      e.open(`if let Some(v) = ${v.code}`);
      interpolate(e, { code: "v", ty: v.ty.of });
      e.close();
      return;
    default:
      throw new GenError("only strings, integers and booleans can be interpolated");
  }
}

/** The value half of `key="value"`, escaped. */
function attrValue(e: Emitter, v: Val): void {
  switch (v.ty.k) {
    case "str":
      e.stmt(`fv::escape_into(out, ${v.code});`);
      return;
    case "int":
      e.stmt(`fv::push_int(out, ${v.code});`);
      return;
    case "bool":
      e.stmt(`out.push_str(if ${v.code} { "true" } else { "false" });`);
      return;
    default:
      throw new GenError("an attribute value must be a string, integer or boolean");
  }
}

/** `ssrRenderAttr(key, value)`: absent for null/undefined, `key="value"` for anything else. */
function renderAttr(e: Emitter, key: string, v: Val): void {
  if (v.ty.k === "undef") return;
  if (v.ty.k === "opt") {
    e.open(`if let Some(v) = ${v.code}`);
    renderAttr(e, key, { code: "v", ty: v.ty.of });
    e.close();
    return;
  }
  e.lit(` ${key}="`);
  attrValue(e, v);
  e.lit(`"`);
}

/** `ssrRenderDynamicAttr(key, value)`: as `renderAttr`, but a boolean attribute is present or
 * absent, and an empty string renders the name alone. */
function renderDynamicAttr(s: Scope, e: Emitter, key: string, v: Val, n: N): void {
  const name = (propsToAttrMap as Record<string, string | undefined>)[key] ?? key.toLowerCase();
  if (!isSSRSafeAttrName(name)) fail(s.comp, `unsafe attribute name \`${name}\``, n);
  if (v.ty.k === "undef") return;
  if (v.ty.k === "opt") {
    e.open(`if let Some(v) = ${v.code}`);
    renderDynamicAttr(s, e, key, { code: "v", ty: v.ty.of }, n);
    e.close();
    return;
  }
  if (isBooleanAttr(name) || (name === "hidden" && (v.ty.k === "bool" || v.ty.k === "int"))) {
    if (v.ty.k === "str") e.lit(` ${name}`);
    else {
      e.open(`if ${truthy(v)}`);
      e.lit(` ${name}`);
      e.close();
    }
    return;
  }
  if (v.ty.k === "str") {
    e.open(`if (${v.code}).is_empty()`);
    e.lit(` ${name}`);
    e.close(" else {");
    e.lit(` ${name}="`);
    // Re-evaluated rather than bound: every string expression here is a borrow or a pure call.
    attrValue(e, v);
    e.lit(`"`);
    e.close();
    return;
  }
  e.lit(` ${name}="`);
  attrValue(e, v);
  e.lit(`"`);
}

/** One item of a class list once it is flattened: literal text, known now, or a Rust `&str`
 * expression evaluated at run time — empty when the item contributes nothing. */
type ClassItem = { lit: string } | { code: string };

/** `normalizeClass`'s view of a class binding, flattened: a string, an array of items, an object
 * of `name: condition`, `cond && "name"`, `cond ? "a" : null`. Every item is trimmed and the empty
 * ones dropped before they are joined with one space, which is what `class_into` does too, so an
 * object's keys become items of their own. */
function classItems(s: Scope, n: N): ClassItem[] {
  switch (n.type) {
    case "StringLiteral": {
      const t = n.value.trim();
      return t ? [{ lit: t }] : [];
    }
    case "ArrayExpression":
      return n.elements.flatMap((el: N) => (el ? classItems(s, el) : []));
    case "ObjectExpression":
      return n.properties.flatMap((p: N): ClassItem[] => {
        if (p.type !== "ObjectProperty") fail(s.comp, "a class object holds `name: condition` pairs", p);
        // A literal name is written as it is: an object's names are joined, not trimmed one by one.
        let name: ClassItem;
        if (!p.computed) {
          const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
          if (key !== key.trim() || !key) fail(s.comp, `class name \`${key}\` has spaces around it`, p);
          name = { lit: key };
        } else {
          const k = expr(s, p.key);
          if (k.ty.k !== "str") fail(s.comp, "a computed class name is a string", p.key);
          name = { code: `fv::js_trim(${k.code})` };
        }
        const v = expr(s, p.value);
        if (v.konst === false) return [];
        if (v.konst === true) return [name];
        const text = "lit" in name ? rustStr(name.lit) : name.code;
        return [{ code: `if ${truthy(v)} { ${text} } else { "" }` }];
      });
    case "LogicalExpression":
      if (n.operator === "&&") {
        const right = classItems(s, n.right);
        const test = cond(s, n.left);
        return right.map((it) => ({ code: `if ${test} { ${"lit" in it ? rustStr(it.lit) : it.code} } else { "" }` }));
      }
      break;
    case "ConditionalExpression":
      if (n.consequent.type === "NullLiteral" || n.alternate.type === "NullLiteral") {
        const branch = n.consequent.type === "NullLiteral" ? n.alternate : n.consequent;
        const test = cond(s, n.test);
        const items = classItems(s, branch);
        const when = n.consequent.type === "NullLiteral" ? `!(${test})` : test;
        return items.map((it) => ({ code: `if ${when} { ${"lit" in it ? rustStr(it.lit) : it.code} } else { "" }` }));
      }
      break;
  }
  const v = expr(s, n);
  if (v.ty.k === "str") return [{ code: v.code }];
  if (v.ty.k === "opt" && v.ty.of.k === "str") return [{ code: `(${v.code}).unwrap_or("")` }];
  if (v.ty.k === "undef") return [];
  return fail(s.comp, "a class is a string, an array, or an object of conditions", n);
}

/** `ssrRenderClass(value)`: normalised, then escaped. `after` says a class was already written. */
function renderClass(s: Scope, e: Emitter, n: N, after = false): void {
  const items = classItems(s, n);
  // Literal items before the first run-time one are written now; the rest go to `class_into`,
  // which decides at run time whether each needs a separator.
  let wrote = after;
  let i = 0;
  for (; i < items.length; i++) {
    const it = items[i]!;
    if (!("lit" in it)) break;
    e.lit((wrote ? " " : "") + escapeHtml(it.lit));
    wrote = true;
  }
  if (i < items.length) {
    const rest = items.slice(i).map((it) => ("lit" in it ? rustStr(it.lit) : it.code));
    e.stmt(`fv::class_into(out, ${wrote}, &[${rest.join(", ")}]);`);
  }
}

const IGNORED_PROPS = new Set(["", "key", "ref", "innerHTML", "textContent", "ref_key", "ref_for"]);

/** `ssrRenderAttrs(obj)`, key by key in the object's order. `_attrs` is always empty: an island
 * passes a child only the props it declares, so nothing falls through. */
/** `ssrGetDirectiveProps(_ctx, dir)`: a custom directive's server props, which are none for a
 * directive the configuration declares client-only. `false` when `n` is not such a call. */
function directiveProps(s: Scope, n: N): boolean {
  if (n?.type !== "CallExpression" || n.callee.type !== "Identifier" || n.callee.name !== "_ssrGetDirectiveProps") return false;
  const dir = n.arguments[1];
  // `$setup["vFocus"]` for an imported directive, `_directive_focus` for a registered one.
  let name: string | null = null;
  if (dir?.type === "MemberExpression") {
    const local: string = dir.computed ? dir.property.value : dir.property.name;
    name = hyphenate(local.replace(/^v(?=[A-Z])/, "")).replace(/^-/, "");
  } else if (dir?.type === "Identifier") name = s.directives.get(dir.name) ?? null;
  if (name === null || !CLIENT_DIRECTIVES.has(name)) {
    fail(s.comp, `custom directive \`v-${name ?? "?"}\` may add attributes on the server; if it has no \`getSSRProps\`, list \`${name ?? "?"}\` in \`clientDirectives\` in ${CONFIG_FILE}`, n);
  }
  return true;
}

function renderAttrs(s: Scope, e: Emitter, n: N): void {
  if (n.type === "Identifier" && n.name === "_attrs") return;
  if (directiveProps(s, n)) return;
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_mergeProps") {
    renderAttrs(s, e, mergeProps(s, n));
    return;
  }
  if (n.type !== "ObjectExpression") fail(s.comp, "attributes must be an object literal", n);
  for (const p of n.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "attribute objects hold plain keys", p);
    const raw: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    if (IGNORED_PROPS.has(raw) || /^on[^a-z]/.test(raw) || raw.startsWith(".")) continue;
    // Vue strips the `^` attribute-binding prefix before it looks at the name.
    const key = raw.startsWith("^") ? raw.slice(1) : raw;
    if (key === "className") {
      fail(s.comp, "`className` renders by its own rule in Vue; bind `class`", p);
    } else if (key === "class") {
      e.lit(` class="`);
      renderClass(s, e, p.value);
      e.lit(`"`);
    } else if (key === "style") {
      e.lit(` style="`);
      renderStyle(s, e, p.value);
      e.lit(`"`);
    } else {
      renderDynamicAttr(s, e, key, expr(s, p.value), p);
    }
  }
}

/** `mergeProps(a, _attrs, b, …)` as one object literal. `_attrs` is empty, an island passing a child
 * only the props it declares; of the rest, `class` and `style` values are merged as an array, and
 * any other key keeps the place it first had with the last value given. */
function mergeProps(s: Scope, n: N): N {
  const merged = new Map<string, N>();
  for (const a of n.arguments) {
    if (a.type === "Identifier" && a.name === "_attrs") continue;
    if (directiveProps(s, a)) continue;
    if (a.type !== "ObjectExpression") fail(s.comp, "`_mergeProps` of object literals is supported", a);
    for (const p of a.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "attribute objects hold plain keys", p);
      const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
      const had = merged.get(key);
      if (had && (key === "class" || key === "style")) {
        merged.set(key, { ...p, value: { type: "ArrayExpression", elements: [had.value, p.value] } });
      } else if (had) {
        // `Map` keeps a key where it was first set, as a JavaScript object does.
        merged.set(key, { ...had, value: p.value });
      } else merged.set(key, p);
    }
  }
  return { type: "ObjectExpression", properties: [...merged.values()] };
}

/** One object of a style binding, and the run-time condition under which it is part of it. */
interface StyleItem {
  cond: string | null;
  entries: { key: string; css: string; value: N }[];
}

/** The objects a style binding merges, in order: an object literal, a static `style` the compiler
 * parsed, `v-show`'s `cond ? null : { display: "none" }`, and arrays of those. */
function styleItems(s: Scope, n: N, when: string | null): StyleItem[] {
  const both = (a: string | null, b: string) => (a === null ? b : `(${a} && ${b})`);
  switch (n.type) {
    case "NullLiteral":
      return [];
    case "ArrayExpression":
      return n.elements.flatMap((el: N) => (el ? styleItems(s, el, when) : []));
    case "StringLiteral":
      // Parsed as `normalizeStyle` parses a string inside an array, by Vue's own function.
      return [{ cond: when, entries: Object.entries(parseStringStyle(n.value)).map(([key, v]) => ({ key, css: key, value: { type: "StringLiteral", value: v } })) }];
    case "ConditionalExpression": {
      const t = `(${cond(s, n.test)})`;
      return [...styleItems(s, n.consequent, both(when, t)), ...styleItems(s, n.alternate, both(when, `!${t}`))];
    }
    case "LogicalExpression":
      if (n.operator === "&&") return styleItems(s, n.right, both(when, `(${cond(s, n.left)})`));
      break;
    case "ObjectExpression":
      return [{
        cond: when,
        entries: n.properties.map((p: N) => {
          if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "a style object holds plain `property: value` pairs", p);
          const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
          // An integer-like key comes first in a JavaScript object whatever the order written.
          if (/^\d+$/.test(key) || key.startsWith(":")) fail(s.comp, `style property \`${key}\``, p);
          return { key, css: key.startsWith("--") ? key : hyphenate(key), value: p.value };
        }),
      }];
  }
  return fail(s.comp, "a style binding is an object, an array of objects, or a string on its own", n);
}

/** `ssrRenderStyle(value)`: a string as it is, or the objects merged — each property where it first
 * appears, with the last value given — and written `name:value;`, all escaped. */
function renderStyle(s: Scope, e: Emitter, n: N): void {
  // A string on its own is written as it is, with no normalising.
  if (n.type === "StringLiteral") {
    e.lit(escapeHtml(n.value));
    return;
  }
  if (n.type !== "ObjectExpression" && n.type !== "ArrayExpression" && n.type !== "ConditionalExpression" && n.type !== "LogicalExpression" && n.type !== "NullLiteral") {
    const v = expr(s, n);
    if (v.ty.k === "str") e.stmt(`fv::escape_into(out, ${v.code});`);
    else if (v.ty.k === "opt" && v.ty.of.k === "str") {
      e.open(`if let Some(v) = ${v.code}`);
      e.stmt("fv::escape_into(out, v);");
      e.close();
    } else if (v.ty.k !== "undef") fail(s.comp, "a style binding is a string, an object or an array", n);
    return;
  }
  const items = styleItems(s, n, null);
  // Each property, where it first appears, with every place that sets it.
  const order: string[] = [];
  const sets = new Map<string, { cond: string | null; css: string; value: N }[]>();
  for (const it of items) {
    for (const en of it.entries) {
      if (!sets.has(en.key)) {
        order.push(en.key);
        sets.set(en.key, []);
      }
      sets.get(en.key)!.push({ cond: it.cond, css: en.css, value: en.value });
    }
  }
  const write = (css: string, value: N): void => {
    // A literal is stringified now, by JavaScript itself: `0.5`, `"1px"`.
    if (value.type === "StringLiteral" || value.type === "NumericLiteral") {
      e.lit(escapeHtml(`${css}:${String(value.value)};`));
      return;
    }
    const v = expr(s, value);
    const one = (w: Val): void => {
      if (w.ty.k === "str" || w.ty.k === "int") {
        e.lit(`${escapeHtml(css)}:`);
        e.stmt(w.ty.k === "str" ? `fv::escape_into(out, ${w.code});` : `fv::push_int(out, ${w.code});`);
        e.lit(";");
      } else if (w.ty.k === "opt") {
        e.open(`if let Some(v) = ${w.code}`);
        one({ code: "v", ty: w.ty.of });
        e.close();
      }
      // A boolean or `undefined` writes nothing — and, set later, removes what was set before.
    };
    one(v);
  };
  // A property's place is where an object that is present first sets it. When that object is
  // conditional and the property is set again after another one first appears, the order would be
  // decided at run time.
  const flat = items.flatMap((it, i) => it.entries.map((en) => ({ key: en.key, item: i, cond: it.cond })));
  for (const key of order) {
    const at = flat.filter((f) => f.key === key);
    if (at.length < 2 || at[0]!.cond === null) continue;
    const first = flat.indexOf(at[0]!);
    const again = flat.indexOf(at[at.length - 1]!);
    const between = flat.slice(first + 1, again).some((f) => order.indexOf(f.key) > order.indexOf(key));
    if (between) fail(s.comp, `the place of style property \`${key}\` would depend on a condition; set it unconditionally first`, n);
  }
  for (const key of order) {
    // The last place that sets it wins: walked back to the first that always applies.
    const chain: { cond: string | null; css: string; value: N }[] = [];
    for (const set of [...sets.get(key)!].reverse()) {
      chain.push(set);
      if (set.cond === null) break;
    }
    if (chain.length === 1 && chain[0]!.cond === null) {
      write(chain[0]!.css, chain[0]!.value);
      continue;
    }
    chain.forEach((set, i) => {
      if (set.cond === null) {
        e.close(" else {");
      } else if (i === 0) {
        e.open(`if ${set.cond}`);
      } else {
        e.close(` else if ${set.cond} {`);
      }
      write(set.css, set.value);
    });
    e.close();
  }
}

/** One `${...}` inside a pushed template literal. */
function slot(s: Scope, e: Emitter, n: N): void {
  // A slot's scope id, for scoped styles, which an island never has.
  if (n.type === "Identifier" && n.name === "_scopeId") return;
  if (n.type === "CallExpression" && n.callee.type === "Identifier") {
    const a: N[] = n.arguments;
    switch (n.callee.name) {
      case "_ssrInterpolate":
        interpolate(e, expr(s, a[0]));
        return;
      case "_ssrRenderAttr":
        if (a[0].type !== "StringLiteral") fail(s.comp, "attribute names are literal", n);
        renderAttr(e, a[0].value, expr(s, a[1]));
        return;
      // `:hidden`, whose rendering depends on the value's type: Vue cannot decide it at compile time.
      case "_ssrRenderDynamicAttr":
        if (a[0].type !== "StringLiteral") fail(s.comp, "attribute names are literal", n);
        renderDynamicAttr(s, e, a[0].value, expr(s, a[1]), n);
        return;
      case "_ssrRenderAttrs":
        if (a.length > 1) fail(s.comp, "`ssrRenderAttrs` with a tag argument", n);
        renderAttrs(s, e, a[0]);
        return;
      case "_ssrRenderClass":
        renderClass(s, e, a[0]);
        return;
      case "_ssrRenderStyle":
        renderStyle(s, e, a[0]);
        return;
    }
  }
  /* `v-html`, which Vue compiles to the bare value with an empty-string fallback and no escaping.
   * Only a `TrustedHtml` prop may arrive here; anything else would be a string written raw. */
  if (n.type === "LogicalExpression" && n.operator === "??" && n.right.type === "StringLiteral" && n.right.value === "") {
    const v = expr(s, n.left);
    if (v.ty.k === "html") {
      e.stmt(`fv::trusted_into(out, ${v.code});`);
      return;
    }
    if (v.ty.k === "opt" && v.ty.of.k === "html") {
      e.open(`if let Some(html) = ${v.code}`);
      e.stmt("fv::trusted_into(out, html);");
      e.close();
      return;
    }
    fail(s.comp, "`v-html` renders only a `TrustedHtml` prop (from `ferrovue/types`)", n);
  }
  if (n.type === "ConditionalExpression" && n.consequent.type === "StringLiteral" && n.alternate.type === "StringLiteral") {
    const t = expr(s, n.test);
    if (t.konst !== undefined) {
      e.lit(t.konst ? n.consequent.value : n.alternate.value);
      return;
    }
    e.open(`if ${truthy(t)}`);
    e.lit(n.consequent.value);
    if (n.alternate.value) {
      e.close(" else {");
      e.lit(n.alternate.value);
    }
    e.close();
    return;
  }
  fail(s.comp, "this expression cannot be rendered on the server", n);
}

/** `isComment` in `@vue/server-renderer`: a chunk that is only comments and whitespace. */
function isComment(text: string): boolean {
  if (!/^<!--[\s\S]*-->$/.test(text)) return false;
  return text.length <= 8 || !text.replace(/<!--[^]*?-->/gm, "").trim();
}

/** Whether a `_push` argument is content to `ssrRenderSlot`, rather than only comments. */
function pushesContent(s: Scope, n: N): boolean {
  if (n.type === "StringLiteral") return !isComment(n.value);
  if (n.type === "TemplateLiteral") {
    if (n.expressions.length === 0) return !isComment(n.quasis[0].value.cooked);
    if (n.quasis[0].value.cooked.startsWith("<!--")) {
      fail(s.comp, "slot content that starts with a comment holding an interpolation", n);
    }
    return true;
  }
  // A component's render is a buffer, never a comment.
  return true;
}

function push(s: Scope, e: Emitter, n: N): void {
  if (s.fill && pushesContent(s, n)) e.stmt("filled = true;");
  const text = n.type === "StringLiteral" ? n.value : n.type === "TemplateLiteral" && !n.expressions.length ? n.quasis[0].value.cooked : null;
  if (s.vnode && text === "<!---->") {
    e.lit("<!--v-if-->");
    return;
  }
  if (n.type === "StringLiteral") {
    e.lit(n.value);
    return;
  }
  if (n.type === "TemplateLiteral") {
    n.quasis.forEach((q: N, i: number) => {
      e.lit(q.value.cooked);
      if (i < n.expressions.length) slot(s, e, n.expressions[i]);
    });
    return;
  }
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_ssrRenderComponent") {
    const target = n.arguments[0];
    const routed =
      target.type === "Identifier"
        ? s.router.get(target.name)
        : target.type === "MemberExpression" && target.object.name === "$setup"
          ? s.router.get(target.computed ? target.property.value : target.property.name)
          : undefined;
    if (routed === "RouterLink") routerLink(s, e, n);
    else if (routed === "RouterView") e.stmt("fv_slots.router_view.render_to(out);");
    else renderChild(s, e, n);
    return;
  }
  fail(s.comp, "this cannot be pushed", n);
}

function renderChild(s: Scope, e: Emitter, n: N): void {
  const [target, rawProps, slots] = n.arguments;
  let local: string | null = null;
  if (target.type === "MemberExpression" && target.object.name === "$setup") {
    local = target.computed ? target.property.value : target.property.name;
  }
  const isSelf = target.type === "Identifier" && target.name === s.selfAlias.name;
  const childName = isSelf ? s.comp.name : local ? s.children.get(local) : undefined;
  const child = childName ? s.components.get(childName) : undefined;
  // Inside a `v-for`, Vue merges a `{ ref_for: true }` marker into the props; it renders nothing.
  let props = rawProps;
  if (
    props?.type === "CallExpression" && props.callee.type === "Identifier" && props.callee.name === "_mergeProps" &&
    props.arguments.length === 2 && props.arguments[0].type === "ObjectExpression" &&
    props.arguments[0].properties.every((p: N) => p.type === "ObjectProperty" && IGNORED_PROPS.has(p.key.name ?? p.key.value))
  ) {
    props = props.arguments[1];
  }
  // A component at the root of the template is handed the fallthrough attributes, which an island
  // never has.
  if (
    props?.type === "CallExpression" && props.callee.type === "Identifier" && props.callee.name === "_mergeProps" &&
    props.arguments.length === 2 && props.arguments[1].type === "Identifier" && props.arguments[1].name === "_attrs"
  ) {
    props = props.arguments[0];
  }
  if (props?.type === "Identifier" && props.name === "_attrs") props = { type: "ObjectExpression", properties: [] };
  if (!child) fail(s.comp, "a child component must be an imported island", n);
  if (child.routerView) {
    fail(s.comp, `${child.name} holds \`<RouterView>\`: the server renders it at the top, never as a child`, n);
  }
  // `v-bind="x"`, where `x` is exactly the child's own `Props`: handed over as it is.
  if (props.type !== "ObjectExpression") {
    const v = expr(s, props);
    // The component itself, however the template reached it: its own `Props` struct is the type.
    const own = child.name === s.comp.name && v.ty.k === "struct" && v.ty.name === "Props";
    if (own || (v.ty.k === "child" && v.ty.name === child.name)) {
      callChild(s, e, child, v.code, slots, n);
      return;
    }
    fail(s.comp, `child props must be an object literal, or \`v-bind\` of ${child.name}'s own \`Props\``, n);
  }

  const given = new Map<string, N>();
  for (const p of props.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "child props hold plain keys", p);
    const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    // Listeners, `v-model`'s `onUpdate:…` among them, run on the client alone; a model's modifiers
    // change only what an update writes.
    if (IGNORED_PROPS.has(key) || /^on[^a-z]/.test(key)) continue;
    if (key.endsWith("Modifiers") && child.props.fields.some((f) => f.js === (key === "modelModifiers" ? "modelValue" : key.slice(0, -"Modifiers".length)))) continue;
    if (!child.props.fields.some((f) => f.js === key)) {
      // A key the child does not declare would fall through onto its root element as an
      // attribute, which the generated child does not render.
      fail(s.comp, `\`${key}\` is not a prop of ${child.name}`, p);
    }
    given.set(key, p.value);
  }
  const inits = child.props.fields.map((f) => {
    const node = given.get(f.js);
    if (!node) {
      if (f.ty.k !== "opt") fail(s.comp, `${child.name} requires \`${f.js}\``, n);
      return `${f.rust}: None`;
    }
    // Each side's own types named by the component that declares them, so that a type the parent
    // imports from the child's `.vue` file is the child's type.
    const v = expr(s, node);
    return `${f.rust}: ${ownInto(s.comp, { ...v, ty: markHome(v.ty, s.comp.name) }, markHome(f.ty, child.name), node)}`;
  });
  callChild(s, e, child, `&super::${child.module}::Props { ${inits.join(", ")} }`, slots, n);
}

/** Whether a component takes a `Slots` argument. */
function takesSlots(c: Component): boolean {
  return c.slotNames.length > 0 || c.routerView;
}

/** The arguments after `props` that a component's `render` takes. */
function extraParams(c: Component): string {
  return (
    (takesSlots(c) ? ", fv_slots: Slots<'_>" : "") +
    (c.usesRoute ? ", fv_route: &fv::Route<'_>" : "") +
    (c.usesStores ? ", fv_stores: &super::stores::Stores<'_>" : "")
  );
}

/** `render(out, props[, slots][, route])` for a child, with the slot content this template gives
 * it as closures. */
function callChild(s: Scope, e: Emitter, child: Component, propsCode: string, slots: N, _n: N): void {
  const given = new Map<string, N>();
  if (slots && slots.type !== "NullLiteral") {
    if (slots.type !== "ObjectExpression") fail(s.comp, "slots must be an object literal", slots);
    for (const p of slots.properties) {
      const key: string = p.key?.type === "Identifier" ? p.key.name : p.key?.value;
      if (key === "_") continue;
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "slots hold plain keys", p);
      if (!child.slotNames.includes(key)) fail(s.comp, `${child.name} has no slot \`${key}\``, p);
      given.set(key, p.value);
    }
  }
  const m = `super::${child.module}`;
  const route = (child.usesRoute ? ", fv_route" : "") + (child.usesStores ? ", fv_stores" : "");
  if (!takesSlots(child)) {
    e.stmt(`${m}::render(out, ${propsCode}${route});`);
    return;
  }
  e.open(`${m}::render(out, ${propsCode}, ${m}::Slots`);
  for (const name of child.slotNames) {
    const field = snake(name);
    const value = given.get(name);
    if (!value) {
      e.stmt(`${field}: None,`);
      continue;
    }
    const { body, param } = slotContent(s, value);
    const shape = child.slotShapes.get(name);
    const takesNone = param?.type === "Identifier" && param.name === "_";
    if (shape) {
      // A scoped slot: content given the outlet's props, bound as the parent destructured them.
      const sp = `fv_sp${++narrowCount}`;
      const ty: Ty = { k: "struct", name: shape.name, home: child.name };
      const locals = new Map(s.locals);
      if (param?.type === "ObjectPattern") {
        for (const p of param.properties) {
          if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
            fail(s.comp, "slot props are destructured into plain names, without defaults", p);
          }
          locals.set(p.value.name, fieldVal(s.comp, sp, ty, p.key.name ?? p.key.value, p));
        }
      } else if (param?.type === "Identifier" && !takesNone) {
        locals.set(param.name, { code: sp, ty });
      } else if (!takesNone) fail(s.comp, "slot props are a name or an object pattern", param);
      const life = shape.fields.some((f) => slotFieldBorrows(f.ty)) ? "<'_>" : "";
      e.open(`${field}: Some(&|out: &mut String, ${sp}: &${m}::${shape.name}${life}| -> bool`);
      const inner = { ...s, locals };
      if (staticallyFilled(inner, body)) {
        statements({ ...inner, fill: false }, e, body);
        e.stmt("true");
      } else {
        e.stmt("let mut filled = false;");
        statements({ ...inner, fill: true }, e, body);
        e.stmt("filled");
      }
      e.close("),");
      continue;
    }
    if (!takesNone) fail(s.comp, `\`<slot${name === "default" ? "" : ` name="${name}"`}>\` in ${child.name} passes no props`, param);
    if (staticallyFilled(s, body)) {
      e.open(`${field}: Some(fv::Slot::new(&|out: &mut String|`);
      statements({ ...s, fill: false }, e, body);
      e.close(")),");
    } else {
      e.open(`${field}: Some(fv::Slot::markup(&|out: &mut String| -> bool`);
      e.stmt("let mut filled = false;");
      statements({ ...s, fill: true }, e, body);
      e.stmt("filled");
      e.close(")),");
    }
  }
  e.close(`${route});`);
}

/** The statements a parent's slot content pushes: the `if (_push)` half of its `_withCtx`. */
function slotBody(s: Scope, value: N): N[] {
  return slotContent(s, value).body;
}

/** A parent's slot content: what it pushes, and the parameter its scoped slot props are bound to
 * (`_` when it takes none). */
function slotContent(s: Scope, value: N): { body: N[]; param: N } {
  const fn =
    value.type === "CallExpression" && value.callee.type === "Identifier" && value.callee.name === "_withCtx"
      ? value.arguments[0]
      : null;
  if (fn?.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected slot content", value);
  }
  const branch = fn.body.body.length === 1 ? fn.body.body[0] : null;
  if (branch?.type !== "IfStatement" || branch.test.type !== "Identifier" || branch.test.name !== "_push") {
    fail(s.comp, "unexpected slot content", fn);
  }
  const body = branch.consequent.type === "BlockStatement" ? branch.consequent.body : [branch.consequent];
  return { body, param: fn.params[0] };
}

/** Whether slot content always pushes something that is not a comment: a push of content outside
 * any `if` or loop. Then nothing has to be decided at run time. */
function staticallyFilled(s: Scope, body: N[]): boolean {
  return body.some(
    (st) =>
      st.type === "ExpressionStatement" && st.expression.type === "CallExpression" &&
      st.expression.callee.type === "Identifier" && st.expression.callee.name === "_push" &&
      pushesContent(s, st.expression.arguments[0]),
  );
}

/** `RowSlotProps`, `RowSlot`: the names of a scoped slot's props struct and content type. */
function slotTypeName(slot: string, suffix: string): string {
  return slot.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") + suffix;
}

/** Whether a scoped slot prop's Rust type borrows, and so needs the props' lifetime `'v`. */
function slotFieldBorrows(ty: Ty): boolean {
  return !(ty.k === "int" || ty.k === "bool" || (ty.k === "opt" && (ty.of.k === "int" || ty.of.k === "bool")));
}

/** A scoped slot prop's Rust type: a scalar copied, anything else borrowed from the render for `'v`. */
function slotFieldTy(ty: Ty, comp: Component): string {
  const owned = (t: Ty) => rustTy(t, comp).replace(/'a\b/g, "'v");
  switch (ty.k) {
    case "int":
      return "i64";
    case "bool":
      return "bool";
    case "str":
      return "&'v str";
    case "list":
      return `&'v [${owned(ty.of)}]`;
    case "struct":
    case "child":
    case "html":
      return `&'v ${owned(ty)}`;
    case "opt":
      return `Option<${slotFieldTy(ty.of, comp)}>`;
    default:
      throw new GenError(`no Rust type for a slot prop of type ${JSON.stringify(ty)}`);
  }
}

/** A value an outlet passes, as the scoped slot prop field holds it. */
function slotFieldValue(s: Scope, v: Val, n: N): string {
  switch (v.ty.k) {
    case "str":
    case "int":
    case "bool":
      return v.code;
    case "list":
      // An array literal is a Rust array of `&str`, not the list a slot prop borrows.
      if (v.code.startsWith("[")) fail(s.comp, "a slot prop is not an array literal: pass a list the component holds", n);
      return `&(${v.code})`;
    case "struct":
    case "child":
    case "html":
      return `&(${v.code})`;
    case "opt":
      if (v.ty.of.k === "list") return `(${v.code}).map(|v| &v[..])`;
      if (v.ty.of.k === "opt" || v.ty.of.k === "undef") break;
      return v.code;
  }
  return fail(s.comp, "a slot prop is a string, a number, a boolean, an object or a list", n);
}

/** `<slot name="x" :prop="…">fallback</slot>`: `ssrRenderSlot`, with the props a scoped slot passes. */
function slotOutlet(s: Scope, e: Emitter, c: N): void {
  const [, nameNode, slotProps, fallback] = c.arguments;
  if (nameNode?.type !== "StringLiteral") fail(s.comp, "a slot's name is literal", c);
  if (slotProps?.type !== "ObjectExpression") fail(s.comp, "a slot's props are attributes or a `v-bind` object literal", c);
  const slot: string = nameNode.value;
  const field = `fv_slots.${snake(slot)}`;
  const outlet = `\`<slot${slot === "default" ? "" : ` name="${slot}"`}>\``;
  let fn = "fv::slot_into";
  let args = field;
  if (slotProps.properties.length) {
    const fields: Field[] = [];
    const values: string[] = [];
    for (const p of slotProps.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "slot props hold plain names", p);
      const key: string = p.key.name ?? p.key.value;
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) fail(s.comp, `slot prop \`${key}\` is not a plain name; write it in camelCase`, p);
      const v = expr(s, p.value);
      fields.push({ js: key, rust: snake(key), ty: v.ty });
      values.push(`${snake(key)}: ${slotFieldValue(s, v, p.value)}`);
    }
    const name = slotTypeName(slot, "SlotProps");
    const shape: Struct = { name, fields, slot: true };
    const had = s.comp.slotShapes.get(slot);
    if (had && JSON.stringify(had.fields) !== JSON.stringify(fields)) {
      fail(s.comp, `every ${outlet} passes the same props, of the same types`, c);
    }
    if (!had) {
      if (s.comp.structs.has(name) && !s.comp.structs.get(name)!.slot) fail(s.comp, `\`${name}\` names this slot's props; rename the interface`, c);
      s.comp.slotShapes.set(slot, shape);
      s.comp.structs.set(name, shape);
    }
    fn = "fv::scoped_slot_into";
    args = `${field}, &${name} { ${values.join(", ")} }`;
  } else if (s.comp.slotShapes.has(slot)) {
    fail(s.comp, `every ${outlet} passes the same props, of the same types`, c);
  }
  const call = (rest: string) => (s.fill ? `if ${fn}(out, ${args}, ${rest}) { filled = true; }` : `${fn}(out, ${args}, ${rest});`);
  if (fallback?.type === "NullLiteral" || !fallback) {
    e.stmt(call("None"));
    return;
  }
  if (fallback.type !== "ArrowFunctionExpression" || fallback.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected slot fallback", fallback);
  }
  // The fallback writes to the same buffer as the outlet, so inside slot content it fills it too.
  e.open(`${s.fill ? "if " : ""}${fn}(out, ${args}, Some(&mut |out: &mut String|`);
  statements(s, e, fallback.body.body);
  e.close(s.fill ? ")) { filled = true; }" : "));");
}

const ROUTER_LINK_PROPS = new Set(["to", "class", "activeClass", "exactActiveClass", "ariaCurrentValue"]);

/** `<RouterLink>` props that change only what a click does, which the server does not render. */
const ROUTER_LINK_INERT = new Set(["replace", "viewTransition"]);

/** The parameter names of a route path, in order. */
function routeParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
}

/** A value written into a URL — a parameter or a query value — as the `&str` vue-router stringifies. */
function urlText(s: Scope, v: Val, n: N): string {
  if (v.ty.k === "str") return v.code;
  if (v.ty.k === "int") return `&*(${v.code}).to_string()`;
  if (v.ty.k === "bool") return `if ${v.code} { "true" } else { "false" }`;
  return fail(s.comp, "a route parameter is a string or a number that is present", n);
}

/** \`let fv_link = …;\`: a \`<RouterLink>\`'s \`to\` resolved from the reader's route. */
function resolveLink(s: Scope, e: Emitter, to: N): void {
  if (to.type !== "ObjectExpression") {
    const target = expr(s, to);
    if (target.ty.k !== "str") fail(s.comp, "`<RouterLink>`'s `to` is a string or an object literal", to);
    e.stmt(`let fv_link = fv_route.link(${target.code});`);
    return;
  }
  const parts = new Map<string, N>();
  for (const p of to.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "a `to` object holds plain keys", p);
    const key: string = p.key.name ?? p.key.value;
    if (["replace", "force", "state"].includes(key)) continue;
    if (!["name", "path", "params", "query", "hash"].includes(key)) fail(s.comp, `\`${key}\` in a \`to\` object`, p);
    parts.set(key, p.value);
  }
  e.open("let fv_link =");
  const query = parts.get("query");
  // The query, built only when the location has one.
  const search = query ? "&fv_search" : '""';
  if (query) {
    e.stmt("let mut fv_search = String::new();");
    if (query.type !== "ObjectExpression") fail(s.comp, "a `to`'s `query` is an object literal", query);
    for (const p of query.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "a query holds plain keys", p);
      const key = String(p.key.name ?? p.key.value);
      const v = expr(s, p.value);
      // An absent value leaves its key out, as `undefined` does.
      if (v.ty.k === "undef") continue;
      if (v.ty.k === "opt") {
        e.open(`if let Some(v) = ${v.code}`);
        e.stmt(`fv::query_into(&mut fv_search, ${rustStr(key)}, ${urlText(s, { code: "v", ty: v.ty.of }, p.value)});`);
        e.close();
      } else e.stmt(`fv::query_into(&mut fv_search, ${rustStr(key)}, ${urlText(s, v, p.value)});`);
    }
  }
  let hash = '""';
  const h = parts.get("hash");
  if (h) {
    const v = expr(s, h);
    if (v.ty.k !== "str") fail(s.comp, "a `to`'s `hash` is a string", h);
    hash = v.code;
  }
  const name = parts.get("name");
  const path = parts.get("path");
  if (name) {
    if (name.type !== "StringLiteral") fail(s.comp, "a `to`'s `name` is a string literal, checked against the routes", name);
    const route = ROUTES!.find((r) => r.name === name.value);
    if (!route) fail(s.comp, `no route is called \`${name.value}\``, name);
    const wanted = routeParams(route.path);
    const given = new Map<string, N>();
    const params = parts.get("params");
    if (params) {
      if (params.type !== "ObjectExpression") fail(s.comp, "a `to`'s `params` is an object literal", params);
      for (const p of params.properties) {
        if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "params hold plain keys", p);
        const key = String(p.key.name ?? p.key.value);
        if (!wanted.includes(key)) fail(s.comp, `route \`${name.value}\` has no parameter \`${key}\``, p);
        given.set(key, p.value);
      }
    }
    const missing = wanted.filter((w) => !given.has(w));
    if (missing.length) fail(s.comp, `route \`${name.value}\` needs \`${missing.join("`, `")}\`: give every parameter`, to);
    const list = wanted.map((w) => `(${rustStr(w)}, ${urlText(s, expr(s, given.get(w)), given.get(w))})`);
    e.stmt(`fv_route.link_named(${rustStr(name.value)}, &[${list.join(", ")}], ${search}, ${hash})`);
  } else if (path) {
    if (parts.has("params")) fail(s.comp, "a `to` with a `path` takes no `params`, which vue-router ignores", path);
    const v = expr(s, path);
    if (v.ty.k !== "str") fail(s.comp, "a `to`'s `path` is a string", path);
    e.stmt(`fv_route.link_path(${v.code}, ${search}, ${hash})`);
  } else fail(s.comp, "a `to` object has a `name` or a `path`", to);
  e.close(";");
}

/** \`<RouterLink to="...">\` as vue-router renders it: \`aria-current\` and the active classes when it
 * points where the reader is, then \`href\`, then the link's own class and attributes. */
function routerLink(s: Scope, e: Emitter, n: N): void {
  const [, rawProps, slots] = n.arguments;
  let props = rawProps;
  if (props?.type === "CallExpression" && props.callee.type === "Identifier" && props.callee.name === "_mergeProps") {
    props = mergeProps(s, props);
  }
  if (props?.type !== "ObjectExpression") fail(s.comp, "`<RouterLink>` takes literal attributes", n);
  const fields = new Map<string, N>();
  const attrs: N[] = [];
  for (const p of props.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "`<RouterLink>` attributes hold plain keys", p);
    const raw: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    const key = raw.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    if (ROUTER_LINK_PROPS.has(key)) fields.set(key, p.value);
    else if (/^on[^a-z]/.test(raw) || IGNORED_PROPS.has(raw) || ROUTER_LINK_INERT.has(key)) continue;
    else if (key === "custom") fail(s.comp, "`custom` on `<RouterLink>` renders a scoped slot, which is not supported", p);
    else if (key === "href" || key === "ariaCurrent") fail(s.comp, `\`${raw}\` on \`<RouterLink>\` is its own`, p);
    else attrs.push({ ...p, key: { type: "StringLiteral", value: raw } });
  }
  const to = fields.get("to");
  if (!to) fail(s.comp, "`<RouterLink>` needs `to`", n);
  if (!ROUTES) fail(s.comp, `\`<RouterLink>\` needs \`routes\` in ${CONFIG_FILE}: the paths it resolves against`, n);
  /** A literal-string prop, which the class names and `aria-current` must be. */
  const literal = (key: string, fallback: string): string => {
    const v = fields.get(key);
    if (!v) return fallback;
    if (v.type !== "StringLiteral") fail(s.comp, `\`${key}\` on \`<RouterLink>\` is a string literal`, v);
    return v.value;
  };
  const activeClass = literal("activeClass", LINK_ACTIVE);
  const exactClass = literal("exactActiveClass", LINK_EXACT_ACTIVE);
  const ariaCurrent = literal("ariaCurrentValue", "page");
  e.open("");
  resolveLink(s, e, to);
  e.lit("<a");
  e.open("if fv_link.active");
  e.lit(` aria-current="${escapeHtml(ariaCurrent)}"`);
  e.close();
  e.lit(' href="');
  e.stmt("fv::escape_into(out, &fv_link.href);");
  e.lit('" class="');
  // `{ [activeClass]: isActive, [exactActiveClass]: isExactActive }`: one key when the two are the
  // same, and both true together, as they are for the flat routes ferrovue supports.
  const active = activeClass === exactClass ? [activeClass] : [activeClass, exactClass];
  const linkItems = active.map((c) => `if fv_link.active { ${rustStr(c)} } else { "" }`);
  const cls = fields.get("class");
  const own = cls ? classItems(s, cls).map((it) => ("lit" in it ? rustStr(it.lit) : it.code)) : [];
  if (own.length === 0 && active.join(" ") === "router-link-active router-link-exact-active") {
    e.open("if fv_link.active");
    e.lit("router-link-active router-link-exact-active");
    e.close();
  } else e.stmt(`fv::class_into(out, false, &[${[...linkItems, ...own].join(", ")}]);`);
  e.lit('"');
  for (const p of attrs) {
    const key: string = p.key.value;
    if (key === "style") {
      e.lit(` style="`);
      renderStyle(s, e, p.value);
      e.lit(`"`);
      continue;
    }
    renderDynamicAttr(s, e, key, expr(s, p.value), p);
  }
  e.lit(">");
  if (slots && slots.type !== "NullLiteral") {
    if (slots.type !== "ObjectExpression") fail(s.comp, "slots must be an object literal", slots);
    for (const p of slots.properties) {
      const key: string = p.key?.type === "Identifier" ? p.key.name : p.key?.value;
      if (key === "_") continue;
      if (key !== "default") fail(s.comp, "`<RouterLink>` has only its default slot", p);
      statements({ ...s, fill: false, vnode: true }, e, slotBody(s, p.value));
    }
  }
  e.lit("</a>");
  e.close();
}

/** A value into a child's props field, whose strings are `Cow`s. */
function ownInto(comp: Component, v: Val, want: Ty, node: N): string {
  if (want.k === "str") {
    if (v.ty.k !== "str") fail(comp, "a string prop needs a string", node);
    return `std::borrow::Cow::Borrowed(${v.code})`;
  }
  if (want.k === "opt" && want.of.k === "str") {
    if (v.ty.k === "undef") return "None";
    if (v.ty.k === "str") return `Some(std::borrow::Cow::Borrowed(${v.code}))`;
    if (v.ty.k === "opt" && v.ty.of.k === "str") return `(${v.code}).map(std::borrow::Cow::Borrowed)`;
  }
  if (sameTy(v.ty, want) && (want.k === "int" || want.k === "bool")) return v.code;
  if (want.k === "opt" && sameTy(v.ty, want.of) && (v.ty.k === "int" || v.ty.k === "bool")) return `Some(${v.code})`;
  // An object, a list of objects, or an optional one, of the type the child declares: cloned, which
  // copies its strings only where they are owned.
  const objecty = (t: Ty): boolean => t.k === "struct" || t.k === "child" || ((t.k === "list" || t.k === "opt") && objecty(t.of));
  if (objecty(want) && sameTy(v.ty, want)) return v.ty.k === "opt" ? `(${v.code}).cloned()` : `(${v.code}).to_owned()`;
  if (want.k === "opt" && objecty(want.of) && sameTy(v.ty, want.of)) return `Some((${v.code}).to_owned())`;
  if (objecty(want) && v.ty.k === want.k && JSON.stringify(v.ty).includes('"struct"')) {
    fail(comp, `a ${JSON.stringify(v.ty)} where the child takes a ${JSON.stringify(want)}: two components share a type only when both import it from one \`.ts\` file`, node);
  }
  // A list of strings or numbers: each item borrowed, or copied, into the child's own list.
  if (want.k === "list" && v.ty.k === "list" && v.ty.of.k === "undef") return "Vec::new()";
  if (want.k === "opt" && want.of.k === "list" && v.ty.k === "list") return `Some(${ownInto(comp, v, want.of, node)})`;
  if (want.k === "list" && v.ty.k === "list" && sameTy(v.ty.of, want.of)) {
    if (want.of.k === "str") return `(${v.code}).iter().map(|v| std::borrow::Cow::Borrowed(&**v)).collect()`;
    if (want.of.k === "int" || want.of.k === "bool") return `(${v.code}).clone()`;
  }
  return fail(comp, `a ${JSON.stringify(v.ty)} into a ${JSON.stringify(want)} prop`, node);
}

function statements(s: Scope, e: Emitter, body: N[]): void {
  for (const st of body) {
    if (st.type === "ExpressionStatement" && st.expression.type === "CallExpression") {
      const c = st.expression;
      const callee = c.callee.type === "Identifier" ? c.callee.name : null;
      if (callee === "_push") {
        push(s, e, c.arguments[0]);
        continue;
      }
      if (callee === "_ssrRenderList") {
        list(s, e, c);
        continue;
      }
      if (callee === "_ssrRenderSlot") {
        slotOutlet(s, e, c);
        continue;
      }
      // `<Suspense>`: its default content, rendered in place — ferrovue renders nothing async.
      if (callee === "_ssrRenderSuspense") {
        const def = c.arguments[1]?.properties?.find((p: N) => (p.key?.name ?? p.key?.value) === "default");
        if (!def) e.lit("<!---->");
        else if (def.value.type === "ArrowFunctionExpression" && def.value.body.type === "BlockStatement") statements(s, e, def.value.body.body);
        else fail(s.comp, "unexpected `<Suspense>` content", c);
        continue;
      }
      if (callee === "_ssrRenderTeleport") {
        fail(s.comp, "`<Teleport>` renders its content into a separate buffer the page must place; render it on the client (`<ClientOnly>`, `defer`, or `disabled`) or place the content in the page", st);
      }
      if (callee === "_ssrRenderVNode") {
        fail(s.comp, "`<component :is>` chooses its component at run time; write the choices out with `v-if`", st);
      }
    }
    /* `const _component_X = _resolveComponent("X", true)`: a component that uses itself, which is
     * how a tree renders. Any other component resolved by name is one this compiler cannot see. */
    if (st.type === "VariableDeclaration" && st.declarations.length === 1) {
      const d = st.declarations[0];
      const init = d.init;
      if (
        init?.type === "CallExpression" && init.callee.type === "Identifier" &&
        init.callee.name === "_resolveComponent" && init.arguments[0]?.type === "StringLiteral" &&
        init.arguments[0].value === s.comp.name && init.arguments[1]?.type === "BooleanLiteral"
      ) {
        s.selfAlias.name = d.id.name;
        continue;
      }
      const routed = init?.type === "CallExpression" && init.callee.type === "Identifier" &&
        init.callee.name === "_resolveComponent" && init.arguments.length === 1 &&
        init.arguments[0]?.type === "StringLiteral" ? init.arguments[0].value : null;
      if (routed === "RouterLink" || routed === "RouterView") {
        s.router.set(d.id.name, routed);
        continue;
      }
      // `const _directive_focus = _resolveDirective("focus")`: a globally registered directive.
      if (init?.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === "_resolveDirective" && init.arguments[0]?.type === "StringLiteral") {
        s.directives.set(d.id.name, init.arguments[0].value);
        continue;
      }
      fail(s.comp, "a component the template resolves by name must be imported, or be this one", st);
    }
    if (st.type === "IfStatement") {
      const body = (b: N): N[] => (b.type === "BlockStatement" ? b.body : [b]);
      /* `a && b && …`, where a leading operand is an optional value: present for the whole branch,
       * so it is bound and narrowed there, as TypeScript narrows it — a Rust let-chain, which is why
       * generated code needs edition 2024. */
      if (st.test.type === "LogicalExpression" && st.test.operator === "&&") {
        const operands: N[] = [];
        const flatten = (n: N): void => {
          if (n.type === "LogicalExpression" && n.operator === "&&") {
            flatten(n.left);
            flatten(n.right);
          } else operands.push(n);
        };
        flatten(st.test);
        const narrowed = new Map(s.narrowed);
        const parts: string[] = [];
        for (const op of operands) {
          const path = pathOf(op);
          const inner = { ...s, narrowed };
          const v = path !== null ? expr(inner, op) : null;
          if (path !== null && v && v.ty.k === "opt") {
            const name = `n${++narrowCount}`;
            const of: Ty = v.ty.of;
            const keep = of.k === "str" || of.k === "int" || of.k === "bool";
            parts.push(`let Some(${name}) = ${keep ? `(${v.code}).filter(|v| ${truthy({ code: "*v", ty: of })})` : v.code}`);
            narrowed.set(path, { code: name, ty: of });
          } else {
            parts.push(cond(inner, op));
          }
        }
        if (narrowed.size > s.narrowed.size) {
          e.open(`if ${parts.join(" && ")}`);
          statements({ ...s, narrowed }, e, body(st.consequent));
          if (st.alternate) {
            e.close(" else {");
            statements(s, e, body(st.alternate));
          }
          e.close();
          continue;
        }
      }
      const compound =
        (st.test.type === "LogicalExpression" && st.test.operator !== "??") ||
        (st.test.type === "UnaryExpression" && st.test.operator === "!");
      const t: Val = compound ? { code: cond(s, st.test), ty: BOOL } : expr(s, st.test);
      if (t.konst !== undefined) {
        const taken = t.konst ? st.consequent : st.alternate;
        if (taken) statements(s, e, body(taken));
        continue;
      }
      /* An optional value tested for presence is narrowed inside the branch, as TypeScript narrows
       * it: bound by `if let`, so `user.name` under `v-if="user"` reads the bound value. The
       * test keeps JavaScript's truthiness — an empty string, a 0 and `false` are not taken — while
       * an object and a list, empty or not, always are. */
      const path = pathOf(st.test);
      if (path !== null && t.ty.k === "opt") {
        const name = `n${++narrowCount}`;
        const inner: Ty = t.ty.of;
        const keep = inner.k === "str" || inner.k === "int" || inner.k === "bool";
        const test = keep ? `(${t.code}).filter(|v| ${truthy({ code: "*v", ty: inner })})` : t.code;
        e.open(`if let Some(${name}) = ${test}`);
        const narrowed = new Map(s.narrowed).set(path, { code: name, ty: inner });
        statements({ ...s, narrowed }, e, body(st.consequent));
      } else {
        e.open(`if ${cond(s, st.test)}`);
        statements(s, e, body(st.consequent));
      }
      if (st.alternate) {
        e.close(" else {");
        statements(s, e, body(st.alternate));
      }
      e.close();
      continue;
    }
    fail(s.comp, `\`${st.type}\` in the compiled template`, st);
  }
}

function list(s: Scope, e: Emitter, c: N): void {
  const src = expr(s, c.arguments[0]);
  const fn = c.arguments[1];
  if (fn.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected `ssrRenderList` callback", c);
  }
  const [item, index] = fn.params as N[];
  const idx = index ? snake(index.name) : null;
  // The item's name in Rust: its own when it is a plain name, a placeholder when it is destructured.
  const itemName = item.type === "Identifier" ? snake(item.name) : `fv_item${++narrowCount}`;
  const inner = new Map(s.locals);
  let of: Ty;
  if (src.ty.k === "int") {
    // `v-for="n in 5"`: 1 to 5, as `renderList` counts a number.
    of = INT;
    e.open(idx ? `for (${idx}, ${itemName}) in (1..=${src.code}).enumerate()` : `for ${itemName} in 1..=${src.code}`);
  } else if (src.ty.k === "list") {
    of = src.ty.of;
    if (of.k === "undef") fail(s.comp, "`v-for` over an empty array literal", c);
    const itemCode = of.k === "str" ? `&**${itemName}_ref` : `${itemName}_ref`;
    e.open(
      idx
        ? `for (${idx}, ${itemName}_ref) in (${src.code}).iter().enumerate()`
        : `for ${itemName}_ref in (${src.code}).iter()`,
    );
    if (of.k === "str") e.stmt(`let ${itemName}: &str = ${itemCode};`);
    // An object — a struct, or another component's props — is borrowed; only a scalar is copied.
    else if (of.k === "struct" || of.k === "child") e.stmt(`let ${itemName} = ${itemCode};`);
    else e.stmt(`let ${itemName} = *${itemName}_ref;`);
  } else {
    return fail(s.comp, "`v-for` walks an array, or counts to a number", c);
  }
  if (idx) e.stmt(`let ${idx} = ${idx} as i64;`);
  if (item.type === "Identifier") inner.set(item.name, { code: itemName, ty: of });
  else if (item.type === "ObjectPattern") {
    // `v-for="{ name, id: key } in items"`: each name is that field of the item.
    for (const p of item.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "a destructured `v-for` item binds plain names, without defaults", p);
      }
      inner.set(p.value.name, fieldVal(s.comp, itemName, of, p.key.name ?? p.key.value, p));
    }
  } else fail(s.comp, "a `v-for` item is a name or an object pattern", item);
  if (index) inner.set(index.name, { code: idx!, ty: INT });
  const before = e.literalBytes;
  statements({ ...s, locals: inner }, e, fn.body.body);
  e.close();
  // The body's markup is written once per item, not once.
  const body = e.literalBytes - before;
  e.literalBytes = before;
  // Counted up front only when the list is reachable from there: one a `v-if` narrowed, or a loop
  // variable, exists only inside its block, and the reservation is an estimate either way.
  if (body > 0 && src.ty.k === "list" && /^\(?props\./.test(src.code)) e.perItem.push(`${body} * (${src.code}).len()`);
}

/* ── Script setup ────────────────────────────────────────────────────────────────────────── */

/** The store module an import names, resolved and without its extension, when it is one. */
function storeImport(comp: Component, from: string): string | null {
  if (!from.startsWith(".") || STORES.size === 0) return null;
  const target = resolve(ROOT_DIR, dirname(comp.file), from).replace(/\.ts$/, "");
  return [...STORES.values()].some((s) => s.module === target) ? target : null;
}

/** Every store in the configured directory, and the interfaces their files declare. */
function readStores(root: string, dir: string): void {
  STORES = new Map();
  STORE_STRUCTS = new Map();
  STORE_FILES = new Map();
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();
  for (const f of files) {
    const path = join(root, dir, f);
    const comp = storeHome(relative(root, path));
    const ast: N[] = parseJs(readFileSync(path, "utf8"), { sourceType: "module", plugins: ["typescript"] }).program.body;
    const decls = ast.map((st) => (st.type === "ExportNamedDeclaration" ? st.declaration : st)).filter(Boolean);
    const interfaces = decls.filter((d) => d.type === "TSInterfaceDeclaration");
    for (const d of interfaces) {
      if (STORE_STRUCTS.has(d.id.name)) fail(comp, `\`${d.id.name}\` is declared by another store too`, d);
      STORE_STRUCTS.set(d.id.name, { name: d.id.name, fields: [] });
      STORE_FILES.set(d.id.name, comp.file);
    }
    for (const d of interfaces) {
      const st = structOf(comp, d.id.name, d.body.body, STORE_STRUCTS);
      for (const field of st.fields) field.ty = markStore(field.ty);
      STORE_STRUCTS.set(d.id.name, st);
    }
    for (const d of decls) {
      if (d.type !== "VariableDeclaration") continue;
      for (const v of d.declarations) {
        const init = v.init;
        if (init?.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== "defineStore") continue;
        const [id, options] = init.arguments;
        if (id?.type !== "StringLiteral") fail(comp, "a store's id is a string literal", init);
        if (options?.type !== "ObjectExpression") fail(comp, "a store is an option store: `defineStore(id, { state, … })`", init);
        const state = options.properties.find((p: N) => (p.key?.name ?? p.key?.value) === "state");
        const fn = state?.value ?? (state?.type === "ObjectMethod" ? state : null);
        const ret = fn?.returnType?.typeAnnotation;
        if (ret?.type !== "TSTypeReference" || !STORE_STRUCTS.has(ret.typeName.name)) {
          fail(comp, "a store's `state` declares its return type, an interface in the same file: `state: (): State => ({ … })`", state ?? init);
        }
        const getters = new Map<string, { param: string | null; body: N; file: string }>();
        const getterObj = options.properties.find((p: N) => (p.key?.name ?? p.key?.value) === "getters");
        if (getterObj && getterObj.value?.type !== "ObjectExpression") fail(comp, "a store's `getters` is an object literal", getterObj);
        for (const g of getterObj?.value.properties ?? []) {
          const fn = g.type === "ObjectMethod" ? g : g.value;
          const name: string = g.key?.name ?? g.key?.value;
          if (!fn || !["ArrowFunctionExpression", "FunctionExpression", "ObjectMethod"].includes(fn.type)) {
            fail(comp, `getter \`${name}\` is a function of the state`, g);
          }
          let body: N = fn.body;
          if (body.type === "BlockStatement") {
            const only = body.body.length === 1 ? body.body[0] : null;
            body = only?.type === "ReturnStatement" ? only.argument : null;
          }
          const param = fn.params[0];
          // A getter the server cannot translate fails where a component reads it, not here.
          getters.set(name, { param: param?.type === "Identifier" ? param.name : null, body, file: comp.file });
        }
        STORES.set(v.id.name, {
          hook: v.id.name,
          id: id.value,
          field: snake(id.value),
          state: ret.typeName.name,
          module: path.replace(/\.ts$/, ""),
          getters,
        });
      }
    }
  }
}

/** A store file, as the thing its types are declared in: what errors name, and where they resolve. */
function storeHome(file: string): Component {
  return {
    name: basename(file),
    module: "stores",
    file,
    props: { name: "Props", fields: [] },
    structs: STORE_STRUCTS,
    trustedName: null,
    childProps: new Map(),
    imports: new Set(),
    slotNames: [],
    routerView: false,
    routerLink: false,
    readsRoute: false,
    usesRoute: false,
    readsStores: false,
    usesStores: false,
    models: new Map(),
    aliases: new Map(),
    importedTypes: new Map(),
    slotShapes: new Map(),
  };
}

function markStore(ty: Ty): Ty {
  if (ty.k === "struct") return { ...ty, store: true };
  if (ty.k === "opt" || ty.k === "list") return { ...ty, of: markStore(ty.of) };
  return ty;
}

/** Lifecycle hooks, which never run on the server: setup may register them freely. */
const CLIENT_HOOKS = new Set([
  "onMounted", "onBeforeMount", "onUnmounted", "onBeforeUnmount", "onUpdated", "onBeforeUpdate",
  "onActivated", "onDeactivated", "onErrorCaptured", "onRenderTracked", "onRenderTriggered",
]);

/** Compiler macros and calls with no effect on the server's render. */
const INERT_CALLS = new Set(["defineEmits", "defineSlots", "defineOptions", "defineExpose", "defineProps", "withDefaults", "provide"]);

/** A statement in setup that is a call on its own: allowed only when it cannot change the render. */
function setupStatement(comp: Component, st: N): void {
  const c = st.expression;
  const name = c?.type === "CallExpression" && c.callee.type === "Identifier" ? (c.callee.name as string) : null;
  if (name !== null && (CLIENT_HOOKS.has(name) || INERT_CALLS.has(name))) return;
  if (name === "watch") {
    // A watcher's callback runs on the server only with `immediate`, and could then change state.
    const options = c.arguments[2];
    const immediate = options?.type === "ObjectExpression" && options.properties.some(
      (p: N) => p.type === "ObjectProperty" && (p.key.name ?? p.key.value) === "immediate" && !(p.value.type === "BooleanLiteral" && !p.value.value),
    );
    if (!immediate) return;
    fail(comp, "`watch` with `immediate` runs on the server, where its effect is not translated", st);
  }
  if (name === "watchEffect" || name === "watchSyncEffect" || name === "watchPostEffect") {
    fail(comp, `\`${name}\` runs once on the server, where its effect is not translated; use \`watch\` or \`onMounted\``, st);
  }
  if (name === "onServerPrefetch") fail(comp, "`onServerPrefetch` fetches on the server; pass the data in as props instead", st);
  fail(comp, `\`${st.expression?.type === "CallExpression" ? `${name ?? "a call"}()` : st.expression?.type}\` in setup could change what renders, and is not translated`, st);
}

/** What a setup binding's value is computed from: `ref(x)` and `shallowRef(x)` hold `x`,
 * `computed(() => x)` is `x`, and a plain `const y = x` is `x`. */
function setupSource(init: N): N | null {
  if (init.type === "CallExpression" && init.callee.type === "Identifier") {
    const name = init.callee.name;
    if ((name === "ref" || name === "shallowRef") && init.arguments.length === 1) return init.arguments[0];
    if (name === "computed") {
      const fn = init.arguments[0];
      if (fn?.type !== "ArrowFunctionExpression" && fn?.type !== "FunctionExpression") return null;
      if (fn.body.type !== "BlockStatement") return fn.body;
      const only = fn.body.body.length === 1 ? fn.body.body[0] : null;
      return only?.type === "ReturnStatement" && only.argument ? only.argument : null;
    }
  }
  if (init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression" || init.type === "TSNonNullExpression") return setupSource(init.expression);
  return init;
}

/** The names a destructuring pattern binds. */
function patternNames(p: N): string[] {
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

function scopeFor(comp: Component, ast: N[], components: Map<string, Component>): { scope: Scope; lets: string[] } {
  const scope: Scope = {
    comp,
    components,
    setup: new Map(),
    children: new Map(),
    helpers: new Map(),
    locals: new Map(),
    propsIdent: null,
    refs: new Set(),
    clientOnly: new Map(),
    narrowed: new Map(),
    selfAlias: { name: null },
    helperBytes: { n: 0 },
    router: new Map(),
    directives: new Map(),
    fill: false,
    vnode: false,
  };
  const lets: string[] = [];
  const storeHooks = new Map<string, Store>();
  let storeToRefsName: string | null = null;
  let useRouteName: string | null = null;
  /** Setup bindings holding a store, by name. */
  const storeValues = new Map<string, Store>();
  for (const st of ast) {
    if (st.type === "ImportDeclaration") {
      const from: string = st.source.value;
      if (from.endsWith(".vue")) {
        const def = st.specifiers.find((x: N) => x.type === "ImportDefaultSpecifier");
        if (def) scope.children.set(def.local.name, basename(from, ".vue"));
      } else if (storeImport(comp, from)) {
        for (const sp of st.specifiers) {
          const hook = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
          // A type from the store's file, which `readComponent` has already resolved.
          if (st.importKind === "type" || sp.importKind === "type" || (hook !== null && STORE_STRUCTS.has(hook))) continue;
          const store = hook ? STORES.get(hook) : undefined;
          if (!store || store.module !== storeImport(comp, from)) fail(comp, "import a store by its `use…` hook", sp);
          storeHooks.set(sp.local.name, store);
        }
      } else if (from === "vue-router") {
        for (const sp of st.specifiers) {
          const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
          if (name === "useRoute") useRouteName = sp.local.name;
          else if (name === "RouterLink" || name === "RouterView") scope.router.set(sp.local.name, name);
          else scope.clientOnly.set(sp.local.name, `\`${name}\` from vue-router does not run on the server`);
        }
      } else if (from === "pinia") {
        for (const sp of st.specifiers) {
          const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
          if (name === "storeToRefs") storeToRefsName = sp.local.name;
          else scope.clientOnly.set(sp.local.name, `\`${name}\` from Pinia does not run on the server`);
        }
      } else if (HELPER_MODULE !== null && from === HELPER_MODULE) {
        for (const sp of st.specifiers) {
          if (!HELPERS[sp.imported.name]) fail(comp, `\`${sp.imported.name}\` has no Rust twin in HELPERS`, sp);
          scope.helpers.set(sp.local.name, sp.imported.name);
        }
      }
      continue;
    }
    if (st.type === "FunctionDeclaration") {
      if (st.id) scope.clientOnly.set(st.id.name, "it is a function, which only an event handler may call");
      continue;
    }
    const decl = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (decl?.type === "TSInterfaceDeclaration" || decl?.type === "TSTypeAliasDeclaration") continue;
    if (st.type === "ExpressionStatement") {
      setupStatement(comp, st);
      continue;
    }
    // Setup runs on the server too, so a statement there can change what renders: `x.value = ...`
    // after a `ref`, an `if`, a loop. None of it is translated, so none of it may exist.
    if (st.type !== "VariableDeclaration") fail(comp, `\`${st.type}\` in setup is not supported`, st);
    for (const d of st.declarations) {
      const init0 = d.init;
      // `const { size = "md", label: l } = defineProps<...>()`: each name reads that prop, whose
      // default `compileScript` already resolved.
      if (d.id.type === "ObjectPattern" && definePropsType(init0)) {
        for (const p of d.id.properties) {
          if (p.type !== "ObjectProperty" || p.computed) fail(comp, "destructured props are plain names: `...rest` has no Rust type", p);
          const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
          const local = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
          if (local.type !== "Identifier") fail(comp, "destructured props are plain names", p);
          scope.setup.set(local.name, fieldVal(comp, "props", { k: "struct", name: "Props" }, key, p));
        }
        continue;
      }
      const calls = (name: string | null) =>
        name !== null && init0?.type === "CallExpression" && init0.callee.type === "Identifier" && init0.callee.name === name;
      // `const { density, label: l } = storeToRefs(prefs)`: each name is that field of the state.
      if (d.id.type === "ObjectPattern" && calls(storeToRefsName)) {
        const arg = init0.arguments[0];
        const store = arg?.type === "Identifier" ? storeValues.get(arg.name) : undefined;
        if (!store || init0.arguments.length !== 1) fail(comp, "`storeToRefs` takes a store bound in this setup", d);
        for (const p of d.id.properties) {
          if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
            fail(comp, "`storeToRefs` is destructured into plain names", p);
          }
          const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
          const state: Val = { code: `fv_stores.${store.field}`, ty: { k: "struct", name: store.state, store: true } };
          scope.setup.set(p.value.name, storeGetter(scope, state, key, p) ?? fieldVal(comp, state.code, state.ty, key, p));
          scope.refs.add(p.value.name);
        }
        comp.readsStores = true;
        continue;
      }
      if (d.id.type !== "Identifier") {
        // Destructuring anything else: client-side state the template may not read.
        for (const name of patternNames(d.id)) scope.clientOnly.set(name, "it is destructured from a value the server does not have");
        continue;
      }
      const local: string = d.id.name;
      // `const prefs = usePrefs()`: the store's state, as the server was given it.
      const hook = init0?.type === "CallExpression" && init0.callee.type === "Identifier" ? storeHooks.get(init0.callee.name) : undefined;
      if (hook) {
        if (init0.arguments.length) fail(comp, "a store hook takes no arguments", d);
        storeValues.set(local, hook);
        scope.setup.set(local, { code: `fv_stores.${hook.field}`, ty: { k: "struct", name: hook.state, store: true } });
        comp.readsStores = true;
        continue;
      }
      // `const route = useRoute()`: the reader's location.
      if (useRouteName !== null && init0?.type === "CallExpression" && init0.callee.type === "Identifier" && init0.callee.name === useRouteName) {
        scope.setup.set(local, theRoute(scope, d));
        continue;
      }
      // `const model = defineModel<string>()`: the model's prop.
      const model = comp.models.get(local);
      if (model !== undefined) {
        scope.setup.set(local, fieldVal(comp, "props", { k: "struct", name: "Props" }, model, d));
        scope.refs.add(local);
        continue;
      }
      if (!init0) {
        scope.clientOnly.set(local, "it has no initial value");
        continue;
      }
      if (definePropsType(init0)) {
        scope.propsIdent = local;
        continue;
      }
      const source = setupSource(init0);
      const isRef = init0.type === "CallExpression" && init0.callee.type === "Identifier" && ["ref", "shallowRef", "computed"].includes(init0.callee.name);
      if (isRef) scope.refs.add(local);
      if (!source) {
        scope.clientOnly.set(local, "it is not a value the server computes: only `ref(…)`, `computed(() => …)` and plain expressions are");
        continue;
      }
      // Evaluated once, as setup is on the server. A value the server cannot evaluate is client-side
      // state — a template ref, an element, a `reactive` object — which the template may still name
      // from an event handler; a reference the server needs fails in `expr` with this reason.
      let v: Val;
      try {
        v = expr(scope, source);
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
        scope.clientOnly.set(local, e.message.replace(/^[^:]*: /, ""));
        continue;
      }
      if (v.ty.k === "undef") {
        scope.setup.set(local, v);
        continue;
      }
      const name = `s_${snake(local).replace(/^r#/, "")}`;
      // A list or an object is a place in the props: borrowed, never moved out of them.
      const place = v.ty.k === "list" || v.ty.k === "struct" || v.ty.k === "child";
      lets.push(`let ${name} = ${place ? `&(${v.code})` : v.code};`);
      scope.setup.set(local, { code: name, ty: v.ty, ...(v.konst !== undefined ? { konst: v.konst } : {}) });
    }
  }
  return { scope, lets };
}

/* ── Rust source ─────────────────────────────────────────────────────────────────────────── */

function needsLifetime(ty: Ty, comp: Component, seen: Set<string> = new Set()): boolean {
  switch (ty.k) {
    case "str":
      return true;
    case "opt":
    case "list":
      return needsLifetime(ty.of, comp, seen);
    case "struct": {
      // A struct that holds itself borrows only if something else in it does.
      if (seen.has(ty.name)) return false;
      const { st, owner } = lookupStruct(comp, ty);
      const inner = new Set(seen).add(ty.name);
      return !!st && st.fields.some((f) => needsLifetime(f.ty, owner, inner));
    }
    case "child": {
      const child = childOf(ty.name);
      return structLifetime(child.props, child);
    }
    // A configured type that borrows says so by naming the props' lifetime: `Trusted<'a>`.
    case "html":
      return TRUSTED_HTML?.includes("'a") ?? false;
    default:
      return false;
  }
}

function structLifetime(st: Struct, comp: Component): boolean {
  return st.fields.some((f) => needsLifetime(f.ty, comp, new Set([st.name])));
}

function rustTy(ty: Ty, comp: Component): string {
  switch (ty.k) {
    case "str":
      return "Cow<'a, str>";
    case "int":
      return "i64";
    case "bool":
      return "bool";
    case "opt":
      return `Option<${rustTy(ty.of, comp)}>`;
    case "list":
      return `Vec<${rustTy(ty.of, comp)}>`;
    case "struct": {
      const { st, owner, path } = lookupStruct(comp, ty);
      if (!st) throw new GenError(`no type \`${ty.name}\``);
      return `${path}${ty.name}${structLifetime(st, owner) ? "<'a>" : ""}`;
    }
    case "html":
      return TRUSTED_HTML!;
    case "child": {
      const child = childOf(ty.name);
      return `super::${child.module}::Props${structLifetime(child.props, child) ? "<'a>" : ""}`;
    }
    default:
      throw new GenError("no Rust type for `undefined`");
  }
}

function structSource(st: Struct, comp: Component, doc: string): string {
  const life = structLifetime(st, comp) ? "<'a>" : "";
  const fields = st.fields
    .map((f) => {
      const attrs =
        f.ty.k === "opt"
          ? `    #[serde(rename = ${rustStr(f.js)}, default, skip_serializing_if = "Option::is_none")]`
          : `    #[serde(rename = ${rustStr(f.js)})]`;
      return `${attrs}\n    pub ${f.rust}: ${rustTy(f.ty, comp)},`;
    })
    .join("\n");
  /* `Deserialize` only for the conformance suite. Props go out as JSON and never come back in, and a
   * `Deserialize` in production would be a way to make a `TrustedHtml` value out of any string. */
  return `${doc}#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
pub struct ${st.name}${life} {
${fields}
}
`;
}

function header(source: string, edit = "the `.vue` file"): string {
  return `// @generated by ferrovue from ${source}. Do not edit: change ${edit} and run
// \`ferrovue\`.
`;
}

/** Rust expressions summing the lengths of the strings a value of type `ty` at `place` holds. */
function textLen(comp: Component, place: string, ty: Ty, seen: Set<string> = new Set()): string[] {
  switch (ty.k) {
    case "str":
      return [`${place}.len()`];
    case "html":
      return [`fv::TrustedHtml::trusted_html(&${place}).len()`];
    case "opt":
      if (ty.of.k === "str") return [`${place}.as_deref().map_or(0, str::len)`];
      if (ty.of.k === "html") return [`${place}.as_ref().map_or(0, |v| fv::TrustedHtml::trusted_html(v).len())`];
      if (ty.of.k === "struct") {
        const inner = textLen(comp, "v", ty.of, seen);
        return inner.length ? [`${place}.as_ref().map_or(0, |v| ${inner.join(" + ")})`] : [];
      }
      return [];
    case "struct": {
      // A recursive structure is counted to its first level: the reservation is an estimate.
      if (seen.has(ty.name)) return [];
      const { st, owner } = lookupStruct(comp, ty);
      const inner = new Set(seen).add(ty.name);
      return (st?.fields ?? []).flatMap((f) => textLen(owner, `${place}.${f.rust}`, f.ty, inner));
    }
    case "list": {
      const inner = textLen(comp, "v", ty.of, seen);
      return inner.length ? [`${place}.iter().map(|v| ${inner.join(" + ")}).sum::<usize>()`] : [];
    }
    default:
      return [];
  }
}

function componentSource(comp: Component, ast: N[], ssr: string, components: Map<string, Component>): string {
  const { scope, lets } = scopeFor(comp, ast, components);
  const program = parseJs(ssr, { sourceType: "module" }).program;
  const fn = (program.body as N[]).find(
    (s: N) => s.type === "ExportNamedDeclaration" && s.declaration?.id?.name === "ssrRender",
  )?.declaration;
  if (!fn) fail(comp, "the compiled template has no `ssrRender`");

  const e = new Emitter();
  for (const l of lets) e.stmt(l);
  statements(scope, e, fn.body.body);
  e.flush();
  /* The literal markup, a loop's once per item, what the helpers can write, and every string the
   * props hold. Literals in untaken branches overcount and escaping or a string used twice
   * undercounts, so it is an estimate — close enough that the buffer is sized once, where
   * reserving the literals alone leaves it to grow again at the first long label. */
  const text = textLen(comp, "props", { k: "struct", name: "Props" });
  const fixed = e.literalBytes + scope.helperBytes.n;
  e.lines.unshift(`    out.reserve(${[String(fixed), ...e.perItem, ...text].join(" + ")});`);

  const life = structLifetime(comp.props, comp) ? "<'_>" : "";
  const gen = life ? "<'p, 'a>" : "<'p>";
  const named = life ? "<'a>" : "";
  // An `interface Props` that `defineProps` takes is the props struct itself, written once below.
  const structs = [...comp.structs.values()]
    .filter((st) => st.name !== "Props" && !st.slot)
    .map((st) => structSource(st, comp, `/// \`${st.name}\` in \`${basename(comp.file)}\`.\n`))
    .join("\n");
  // `Cow` is imported only where a field is one: a lifetime that comes from another component's props
  // alone borrows through that type, not through a `Cow` written here.
  const usesCow = /Cow</.test(structs + structSource(comp.props, comp, ""));
  const plain = !takesSlots(comp) && !comp.usesRoute && !comp.usesStores;
  const slotFields = [
    ...comp.slotNames.map((n) => {
      const outlet = `\`<slot${n === "default" ? "" : ` name="${n}"`}>\``;
      const type = comp.slotShapes.has(n) ? `&'s ${slotTypeName(n, "Slot")}<'s>` : "fv::Slot<'s>";
      return `    /// ${outlet}\n    pub ${snake(n)}: Option<${type}>,`;
    }),
    ...(comp.routerView ? ["    /// The page `<RouterView>` shows.\n    pub router_view: fv::Slot<'s>,"] : []),
  ];
  const slotTypes = [...comp.slotShapes.entries()]
    .map(([n, shape]) => {
      const outlet = `\`<slot${n === "default" ? "" : ` name="${n}"`}>\``;
      const life = shape.fields.some((f) => slotFieldBorrows(f.ty));
      const fields = shape.fields.map((f) => `    pub ${f.rust}: ${slotFieldTy(f.ty, comp)},`).join("\n");
      const props = `${shape.name}${life ? "<'v>" : ""}`;
      return `/// The props ${outlet} passes the content a parent gives it, borrowed for the render.
pub struct ${props} {
${fields}
}

/// A parent's content for ${outlet}, given its props: returns whether it wrote anything but comments.
pub type ${slotTypeName(n, "Slot")}<'s> = dyn ${life ? "for<'v> " : ""}Fn(&mut String, &${props}) -> bool + 's;

`;
    })
    .join("");
  const slotsStruct = takesSlots(comp)
    ? `${slotTypes}/// What a parent puts in the slots \`${basename(comp.file)}\` renders.
#[derive(Clone, Copy${comp.routerView ? "" : ", Default"})]
pub struct Slots<'s> {
${slotFields.join("\n")}
}

`
    : "";
  const args = (takesSlots(comp) ? ", fv_slots" : "") + (comp.usesRoute ? ", fv_route" : "") + (comp.usesStores ? ", fv_stores" : "");
  const params =
    (takesSlots(comp) ? ", fv_slots: Slots<'p>" : "") +
    (comp.usesRoute ? ", fv_route: &'p fv::Route<'p>" : "") +
    (comp.usesStores ? ", fv_stores: &'p super::stores::Stores<'p>" : "");
  const wrappers = plain
    ? `/// The component's markup, for a maud page that shows it without hydrating it.
pub fn html${gen}(props: &'p Props${named}) -> fv::Html<'p, Props${named}> {
    fv::Html::markup(props, render)
}

/// The component as an island the client hydrates.
pub fn island${gen}(props: &'p Props${named}) -> fv::Html<'p, Props${named}> {
    fv::Html::island(NAME, props, render)
}
`
    : `/// The component's markup, for a maud page that shows it.
pub fn html${gen}(props: &'p Props${named}${params}) -> fv::Html<'p, Props${named}, impl Fn(&mut String, &Props${named}) + 'p> {
    fv::Html::markup(props, move |out: &mut String, props: &Props${named}| render(out, props${args}))
}
`;
  return `${header(comp.file)}
${usesCow ? "use std::borrow::Cow;\n\n" : ""}use ferrovue as fv;

/// The component's name, as \`data-island\` carries it.
pub const NAME: &str = ${rustStr(comp.name)};

${structs ? structs + "\n" : ""}${structSource(comp.props, comp, `/// The props \`${basename(comp.file)}\` declares.\n`)}
${slotsStruct}/// Write the component's server render into \`out\`.
pub fn render(out: &mut String, props: &Props${life}${extraParams(comp)}) {
${e.lines.join("\n")}
}

${wrappers}`;
}

function modSource(comps: Component[]): string {
  const arms = comps
    .map((c) => {
      const lines = [`let props: ${c.module}::Props = serde_json::from_str(json).map_err(|e| e.to_string())?;`];
      let args = "";
      if (takesSlots(c) || c.usesRoute || c.usesStores) lines.push("let fixture: Fixture = serde_json::from_str(json).map_err(|e| e.to_string())?;");
      if (takesSlots(c)) {
        const names = [...c.slotNames, ...(c.routerView ? ["routerView"] : [])];
        for (const n of names) {
          const local = `s_${snake(n).replace(/^r#/, "")}`;
          const shape = c.slotShapes.get(n);
          if (shape) {
            // A fixture's content for a scoped slot is static: it is given the props and ignores them.
            const life = shape.fields.some((f) => slotFieldBorrows(f.ty)) ? "<'_>" : "";
            lines.push(`let ${local} = |out: &mut String, _: &${c.module}::${shape.name}${life}| -> bool { out.push_str(fixture.slot(${rustStr(n)}).unwrap_or_default()); true };`);
          } else lines.push(`let ${local} = |out: &mut String| out.push_str(fixture.slot(${rustStr(n)}).unwrap_or_default());`);
        }
        const fields = c.slotNames.map((n) => {
          const local = `s_${snake(n).replace(/^r#/, "")}`;
          const value = c.slotShapes.has(n) ? `&${local} as &${c.module}::${slotTypeName(n, "Slot")}` : `ferrovue::Slot::new(&${local})`;
          return `${snake(n)}: fixture.slot(${rustStr(n)}).map(|_| ${value})`;
        });
        if (c.routerView) fields.push("router_view: ferrovue::Slot::new(&s_router_view)");
        args += `, ${c.module}::Slots { ${fields.join(", ")} }`;
      }
      if (c.usesRoute) {
        lines.push("let router = route_table::router();", "let route = router.at(&fixture.route);");
        args += ", &route";
      }
      if (c.usesStores) {
        lines.push("let state: stores::Stores = serde_json::from_value(fixture.stores.clone()).map_err(|e| e.to_string())?;");
        args += ", &state";
      }
      lines.push(`${c.module}::render(&mut out, &props${args});`);
      return `        ${rustStr(c.name)} => {\n${lines.map((l) => "            " + l).join("\n")}\n        }`;
    })
    .join("\n");
  const fixture = comps.some((c) => takesSlots(c) || c.usesRoute || c.usesStores)
    ? `
/// What a fixture holds besides the props: each slot's content, and the location it renders at.
#[cfg(test)]
#[derive(serde::Deserialize)]
struct Fixture {
    #[serde(rename = "$slots", default)]
    slots: std::collections::HashMap<String, String>,
    #[serde(rename = "$route", default = "Fixture::root")]
    route: String,
    #[serde(rename = "$stores", default = "Fixture::no_stores")]
    stores: serde_json::Value,
}

#[cfg(test)]
impl Fixture {
    fn root() -> String {
        "/".to_owned()
    }

    fn no_stores() -> serde_json::Value {
        serde_json::Value::Object(Default::default())
    }

    fn slot(&self, name: &str) -> Option<&str> {
        self.slots.get(name).map(String::as_str)
    }
}
`
    : "";
  return `${header(componentsDir)}
//! The component renderers, one module per \`.vue\` file.

#![allow(dead_code, unused_parens, unused_variables, clippy::all)]

${comps.map((c) => `pub mod ${c.module};`).join("\n")}${ROUTES ? "\npub mod route_table;" : ""}${STORES.size ? "\npub mod stores;" : ""}${TYPE_STRUCTS.size ? "\npub mod types;" : ""}
${fixture}
/// Render one component from its props as JSON, for the conformance suite.
#[cfg(test)]
pub fn render_json(component: &str, json: &str) -> Result<String, String> {
    let mut out = String::new();
    match component {
${arms}
        other => return Err(format!("no component called {other}")),
    }
    Ok(out)
}
`;
}

function storesSource(dir: string): string {
  const home = storeHome(dir);
  // Test-only `Default` lets a fixture name only the stores it reads; the rest are never looked at.
  const testDerive = (src: string) =>
    src.replace("#[cfg_attr(test, derive(serde::Deserialize))]", "#[cfg_attr(test, derive(Default, serde::Deserialize))]\n#[cfg_attr(test, serde(default))]");
  const structs = [...STORE_STRUCTS.values()]
    .map((st) => testDerive(structSource(st, home, `/// \`${st.name}\` in \`${STORE_FILES.get(st.name)}\`.\n`)))
    .join("\n");
  const all: Struct = {
    name: "Stores",
    fields: [...STORES.values()].map((st) => ({ js: st.id, rust: st.field, ty: { k: "struct", name: st.state, store: true } as Ty })),
  };
  const top = testDerive(structSource(all, home, "/// Every store's state, keyed by id as `pinia.state.value` is: what the page sends the client.\n"));
  return `${header(dir, "the store files")}
//! The Pinia stores' state, which components read while they render on the server.

${/Cow</.test(structs) ? "use std::borrow::Cow;\n\n" : ""}${structs}
${top}`;
}

function typesSource(): string {
  const home = storeHome("types");
  home.structs = TYPE_STRUCTS;
  home.module = "types";
  const files = [...new Set(TYPE_FILES.values())].sort();
  const structs = [...TYPE_STRUCTS.values()]
    .map((st) => structSource(st, home, `/// \`${st.name}\` in \`${TYPE_FILES.get(st.name)}\`.\n`))
    .join("\n");
  return `${header(files.join(", "), "the type files")}
//! The types components import from shared \`.ts\` files, written once so that components passing
//! them to one another agree on them.

${/Cow</.test(structs) ? "use std::borrow::Cow;\n\n" : ""}${structs}`;
}

function routesSource(routes: RouteDef[], file: string): string {
  return `${header(file)}
//! The app's routes: what \`<RouterLink>\` resolves against and \`useRoute()\` reads.

/// Each route's vue-router path, and its name if it has one.
pub const ROUTES: &[(&str, Option<&str>)] = &[
${routes.map((r) => `    (${rustStr(r.path)}, ${r.name === undefined ? "None" : `Some(${rustStr(r.name)})`}),`).join("\n")}
];

/// The routes' paths alone.
pub const PATHS: &[&str] = &[
${routes.map((r) => `    ${rustStr(r.path)},`).join("\n")}
];

/// The history's base, which every link's \`href\` starts with.
pub const BASE: &str = ${rustStr(ROUTER_BASE)};

/// The router these routes make: build it once, and resolve each request's location with
/// [\`ferrovue::Router::at\`].
pub fn router() -> ferrovue::Router {
    ferrovue::Router::named(ROUTES).with_base(BASE)
}
`;
}

/** The directory the components being compiled come from, for the generated headers. */
let componentsDir = "";

/** The routes file: vue-router paths, each a string or `{ "path", "name" }`. */
function readRoutes(root: string, file: string): RouteDef[] {
  const raw = JSON.parse(readFileSync(join(root, file), "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new GenError(`${file} lists the routes in an array`);
  return raw.map((r: unknown) => {
    if (typeof r === "string") return { path: r };
    const o = r as { path?: unknown; name?: unknown };
    if (typeof o?.path !== "string" || (o.name !== undefined && typeof o.name !== "string")) {
      throw new GenError(`${file}: a route is a path, or \`{ "path": "…", "name": "…" }\``);
    }
    return o.name === undefined ? { path: o.path } : { path: o.path, name: o.name };
  });
}

/** Every generated file, keyed by its name in the output directory. */
export function generate(root: string, config: Config = loadConfig(root)): Map<string, string> {
  componentsDir = config.components.replace(/\/?$/, "/");
  HELPER_MODULE = config.helpers?.module ?? null;
  TRUSTED_HTML = config.trustedHtml ?? null;
  const router = config.router ?? (config.routes ? { routes: config.routes } : null);
  ROUTES = router ? readRoutes(root, router.routes) : null;
  ROUTER_BASE = router?.base ?? "";
  CLIENT_DIRECTIVES = new Set(config.clientDirectives ?? []);
  LINK_ACTIVE = router?.linkActiveClass ?? "router-link-active";
  LINK_EXACT_ACTIVE = router?.linkExactActiveClass ?? "router-link-exact-active";
  ROOT_DIR = root;
  TYPE_STRUCTS = new Map();
  TYPE_ALIASES = new Map();
  TYPE_FILES = new Map();
  TYPE_READ = new Set();
  if (config.stores) readStores(root, config.stores);
  else {
    STORES = new Map();
    STORE_STRUCTS = new Map();
  }
  HELPERS = Object.fromEntries(
    Object.entries(config.helpers?.functions ?? {}).map(([name, h]) => [
      name,
      { rust: h.rust, params: h.params.map(tyOfName), ret: tyOfName(h.returns), maxLen: h.maxLen ?? 0 },
    ]),
  );
  const dir = join(root, config.components);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".vue"))
    .sort()
    .map((f) => join(dir, f));
  const read = files.map((f) => readComponent(f, root));
  const components = new Map(read.map((r) => [r.comp.name, r.comp]));
  ALL = components;
  // Whether a component reads a store or the route is known once its setup is read; both reach
  // every component on the way down to one that does, and the route every one on the way down to
  // a `<RouterLink>`.
  for (const r of read) scopeFor(r.comp, r.ast, components);
  for (const c of components.values()) c.usesRoute = c.routerLink || c.readsRoute;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of components.values()) {
      if (!c.usesRoute && [...c.imports].some((i) => components.get(i)?.usesRoute)) {
        c.usesRoute = changed = true;
      }
    }
  }
  for (const c of components.values()) c.usesStores = c.readsStores;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of components.values()) {
      if (!c.usesStores && [...c.imports].some((i) => components.get(i)?.usesStores)) {
        c.usesStores = changed = true;
      }
    }
  }
  const out = new Map<string, string>();
  // A child before its parents, which read the props its scoped slots pass.
  const ordered: typeof read = [];
  const placed = new Set<string>();
  const place = (r: (typeof read)[number]): void => {
    if (placed.has(r.comp.name)) return;
    placed.add(r.comp.name);
    for (const i of r.comp.imports) {
      const dep = read.find((x) => x.comp.name === i);
      if (dep) place(dep);
    }
    ordered.push(r);
  };
  read.forEach(place);
  for (const r of ordered) {
    // Numbered per component, so a file's text depends on its own source alone.
    narrowCount = 0;
    out.set(`${r.comp.module}.rs`, componentSource(r.comp, r.ast, r.ssr, components));
  }
  out.set("mod.rs", modSource(read.map((r) => r.comp)));
  if (ROUTES) out.set("route_table.rs", routesSource(ROUTES, router!.routes));
  if (STORES.size) out.set("stores.rs", storesSource(config.stores!.replace(/\/?$/, "/")));
  if (TYPE_STRUCTS.size) out.set("types.rs", typesSource());
  return out;
}

/** Write what `generate` produces to the configured directory, replacing what is there. */
export function write(root: string, config: Config = loadConfig(root)): string[] {
  const files = generate(root, config);
  const target = join(root, config.out);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const [name, text] of files) writeFileSync(join(target, name), text);
  return [...files.keys()];
}
