import { type Code, docsUrl, ERRORS } from "./errors.ts";
import { GenError, GenErrors } from "./model.ts";

/** One refusal or warning, as `ferrovue --format json` writes it. Lines and columns count from 1; the end is
 * exclusive, and `null` where it is not known. */
export interface Diagnostic {
  file: string | null;
  line: number | null;
  column: number | null;
  endLine: number | null;
  endColumn: number | null;
  code: Code;
  severity: "error" | "warning";
  title: string;
  message: string;
  /** A short way around the refusal, where one is known. */
  help: string | null;
  docs: string;
}

const UNPARSED: Code = "FV0001";

/** Whether the compiler raised `e` for its input: a refusal, or a file that does not parse. */
export function isRefusal(e: unknown): e is GenError | SyntaxError {
  return e instanceof GenError || e instanceof SyntaxError;
}

/** Each refusal `e` holds: the ones a `GenErrors` collected, or `e` itself. */
export function refusalsOf(e: GenError | SyntaxError): readonly (GenError | SyntaxError)[] {
  return e instanceof GenErrors ? e.errors : [e];
}

/** The diagnostic for a refusal, or for a warning raised as a `GenError` and not thrown. */
export function diagnose(e: GenError | SyntaxError, severity: Diagnostic["severity"] = "error"): Diagnostic {
  const code = e instanceof GenError ? e.code : UNPARSED;
  const at = e instanceof GenError ? e.at : null;
  return {
    file: at?.file ?? null,
    line: at?.line ?? null,
    column: at?.column ?? null,
    endLine: at?.endLine ?? null,
    endColumn: at?.endColumn ?? null,
    code,
    severity,
    title: ERRORS[code].title,
    message: e instanceof GenError ? e.what : e.message.split("\n")[0]!,
    help: e instanceof GenError ? e.help : null,
    docs: docsUrl(code),
  };
}

/** The diagnostic for each refusal `e` holds. */
export function diagnoseAll(e: GenError | SyntaxError): Diagnostic[] {
  return refusalsOf(e).map((one) => diagnose(one));
}

function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** The line after a run's refusals: how many there are, in how many components, and how many
 * components were left unchecked because they use a refused one. */
export function refusalSummary(e: GenError | SyntaxError): string {
  const all = refusalsOf(e);
  const files = new Set(all.flatMap((one) => (one instanceof GenError && one.at ? [one.at.file] : [])));
  const what = [...files].every((f) => f.endsWith(".vue")) ? "component" : "file";
  const unchecked = e instanceof GenErrors ? e.unchecked.length : 0;
  const rest = unchecked ? `; ${count(unchecked, "component")} that use${unchecked === 1 ? "s" : ""} a refused one ${unchecked === 1 ? "was" : "were"} not checked` : "";
  return `${count(all.length, "error")}${files.size ? ` in ${count(files.size, what)}` : ""}${rest}`;
}

function formatOne(e: GenError | SyntaxError): string {
  const code = e instanceof GenError ? e.code : UNPARSED;
  const help = e instanceof GenError && e.help ? `\n = help: ${e.help}` : "";
  return `error[${code}]: ${e.message}${help}\n = docs: ${docsUrl(code)}`;
}

/** A refusal as the CLI and the Vite plugin show it: `error[FV0604]: `, the message with its
 * location and quoted line, a way around it where one is known, and where the code is documented.
 * The refusals of a run are shown in turn, then a line that counts them. */
export function formatRefusal(e: GenError | SyntaxError): string {
  if (!(e instanceof GenErrors)) return formatOne(e);
  return [...e.errors.map(formatOne), refusalSummary(e)].join("\n\n");
}

/** A warning as the CLI shows it: `warning[FV1117]: `, the message, and where the code is documented. */
export function formatWarning(e: GenError): string {
  return `warning[${e.code}]: ${e.message}\n = docs: ${docsUrl(e.code)}`;
}
