import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "./plugin.ts";
import type { Declared } from "./constants.ts";
import { type Component, type N, type Struct, type Ty, BOOL, FLOAT, GenError, INT, opt, STR } from "./model.ts";
import type { Code } from "./errors.ts";

/** A type a helper takes or returns, as the configuration spells it. */
export type TypeName = "string" | "string?" | "int" | "int?" | "float" | "float?" | "bool";

/** A function a template may call, and the Rust function that is its twin. */
export interface HelperSpec {
  /** The Rust path the generated code calls, e.g. `crate::helpers::format_count`. */
  rust: string;
  params: TypeName[];
  returns: TypeName;
  /** The longest string it returns, which is what a call adds to the buffer reservation. */
  maxLen?: number;
}

/** A component ferrovue does not compile, rendered on the server by a Rust function of the
 * project's: its twin. ferrovue cannot check that the function writes what Vue would. */
export interface TwinSpec {
  /** The Rust path the generated parent calls, e.g. `crate::ui::v_btn`. */
  rust: string;
  /** Each prop a template may pass it, by its name in Vue, with its type. */
  props?: Record<string, TypeName>;
  /** The slots a template may fill, by name: `["default", "prepend"]`. */
  slots?: string[];
}

/** What `ferrovue.config.json` holds. Paths are relative to the project root. */
export interface Config {
  /** The directory of `.vue` files to compile. */
  components: string;
  /** The directory the Rust modules are written to. Everything in it is replaced. */
  out: string;
  /** The module components import their helpers from, and the Rust twin of each export. */
  helpers?: { module: string; functions: Record<string, HelperSpec> };
  /** Components ferrovue does not compile, by the name a template gives them (`VBtn`, which
   * `<v-btn>` finds too), each rendered by a Rust function of the project's. */
  twins?: Record<string, TwinSpec>;
  /** The Rust type a `TrustedHtml` prop is, which must implement `ferrovue::TrustedHtml`, e.g.
   * `crate::sanitize::SafeHtml`. A type that borrows names the props' lifetime, `'a`:
   * `crate::render::Trusted<'a>`. `ferrovue::InlineHtml` makes every `TrustedHtml` prop inline HTML.
   * Without it, only an `InlineHtml` prop may reach `v-html`. */
  trustedHtml?: string;
  /** A JSON file listing the app's routes as vue-router paths (`/users/:id`), which `<RouterLink>`
   * resolves against, or `{ pages }`: a folder of pages whose file names give the routes, as
   * vue-router's file-based routing reads them. Without it, a component cannot use `<RouterLink>`. */
  routes?: RoutesSource;
  /** The router, in full: its routes, the history's base, and the class names `createRouter`
   * gives active links. `routes` alone is shorthand for `{ routes }`. */
  router?: { routes: RoutesSource; base?: string; linkActiveClass?: string; linkExactActiveClass?: string };
  /** The directory of Pinia stores (`.ts` files), whose state a component may read while it renders
   * on the server. */
  stores?: string;
  /** Custom directives that render nothing on the server (no `getSSRProps`), by name, without
   * `v-`: `["focus", "click-outside"]`. Any other custom directive is refused, since the server
   * cannot know what its `getSSRProps` would add. */
  clientDirectives?: string[];
  /** vue-i18n: the directory of locale files (`en.json`, `nl.json`), the locale a page renders in
   * when it names none, and the locales a missing message falls back to. */
  i18n?: { messages: string; locale?: string; fallbackLocale?: string | string[] };
  /** How a `<style scoped>` component's `data-v-` id is computed, which must be how
   * `@vitejs/plugin-vue` computes it for the client: from the file's path (`"filepath"`, the
   * plugin's choice in development, and with `features.componentIdGenerator: "filepath"`), or its
   * path and source (`"filepath-source"`, the plugin's choice for a production build). */
  scopeId?: ScopeIdMode;
  /** Vite's root, from which a scope id hashes a component's path: the project root by default. */
  viteRoot?: string;
  /** Whether each props struct and shared type gets `new()` and a chainable setter per optional
   * field: `true` by default. With `false`, props are built as struct literals. */
  builders?: boolean;
}

export type ScopeIdMode = "filepath" | "filepath-source";

/** Where the routes come from: a JSON file of routes, or a folder of pages. */
export type RoutesSource = string | { pages: string };

export const CONFIG_FILE = "ferrovue.config.json";

