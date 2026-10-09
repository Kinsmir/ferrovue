import { type Code, docsUrl, ERRORS } from "./errors.ts";
import { GenError } from "./model.ts";

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
  docs: string;
}

const UNPARSED: Code = "FV0001";

/** Whether the compiler raised `e` for its input: a refusal, or a file that does not parse. */
export function isRefusal(e: unknown): e is GenError | SyntaxError {
  return e instanceof GenError || e instanceof SyntaxError;
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
    docs: docsUrl(code),
  };
}

/** A refusal as the CLI and the Vite plugin show it: `error[FV0604]: `, the message with its
 * location and quoted line, and where the code is documented. */
export function formatRefusal(e: GenError | SyntaxError): string {
  const code = e instanceof GenError ? e.code : UNPARSED;
  return `error[${code}]: ${e.message}\n = docs: ${docsUrl(code)}`;
}

/** A warning as the CLI shows it: `warning[FV1117]: `, the message, and where the code is documented. */
export function formatWarning(e: GenError): string {
  return `warning[${e.code}]: ${e.message}\n = docs: ${docsUrl(e.code)}`;
}
