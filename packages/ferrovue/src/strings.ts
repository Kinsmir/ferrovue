/* Strings as JavaScript has them: halves of surrogate pairs, borrows and temporaries, text joined by
 * `+` and template literals, and the string methods. */

import { type Component, type N, type Scope, type Val, BOOL, fail, INT, opt, rustStr, STR } from "./model.ts";
import { atom, bare, condition, enclosed, receiver, strArg } from "./parens.ts";
import { computed } from "./lists.ts";
import { expr } from "./expr.ts";
import { known } from "./narrowing.ts";
import { asF64, isNumber } from "./numbers.ts";

/** The refusal for a string that may hold half of a surrogate pair, used where that half matters. */
export function lonely(what: string): string {
  return `${what} with a string that may hold half of a surrogate pair (cut by \`slice\`, \`substring\`, \`at\`, \`charAt\`, \`split("")\` and the like): JavaScript keeps the half, which can match, order or join with another where ferrovue holds U+FFFD`;
}

/** Two strings meeting, where a half of a surrogate pair — which ferrovue holds as U+FFFD — would
 * change the result:
 * - `equal`: two halves may differ, and a half never equals a literal U+FFFD;
 * - `order`: a half orders as a surrogate, below U+E000, where U+FFFD orders above — the same only
 *   against a literal of characters below U+D800, which both order after;
 * - `search`: a half searched for (`b`) matches half of a whole pair in `a`;
 * - `join`: two halves side by side join into one character.
 * A string holding U+FFFD in the data still equals, or is found in, a half: README, "Strings". */
export function meet(comp: Component, a: Val, b: Val, what: string, n: N, how: "equal" | "order" | "search" | "join"): void {
  const literal = (v: Val) => v.code.startsWith('"');
  const fffd = (v: Val) => literal(v) && v.code.includes("\u{FFFD}");
  const low = (v: Val) => literal(v) && !/[\u{D800}-\u{10FFFF}]/u.test(v.code);
  const refused =
    how === "order" ? (a.lone && !low(b)) || (b.lone && !low(a))
    : how === "join" ? a.lone && b.lone
    : how === "search" ? b.lone || (a.lone && fffd(b))
    : (a.lone && b.lone) || (a.lone && fffd(b)) || (b.lone && fffd(a));
  if (refused) fail(comp, lonely(what), n);
}

/** `lone` for a value built from these: whether any of them may hold half of a surrogate pair. */
export function loneOf(...vs: (Val | undefined)[]): { lone?: true } {
  return vs.some((v) => v?.lone) ? { lone: true } : {};
}

/** Whether a string is a non-empty literal: a separator that always parts what it joins. */
function nonEmptyLiteral(v: Val): boolean {
  return /^"[^"]/.test(v.code);
}

/** Whether a string expression borrows from a temporary it builds — \`&*format!(…)\`, a call that
 * returns a \`String\` — rather than from the props or the state. Such a borrow ends with the block
 * it is in, so a branch of \`?:\` or \`||\` must hand back the string itself. */
export function isTemporary(v: Val): boolean {
  if (v.ty.k !== "str") return false;
  // A trim borrows from its argument, so it is a temporary when that is.
  const trimmed = /^fv::js_trim(?:_start|_end)?\(([^]*)\)$/.exec(v.code);
  if (trimmed?.[1] !== undefined) return isTemporary({ code: trimmed[1].replace(/^&(?!\*)/, "&*"), ty: v.ty });
  // A borrow of anything but a field: a string built by \`format!\` or a call, or a \`Cow\` made of
  // the branches of \`?:\` or \`||\`.
  // So is an optional string with such a fallback: `x.unwrap_or(&*format!(…))`.
  return /^&\*(?![\w.]+$)/.test(v.code) || /\.unwrap_or\(&\*(?![\w.]+\)$)/.test(v.code);
}

/** A string as a \`Cow\`: borrowed when it lives on, owned when it is a temporary. The \`Cow\` is
 * itself a temporary of the whole statement, so the \`&str\` taken from it lives to its end. A
 * \`String\` built for the purpose is moved into it, and one that is already a \`Cow\` — a branch
 * of \`?:\` or \`||\` — is taken as it is. */
