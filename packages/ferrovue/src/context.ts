import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "./plugin.ts";
import type { Declared } from "./constants.ts";
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
}

export type ScopeIdMode = "filepath" | "filepath-source";

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
      throw new GenError(`cannot find \`${displayName}\` in ${root}`);
    }
    throw e;
  }
  let raw: Partial<Config>;
  try {
    raw = JSON.parse(text) as Partial<Config>;
  } catch (e) {
    throw new GenError(`failed to parse \`${displayName}\`: ${(e as Error).message}`);
  }
  if (typeof raw.components !== "string" || typeof raw.out !== "string") {
    throw new GenError(`${displayName} needs \`components\` and \`out\` directories`);
  }
  if (raw.scopeId !== undefined && raw.scopeId !== "filepath" && raw.scopeId !== "filepath-source") {
    throw new GenError(`\`scopeId\` in ${displayName} is "filepath" or "filepath-source", as \`@vitejs/plugin-vue\` computes it`);
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

/** Where `TrustedHtml` comes from. Only that import names the type `v-html` will write raw. */
export const TYPES_MODULE = "ferrovue/types";

export const ctx = {
  helpers: {} as Record<string, { rust: string; params: Ty[]; ret: Ty; maxLen: number }>,
  helperModule: null as string | null,
  trustedHtml: null as string | null,
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
};