/** Read the project's configuration. */
export function loadConfig(root: string, configPath?: string): Config {
  const filePath = configPath ? resolve(root, configPath) : join(root, CONFIG_FILE);
  const displayName = configPath ?? CONFIG_FILE;
  let text = "";
  try {
    text = readFileSync(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new GenError("FV1102", `cannot find \`${displayName}\` in ${root}`, { file: displayName });
    }
    throw e;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (e) {
    throw new GenError("FV1103", `failed to parse \`${displayName}\`: ${(e as Error).message}`, { file: displayName });
  }
  return checkConfig(raw, displayName);
}

const TYPE_NAMES: readonly string[] = ["string", "string?", "int", "int?", "float", "float?", "bool"] satisfies TypeName[];

/** Every key of `Config`. */
const KEYS = ["components", "out", "routes", "router", "stores", "trustedHtml", "helpers", "twins", "i18n", "clientDirectives", "scopeId", "viteRoot", "builders"];

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}

/** The known key a misspelt one most likely means: the same but for case, or one or two edits
 * away (one for a short key). */
function closest(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let least = Math.min(2, Math.floor(key.length / 3)) + 1;
  for (const k of known) {
    const d = k.toLowerCase() === key.toLowerCase() ? 0 : distance(key, k);
    if (d < least) [best, least] = [k, d];
  }
  return best;
}

/** Check what a configuration file holds against `Config`, naming the first key that is unknown or
 * of the wrong shape. */
function checkConfig(raw: unknown, file: string): Config {
  const refuse = (code: Code, what: string): never => {
    throw new GenError(code, what, { file });
  };
  const wrong = (key: string, shape: string): never => refuse("FV1115", `\`${key}\` in ${file} is ${shape}`);
  const keys = (o: Json, path: string, known: readonly string[]): void => {
    for (const k of Object.keys(o)) {
      if (known.includes(k)) continue;
      const near = closest(k, known);
      const hint = near ? `did you mean \`${near}\`?` : `it takes ${known.map((x) => `\`${x}\``).join(", ")}`;
      refuse("FV1114", `${path ? `\`${path}\` in ${file}` : file} has no key \`${k}\`: ${hint}`);
    }
  };
  const string = (o: Json, key: string, path: string, required = false): void => {
    if (o[key] === undefined ? required : typeof o[key] !== "string") wrong(path, "a string");
  };
  const typeName = (v: unknown, path: string): void => {
    if (typeof v !== "string" || !TYPE_NAMES.includes(v)) {
      refuse("FV1107", `\`${path}\` in ${file} is ${JSON.stringify(v) ?? "missing"}, not a type a helper or twin takes: ${TYPE_NAMES.map((t) => `"${t}"`).join(", ")}`);
    }
  };
  const routesSource = (v: unknown, path: string): void => {
    if (typeof v === "string" || (isObject(v) && typeof v.pages === "string" && Object.keys(v).length === 1)) return;
    refuse("FV1238", `\`${path}\` in ${file} is a JSON file of routes, or \`{ "pages": "…" }\`: the folder of pages vue-router's file-based routing reads`);
  };

  if (!isObject(raw)) {
    const what = Array.isArray(raw) ? "an array" : raw === null ? "`null`" : `a ${typeof raw}`;
    return refuse("FV1113", `${file} holds ${what}, where it holds an object: \`{ "components": "components", "out": "src/generated" }\``);
  }
  keys(raw, "", KEYS);
  if (typeof raw.components !== "string" || typeof raw.out !== "string") {
    throw new GenError("FV1104", `${file} needs \`components\` and \`out\` directories`, { file });
  }
  if (raw.scopeId !== undefined && raw.scopeId !== "filepath" && raw.scopeId !== "filepath-source") {
    throw new GenError("FV1105", `\`scopeId\` in ${file} is "filepath" or "filepath-source", as \`@vitejs/plugin-vue\` computes it`, { file });
  }
  if (raw.builders !== undefined && typeof raw.builders !== "boolean") {
    throw new GenError("FV1106", `\`builders\` in ${file} is \`true\` or \`false\`: whether each props struct gets \`new()\` and a setter per optional field`, { file });
  }
  for (const key of ["stores", "trustedHtml", "viteRoot"]) string(raw, key, key);
  if (raw.clientDirectives !== undefined && !isStrings(raw.clientDirectives)) wrong("clientDirectives", 'a list of directive names, as `["focus"]`');
  if (raw.routes !== undefined) routesSource(raw.routes, "routes");
  if (raw.router !== undefined) {
    const r = raw.router;
    if (!isObject(r)) return wrong("router", "an object: `{ routes, base?, linkActiveClass?, linkExactActiveClass? }`");
    keys(r, "router", ["routes", "base", "linkActiveClass", "linkExactActiveClass"]);
    routesSource(r.routes, "router.routes");
    for (const key of ["base", "linkActiveClass", "linkExactActiveClass"]) string(r, key, `router.${key}`);
  }
  if (raw.i18n !== undefined) {
    const i = raw.i18n;
    if (!isObject(i)) return wrong("i18n", "an object: `{ messages, locale?, fallbackLocale? }`");
    keys(i, "i18n", ["messages", "locale", "fallbackLocale"]);
    string(i, "messages", "i18n.messages", true);
    string(i, "locale", "i18n.locale");
    if (i.fallbackLocale !== undefined && typeof i.fallbackLocale !== "string" && !isStrings(i.fallbackLocale)) wrong("i18n.fallbackLocale", "a locale or a list of them");
  }
  if (raw.helpers !== undefined) {
    const h = raw.helpers;
    if (!isObject(h)) return wrong("helpers", "an object: `{ module, functions }`");
    keys(h, "helpers", ["module", "functions"]);
    string(h, "module", "helpers.module", true);
    if (!isObject(h.functions)) return wrong("helpers.functions", "an object of functions by name, each `{ rust, params, returns, maxLen? }`");
    for (const [name, spec] of Object.entries(h.functions)) {
      const path = `helpers.functions.${name}`;
      if (!isObject(spec)) return wrong(path, "an object: `{ rust, params, returns, maxLen? }`");
      keys(spec, path, ["rust", "params", "returns", "maxLen"]);
      string(spec, "rust", `${path}.rust`, true);
      if (!Array.isArray(spec.params)) return wrong(`${path}.params`, 'the list of types the function takes, as `["int"]`');
      spec.params.forEach((t, i) => typeName(t, `${path}.params[${i}]`));
      typeName(spec.returns, `${path}.returns`);
      if (spec.maxLen !== undefined && !(Number.isSafeInteger(spec.maxLen) && (spec.maxLen as number) >= 0)) wrong(`${path}.maxLen`, "a whole number, 0 or more");
    }
  }
  if (raw.twins !== undefined) {
    if (!isObject(raw.twins)) return wrong("twins", "an object of twins by component name, each `{ rust, props?, slots? }`");
    for (const [name, spec] of Object.entries(raw.twins)) {
      const path = `twins.${name}`;
      if (!isObject(spec)) return wrong(path, "an object: `{ rust, props?, slots? }`");
      keys(spec, path, ["rust", "props", "slots"]);
      if (spec.props !== undefined) {
        if (!isObject(spec.props)) return wrong(`${path}.props`, 'an object of prop types by name, as `{ "label": "string" }`');
        for (const [prop, t] of Object.entries(spec.props)) typeName(t, `${path}.props.${prop}`);
      }
      if (spec.slots !== undefined && !isStrings(spec.slots)) wrong(`${path}.slots`, 'a list of slot names, as `["default"]`');
    }
  }
  return raw as unknown as Config;
}

