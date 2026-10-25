import { inspect } from "node:util";
import { GenError } from "../src/errors.ts";

/** What a throw out of `generate()` was: a refusal, or a crash of the compiler with its stack. */
export type CompileFailure = { k: "refused"; message: string } | { k: "crash"; stack: string };

/** Classify what `generate()` threw: a `GenError` is a refusal, anything else a crash. */
export function compileFailure(e: unknown): CompileFailure {
  if (e instanceof GenError) return { k: "refused", message: e.message };
  if (e instanceof Error) return { k: "crash", stack: e.stack ?? `${e.name}: ${e.message}` };
  return { k: "crash", stack: `a thrown value that is no Error: ${inspect(e)}` };
}
