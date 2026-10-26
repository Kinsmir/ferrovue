import { type Component, type N, type Scope, type Ty, type Val, asciiText, BOOL, fail, FLOAT, INT, isAscii, kept, nothing, opt, placeOf, refusalAt, REFUSALS, rustStr, STR, strTy } from "./model.ts";
import type { ErrorCode } from "./errors.ts";
import { atom, bare, binary, condition, enclosed, receiver, strArg } from "./parens.ts";
import { computed, items } from "./lists.ts";
import { describeTy, expr } from "./expr.ts";
import { known } from "./narrowing.ts";
import { asF64, asWritten, isNumber } from "./numbers.ts";

function regexMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val {
  const comp = s.comp;
  if (target.lone) fail(comp, "FV0706", lonely(`\`.${method}()\` with a regular expression`), n);
  const re = regexOf(comp, args[0], `in \`.${method}()\``);
  const t = strArg(target.code);
  if (method === "split") {
    if (args.length > 2) fail(comp, "FV0709", "`.split()` takes 1 to 2 arguments here", n);
    const limit = args[1] === undefined ? null : expr(s, args[1]);
    if (limit !== null && !isNumber(limit.ty)) fail(comp, "FV0712", "`.split()` takes a number, present or optional", args[1]);
    const pieces = `${atom(re)}.split(${t}, ${limit === null ? "None" : `Some(${bare(asF64(limit))})`})`;
    const shape = regexShape(args[0].pattern, args[0].flags);
    return computed(`${pieces}.into_iter().map(std::borrow::Cow::<str>::Owned)`, STR, !("pieces" in shape && keepsPairs(shape.pieces)));
  }
  if (args.length !== 2) fail(comp, "FV0709", `\`.${method}()\` takes 2 arguments here`, n);
  if (method === "replaceAll" && !args[0].flags.includes("g")) {
    fail(comp, "FV0710", "`.replaceAll()` with a regular expression without the `g` flag, which JavaScript refuses with a `TypeError`: add `g`", args[0]);
  }
  if (args[1].type === "ArrowFunctionExpression" || args[1].type === "FunctionExpression") {
    fail(comp, "FV0713", `\`.${method}()\` with a function, which the server does not run: give it a string`, args[1]);
  }
  const replacement = expr(s, args[1]);
  if (replacement.ty.k !== "str") fail(comp, "FV0711", `\`.${method}()\` takes a string that is present`, args[1]);
  if (replacement.lone) fail(comp, "FV0706", lonely(`\`.${method}()\` with a regular expression`), args[1]);
  const shape = regexShape(args[0].pattern, args[0].flags);
  return { code: `&*${atom(re)}.replace(${t}, ${strArg(replacement.code)})`, ty: STR, ...("pieces" in shape && keepsPairs(shape.pieces) ? {} : { lone: true }) };
}

/** \`/pattern/flags.test(s)\` of a regular expression literal. */
export function regexTest(s: Scope, re: N, args: N[], n: N): Val {
  const comp = s.comp;
  if (args.length !== 1) fail(comp, "FV0709", "`.test()` takes 1 argument here", n);
  const v = expr(s, args[0]);
  if (v.ty.k !== "str") fail(comp, "FV0711", "`.test()` takes a string that is present", args[0]);
  if (v.lone) fail(comp, "FV0706", lonely("`.test()` of a regular expression"), n);
  return { code: `${atom(regexOf(comp, re, "in `.test()`", n))}.test(${strArg(v.code)})`, ty: BOOL };
}

export function lonely(what: string): string {
  return `${what} with a string that may hold half of a surrogate pair (cut by \`slice\`, \`substring\`, \`at\`, \`charAt\`, \`split("")\` and the like): JavaScript keeps the half, which can match, order or join with another where ferrovue holds U+FFFD`;
}

