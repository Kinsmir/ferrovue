import { escapeHtml } from "@vue/shared";
import { rustStr } from "./rust-syntax.ts";
import { closing, enclosed, ifElse, literalEnd } from "./parens.ts";
import { unquote } from "./strings.ts";

const WRITER = "fv::core::escaping(out)";
const OWNED = /^(?:std::borrow::)?Cow::<str>::Owned\(/;
const BORROWED_LITERAL = /^(?:std::borrow::)?Cow::<str>::Borrowed\(("(?:[^"\\]|\\.)*")\)$/;
const JSON_LIST = /^format!\("\[\{\}\]", ([^]*)\.collect::<Vec<_>>\(\)\.join\(","\)\)$/;

/** The statement that writes the string `code` gives into `out`, escaped, with a `format!` it
 * builds only to escape written through `fv::core::escaping`. */
export function escapedWrite(code: string): string {
  return built(code.replace(/^&(?!\*)/, "")) ?? `fv::core::escape_into(out, ${code});`;
}

function built(code: string): string | null {
  const list = JSON_LIST.exec(code);
  if (list) return `out.push('['); fv::core::escape_join(out, ${list[1]}, ","); out.push(']');`;
  if (code.startsWith("format!(") && closing(code, 7) === code.length - 1) return `write!(${WRITER}, ${code.slice(8, -1)});`;
  const owned = OWNED.exec(code);
  if (owned && closing(code, owned[0].length - 1) === code.length - 1) return built(code.slice(owned[0].length, -1));
  if (code.endsWith(".into_owned()") && enclosed(code.slice(0, -13))) return built(code.slice(1, -14));
  if (enclosed(code) && code.startsWith("(")) return built(code.slice(1, -1));
  if (enclosed(code) && code.startsWith("{ ") && code.endsWith(" }")) {
    const inner = body(code.slice(2, -2));
    return inner === null ? null : `{ ${inner} }`;
  }
  const branches = ifElse(code);
  if (branches) {
    const [yes, no] = [body(branches.yes), body(branches.no)];
    if (yes === null && no === null) return null;
    return `if ${branches.test} { ${yes ?? tail(branches.yes)} } else { ${no ?? tail(branches.no)} }`;
  }
  return null;
}

function body(code: string): string | null {
  const at = tailStart(code);
  if (at < 0) return null;
  const last = built(code.slice(at));
  return last === null ? null : code.slice(0, at) + last;
}

function tail(code: string): string {
  const at = tailStart(code);
  const literal = BORROWED_LITERAL.exec(code.slice(at))?.[1];
  return code.slice(0, at) + (literal === undefined ? `fv::core::escape_into(out, &${code.slice(at)});` : `out.push_str(${rustStr(escapeHtml(unquote(literal)))});`);
}

function tailStart(code: string): number {
  let start = 0;
  while (start < code.length) {
    const end = statementEnd(code, start);
    if (end < 0) return -1;
    if (end >= code.length) return start;
    start = end + 1;
  }
  return -1;
}

function statementEnd(code: string, start: number): number {
  const block = /^(?:'\w+: )?(?:for |while |loop |if |match |\{)/.test(code.slice(start));
  for (let i = start; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") i = literalEnd(code, i);
    else if (ch === ";") return code[i + 1] === " " ? i + 1 : -1;
    else if (ch === "(" || ch === "[") i = closing(code, i);
    else if (ch === "{") {
      i = closing(code, i);
      if (i < 0) return -1;
      if (block && !code.startsWith(" else ", i + 1)) return i + 1;
    }
    if (i < 0) return -1;
  }
  return code.length;
}