export function tyOfName(name: TypeName): Ty {
  switch (name) {
    case "string":
      return STR;
    case "string?":
      return opt(STR);
    case "int":
      return INT;
    case "int?":
      return opt(INT);
    case "float":
      return FLOAT;
    case "float?":
      return opt(FLOAT);
    case "bool":
      return BOOL;
    default:
      throw new GenError("FV1107", `unknown helper type \`${String(name)}\``);
  }
}

/** The Rust type of an `InlineHtml` prop, and of a `TrustedHtml` one when `trustedHtml` names it. */
export const INLINE_HTML = "ferrovue::InlineHtml";

/** Where `TrustedHtml` comes from. Only that import names the type `v-html` will write raw. */
export const TYPES_MODULE = "ferrovue/types";

export const ctx = {
  helpers: {} as Record<string, { rust: string; params: Ty[]; ret: Ty; maxLen: number }>,
  helperModule: null as string | null,
  trustedHtml: null as string | null,
  builders: true,
  clientDirectives: new Set<string>(),
  plugins: [] as readonly Plugin[],
  runs: new Map<Plugin, unknown>(),
  rootDir: "",
  typeStructs: new Map<string, Struct>(),
  typeAliases: new Map<string, N>(),
  typeFiles: new Map<string, string>(),
  typeRead: new Set<string>(),
  constDecls: new Map<string, Map<string, Declared>>(),
  typeConsts: new Map<string, { of: unknown; file: string; text: string }>(),
  components: new Map<string, Component>(),
  narrowCount: 0,
  componentsDir: "",
  vnodeTag: null as string | null,
};