export function meet(comp: Component, a: Val, b: Val, what: string, n: N, how: "equal" | "order" | "search" | "join"): void {
  const literal = (v: Val) => v.code.startsWith('"');
  const fffd = (v: Val) => literal(v) && v.code.includes("\u{FFFD}");
  const low = (v: Val) => literal(v) && !/[\u{D800}-\u{10FFFF}]/u.test(v.code);
  const refused =
    how === "order" ? (a.lone && !low(b)) || (b.lone && !low(a))
    : how === "join" ? a.lone && b.lone
    : how === "search" ? b.lone || (a.lone && fffd(b))
    : (a.lone && b.lone) || (a.lone && fffd(b)) || (b.lone && fffd(a));
  if (refused) fail(comp, "FV0706", lonely(what), n);
}

export function loneOf(...vs: (Val | undefined)[]): { lone?: true } {
  return vs.some((v) => v?.lone) ? { lone: true } : {};
}

function nonEmptyLiteral(v: Val): boolean {
  return /^"[^"]/.test(v.code);
}

export function isTemporary(v: Val): boolean {
  if (v.ty.k !== "str") return false;
  const trimmed = /^fv::strings::js_trim(?:_start|_end)?\(([^]*)\)$/.exec(v.code);
  if (trimmed?.[1] !== undefined) return isTemporary({ code: trimmed[1].replace(/^&(?!\*)/, "&*"), ty: v.ty });
  return /^&\*(?!\**[\w.]+$|\(\*\w+\)$)/.test(v.code) || /\.unwrap_or\(&\*(?!\**[\w.]+\)$)/.test(v.code);
}

