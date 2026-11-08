import { closing, literalEnd } from "./parens.ts";
import { ctx } from "./context.ts";

const HELD = /^(?:props|s_[a-z0-9_]+|fv_[a-z0-9_]+)(?:\.(?:[a-z_][a-z0-9_]*(?![a-z0-9_(])|\d+))*/;

const BORROWED = "std::borrow::Cow::<str>::Borrowed(";

const KEPT = ".iter().map(fv::strings::kept)";

const READ = /\b(fv_[a-z0-9_]+)\.iter\(\)\.map\(\|v\| std::borrow::Cow::<str>::Borrowed\(&\*\*v\)\)/g;

/** Records that the local `name` is bound to the reference `option` holds, an `Option` of a
 * reference into the props or the setup's locals, so that what it reaches through outlives any
 * list a render holds. */
export function bindsHeld(name: string, option: string): void {
  const place = /^(.*)\.as_(?:ref|deref)\(\)$/s.exec(option)?.[1];
  if (place !== undefined && heldPlace(place) === place) ctx.held.set(name, "ref");
}

/** Records that the parameter `name` of a closure the items of `chain` are handed to is a
 * reference into the props or the setup's locals. */
export function itemsHeld(name: string, chain: string): void {
  if (refsHeld(chain)) ctx.held.set(name, "ref");
}

/** Records that the local `name`, given the list `init` collects, holds strings that borrow only
 * from the props, the setup's locals and literals, so that a copy of its `Cow`s keeps them
 * borrowed. */
export function listHeld(name: string, init: string): void {
  const chain = /^(.*)\.collect::<Vec<_>>\(\)$/s.exec(init)?.[1];
  if (chain !== undefined && borrowsHeld(chain)) ctx.held.set(name, "items");
}

/** `chain` with each list {@link listHeld} recorded read as copies of its `Cow`s, where that
 * makes it borrow only what outlives the list; `null` otherwise. */
export function keptBorrowed(chain: string): string | null {
  const kept = chain.replace(READ, (read, name: string) => (ctx.held.get(name) === "items" ? `${name}${KEPT}` : read));
  return kept !== chain && borrowsHeld(kept) ? kept : null;
}

function heldPlace(text: string): string | undefined {
  const local = /^fv_[a-z0-9_]+/.exec(text)?.[0];
  return local === undefined || ctx.held.get(local) === "ref" ? HELD.exec(text)?.[0] : undefined;
}

function refsHeld(chain: string): boolean {
  const place = heldPlace(chain);
  if (place === undefined || !chain.startsWith(".iter()", place.length)) return false;
  let at = place.length + ".iter()".length;
  while (at < chain.length) {
    const call = /^\.(filter|take|skip|rev|take_while|skip_while)\(/.exec(chain.slice(at));
    if (!call) return false;
    at = closing(chain, at + call[0].length - 1) + 1;
  }
  return true;
}

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
  const local = /^fv_[a-z0-9_]+/.exec(chain)?.[0];
  if (local !== undefined && ctx.held.get(local) === "items" && chain.startsWith(KEPT, local.length)) return local.length + KEPT.length;
  const place = heldPlace(chain);
  if (place !== undefined) return chain.startsWith(".iter()", place.length) ? place.length + ".iter()".length : -1;
  if (chain.startsWith("[")) {
    const end = closing(chain, 0);
    const elems = end < 0 ? [] : splitArgs(chain.slice(1, end));
    if (elems.length && elems.every(borrowedArg) && chain.startsWith(".into_iter()", end + 1)) return end + 1 + ".into_iter()".length;
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

function borrowedArg(arg: string): boolean {
  return arg.startsWith(BORROWED) && closing(arg, BORROWED.length - 1) === arg.length - 1 && plainArg(arg.slice(BORROWED.length, -1));
}

function plainArg(arg: string): boolean {
  const place = arg.replace(/^&\*?/, "");
  if (place !== arg && heldPlace(place) === place) return true;
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
