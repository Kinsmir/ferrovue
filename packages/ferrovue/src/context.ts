/* The project's configuration, and the state one `generate()` run builds up. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { I18nSetup } from "./i18n.ts";
import { type Component, type N, type Struct, type Ty, BOOL, FLOAT, GenError, INT, opt, STR } from "./model.ts";

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
  /** vue-i18n: the directory of locale files (\`en.json\`, \`nl.json\`), the locale a page renders in
   * when it names none, and the locales a missing message falls back to. */
  i18n?: { messages: string; locale?: string; fallbackLocale?: string | string[] };
  /** How a `<style scoped>` component's `data-v-` id is computed, which must be how
   * `@vitejs/plugin-vue` computes it for the client: from the file's path (`"filepath"`, the
   * plugin's choice in development, and with `features.componentIdGenerator: "filepath"`), or its
   * path and source (`"filepath-source"`, the plugin's choice for a production build). */
  scopeId?: ScopeIdMode;
  /** Vite's root, from which a scope id hashes a component's path: the project root by default. */
  viteRoot?: string;
}

export type ScopeIdMode = "filepath" | "filepath-source";

export const CONFIG_FILE = "ferrovue.config.json";

/** Read the project's configuration. */
export function loadConfig(root: string): Config {
  const raw = JSON.parse(readFileSync(join(root, CONFIG_FILE), "utf8")) as Partial<Config>;
  if (typeof raw.components !== "string" || typeof raw.out !== "string") {
    throw new GenError(`${CONFIG_FILE} needs \`components\` and \`out\` directories`);
  }
  if (raw.scopeId !== undefined && raw.scopeId !== "filepath" && raw.scopeId !== "filepath-source") {
    throw new GenError(`\`scopeId\` in ${CONFIG_FILE} is "filepath" or "filepath-source", as \`@vitejs/plugin-vue\` computes it`);
  }
  return raw as Config;
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
      throw new GenError(`unknown helper type \`${String(name)}\``);
  }
}

/** A route as the routes file lists it: a vue-router path, and the name it may have. */
export interface RouteDef {
  /** The path as written: relative to the parent's unless it starts with \`/\`. */
  path: string;
  name?: string;
  /** The routes nested in it. */
  children?: RouteDef[];
  /** The path with its ancestors', as vue-router normalises it. */
  fullPath: string;
}

/** Every route, nested ones included, parents first. */
export function allRoutes(routes: RouteDef[]): RouteDef[] {
  return routes.flatMap((r) => [r, ...allRoutes(r.children ?? [])]);
}

/** A getter: the parameter naming the state (an option store's), and the expression it returns.
 * \`setup\` marks a setup store's \`computed\`, which reads the state's refs and the other getters by
 * name, through \`.value\`. */
export interface StoreGetter {
  param: string | null;
  body: N;
  file: string;
  setup?: true;
}

/** A Pinia option store: `export const usePrefs = defineStore("prefs", { state: (): PrefsState => ... })`. */
export interface Store {
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
  getters: Map<string, StoreGetter>;
}

/** Where `TrustedHtml` comes from. Only that import names the type `v-html` will write raw. */
export const TYPES_MODULE = "ferrovue/types";

/** What the configuration being compiled says, and what has been read so far: set up by
 * `generate()` at the start of each run, which is synchronous, so one run never sees another's. */
export const ctx = {
  /** The helpers of the configuration being compiled: name → Rust twin, typed. */
  helpers: {} as Record<string, { rust: string; params: Ty[]; ret: Ty; maxLen: number }>,
  helperModule: null as string | null,
  trustedHtml: null as string | null,
  /** Custom directives declared to render nothing on the server. */
  clientDirectives: new Set<string>(),
  /** The configured routes, when there are any. */
  routes: null as RouteDef[] | null,
  /** The history's base, and the class names active links take, from the configured router. */
  routerBase: "",
  linkActive: "router-link-active",
  linkExactActive: "router-link-exact-active",
  /** The configured stores, by hook name, and every interface their files declare. */
  stores: new Map<string, Store>(),
  storeStructs: new Map<string, Struct>(),
  /** The store file each of those interfaces is declared in. */
  storeFiles: new Map<string, string>(),
  /** The project root, for resolving a component's imports. */
  rootDir: "",
  /** Interfaces and object types declared in shared `.ts` files that components import, and type
   * aliases there; the file each comes from. They are written once, to `types.rs`. */
  typeStructs: new Map<string, Struct>(),
  typeAliases: new Map<string, N>(),
  typeFiles: new Map<string, string>(),
  /** The shared files read so far. */
  typeRead: new Set<string>(),
  /** Every component being compiled, by name, for a type that names another one's props. */
  components: new Map<string, Component>(),
  /** Numbers the bindings narrowing introduces, restarted per component so that a file's text
   * depends on its own source alone. */
  narrowCount: 0,
  /** The directory the components being compiled come from, for the generated headers. */
  componentsDir: "",
  /** The configured locales and their messages, when there are any. */
  i18n: null as I18nSetup | null,
  /** How scope ids are computed, and the directory a component's path is hashed from. */
  scopeId: "filepath-source" as ScopeIdMode,
  viteRoot: "",
};
