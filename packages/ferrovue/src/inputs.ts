import { dirname, resolve, sep } from "node:path";
import { type Config, ctx } from "./context.ts";
import { pagesFolder } from "./file-routes.ts";

/** What a run reads, as absolute paths: what `ferrovue --watch` and the Vite plugin regenerate on. */
export interface Inputs {
  /** The configuration file, the routes file, and every `.ts` file the last run read types or
   * constants from. */
  files: Set<string>;
  /** The directories whose files of one kind are read: components, stores, locale messages, and
   * the pages, nested folders included. */
  dirs: { dir: string; ext: string; deep: boolean }[];
  /** The output directory, which is never an input. */
  out: string | null;
}

/** The inputs of a run of `config`, which is `null` when the configuration file cannot be read and
 * the file alone is watched. Call it once a run is over: the type files are those the run read. */
export function inputsOf(root: string, configFile: string, config: Config | null): Inputs {
  const inputs: Inputs = { files: new Set([resolve(root, configFile)]), dirs: [], out: null };
  if (!config) return inputs;
  const at = (path: string): string => resolve(root, path);
  inputs.out = at(config.out);
  inputs.dirs.push({ dir: at(config.components), ext: ".vue", deep: false });
  if (config.stores) inputs.dirs.push({ dir: at(config.stores), ext: ".ts", deep: false });
  if (config.i18n) inputs.dirs.push({ dir: at(config.i18n.messages), ext: ".json", deep: false });
  const pages = pagesFolder(config);
  if (pages !== null) inputs.dirs.push({ dir: at(pages), ext: ".vue", deep: true });
  const routes = config.router?.routes ?? config.routes;
  if (typeof routes === "string") inputs.files.add(at(routes));
  if (ctx.rootDir === root) for (const file of ctx.typeRead) inputs.files.add(file);
  return inputs;
}

/** Whether a change to `file`, an absolute path, can change what is generated. A directory of
 * inputs itself counts, as one renamed away or back. */
export function affects(inputs: Inputs, file: string): boolean {
  if (inputs.files.has(file)) return true;
  if (inputs.out !== null && (file === inputs.out || file.startsWith(inputs.out + sep))) return false;
  return inputs.dirs.some(({ dir, ext, deep }) => file === dir || (file.endsWith(ext) && (deep ? file.startsWith(dir + sep) : dirname(file) === dir)));
}

/** Every path to watch for the inputs: their files and directories. */
export function watched(inputs: Inputs): string[] {
  return [...inputs.files, ...inputs.dirs.map((d) => d.dir)];
}
