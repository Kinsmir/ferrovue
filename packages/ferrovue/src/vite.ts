/* `ferrovue/vite`: the Rust renderers regenerated as part of a Vite build and its dev server.
 *
 *   import ferrovue from "ferrovue/vite";
 *   export default defineConfig({ plugins: [vue(), ferrovue()] });
 *
 * A build regenerates them once and fails on a construct ferrovue refuses, naming the line in the
 * `.vue` file. The dev server regenerates them whenever a component, store, type file, the routes
 * or the configuration changes, and shows a refusal in its error overlay. Only files whose text
 * changed are rewritten, so `cargo watch` rebuilds no more than it must. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { CONFIG_FILE, GenError, loadConfig, write, type Written } from "./compiler.ts";

export interface FerrovueOptions {
  /** The directory holding `ferrovue.config.json`: Vite's working directory by default. */
  root?: string;
}

/** Whether a changed file can change what is generated: a component, a store or type file, the
 * routes or the configuration — anything but the output itself, dependencies and build output. */
export function affects(root: string, file: string): boolean {
  const rel = relative(root, file);
  if (rel.startsWith("..") || !/\.(vue|ts|json)$/.test(rel)) return false;
  let out = "";
  try {
    out = loadConfig(root).out;
  } catch {
    // A broken configuration ignores nothing; regenerating reports it.
  }
  const parts = rel.split(sep);
  if (parts.some((p) => p === "node_modules" || p === "target" || p === ".git" || p === "dist")) return false;
  return out === "" || !(rel === out || rel.startsWith(out + sep));
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
    files = readdirSync(join(root, config.components)).filter((f) => f.endsWith(".vue"));
  } catch {
    // No components: generating reports it.
  }
  if (!files.some((f) => /<style\b[^>]*\bscoped\b/.test(readFileSync(join(root, config.components, f), "utf8")))) return null;
  return `\`<style scoped>\` ids: @vitejs/plugin-vue hashes "${vue.mode}" from ${vue.root}, ${CONFIG_FILE} "${mode}" from ${viteRoot}; set \`scopeId\` and \`viteRoot\` to match, or plugin-vue's \`features.componentIdGenerator\``;
}

export default function ferrovue(options: FerrovueOptions = {}): Plugin {
  const root = resolve(options.root ?? process.cwd());
  const regenerate = (): Written => write(root, loadConfig(root));
  let vue: ReturnType<typeof vueScopeIds> = null;
  let building = true;
  return {
    name: "ferrovue",
    configResolved(config) {
      vue = vueScopeIds(config);
      building = config.command === "build";
    },
    buildStart() {
      try {
        regenerate();
        // A build whose styles would not apply to the server's pages fails, as a refusal does; the
        // dev server warns.
        const mismatch = scopeIdMismatch(root, vue);
        if (mismatch && building) this.error(`ferrovue: ${mismatch}`);
        if (mismatch) this.warn(`ferrovue: ${mismatch}`);
      } catch (e) {
        if (e instanceof GenError || e instanceof SyntaxError) this.error(e.message);
        throw e;
      }
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add(resolve(root, CONFIG_FILE));
      const onChange = (file: string): void => {
        if (!affects(root, file)) return;
        try {
          const { changed, removed } = regenerate();
          if (changed.length || removed.length) {
            server.config.logger.info(`ferrovue: ${changed.length} changed, ${removed.length} removed`, { timestamp: true });
          }
        } catch (e) {
          if (!(e instanceof GenError || e instanceof SyntaxError)) throw e;
          server.config.logger.error(`ferrovue: ${e.message}`, { timestamp: true });
          server.ws.send({ type: "error", err: { message: `ferrovue: ${e.message}`, stack: "", plugin: "ferrovue" } });
        }
      };
      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}
