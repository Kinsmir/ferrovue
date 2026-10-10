import { readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve, sep } from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { type Config, CONFIG_FILE, type GenError, loadConfig, write, type Written } from "./compiler.ts";
import { formatRefusal, formatWarning, isRefusal } from "./diagnostics.ts";
import { allPages, type FileRoute, fileRoutes, pagesFolder } from "./file-routes.ts";
import { affects, type Inputs, inputsOf, watched } from "./inputs.ts";

export type { FileRoute } from "./file-routes.ts";

export interface FerrovueOptions {
  /** The project root, which the configuration's paths are relative to: Vite's working directory
   * by default. */
  root?: string;
  /** The configuration file, relative to `root`, as the CLI's `--config` takes it:
   * `ferrovue.config.json` by default. */
  config?: string;
}

/** How `@vitejs/plugin-vue`, as this build configures it, computes a `<style scoped>` id: from the
 * path alone or the path and source, hashed from Vite's root; and whether it compiles for production.
 * `null` without the plugin, or with an id generator of its own. */
export function vueScopeIds(config: ResolvedConfig): { mode: "filepath" | "filepath-source"; root: string; production: boolean } | null {
  const vue = config.plugins.find((p) => p.name === "vite:vue");
  const generator = (vue?.api as { options?: { features?: { componentIdGenerator?: unknown } } } | undefined)?.options?.features?.componentIdGenerator;
  if (!vue || (generator !== undefined && generator !== "filepath" && generator !== "filepath-source")) return null;
  return { mode: generator ?? (config.isProduction ? "filepath-source" : "filepath"), root: resolve(config.root), production: config.isProduction };
}

function componentSources(root: string, config: Config): string[] {
  let files: string[] = [];
  try {
    files = readdirSync(join(root, config.components))
      .filter((f) => f.endsWith(".vue"))
      .map((f) => join(config.components, f));
  } catch {
  }
  const pages = pagesFolder(config);
  if (pages !== null) {
    try {
      files.push(...allPages(fileRoutes(root, pages)).map((p) => p.file!));
    } catch {
    }
  }
  return files.map((f) => readFileSync(join(root, f), "utf8"));
}

