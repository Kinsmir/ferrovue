/* `ferrovue/vite`: the Rust renderers regenerated as part of a Vite build and its dev server.
 *
 *   import ferrovue from "ferrovue/vite";
 *   export default defineConfig({ plugins: [vue(), ferrovue()] });
 *
 * A build regenerates them once and fails on a construct ferrovue refuses, naming the line in the
 * `.vue` file. The dev server regenerates them whenever a component, store, type file, the routes
 * or the configuration changes, and shows a refusal in its error overlay. Only files whose text
 * changed are rewritten, so `cargo watch` rebuilds no more than it must. */
import { relative, resolve, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
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

export default function ferrovue(options: FerrovueOptions = {}): Plugin {
  const root = resolve(options.root ?? process.cwd());
  const regenerate = (): Written => write(root, loadConfig(root));
  return {
    name: "ferrovue",
    buildStart() {
      try {
        regenerate();
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
