import { type Component, type N, type Scope, type Val, BOOL, fail, INT, opt, rustStr, STR } from "./model.ts";
import { atom, bare, binary, condition, enclosed, receiver, strArg } from "./parens.ts";
import { computed } from "./lists.ts";
import { expr } from "./expr.ts";
import { known } from "./narrowing.ts";
import { asF64, isNumber } from "./numbers.ts";

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
  if (refused) fail(comp, lonely(what), n);
}

export function loneOf(...vs: (Val | undefined)[]): { lone?: true } {
  return vs.some((v) => v?.lone) ? { lone: true } : {};
}

function nonEmptyLiteral(v: Val): boolean {
  return /^"[^"]/.test(v.code);
}

export function isTemporary(v: Val): boolean {
  if (v.ty.k !== "str") return false;
  const trimmed = /^fv::js_trim(?:_start|_end)?\(([^]*)\)$/.exec(v.code);
  if (trimmed?.[1] !== undefined) return isTemporary({ code: trimmed[1].replace(/^&(?!\*)/, "&*"), ty: v.ty });
  return /^&\*(?!\**[\w.]+$)/.test(v.code) || /\.unwrap_or\(&\*(?!\**[\w.]+\)$)/.test(v.code);
}

export function asCow(v: Val): string {
  if (!isTemporary(v)) return `std::borrow::Cow::<str>::Borrowed(${bare(v.code)})`;
  const built = /^&\*(.*)$/s.exec(v.code)?.[1];
  if (built === undefined) return `std::borrow::Cow::<str>::Owned(${atom(v.code)}.to_owned())`;
  if (enclosed(built)) return bare(built);
  if (yieldsCow(built)) return built.startsWith("fv::") ? `std::borrow::Cow::<str>::Owned(${built}.into_owned())` : bare(built);
  if (/^fv::js_(?:char_at|trim|trim_start|trim_end)\(/.test(built)) return `std::borrow::Cow::<str>::Owned(${built}.to_owned())`;
  return `std::borrow::Cow::<str>::Owned(${built})`;
}

export function yieldsCow(code: string): boolean {
  const routine = /^fv::js_(?:slice|substring|replace|replace_all|pad_start|pad_end)(?=\()/.exec(code);
  if (routine !== null) return enclosed(code.slice(routine[0].length));
  const fallback = code.lastIndexOf(".unwrap_or(std::borrow::Cow::<str>::");
  return fallback >= 0 && enclosed(code.slice(fallback + ".unwrap_or".length));
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

export function formatted(comp: Component, parts: (string | Val)[], n: N, what: string): Val {
  let fmt = "";
  const args: string[] = [];
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
    if (part.ty.k === "str") args.push(receiver(part.code).replace(/^(fv::Js\(.*\))\.to_string\(\)$/s, "$1"));
    else if (isNumber(part.ty)) args.push(`fv::Js(${bare(part.code)})`);
    else if (part.ty.k === "bool") args.push(`if ${condition(part.code)} { "true" } else { "false" }`);
    else fail(comp, "a template literal interpolates strings, numbers and booleans that are present", n);
    fmt += "{}";
  }
  if (!args.length) return { code: rustStr(fmt.replace(/\{\{|\}\}/g, (c) => c[0]!)), ty: STR };
  const one = parts.filter((p) => (typeof p === "string" ? p !== "" : p.code !== '""'));
  if (fmt === "{}" && one.length === 1 && typeof one[0] !== "string" && one[0]!.ty.k === "str") return one[0]!;
  return { code: `&*format!(${rustStr(fmt)}, ${args.join(", ")})`, ty: STR, format: { text: fmt, args }, ...lone };
}

export function stringMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  const comp = s.comp;
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
      const held = `${at}.map(|v| std::borrow::Cow::<str>::Owned(v.to_owned()))`;
      return { code: `${atom(held)}.as_deref()`, ty: opt(STR), held, ...cut };
    }
    case "charAt":
      arity(0, 1);
      return { code: `${isTemporary(target) ? "&*" : ""}fv::js_char_at(${t}, ${num(0, "0.0")})`, ty: STR, ...cut };
    case "split": {
      arity(1, 1);
      const sep = str(0);
      meet(comp, target, sep, "`.split()`", n, "search");
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
      const lone = target.lone || replacement.lone || (method === "replaceAll" && !nonEmptyLiteral(pattern));
      return { code: `&*fv::js_${method === "replace" ? "replace" : "replace_all"}(${t}, ${strArg(pattern.code)}, ${strArg(replacement.code)})`, ty: STR, ...(lone ? cut : {}) };
    }
    case "padStart":
    case "padEnd": {
      arity(1, 2);
      const fill: Val = args.length > 1 ? str(1) : { code: '" "', ty: STR };
      const whole = fill.code.startsWith('"') && !/[\u{10000}-\u{10FFFF}]/u.test(fill.code);
      if (fill.lone || (method === "padStart" && target.lone && !whole)) fail(comp, lonely(`\`.${method}()\``), n);
      return { code: `&*fv::js_${method === "padStart" ? "pad_start" : "pad_end"}(${t}, ${num(0, "0.0")}, ${strArg(fill.code)})`, ty: STR, ...(target.lone || !whole ? cut : {}) };
    }
    case "repeat": {
      arity(1, 1);
      const c = args[0];
      if ((c.type === "UnaryExpression" && c.operator === "-" && c.argument.type === "NumericLiteral" && c.argument.value > 0) || (c.type === "Identifier" && c.name === "Infinity")) {
        fail(comp, "`.repeat()` with a negative or infinite count, which throws a `RangeError`", c);
      }
      if (target.lone) fail(comp, lonely("`.repeat()`"), n);
      return { code: `&*fv::js_repeat(${t}, ${num(0, "0.0")})`, ty: STR };
    }
    case "toLocaleUpperCase":
    case "toLocaleLowerCase":
      return fail(comp, `\`.${method}()\` maps case by the locale the server runs in, which the browser need not share: use \`.${method.replace("Locale", "")}()\``, n);
  }
  return null;
}