const SCOPED = /<style\b[^>]*\bscoped\b/;
const CSS_VARS = /<style\b[^>]*>[^]*?\bv-bind\s*\([^]*?<\/style>/;
const MODULE = /<style\b[^>]*\bmodule\b/;

/** Why the server's scope ids, or the CSS variables `v-bind()` sets, would differ from the client's,
 * when a component has `<style scoped>` or `v-bind()` in `<style>` and the configuration,
 * `configFile`, computes them otherwise than plugin-vue: a page would hydrate and show unstyled. */
export function scopeIdMismatch(root: string, vue: { mode: string; root: string; production?: boolean } | null, configFile = CONFIG_FILE): string | null {
  if (!vue) return null;
  const config = loadConfig(root, configFile, ignore);
  const mode = config.scopeId ?? "filepath-source";
  const viteRoot = resolve(root, config.viteRoot ?? ".");
  const production = config.isProduction ?? true;
  const sameIds = mode === vue.mode && viteRoot === vue.root;
  const sameNames = vue.production === undefined || production === vue.production;
  if (sameIds && sameNames) return null;
  const sources = componentSources(root, config);
  const scoped = sources.some((s) => SCOPED.test(s));
  const vars = sources.some((s) => CSS_VARS.test(s));
  if (!sameIds && (scoped || vars)) {
    return `${scoped ? "`<style scoped>` ids" : "the ids `v-bind()` in `<style>` names its variables by"}: @vitejs/plugin-vue hashes "${vue.mode}" from ${vue.root}, ${configFile} "${mode}" from ${viteRoot}; set \`scopeId\` and \`viteRoot\` to match, or plugin-vue's \`features.componentIdGenerator\``;
  }
  if (!sameNames && vars) {
    return `\`v-bind()\` in \`<style>\`: @vitejs/plugin-vue compiles ${vue.production ? "for production" : "for development"}, where ${configFile} has \`"isProduction": ${production}\`; set \`isProduction\` to ${vue.production}`;
  }
  return null;
}

/** Why the class names of the server's CSS modules would differ from those Vite gives the client,
 * when a component has `<style module>` and Vite's `css`, run from `cwd`, names them otherwise than
 * `cssModules` in the configuration, `configFile`. */
export function cssModulesMismatch(root: string, css: ResolvedConfig["css"] | undefined, cwd: string, configFile = CONFIG_FILE): string | null {
  const config = loadConfig(root, configFile, ignore);
  const own = config.cssModules;
  if (!own || !componentSources(root, config).some((s) => MODULE.test(s))) return null;
  const modules = css?.modules;
  const set = (what: string): string => `\`<style module>\` class names: ${what}`;
  if (css?.transformer === "lightningcss") return set("Vite names them with lightningcss (`css.transformer`), where ferrovue computes postcss-modules' names; use the PostCSS transformer");
  if (modules === false) return set("Vite's `css.modules` is `false`, which leaves CSS modules unprocessed");
  if (modules?.generateScopedName !== own.generateScopedName) {
    const theirs = typeof modules?.generateScopedName === "function" ? "a function" : modules?.generateScopedName === undefined ? "unset" : JSON.stringify(modules.generateScopedName);
    return set(`Vite's \`css.modules.generateScopedName\` is ${theirs}, ${configFile}'s \`cssModules.generateScopedName\` ${JSON.stringify(own.generateScopedName)}; set the two alike, to a string`);
  }
  if ((modules.hashPrefix ?? "") !== (own.hashPrefix ?? "")) {
    return set(`Vite's \`css.modules.hashPrefix\` is ${JSON.stringify(modules.hashPrefix ?? "")}, ${configFile}'s \`cssModules.hashPrefix\` ${JSON.stringify(own.hashPrefix ?? "")}`);
  }
  if (modules.localsConvention !== undefined) return set("Vite's `css.modules.localsConvention` renames the classes a template reads; leave it unset");
  if (modules.scopeBehaviour === "global" || modules.globalModulePaths?.length || modules.exportGlobals) {
    return set("Vite's `css.modules` makes some names global (`scopeBehaviour`, `globalModulePaths`, `exportGlobals`); leave those unset");
  }
  const context = resolve(root, own.context ?? config.viteRoot ?? ".");
  if (/\[(?:[^\]]*:)?(?:hash|contenthash|path|folder)\b/i.test(own.generateScopedName) && context !== resolve(cwd)) {
    return set(`Vite runs in ${resolve(cwd)}, from which it hashes a module's path, where ${configFile}'s \`cssModules.context\` is ${context}; run Vite there, or set \`cssModules.context\``);
  }
  return null;
}

const ignore = (): void => {};

const ISLANDS = "ferrovue/islands";
const ISLANDS_ID = `\0${ISLANDS}`;
const ROUTES = "ferrovue/routes";
const ROUTES_ID = `\0${ROUTES}`;

function islandsModule(root: string, islands: Record<string, string>): string {
  const entries = Object.entries(islands).map(([name, file]) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(resolve(root, file).split(sep).join("/"))}),`);
  return `export default {\n${entries.join("\n")}\n};\n`;
}

function routesTree(root: string, routes: FileRoute[], indent: string, lazy: boolean): string {
  return routes
    .map((r) => {
      const page = r.file ? `() => import(${JSON.stringify(resolve(root, r.file).split(sep).join("/"))})` : null;
      const fields = [
        `path: ${JSON.stringify(r.path)}`,
        ...(r.name !== undefined ? [`name: ${JSON.stringify(r.name)}`] : []),
        ...(lazy && page ? [`component: ${page}`] : []),
        ...(!lazy && !page ? ["view: false"] : []),
        ...(r.children ? [`children: [\n${routesTree(root, r.children, `${indent}    `, lazy)}\n${indent}  ]`] : []),
      ];
      return `${indent}{\n${fields.map((f) => `${indent}  ${f},`).join("\n")}\n${indent}}`;
    })
    .join(",\n");
}

/** The `ferrovue/routes` module: the routes vue-router's file-based routing builds from the pages,
 * as vue-router's records with each page loaded lazily (`routes`), and as a routes file lists them
 * (the default export), for `routeRecords` and `linkRouter`. */
export function routesModule(root: string, routes: FileRoute[]): string {
  return `export const routes = [
${routesTree(root, routes, "  ", true)}
];

export default [
${routesTree(root, routes, "  ", false)}
];
`;
}

function islandsFile(manifest: boolean | string, ssr: boolean | string): string | null {
  if (!manifest || ssr) return null;
  const written = typeof manifest === "string" ? manifest : ".vite/manifest.json";
  return posix.join(posix.dirname(written), "ferrovue-islands.json");
}

function islandsJson(root: string, islands: Record<string, string>, bundle: Iterable<{ type: string; fileName: string; moduleIds?: readonly string[] }>): string {
  const names = new Map(Object.entries(islands).map(([name, file]) => [resolve(root, file), name]));
  const files: Record<string, string> = {};
  for (const chunk of bundle) {
    if (chunk.type !== "chunk") continue;
    for (const id of chunk.moduleIds ?? []) {
      const name = names.get(resolve(id));
      if (name !== undefined) files[name] = chunk.fileName;
    }
  }
  const sorted = Object.fromEntries(Object.entries(files).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The Rust renderers regenerated by a Vite build and its dev server, and the `ferrovue/islands`
 * and `ferrovue/routes` modules. */
export default function ferrovue(options: FerrovueOptions = {}): Plugin {
  const root = resolve(options.root ?? process.cwd());
  const configFile = options.config ?? CONFIG_FILE;
  let islands: Record<string, string> | null = null;
  let routes: string | null = null;
  let inputs: Inputs | null = null;
  const regenerate = (warn: (warning: GenError) => void): Written => {
    let config: Config | null = null;
    try {
      config = loadConfig(root, configFile, warn);
      const written = write(root, config);
      islands = written.islands;
      return written;
    } finally {
      inputs = inputsOf(root, configFile, config);
    }
  };
  const pagesModule = (): string => {
    const pages = pagesFolder(loadConfig(root, configFile, ignore));
    if (pages === null) throw new Error(`ferrovue: \`${ROUTES}\` is written from a folder of pages: set \`"routes": { "pages": "…" }\` in ${configFile}`);
    return routesModule(root, fileRoutes(root, pages));
  };
  let vue: ReturnType<typeof vueScopeIds> = null;
  let css: ResolvedConfig["css"] | undefined;
  let building = true;
  let manifest: string | null = null;
  return {
    name: "ferrovue",
    enforce: "pre",
    resolveId(id) {
      return id === ISLANDS ? ISLANDS_ID : id === ROUTES ? ROUTES_ID : null;
    },
    load(id) {
      if (id !== ISLANDS_ID && id !== ROUTES_ID) return null;
      try {
        if (id === ROUTES_ID) return (routes ??= pagesModule());
        return islandsModule(root, islands ?? regenerate((w) => this.warn(formatWarning(w))).islands);
      } catch (e) {
        if (isRefusal(e)) this.error(formatRefusal(e));
        throw e;
      }
    },
    configResolved(config) {
      vue = vueScopeIds(config);
      css = config.css;
      building = config.command === "build";
      manifest = islandsFile(config.build.manifest, config.build.ssr);
    },
    buildStart() {
      try {
        regenerate((w) => this.warn(formatWarning(w)));
        const mismatch = scopeIdMismatch(root, vue, configFile) ?? cssModulesMismatch(root, css, process.cwd(), configFile);
        if (mismatch && building) this.error(`ferrovue: ${mismatch}`);
        if (mismatch) this.warn(`ferrovue: ${mismatch}`);
      } catch (e) {
        if (isRefusal(e)) this.error(formatRefusal(e));
        throw e;
      }
    },
    generateBundle(_, bundle) {
      if (manifest === null || islands === null) return;
      this.emitFile({ type: "asset", fileName: manifest, source: islandsJson(root, islands, Object.values(bundle)) });
    },
    configureServer(server: ViteDevServer) {
      if (!inputs) {
        let config: Config | null = null;
        try {
          config = loadConfig(root, configFile, ignore);
        } catch {
        }
        inputs = inputsOf(root, configFile, config);
      }
      server.watcher.add(watched(inputs));
      const onChange = (file: string): void => {
        if (!inputs || !affects(inputs, resolve(file))) return;
        try {
          const before = JSON.stringify(islands);
          const { changed, removed } = regenerate((w) => server.config.logger.warn(`ferrovue: ${formatWarning(w)}`, { timestamp: true }));
          if (changed.length || removed.length) {
            server.config.logger.info(`ferrovue: ${changed.length} changed, ${removed.length} removed`, { timestamp: true });
          }
          const loaded = server.moduleGraph.getModuleById(ISLANDS_ID);
          if (loaded && JSON.stringify(islands) !== before) {
            server.moduleGraph.invalidateModule(loaded);
            server.ws.send({ type: "full-reload" });
          }
          const pages = server.moduleGraph.getModuleById(ROUTES_ID);
          if (pages && routes !== null) {
            const now = pagesModule();
            if (now !== routes) {
              routes = now;
              server.moduleGraph.invalidateModule(pages);
              server.ws.send({ type: "full-reload" });
            }
          }
        } catch (e) {
          // Thrown from a watcher's listener, anything but a refusal would take the dev server down:
          // show it like one, and regenerate on the change that puts it right.
          const message = isRefusal(e) ? formatRefusal(e) : `error: ${e instanceof Error ? e.message : String(e)}`;
          server.config.logger.error(`ferrovue: ${message}`, { timestamp: true });
          server.ws.send({ type: "error", err: { message: `ferrovue: ${message}`, stack: "", plugin: "ferrovue" } });
        }
        server.watcher.add(watched(inputs));
      };
      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}
