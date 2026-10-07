import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { relativePath } from "./paths.ts";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { CONFIG_FILE, loadConfig, write, type Written } from "./compiler.ts";
import { formatRefusal, isRefusal } from "./diagnostics.ts";
import { allPages, type FileRoute, fileRoutes, pagesFolder } from "./file-routes.ts";

export interface FerrovueOptions {
  /** The directory holding `ferrovue.config.json`: Vite's working directory by default. */
  root?: string;
}

/** Whether a changed file can change what is generated: a component, a store or type file, the
 * routes or the configuration: anything but the output itself, dependencies and build output. */
export function affects(root: string, file: string): boolean {
  const rel = relativePath(root, file);
  if (rel.startsWith("..") || !/\.(vue|ts|json)$/.test(rel)) return false;
  let out = "";
  try {
    out = loadConfig(root).out;
  } catch {
  }
  const parts = rel.split("/");
  if (parts.some((p) => p === "node_modules" || p === "target" || p === ".git" || p === "dist")) return false;
  return out === "" || !(rel === out || rel.startsWith(out + "/"));
}

/** How `@vitejs/plugin-vue`, as this build configures it, computes a `<style scoped>` id: from the
 * path alone or the path and source, hashed from Vite's root. `null` without the plugin, or with an
 * id generator of its own. */
export function vueScopeIds(config: ResolvedConfig): { mode: "filepath" | "filepath-source"; root: string } | null {
  const vue = config.plugins.find((p) => p.name === "vite:vue");
  const generator = (vue?.api as { options?: { features?: { componentIdGenerator?: unknown } } } | undefined)?.options?.features?.componentIdGenerator;
  if (!vue || (generator !== undefined && generator !== "filepath" && generator !== "filepath-source")) return null;
  return { mode: generator ?? (config.isProduction ? "filepath-source" : "filepath"), root: resolve(config.root) };
}

/** Why the server's scope ids would differ from the client's, when a component has `<style scoped>`
 * and `ferrovue.config.json` computes them otherwise than plugin-vue: a page would hydrate cleanly
 * and show unstyled. */
export function scopeIdMismatch(root: string, vue: { mode: string; root: string } | null): string | null {
  if (!vue) return null;
  const config = loadConfig(root);
  const mode = config.scopeId ?? "filepath-source";
  const viteRoot = resolve(root, config.viteRoot ?? ".");
  if (mode === vue.mode && viteRoot === vue.root) return null;
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
  if (!files.some((f) => /<style\b[^>]*\bscoped\b/.test(readFileSync(join(root, f), "utf8")))) return null;
  return `\`<style scoped>\` ids: @vitejs/plugin-vue hashes "${vue.mode}" from ${vue.root}, ${CONFIG_FILE} "${mode}" from ${viteRoot}; set \`scopeId\` and \`viteRoot\` to match, or plugin-vue's \`features.componentIdGenerator\``;
}

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

/** The Rust renderers regenerated by a Vite build and its dev server, and the `ferrovue/islands`
 * and `ferrovue/routes` modules. */
export default function ferrovue(options: FerrovueOptions = {}): Plugin {
  const root = resolve(options.root ?? process.cwd());
  let islands: Record<string, string> | null = null;
  let routes: string | null = null;
  const regenerate = (): Written => {
    const written = write(root, loadConfig(root));
    islands = written.islands;
    return written;
  };
  const pagesModule = (): string => {
    const pages = pagesFolder(loadConfig(root));
    if (pages === null) throw new Error(`ferrovue: \`${ROUTES}\` is written from a folder of pages: set \`"routes": { "pages": "…" }\` in ${CONFIG_FILE}`);
    return routesModule(root, fileRoutes(root, pages));
  };
  let vue: ReturnType<typeof vueScopeIds> = null;
  let building = true;
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
        return islandsModule(root, islands ?? regenerate().islands);
      } catch (e) {
        if (isRefusal(e)) this.error(formatRefusal(e));
        throw e;
      }
    },
    configResolved(config) {
      vue = vueScopeIds(config);
      building = config.command === "build";
    },
    buildStart() {
      try {
        regenerate();
        const mismatch = scopeIdMismatch(root, vue);
        if (mismatch && building) this.error(`ferrovue: ${mismatch}`);
        if (mismatch) this.warn(`ferrovue: ${mismatch}`);
      } catch (e) {
        if (isRefusal(e)) this.error(formatRefusal(e));
        throw e;
      }
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add(resolve(root, CONFIG_FILE));
      const onChange = (file: string): void => {
        if (!affects(root, file)) return;
        try {
          const before = JSON.stringify(islands);
          const { changed, removed } = regenerate();
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
      };
      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}