export function asCow(v: Val): string {
  if (!isTemporary(v)) return `std::borrow::Cow::<str>::Borrowed(${bare(v.code)})`;
  const built = /^&\*(.*)$/s.exec(v.code)?.[1];
  if (built === undefined) return `std::borrow::Cow::<str>::Owned(${atom(v.code)}.to_owned())`;
  if (enclosed(built)) return bare(built);
  // A routine's `Cow` may borrow a string built in the same branch, which ends with it: owned.
  if (yieldsCow(built)) return built.startsWith("fv::") ? `std::borrow::Cow::<str>::Owned(${built}.into_owned())` : bare(built);
  // A routine that hands back part of the string it is given, as a `&str`: copied out.
  if (/^fv::js_(?:char_at|trim|trim_start|trim_end)\(/.test(built)) return `std::borrow::Cow::<str>::Owned(${built}.to_owned())`;
  return `std::borrow::Cow::<str>::Owned(${built})`;
}

/** Whether built code is a `Cow<str>` already: a runtime routine that borrows when it can
 * (`js_slice`, `js_replace`, `js_pad_start`, …), or a fallback taken from one (`.unwrap_or(Cow…)`). */
export function yieldsCow(code: string): boolean {
  // The routine's call is the whole of it: `fv::js_slice(…).to_lowercase()` is a `String`.
  const routine = /^fv::js_(?:slice|substring|replace|replace_all|pad_start|pad_end)(?=\()/.exec(code);
  if (routine !== null) return enclosed(code.slice(routine[0].length));
  // The fallback is the last call of it: `format!("{}a", x.unwrap_or(Cow…))` is a `String`.
  const fallback = code.lastIndexOf(".unwrap_or(std::borrow::Cow::<str>::");
  return fallback >= 0 && enclosed(code.slice(fallback + ".unwrap_or".length));
}

/** A Rust string literal's text. */
export function unquote(literal: string): string {
  const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
  return literal.slice(1, -1).replace(/\\(?:u\{([0-9a-f]+)\}|(.))/g, (_, hex: string | undefined, c: string) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : (escapes[c] ?? c)));
}

/** Literal text and values joined into one string, each value written as JavaScript writes it into
 * a string: `format!`, with string literals among the values part of its text, and a string another
 * `format!` built part of its text and arguments. */
export function formatted(comp: Component, parts: (string | Val)[], n: N, what: string): Val {
  let fmt = "";
  const args: string[] = [];
  // The value before, when nothing lies between it and the next: two halves of a pair would join.
  let before: Val | undefined;
  const lone = loneOf(...parts.map((p) => (typeof p === "string" ? undefined : p)));
  for (const part of parts) {
    if (typeof part === "string" || (part.ty.k === "str" && known(part) !== undefined)) {
      const text = typeof part === "string" ? part : unquote(part.code);
      if (text !== "") before = undefined;
      fmt += text.replace(/[{}]/g, (c) => c + c);
      continue;
    }
    if (before) meet(comp, before, part, what, n, "join");
    before = part;
    if (part.format) {
      fmt += part.format.text;
      args.push(...part.format.args);
      continue;
    }
    // A string written by `Display` is written as it is: `fv::Js(n)` rather than its `to_string()`.
    if (part.ty.k === "str") args.push(receiver(part.code).replace(/^(fv::Js\(.*\))\.to_string\(\)$/s, "$1"));
    else if (isNumber(part.ty)) args.push(`fv::Js(${bare(part.code)})`);
    else if (part.ty.k === "bool") args.push(`if ${condition(part.code)} { "true" } else { "false" }`);
    else fail(comp, "a template literal interpolates strings, numbers and booleans that are present", n);
    fmt += "{}";
  }
  if (!args.length) return { code: rustStr(fmt.replace(/\{\{|\}\}/g, (c) => c[0]!)), ty: STR };
  // One string and nothing else is that string.
  const one = parts.filter((p) => (typeof p === "string" ? p !== "" : p.code !== '""'));
  if (fmt === "{}" && one.length === 1 && typeof one[0] !== "string" && one[0]!.ty.k === "str") return one[0]!;
  return { code: `&*format!(${rustStr(fmt)}, ${args.join(", ")})`, ty: STR, format: { text: fmt, args }, ...lone };
}

/** A string method beyond trimming and case mapping, or `null` when `method` is none of them.
 * Indices and lengths count UTF-16 code units, as JavaScript's do; a result that may hold half of a
 * surrogate pair is marked `lone`. */
export function stringMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  const comp = s.comp;
  // As an argument, where a `&str` parameter coerces the borrow.
  const t = strArg(target.code);
  const arity = (least: number, most: number): void => {
    if (args.length < least || args.length > most) {
      fail(comp, `\`.${method}()\` takes ${least === most ? least : `${least} to ${most}`} argument${most === 1 ? "" : "s"} here`, n);
    }
  };
  const str = (i: number): Val => {
    if (args[i]?.type === "RegExpLiteral") fail(comp, `\`.${method}()\` with a regular expression, which the server does not run: give it a string`, args[i]);
    const v = expr(s, args[i]);
    if (v.ty.k !== "str") fail(comp, `\`.${method}()\` takes a string that is present`, args[i]);
    return v;
  };
  /** A number argument as an `f64`; `fallback` when it is left out or `undefined`. */
  const num = (i: number, fallback: string): string => {
    if (args[i] === undefined) return fallback;
    const v = expr(s, args[i]);
    if (v.ty.k === "undef") return fallback;
    if (!isNumber(v.ty)) fail(comp, `\`.${method}()\` takes a number that is present`, args[i]);
    return asF64(v);
  };
  const cut = { lone: true };
  switch (method) {
    case "includes":
    case "startsWith":
    case "endsWith": {
      // Without a position: `includes(x, 3)` would start the search part way.
      arity(1, 1);
      const x = str(0);
      meet(comp, target, x, `\`.${method}()\``, n, "search");
      const rust = { includes: "contains", startsWith: "starts_with", endsWith: "ends_with" }[method];
      return { code: `${receiver(target.code)}.${rust}(${bare(x.code)})`, ty: BOOL };
    }
    case "indexOf":
    case "lastIndexOf": {
      arity(1, 1);
      const x = str(0);
      meet(comp, target, x, `\`.${method}()\``, n, "search");
      return { code: `fv::js_${method === "indexOf" ? "index_of" : "last_index_of"}(${t}, ${strArg(x.code)})`, ty: INT };
    }
    case "slice":
    case "substring": {
      arity(0, 2);
      const end = num(1, "");
      return { code: `&*fv::js_${method}(${t}, ${num(0, "0.0")}, ${end ? `Some(${end})` : "None"})`, ty: STR, ...cut };
    }
    case "at": {
      arity(1, 1);
      const at = `fv::js_at(${t}, ${num(0, "0.0")})`;
      if (!isTemporary(target)) return { code: at, ty: opt(STR), ...cut };
      // Of a string built here, the character is copied out, to outlive it.
      const held = `${at}.map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))`;
      return { code: `${atom(held)}.as_deref()`, ty: opt(STR), held, ...cut };
    }
    case "charAt":
      arity(0, 1);
      // It borrows from the string, so it is a temporary when the string is.
      return { code: `${isTemporary(target) ? "&*" : ""}fv::js_char_at(${t}, ${num(0, "0.0")})`, ty: STR, ...cut };
    case "split": {
      // Without a limit, and with a string separator: `split()` alone gives the whole string.
      arity(1, 1);
      const sep = str(0);
      meet(comp, target, sep, "`.split()`", n, "search");
      // An empty separator cuts between code units, so a pair in two.
      return computed(`fv::js_split(${t}, ${strArg(sep.code)}).into_iter()`, STR, target.lone || !nonEmptyLiteral(sep));
    }
    case "replace":
    case "replaceAll": {
      arity(2, 2);
      if (args[1].type === "ArrowFunctionExpression" || args[1].type === "FunctionExpression") {
        fail(comp, `\`.${method}()\` with a function, which the server does not run: give it a string`, args[1]);
      }
      const [pattern, replacement] = [str(0), str(1)];
      meet(comp, target, pattern, `\`.${method}()\``, n, "search");
      meet(comp, target, replacement, `\`.${method}()\``, n, "join");
      // `replaceAll("", …)` matches between code units, which cuts every pair in two.
      const lone = target.lone || replacement.lone || (method === "replaceAll" && !nonEmptyLiteral(pattern));
      return { code: `&*fv::js_${method === "replace" ? "replace" : "replace_all"}(${t}, ${strArg(pattern.code)}, ${strArg(replacement.code)})`, ty: STR, ...(lone ? cut : {}) };
    }
    case "padStart":
    case "padEnd": {
      arity(1, 2);
      const fill: Val = args.length > 1 ? str(1) : { code: '" "', ty: STR };
      // The fill repeats itself, and is cut short where a pair may be: before a string starting
      // with a half, the two would join.
      const whole = fill.code.startsWith('"') && !/[\u{10000}-\u{10FFFF}]/u.test(fill.code);
      if (fill.lone || (method === "padStart" && target.lone && !whole)) fail(comp, lonely(`\`.${method}()\``), n);
      return { code: `&*fv::js_${method === "padStart" ? "pad_start" : "pad_end"}(${t}, ${num(0, "0.0")}, ${strArg(fill.code)})`, ty: STR, ...(target.lone || !whole ? cut : {}) };
    }
    case "repeat": {
      arity(1, 1);
      // JavaScript throws a `RangeError` for a negative or infinite count.
      const c = args[0];
      if ((c.type === "UnaryExpression" && c.operator === "-" && c.argument.type === "NumericLiteral" && c.argument.value > 0) || (c.type === "Identifier" && c.name === "Infinity")) {
        fail(comp, "`.repeat()` with a negative or infinite count, which throws a `RangeError`", c);
      }
      // Repeated, a string ending with one half and starting with the other joins them.
      if (target.lone) fail(comp, lonely("`.repeat()`"), n);
      return { code: `&*fv::js_repeat(${t}, ${num(0, "0.0")})`, ty: STR };
    }
    case "toLocaleUpperCase":
    case "toLocaleLowerCase":
      return fail(comp, `\`.${method}()\` maps case by the locale the server runs in, which the browser need not share: use \`.${method.replace("Locale", "")}()\``, n);
  }
  return null;
}
