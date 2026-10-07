import { parse as parseJs } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Code } from "./errors.ts";
import { type Component, type N, fail, failIn, GenError } from "./model.ts";

function why(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ENOENT" ? "it does not exist" : code === "ENOTDIR" ? "it is not a directory" : code === "EISDIR" ? "it is a directory" : (e as Error).message;
}

/** The entries of a directory the configuration names as `key`, refusing one that cannot be read. */
export function listDir(root: string, dir: string, key: string): string[] {
  try {
    return readdirSync(join(root, dir));
  } catch (e) {
    throw new GenError("FV1116", `cannot read the \`${key}\` directory \`${dir}\`: ${why(e)}`, { file: dir });
  }
}

/** A JSON file of the project's, parsed; one that cannot be read is refused with `missing`, and one
 * that does not parse with `invalid`. */
export function readJsonFile(root: string, file: string, codes: { missing?: Code; invalid: Code }): unknown {
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
