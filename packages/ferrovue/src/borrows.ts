import { closing, literalEnd } from "./parens.ts";

const HELD = /^(?:props|s_[a-z0-9_]+)(?:\.(?:[a-z_][a-z0-9_]*(?![a-z0-9_(])|\d+))*/;

const ADAPTERS = new Set(["map", "filter", "flat_map", "filter_map", "take", "skip", "rev", "take_while", "skip_while"]);

/** Whether the strings an iterator chain yields borrow only from the props, the setup's locals and
 * literals, which outlive any list a render holds, so that the list can keep them borrowed. */
export function borrowsHeld(chain: string): boolean {
  let at = root(chain);
  while (at >= 0 && at < chain.length) {
    const call = /^\.([a-z_]+)\(/.exec(chain.slice(at));
    if (!call) return false;
    const open = at + call[0].length - 1;
    const end = closing(chain, open);
    const arg = chain.slice(open + 1, end);
    if (call[1] === "chain" ? !borrowsHeld(arg) : !ADAPTERS.has(call[1]!)) return false;
    at = end + 1;
  }
  return at === chain.length;
}

function root(chain: string): number {
  const place = HELD.exec(chain)?.[0];
  if (place !== undefined) return chain.startsWith(".iter()", place.length) ? place.length + ".iter()".length : -1;
  if (chain.startsWith("[")) {
    const end = closing(chain, 0);
    const elems = end < 0 ? [] : splitArgs(chain.slice(1, end));
    const plain = elems.every((e) => /^fv_[a-z0-9_]+$/.test(e) || plainArg(e));
    return plain && elems.some((e) => plainArg(e)) && chain.startsWith(".iter()", end + 1) ? end + 1 + ".iter()".length : -1;
  }
  const call = /^fv::strings::[a-z_]+\(/.exec(chain);
  if (!call) return -1;
  const end = closing(chain, call[0].length - 1);
  if (end < 0) return -1;
  const given = splitArgs(chain.slice(call[0].length, end));
  if (chain.startsWith(".into_iter()", end + 1)) return given.every(plainArg) ? end + 1 + ".into_iter()".length : -1;
  return given.length && borrowsHeld(given[0]!) && given.slice(1).every((a) => plainArg(a) || a.startsWith("|")) ? end + 1 : -1;
}

function plainArg(arg: string): boolean {
  const place = arg.replace(/^&\*?/, "");
  if (place !== arg && HELD.exec(place)?.[0] === place) return true;
  if (arg[0] === '"') return literalEnd(arg, 0) === arg.length - 1;
  return /^(?:-?\d+(?:\.\d+)?(?:f64|i64|usize)?|None|Some\(-?\d+(?:\.\d+)?(?:f64|i64|usize)?\))$/.test(arg);
}

function splitArgs(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") i = literalEnd(text, i);
    else if (ch === "(" || ch === "[") i = closing(text, i);
    else if (ch === "|") {
      out.push(text.slice(from).trim());
      return out;
    } else if (ch === ",") {
      out.push(text.slice(from, i).trim());
      from = i + 1;
    }
    if (i < 0) return [];
  }
  if (text.slice(from).trim()) out.push(text.slice(from).trim());
  return out;
}