export function asCow(v: Val): string {
  if (!isTemporary(v)) return `std::borrow::Cow::<str>::Borrowed(${bare(v.code)})`;
  const built = /^&\*(.*)$/s.exec(v.code)?.[1];
  if (built === undefined) return `std::borrow::Cow::<str>::Owned(${atom(v.code)}.to_owned())`;
  if (enclosed(built)) return bare(built);
  if (yieldsCow(built)) return built.startsWith("fv::") || built.startsWith(`${REFUSALS}.`) ? `std::borrow::Cow::<str>::Owned(${built}.into_owned())` : bare(built);
  if (/^fv::strings::js_(?:char_at|trim|trim_start|trim_end)\(/.test(built)) return `std::borrow::Cow::<str>::Owned(${built}.to_owned())`;
  return `std::borrow::Cow::<str>::Owned(${built})`;
}

/** A temporary string as a value a `let` can hold past its statement: a `String`, or a `Cow`
 * borrowing nothing the statement made. */
export function heldStr(v: Val): string {
  const cow = asCow(v);
  const owned = /^std::borrow::Cow::<str>::Owned\(([^]*)\)$/.exec(cow)?.[1];
  return owned !== undefined && enclosed(`(${owned})`) ? owned : cow;
}

const MAX_STRING_LENGTH = 2 ** 29 - 24;

export function yieldsCow(code: string): boolean {
  const routine = /^fv::strings::js_(?:slice|substring|substr|replace|replace_all|pad_start|pad_end)(?=\()/.exec(code) ?? /^fv_refusals\.keep(?=\(fv::strings::try_pad_(?:start|end)\()/.exec(code);
  if (routine !== null) return enclosed(code.slice(routine[0].length));
  for (const method of [".unwrap_or", ".unwrap_or_else"]) {
    for (let at = code.lastIndexOf(`${method}(`); at >= 0; at = code.lastIndexOf(`${method}(`, at - 1)) {
      const rest = code.slice(at + method.length);
      if (!enclosed(rest)) continue;
      const fallback = rest.slice(1, -1).replace(/^\|\| /, "");
      return fallback.startsWith("std::borrow::Cow::<str>::") || yieldsCow(fallback);
    }
  }
  return false;
}

export function unquote(literal: string): string {
  const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
  return literal.slice(1, -1).replace(/\\(?:u\{([0-9a-f]+)\}|(.))/g, (_, hex: string | undefined, c: string) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : (escapes[c] ?? c)));
}

export function stringsEqual(a: Val, b: Val): string {
  if (known(a) !== undefined && known(b) !== undefined) return String(unquote(a.code) === unquote(b.code));
  if (a.code === '""' || b.code === '""') return `${receiver(a.code === '""' ? b.code : a.code)}.is_empty()`;
  return binary(a.code, "==", b.code);
}

const SCALAR = new Set(["str", "int", "float", "bool"]);

/**
 * `v` as JavaScript's `String()` and a template literal write it, where that is not the value
 * itself: an absent value as `undefined` or `null`, a list as its items joined by `,` (an absent
 * item as nothing). Strings, numbers and booleans are returned as they are; any other value is
 * refused with `code`.
 */
export function stringOf(comp: Component, v: Val, n: N, what: string, code: ErrorCode): Val {
  if (SCALAR.has(v.ty.k)) return v;
  if (nothing(v.ty)) return { code: rustStr(v.ty.k === "null" ? "null" : "undefined"), ty: STR };
  const lone = loneOf(v);
  const written = (arg: string): Val => ({ code: `&*format!("{}", ${arg})`, ty: STR, format: { text: "{}", args: [arg] }, ...lone });
  if (v.ty.k === "opt" && SCALAR.has(v.ty.of.k)) {
    if (v.ty.none === "either") {
      fail(comp, "FV0721", `${what} of a value that may be \`null\` or \`undefined\`, which JavaScript writes as \`null\` or \`undefined\` and its Rust \`Option\` cannot tell apart: give it a fallback with \`??\``, n);
    }
    const word = rustStr(v.ty.none === "null" ? "null" : "undefined");
    switch (v.ty.of.k) {
      case "str":
        return { code: `${atom(v.code)}.unwrap_or(${word})`, ty: STR, ...lone };
      case "bool":
        return written(`fv::strings::JsOr(${atom(v.code)}.map(|v| if v { "true" } else { "false" }), ${word})`);
      default:
        return written(`fv::strings::JsOr(${atom(v.code)}.map(fv::core::Js), ${word})`);
    }
  }
  if (v.ty.k === "list") {
    const of = v.ty.of;
    const joined = (each: string): Val => ({ code: `&*${each}.collect::<Vec<_>>().join(",")`, ty: STR, ...lone });
    if (of.k === "undef") return { code: '""', ty: STR };
    if (of.k === "str") return joined(items(v));
    if (of.k === "bool") return joined(`${items(v)}.map(|v| if v { "true" } else { "false" })`);
    if (of.k === "int" || of.k === "float") return joined(`${items(v)}.map(|v| fv::core::Js(v).to_string())`);
    if (of.k === "opt" && of.of.k === "str" && v.iter !== undefined) return joined(`${v.iter}.map(|v| v.unwrap_or(""))`);
    if (of.k === "opt" && v.iter === undefined && SCALAR.has(of.of.k)) {
      const each = `${atom(v.code)}.iter()`;
      if (of.of.k === "str") return joined(`${each}.map(|v| v.as_deref().unwrap_or(""))`);
      if (of.of.k === "bool") return joined(`${each}.map(|v| match v { Some(true) => "true", Some(false) => "false", None => "" })`);
      return joined(`${each}.map(|v| v.map_or_else(String::new, |v| fv::core::Js(v).to_string()))`);
    }
  }
  return fail(comp, code, `${what} of ${describeTy(v.ty)}: it writes strings, numbers and booleans, present or optional, and lists of them`, n);
}

/** Whether every character `ty` may write as text is ASCII: a number, a boolean, an absent value
 * (`undefined`, `null`), a string known to be ASCII, or a list of them. */
export function writesAscii(ty: Ty): boolean {
  if (ty.k === "int" || ty.k === "float" || ty.k === "bool" || nothing(ty)) return true;
  if (ty.k === "opt" || ty.k === "list") return writesAscii(ty.of);
  return isAscii(ty);
}

function mayBeEmpty(v: Val): boolean {
  return v.ty.k === "str" && !nonEmptyLiteral(v);
}

export function formatted(comp: Component, given: (string | Val)[], n: N, what: string): Val {
  let fmt = "";
  const args: string[] = [];
  let before: Val | undefined;
  const parts = given.map((p) => (typeof p === "string" ? p : stringOf(comp, p, n, what, "FV0708")));
  const lone = loneOf(...parts.map((p) => (typeof p === "string" ? undefined : p)));
  const ty = strTy(given.every((p) => (typeof p === "string" ? asciiText(p) : writesAscii(p.ty))));
  for (const part of parts) {
    if (typeof part === "string" || (part.ty.k === "str" && known(part) !== undefined)) {
      const text = typeof part === "string" ? part : unquote(part.code);
      if (text !== "") before = undefined;
      fmt += text.replace(/[{}]/g, (c) => c + c);
      continue;
    }
    if (before) meet(comp, before, part, what, n, "join");
    if (!before?.lone || part.lone || !mayBeEmpty(part)) before = part;
    if (part.format) {
      fmt += part.format.text;
      args.push(...part.format.args);
      continue;
    }
    if (part.ty.k === "str") args.push(receiver(part.code).replace(/^(fv::core::Js\(.*\))\.to_string\(\)$/s, "$1"));
    else if (isNumber(part.ty)) args.push(`fv::core::Js(${bare(asWritten(part).code)})`);
    else args.push(`if ${condition(part.code)} { "true" } else { "false" }`);
    fmt += "{}";
  }
  if (!args.length) return { code: rustStr(fmt.replace(/\{\{|\}\}/g, (c) => c[0]!)), ty };
  const one = parts.filter((p) => (typeof p === "string" ? p !== "" : p.code !== '""'));
  if (fmt === "{}" && one.length === 1 && typeof one[0] !== "string" && one[0]!.ty.k === "str") return one[0]!;
  if (fmt === "{}" && one.length === 1 && typeof one[0] !== "string" && one[0]!.ty.k === "bool") return { code: args[0]!, ty };
  return { code: `&*format!(${rustStr(fmt)}, ${args.join(", ")})`, ty, format: { text: fmt, args }, ...lone };
}

const CLASS_ESCAPES: Record<string, "none" | "all"> = { d: "none", D: "all", w: "none", W: "all", s: "none", S: "all" };
const SYNTAX = "^$\\.*+?()[]{}|/";
const CONTROLS: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13 };

type Surrogates = "none" | "all" | "some";

interface RegexPiece {
  surrogates: Surrogates;
  min: number;
  max: number;
  greedy: boolean;
}

function coverage(ranges: [number, number][], all: boolean[], negate: boolean): Surrogates {
  let covered = 0;
  for (let u = 0xd800; u <= 0xdfff; u++) if (all.some(Boolean) || ranges.some(([lo, hi]) => lo <= u && u <= hi)) covered++;
  const inside = covered === 0x800 ? "all" : covered === 0 ? "none" : "some";
  return negate ? (inside === "all" ? "none" : inside === "none" ? "all" : "some") : inside;
}

/** The pieces of `/pattern/flags` in the subset of regular expressions `fv::strings::JsRegex`
 * runs, or what leaves the subset: the checks `JsRegex::parse` makes. */
export function regexShape(pattern: string, flags: string): { refused: string } | { pieces: RegexPiece[] } {
  const seen = new Set<string>();
  for (const f of flags) {
    if ((f !== "g" && f !== "i") || seen.has(f)) return { refused: `the flag \`${f}\`` };
    seen.add(f);
  }
  let at = 0;
  const peek = (): string | undefined => pattern[at];
  const hex = (n: number): number | null => {
    const digits = pattern.slice(at, at + n);
    at += n;
    return digits.length === n && /^[0-9a-fA-F]+$/.test(digits) ? parseInt(digits, 16) : null;
  };
  const escape = (inClass: boolean): number | "none" | "all" | { refused: string } => {
    const c = pattern[at++];
    if (c === undefined) return { refused: "a `\\` at the end" };
    if (c in CLASS_ESCAPES) return CLASS_ESCAPES[c]!;
    if (c in CONTROLS) return CONTROLS[c]!;
    if (c === "0" && !/[0-9]/.test(peek() ?? "")) return 0;
    if (c === "x" || c === "u") return hex(c === "x" ? 2 : 4) ?? { refused: "an escape with a digit that is not hexadecimal" };
    if (inClass && c === "b") return 8;
    if ((inClass && c === "-") || SYNTAX.includes(c)) return c.charCodeAt(0);
    return { refused: `the escape \`\\${c}\`` };
  };
  const number = (): number | null => {
    const start = at;
    while (/[0-9]/.test(peek() ?? "")) at++;
    return at > start ? Number(pattern.slice(start, at)) : null;
  };
  const quantifier = (): [number, number] | null | string => {
    const c = peek();
    if (c === "*" || c === "+" || c === "?") {
      at++;
      return c === "*" ? [0, Infinity] : c === "+" ? [1, Infinity] : [0, 1];
    }
    if (c !== "{") return null;
    const start = at++;
    const min = number();
    if (min === null) {
      at = start;
      return null;
    }
    let max: number | null = min;
    if (peek() === ",") {
      at++;
      max = peek() === "}" ? Infinity : number();
    }
    if (peek() !== "}" || max === null) {
      at = start;
      return null;
    }
    at++;
    return max < min ? "a quantifier out of order" : [min, max];
  };
  const unitOf = (u: string): number | "none" | "all" | { refused: string } => (u === "\\" ? escape(true) : u.charCodeAt(0));
  const surrogate = (u: number): Surrogates => (u >= 0xd800 && u <= 0xdfff ? "some" : "none");
  const pieces: RegexPiece[] = [];
  while (at < pattern.length) {
    const c = pattern[at++]!;
    let zeroWidth = c === "^" || c === "$";
    let kind: Surrogates = c === "." ? "all" : surrogate(c.charCodeAt(0));
    if (c === "[") {
      const negate = peek() === "^";
      if (negate) at++;
      const ranges: [number, number][] = [];
      const alls: boolean[] = [];
      for (;;) {
        const u = pattern[at++];
        if (u === undefined) return { refused: "a class that does not end" };
        if (u === "]") break;
        const low = unitOf(u);
        if (typeof low === "object") return low;
        if (low === "none" || low === "all") {
          alls.push(low === "all");
          continue;
        }
        let high = low;
        if (peek() === "-" && pattern[at + 1] !== "]" && pattern[at + 1] !== undefined) {
          at++;
          const end = unitOf(pattern[at++]!);
          if (typeof end === "object") return end;
          if (end === "none" || end === "all") return { refused: "a range that ends at a class escape" };
          if (end < low) return { refused: "a range out of order" };
          high = end;
        }
        ranges.push([low, high]);
      }
      kind = coverage(ranges, alls, negate);
    } else if (c === "\\") {
      if (peek() === "b" || peek() === "B") {
        at++;
        zeroWidth = true;
      } else {
        const e = escape(false);
        if (typeof e === "object") return e;
        kind = e === "none" || e === "all" ? e : surrogate(e);
      }
    } else if ("()|]}*+?{".includes(c)) return { refused: `\`${c}\`` };
    const q = quantifier();
    if (typeof q === "string") return { refused: q };
    if (q !== null && zeroWidth) return { refused: "a quantifier of an assertion" };
    const lazy = q !== null && peek() === "?";
    if (lazy) at++;
    if (!zeroWidth) pieces.push({ surrogates: kind, min: q?.[0] ?? 1, max: q?.[1] ?? 1, greedy: !lazy });
  }
  return { pieces };
}

/** What leaves the subset of regular expressions `fv::strings::JsRegex` runs in `/pattern/flags`,
 * or null when it stays in it. */
export function regexRefusal(pattern: string, flags: string): string | null {
  const shape = regexShape(pattern, flags);
  return "refused" in shape ? shape.refused : null;
}

/** Whether no match of the pieces can begin or end between the halves of a surrogate pair: none
 * matches half of one and none is empty, or one piece of every surrogate repeats greedily. */
function keepsPairs(pieces: RegexPiece[]): boolean {
  if (pieces.every((p) => p.surrogates === "none") && pieces.some((p) => p.min > 0)) return true;
  const [one] = pieces;
  return pieces.length === 1 && one!.surrogates === "all" && one!.min > 0 && one!.max === Infinity && one!.greedy;
}

/** The Rust of the regular expression literal \`n\`, held once for the program's life: refused
 * with FV0710 where it leaves the subset \`fv::strings::JsRegex\` runs. */
export function regexOf(comp: Component, n: N, what: string, at: N = n): string {
  const pattern: string = n.pattern;
  const flags: string = n.flags;
  const refused = regexRefusal(pattern, flags);
  if (refused !== null) {
    fail(comp, "FV0710", `\`/${pattern}/${flags}\` ${what} holds ${refused}, outside the regular expressions the server runs`, placeOf(comp, n).line === undefined ? at : n, "the server runs characters, `.`, classes such as `[a-z]` and `\\d`, `\\w`, `\\s`, `^`, `$`, `\\b`, the quantifiers `*`, `+`, `?` and `{n,m}`, and the flags `g` and `i`; do the rest in Rust and pass the result as a prop");
  }
  return `{ static RE: std::sync::LazyLock<fv::strings::JsRegex> = std::sync::LazyLock::new(|| fv::strings::JsRegex::new(${rustStr(pattern)}, ${rustStr(flags)})); &RE }`;
}

/** Translates a string's method called with no arguments that trims, changes case or returns the string, or returns null for another method. */
export function noArgStringMethod(target: Val, method: string): Val | null {
  const lone = loneOf(target);
  const same = strTy(isAscii(target.ty));
  switch (method) {
    case "trim":
      return { code: `fv::strings::js_trim(${strArg(target.code)})`, ty: same, ...lone };
    case "trimStart":
    case "trimLeft":
      return { code: `fv::strings::js_trim_start(${strArg(target.code)})`, ty: same, ...lone };
    case "trimEnd":
    case "trimRight":
      return { code: `fv::strings::js_trim_end(${strArg(target.code)})`, ty: same, ...lone };
    case "toUpperCase":
      return { code: `&*${receiver(target.code)}.to_uppercase()`, ty: same, ...lone };
    case "toLowerCase":
      return { code: `&*${receiver(target.code)}.to_lowercase()`, ty: same, ...lone };
    case "toString":
      return target;
  }
  return null;
}

export function stringMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  const comp = s.comp;
  const t = strArg(target.code);
  if (args[0]?.type === "RegExpLiteral" && ["replace", "replaceAll", "split"].includes(method)) return regexMethod(s, target, method, args, n);
  const arity = (least: number, most: number): void => {
    if (args.length < least || args.length > most) {
      fail(comp, "FV0709", `\`.${method}()\` takes ${least === most ? least : `${least} to ${most}`} argument${most === 1 ? "" : "s"} here`, n);
    }
  };
  const str = (i: number): Val => {
    if (args[i]?.type === "RegExpLiteral") fail(comp, "FV0710", `\`.${method}()\` with a regular expression, which the server does not run: give it a string`, args[i]);
    const v = expr(s, args[i]);
    if (v.ty.k !== "str") fail(comp, "FV0711", `\`.${method}()\` takes a string that is present`, args[i]);
    return v;
  };
  const num = (i: number, fallback: string, absent: string): string => {
    if (args[i] === undefined) return fallback;
    const v = expr(s, args[i]);
    if (v.ty.k === "undef") return fallback;
    if (v.ty.k === "null") return "0.0";
    if (v.ty.k === "opt" && isNumber(v.ty.of) && v.ty.none !== "either") {
      return `${atom(v.code)}.map_or(${v.ty.none === "null" ? "0.0" : absent}, |v| ${v.ty.of.k === "int" ? "v as f64" : "v"})`;
    }
    if (!isNumber(v.ty)) fail(comp, "FV0712", `\`.${method}()\` takes a number, present or optional`, args[i]);
    return asF64(v);
  };
  const ascii = isAscii(target.ty);
  const cut = ascii ? {} : { lone: true };
  const same = strTy(ascii);
  const noHalves = (): void => {
    if (target.lone) fail(comp, "FV0706", lonely(`\`.${method}()\``), n);
  };
  switch (method) {
    case "includes":
    case "startsWith":
    case "endsWith": {
      arity(1, 2);
      const x = str(0);
      meet(comp, target, x, `\`.${method}()\``, n, "search");
      const at = num(1, "", method === "endsWith" ? "f64::INFINITY" : "0.0");
      if (at) {
        const rust = { includes: "includes_from", startsWith: "starts_with_at", endsWith: "ends_with_at" }[method];
        return { code: `fv::strings::js_${rust}(${t}, ${strArg(x.code)}, ${bare(at)})`, ty: BOOL };
      }
      const rust = { includes: "contains", startsWith: "starts_with", endsWith: "ends_with" }[method];
      return { code: `${receiver(target.code)}.${rust}(${bare(x.code)})`, ty: BOOL };
    }
    case "indexOf":
    case "lastIndexOf": {
      arity(1, 2);
      const x = str(0);
      meet(comp, target, x, `\`.${method}()\``, n, "search");
      const at = num(1, "", method === "indexOf" ? "0.0" : "f64::NAN");
      const rust = method === "indexOf" ? "index_of" : "last_index_of";
      if (at) return { code: `fv::strings::js_${rust}_from(${t}, ${strArg(x.code)}, ${bare(at)})`, ty: INT };
      return { code: `fv::strings::js_${rust}(${t}, ${strArg(x.code)})`, ty: INT };
    }
    case "substr": {
      arity(0, 2);
      const length = num(1, "", "f64::INFINITY");
      return { code: `&*fv::strings::js_substr(${t}, ${num(0, "0.0", "0.0")}, ${length ? `Some(${bare(length)})` : "None"})`, ty: same, ...cut };
    }
    case "charCodeAt":
      arity(0, 1);
      noHalves();
      return { code: `fv::strings::js_char_code_at(${t}, ${num(0, "0.0", "0.0")})`, ty: FLOAT };
    case "codePointAt":
      arity(0, 1);
      noHalves();
      return { code: `fv::strings::js_code_point_at(${t}, ${num(0, "0.0", "0.0")})`, ty: opt(INT) };
    case "concat":
      return formatted(comp, [target, ...args.map((a: N) => stringOf(comp, expr(s, a), a, "`.concat()`", "FV0723"))], n, "`.concat()`");
    case "slice":
    case "substring": {
      arity(0, 2);
      const end = num(1, "", "f64::INFINITY");
      return { code: `&*fv::strings::js_${method}(${t}, ${num(0, "0.0", "0.0")}, ${end ? `Some(${end})` : "None"})`, ty: same, ...cut };
    }
    case "at": {
      arity(1, 1);
      const at = `fv::strings::js_at(${t}, ${num(0, "0.0", "0.0")})`;
      if (!isTemporary(target)) return { code: at, ty: opt(same), ...cut };
      const held = `${at}.map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))`;
      return { code: `${atom(held)}.as_deref()`, ty: opt(same), held, ...cut };
    }
    case "charAt":
      arity(0, 1);
      return { code: `${isTemporary(target) ? "&*" : ""}fv::strings::js_char_at(${t}, ${num(0, "0.0", "0.0")})`, ty: same, ...cut };
    case "split": {
      arity(1, 2);
      const sep = str(0);
      meet(comp, target, sep, "`.split()`", n, "search");
      const limit = num(1, "", "4_294_967_295.0");
      const pieces = limit ? `fv::strings::js_split_limit(${t}, ${strArg(sep.code)}, ${bare(limit)})` : `fv::strings::js_split(${t}, ${strArg(sep.code)})`;
      return computed(`${pieces}.into_iter()`, same, !ascii && (target.lone || !nonEmptyLiteral(sep)));
    }
    case "replace":
    case "replaceAll": {
      arity(2, 2);
      if (args[1].type === "ArrowFunctionExpression" || args[1].type === "FunctionExpression") {
        fail(comp, "FV0713", `\`.${method}()\` with a function, which the server does not run: give it a string`, args[1]);
      }
      const [pattern, replacement] = [str(0), str(1)];
      meet(comp, target, pattern, `\`.${method}()\``, n, "search");
      meet(comp, target, replacement, `\`.${method}()\``, n, "join");
      const lone = target.lone || replacement.lone || (method === "replaceAll" && !nonEmptyLiteral(pattern));
      return { code: `&*fv::strings::js_${method === "replace" ? "replace" : "replace_all"}(${t}, ${strArg(pattern.code)}, ${strArg(replacement.code)})`, ty: strTy(ascii && isAscii(replacement.ty)), ...(replacement.lone || (lone && !ascii) ? { lone: true } : {}) };
    }
    case "padStart":
    case "padEnd": {
      arity(1, 2);
      const fill: Val = args.length > 1 ? str(1) : { code: '" "', ty: strTy(true) };
      const whole = fill.code.startsWith('"') && !/[\u{10000}-\u{10FFFF}]/u.test(fill.code);
      if (fill.lone || (method === "padStart" && target.lone && !whole)) fail(comp, "FV0706", lonely(`\`.${method}()\``), n);
      const routine = method === "padStart" ? "pad_start" : "pad_end";
      const padArgs = `${t}, ${num(0, "0.0", "0.0")}, ${strArg(fill.code)}`;
      const short = args[0]?.type === "NumericLiteral" && args[0].value <= MAX_STRING_LENGTH;
      return { code: short ? `&*fv::strings::js_${routine}(${padArgs})` : `&*${kept(`fv::strings::try_${routine}(${padArgs})`, refusalAt(comp, n))}`, ty: strTy(ascii && isAscii(fill.ty)), ...(target.lone || !whole ? { lone: true } : {}) };
    }
    case "repeat": {
      arity(1, 1);
      const c = args[0];
      if ((c.type === "UnaryExpression" && c.operator === "-" && c.argument.type === "NumericLiteral" && c.argument.value > 0) || (c.type === "Identifier" && c.name === "Infinity")) {
        fail(comp, "FV0714", "`.repeat()` with a negative or infinite count, which throws a `RangeError`", c);
      }
      if (target.lone) fail(comp, "FV0706", lonely("`.repeat()`"), n);
      return { code: `&*${kept(`fv::strings::try_repeat(${t}, ${num(0, "0.0", "0.0")})`, refusalAt(comp, n))}`, ty: same };
    }
    case "toLocaleUpperCase":
    case "toLocaleLowerCase":
      return fail(comp, "FV0715", `\`.${method}()\` maps case by the locale the server runs in, which the browser need not share: use \`.${method.replace("Locale", "")}()\``, n);
  }
  return null;
}
