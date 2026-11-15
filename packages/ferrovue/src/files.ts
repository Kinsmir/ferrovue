import { parse as parseJs } from "@babel/parser";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, posix, resolve, sep } from "node:path";
import { ctx } from "./context.ts";
import type { ErrorCode } from "./errors.ts";
import { type Component, type N } from "./model.ts";
import { fail, failIn } from "./locate.ts";
import { GenError } from "./errors.ts";

function why(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ENOENT" ? "it does not exist" : code === "ENOTDIR" ? "it is not a directory" : code === "EISDIR" ? "it is a directory" : (e as Error).message;
}

/** The real paths of the directories the project's files may be read from: its root, and each
 * directory `sharedDirectories` names, refusing one that cannot be found. */
export function reachOf(root: string, shared: readonly string[]): string[] {
  return [root, ...shared].map((dir) => {
    try {
      return realpathSync.native(resolve(root, dir));
    } catch (e) {
      throw new GenError("FV1116", `cannot read the \`sharedDirectories\` directory \`${dir}\`: ${why(e)}`, { file: dir });
    }
  });
}

/** Refuse a path the configuration names as `key`, or a file found there, that leads out of the
 * project's root, through a symbolic link or `..`, to a directory `sharedDirectories` does not list.
 * A path that does not exist is left for its read to refuse, and outside a compile of `root` nothing
 * is checked. */
export function refuseOutsideProject(root: string, path: string, key: string): void {
  if (ctx.rootDir !== root || ctx.reach.length === 0) return;
  let real: string;
  try {
    real = realpathSync.native(resolve(root, path));
  } catch {
    return;
  }
  if (ctx.reach.some((dir) => real === dir || real.startsWith(dir.endsWith(sep) ? dir : dir + sep))) return;
  throw new GenError("FV1125", `\`${path}\`, which \`${key}\` reaches, leads to ${real}, outside the project: list the directory it is in under \`sharedDirectories\`, or copy the file into the project`, { file: path });
}

/** The entries of a directory the configuration names as `key` that `keep` keeps, refusing a
 * directory that cannot be read, and the directory or an entry kept when it leads out of the project. */
export function listDir(root: string, dir: string, key: string, keep: (name: string) => boolean): string[] {
  let names: string[];
  try {
    names = readdirSync(join(root, dir)).filter(keep);
  } catch (e) {
    throw new GenError("FV1116", `cannot read the \`${key}\` directory \`${dir}\`: ${why(e)}`, { file: dir });
  }
  refuseOutsideProject(root, dir, key);
  for (const name of names) refuseOutsideProject(root, posix.join(dir, name), key);
  return names;
}

/** A JSON file of the project's, parsed; one that cannot be read is refused with `missing`, and one
 * that does not parse with `invalid`. */
export function readJsonFile(root: string, file: string, codes: { missing?: ErrorCode; invalid: ErrorCode }): unknown {
  let text: string;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch (e) {
    if (!codes.missing) throw e;
    return failIn(file, codes.missing, `cannot read the file: ${why(e)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    return failIn(file, codes.invalid, (e as Error).message);
  }
}

/** The statements of a TypeScript file of the project's, whose text `home.source` holds, refusing
 * one that does not parse with where the parser stopped, as a component's script is. */
export function parseTs(home: Component): N[] {
  try {
    return parseJs(home.source ?? "", { sourceType: "module", plugins: ["typescript"] }).program.body;
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    const at = (e as { loc?: { line: number; column: number } }).loc;
    return fail(home, "FV0001", e.message.replace(/ \(\d+:\d+\)$/, ""), at ? { type: "ParseError", loc: { start: at }, __fv: "source" } : undefined);
  }
}
