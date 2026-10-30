import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkConfig } from "./context.ts";
import { formatWarning } from "./diagnostics.ts";
import { GenError } from "./errors.ts";

/** A type a helper takes or returns, as the configuration spells it. */
export type TypeName = "string" | "string?" | "int" | "int?" | "float" | "float?" | "bool";

/** A function a template may call, and the Rust function that is its twin. */
export interface HelperSpec {
  /** The Rust path the generated code calls, e.g. `crate::helpers::format_count`. */
  rust: string;
  /** The type of each argument, in order. */
  params: TypeName[];
  /** The type it returns. */
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
  /** The JSON Schema an editor checks the file against. ferrovue does not read it. */
  $schema?: string;
  /** The directory of `.vue` files to compile. */
  components: string;
  /** The directory the Rust modules are written to. A module ferrovue wrote there is replaced or
   * removed; any other file is left alone. */
  out: string;
  /** The module components import their helpers from, and the Rust twin of each export. */
  helpers?: {
    /** The module a component imports the helpers from, as its imports name it: `./helpers`. */
    module: string;
    /** Each function a template may call, by its name in that module. */
    functions: Record<string, HelperSpec>;
  };
  /** Components ferrovue does not compile, by the name a template gives them (`VBtn`, which
   * `<v-btn>` finds too), each rendered by a Rust function of the project's. */
  twins?: Record<string, TwinSpec>;
  /** The Rust type a `TrustedHtml` prop is, which must implement `ferrovue::html::TrustedHtml`, e.g.
   * `crate::sanitize::SafeHtml`. A type that borrows names the props' lifetime, `'a`:
   * `crate::render::Trusted<'a>`. `ferrovue::html::InlineHtml` makes every `TrustedHtml` prop inline HTML.
   * Without it, only an `InlineHtml` prop may reach `v-html`. */
  trustedHtml?: string;
  /** The Rust type a `Date` prop is, which must implement `ferrovue::date::JsTime`:
   * `ferrovue::date::JsDate` by default, or `chrono::DateTime<chrono::Utc>` with the crate's `chrono`
   * feature. */
  dateType?: string;
  /** The application's own Rust enum for a union of string literals, by the union's `type` alias:
   * `{ "Tone": "crate::domain::Tone" }`. Generated code uses that enum, which must implement
   * `ferrovue::props::Union` and have a variant of the name ferrovue would generate for each literal, and
   * generates no enum for the union. */
  unions?: Record<string, string>;
  /** A JSON file listing the app's routes as vue-router paths (`/users/:id`), which `<RouterLink>`
   * resolves against, or `{ pages }`: a folder of pages whose file names give the routes, as
   * vue-router's file-based routing reads them. Without it, a component cannot use `<RouterLink>`. */
  routes?: RoutesSource;
  /** The router, in full: its routes, the history's base, and the class names `createRouter`
   * gives active links. `routes` alone is shorthand for `{ routes }`. */
  router?: {
    /** Where the routes come from, as `routes` takes them. */
    routes: RoutesSource;
    /** The base `createWebHistory` is given, which every link starts with. */
    base?: string;
    /** The class of a link to the current route or one of its parents. */
    linkActiveClass?: string;
    /** The class of a link to exactly the current route. */
    linkExactActiveClass?: string;
  };
  /** The directory of Pinia stores (`.ts` files), whose state a component may read while it renders
   * on the server. */
  stores?: string;
  /** Custom directives that render nothing on the server (no `getSSRProps`), by name, without
   * `v-`: `["focus", "click-outside"]`. Any other custom directive is refused, since the server
   * cannot know what its `getSSRProps` would add. */
  clientDirectives?: string[];
  /** vue-i18n: the directory of locale files (`en.json`, `nl.json`), the locale a page renders in
   * when it names none, and the locales a missing message falls back to. */
  i18n?: {
    /** The directory of locale files, one per locale: `en.json`, `nl.json`. */
    messages: string;
    /** The locale a page renders in when it names none. */
    locale?: string;
    /** The locale or locales, in order, a message missing from the page's locale is looked up in. */
    fallbackLocale?: string | string[];
  };
  /** How a `<style scoped>` component's `data-v-` id is computed, which must be how
   * `@vitejs/plugin-vue` computes it for the client: from the file's path (`"filepath"`, the
   * plugin's choice in development, and with `features.componentIdGenerator: "filepath"`), or its
   * path and source (`"filepath-source"`, the plugin's choice for a production build). */
  scopeId?: ScopeIdMode;
  /** Vite's root, from which a scope id hashes a component's path: the project root by default. */
  viteRoot?: string;
  /** Whether `@vitejs/plugin-vue` compiles for production, as Vite's `isProduction`: `true` (the
   * default) for `vite build`, `false` for the dev server. It decides the names of the CSS
   * variables `v-bind()` in `<style>` sets: a hash in production, the expression in development. */
  isProduction?: boolean;
  /** Whether the HTML comments of templates render, as `@vitejs/plugin-vue`'s
   * `template.compilerOptions.comments`: by default as Vue decides it, kept when `isProduction` is
   * `false` and left out when it is `true`. */
  comments?: boolean;
  /** CSS modules (`<style module>`): how Vite's `css.modules` names their classes, which ferrovue
   * computes as postcss-modules does. Without it, `<style module>` is refused. */
  cssModules?: {
    /** The pattern of a class's name, as Vite's `css.modules.generateScopedName`:
     * `"[local]_[hash:base64:5]"`. */
    generateScopedName: string;
    /** Vite's `css.modules.hashPrefix`, hashed before a module's path. */
    hashPrefix?: string;
    /** The directory Vite runs in, its working directory, from which a hash takes a module's path,
     * relative to this file's directory: `viteRoot` by default. */
    context?: string;
  };
  /** Whether each props struct and shared type gets `new()` and a chainable setter per optional
   * field: `true` by default. With `false`, props are built as struct literals. */
  builders?: boolean;
}

export type ScopeIdMode = "filepath" | "filepath-source";

/** Where the routes come from: a JSON file of routes, or a folder of pages. */
export type RoutesSource =
  | string
  | {
      /** The folder of pages, each a component, whose file names give the routes. */
      pages: string;
    };

export const CONFIG_FILE = "ferrovue.config.json";

/** Where `TrustedHtml` comes from. Only that import names the type `v-html` will write raw. */
export const TYPES_MODULE = "ferrovue/types";

const warnOnConsole = (warning: GenError): void => console.warn(formatWarning(warning));

/** Read the project's configuration, handing `warn` a warning for each deprecated key it holds. */
export function loadConfig(root: string, configPath?: string, warn: (warning: GenError) => void = warnOnConsole): Config {
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
  return checkConfig(raw, displayName, warn);
}
