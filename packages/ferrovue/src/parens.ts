const LOOSE = 0;
export const OR = 1;
const AND = 2;
export const CMP = 3;
const ADD = 4;
const MUL = 5;
export const AS = 6;
export const UNARY = 7;
const ATOM = 8;

const BINARY: [RegExp, number][] = [
  [/^ \|\| /, OR],
  [/^ && /, AND],
  [/^ (?:==|!=|<=|>=|<|>) /, CMP],
  [/^ [+-] /, ADD],
  [/^ [*/%] /, MUL],
  [/^ as /, AS],
];

export function literalEnd(code: string, i: number): number {
  if (code[i] === "'") {
    if (code[i + 1] === "\\") return code.indexOf("'", i + 3);
    return code[i + 2] === "'" ? i + 2 : i;
  }
  if (code[i] !== '"') return i;
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === "\\") j++;
    else if (code[j] === '"') return j;
  }
  return code.length;
}

export function closing(code: string, i: number): number {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const ch = code[j]!;
    if (ch === '"' || ch === "'") j = literalEnd(code, j);
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function topLevel(code: string): { at: number; op: string; p: number }[] | null {
  if (/^(?:if|match|let|move|loop|unsafe)\b/.test(code) || code.startsWith("|") || code.startsWith("{")) return null;
  const ops: { at: number; op: string; p: number }[] = [];
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") {
      i = literalEnd(code, i);
    } else if (ch === "(" || ch === "[" || ch === "{") {
      i = closing(code, i);
      if (i < 0) return null;
    } else if (ch === " ") {
      const rest = code.slice(i);
      const found = BINARY.find(([re]) => re.test(rest));
      if (!found) return null;
      const spaced = rest.match(found[0])![0];
      ops.push({ at: i, op: spaced.trim(), p: found[1] });
      i += spaced.length - 1;
    } else if (ch === "." && code[i + 1] === ".") {
      return null;
    }
  }
  return ops;
}

/** The two operands of the operator `code` applies last, where that is a binary operator. */
export function outermost(code: string): { left: string; op: string; right: string } | null {
  const ops = topLevel(code);
  if (!ops?.length) return null;
  const p = Math.min(...ops.map((o) => o.p));
  const last = ops.findLast((o) => o.p === p)!;
  return { left: code.slice(0, last.at), op: last.op, right: code.slice(last.at + last.op.length + 2) };
}

export function binding(code: string): number {
  const ops = topLevel(code);
  if (!ops) return LOOSE;
  if (ops.length) return Math.min(...ops.map((o) => o.p));
  return /^[&*!-]/.test(code) ? UNARY : ATOM;
}

export function occurrences(code: string, name: string): number {
  const text = code.replace(/'(?:[^'\\]|\\u\{[0-9a-f]+\}|\\.)'|"(?:[^"\\]|\\.)*"/g, '""');
  return text.match(new RegExp(`(?<![\\w$])(?<![^.]\\.)${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g"))?.length ?? 0;
}

export function operand(code: string, min: number): string {
  return binding(code) >= min ? code : `(${code})`;
}

export function atom(code: string): string {
  return operand(code, ATOM);
}

export function bare(code: string): string {
  while (code.startsWith("(") && enclosed(code)) code = code.slice(1, -1);
  return code;
}

export function enclosed(code: string): boolean {
  return /^[([{]/.test(code) && closing(code, 0) === code.length - 1;
}

export function condition(code: string): string {
  const inner = bare(code);
  return inner.startsWith("{") ? `(${inner})` : inner;
}

const FLOAT_LITERAL = /^-?\d[\d.]*(?:e-?\d+)?f64$/;

export function binary(a: string, op: string, b: string): string {
  const p = BINARY.find(([re]) => re.test(` ${op} `))![1];
  const plain = (x: string, other: string) => (FLOAT_LITERAL.test(x) && !FLOAT_LITERAL.test(other) ? x.slice(0, -3) : x);
  const left = operand(plain(a, b), p === CMP ? p + 1 : p);
  const cast = op === "<" && topLevel(left)?.at(-1)?.op === "as";
  const right = operand(plain(b, a), p + 1);
  if ((op === "==" || op === "!=") && /^&[^&]/.test(left) && /^&[^&]/.test(right)) return `${left.slice(1)} ${op} ${right.slice(1)}`;
  return `${cast ? `(${left})` : left} ${op} ${right}`;
}

export function negate(code: string): string {
  if (code.startsWith("-") && binding(code) === UNARY) return code.slice(1);
  return `-${operand(code, UNARY)}`;
}

export const FLIPPED: Record<string, string> = { "<": ">=", ">": "<=", "<=": ">", ">=": "<" };

export function not(code: string): string {
  if (code === "true" || code === "false") return String(code === "false");
  if (code.startsWith("!") && binding(code.slice(1)) >= UNARY) return code.slice(1);
  const option = /^(.*)\.is_(some|none)\(\)$/s.exec(code);
  if (option && binding(code) === ATOM) return `${option[1]}.is_${option[2] === "some" ? "none" : "some"}()`;
  const cmps = binding(code) === CMP ? topLevel(code)!.filter((o) => o.p === CMP) : [];
  const eq = cmps.length === 1 && (cmps[0]!.op === "==" || cmps[0]!.op === "!=") ? cmps[0]! : null;
  if (eq) return `${code.slice(0, eq.at)} ${eq.op === "==" ? "!=" : "=="} ${code.slice(eq.at + eq.op.length + 2)}`;
  const order = cmps.length === 1 ? cmps[0]! : null;
  if (order) {
    const [a, b] = [code.slice(0, order.at), code.slice(order.at + order.op.length + 2)];
    const whole = [a, b].some((x) => /^-?\d+$/.test(x));
    const nan = whole ? [] : [a, b].filter((x) => !/^-?[\d.]+(?:e-?\d+)?(?:f64)?$/.test(x)).map((x) => `${receiver(x)}.is_nan()`);
    return [binary(a, FLIPPED[order.op]!, b), ...nan].join(" || ");
  }
  return `!${operand(code, UNARY)}`;
}

/** Whether `code` calls nothing, so that evaluating it once or twice is the same. */
export function pure(code: string): boolean {
  const text = code.replace(/\|\|/g, " ");
  return !/["'{}[;|]/.test(text) && !/(?:[\w)\]]|\w!)\s*\(/.test(text);
}

const SWAPPED: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

const OUTCOMES: Record<string, number> = { "<": 1, "==": 2, "<=": 3, ">": 4, ">=": 6, "!=": 13 };
const BY_OUTCOMES = new Map(Object.entries(OUTCOMES).map(([op, set]) => [set, op]));

function comparison(code: string): { l: string; op: string; r: string } | null {
  const inner = bare(code);
  const o = binding(inner) === CMP && topLevel(inner)!.filter((t) => t.p === CMP).length === 1 ? outermost(inner) : null;
  if (!o) return null;
  const [l, r] = [bare(o.left), bare(o.right)];
  return pure(l) && pure(r) ? { l, op: o.op, r } : null;
}

function sameOperands(a: string, op: "&&" | "||", b: string): string | null {
  const [p, q] = [comparison(a), comparison(b)];
  if (!p || !q) return null;
  const qop = p.l === q.l && p.r === q.r ? q.op : p.l === q.r && p.r === q.l ? (SWAPPED[q.op] ?? q.op) : null;
  if (qop === null) return null;
  const set = op === "&&" ? OUTCOMES[p.op]! & OUTCOMES[qop]! : OUTCOMES[p.op]! | OUTCOMES[qop]!;
  if (set === 0 || set === 15) return String(set === 15);
  const one = BY_OUTCOMES.get(set);
  if (one !== undefined) return binary(p.l, one, p.r);
  const ordering = `${receiver(p.l)}.partial_cmp(&${operand(p.r, UNARY)})`;
  if (set === 5) return `${ordering}.is_some_and(std::cmp::Ordering::is_ne)`;
  return set === 7 ? `${ordering}.is_some()` : null;
}

function bound(code: string): { x: string; op: string; c: number } | null {
  const o = comparison(code);
  if (!o || !(o.op in SWAPPED)) return null;
  const num = (t: string) => (/^-?\d[\d_]*(?:\.\d+)?(?:e-?\d+)?(?:f64|i64)?$/.test(t) ? Number(t.replace(/_|f64|i64/g, "")) : null);
  const [cl, cr] = [num(o.l), num(o.r)];
  if (cr !== null && cl === null) return { x: o.l, op: o.op, c: cr };
  if (cl !== null && cr === null) return { x: o.r, op: SWAPPED[o.op]!, c: cl };
  return null;
}

function bothBounds(a: string, b: string): string | null {
  const [p, q] = [bound(a), bound(b)];
  if (!p || !q || p.x !== q.x) return null;
  const lower = (t: { op: string }) => t.op.startsWith(">");
  if (lower(p) === lower(q)) {
    const past = (p.c - q.c) * (lower(p) ? 1 : -1);
    return past > 0 || (past === 0 && p.op.length === 1) ? a : b;
  }
  const [lo, hi] = lower(p) ? [p, q] : [q, p];
  return lo.c > hi.c || (lo.c === hi.c && (lo.op.length === 1 || hi.op.length === 1)) ? "false" : null;
}

export function logical(a: string, op: "&&" | "||", b: string): string {
  if (a === b && pure(a)) return a;
  const both = sameOperands(a, op, b) ?? (op === "&&" ? bothBounds(a, b) : null);
  if (both !== null) return both;
  const absorbing = op === "&&" ? "false" : "true";
  if (a === absorbing || b === absorbing) return absorbing;
  const identity = op === "&&" ? "true" : "false";
  if (a === identity) return b;
  if (b === identity) return a;
  return binary(a, op, b);
}

export function ifElse(code: string): { test: string; yes: string; no: string } | null {
  if (!code.startsWith("if ")) return null;
  let open = -1;
  for (let i = 3; i < code.length && open < 0; i++) {
    const ch = code[i]!;
    if (ch === '"' || ch === "'") i = literalEnd(code, i);
    else if (ch === "(" || ch === "[") i = closing(code, i);
    else if (ch === "{") open = i;
    if (i < 0) return null;
  }
  const close = open < 0 ? -1 : closing(code, open);
  if (close < 0 || !code.startsWith(" else {", close + 1) || closing(code, close + 7) !== code.length - 1) return null;
  return { test: code.slice(3, open - 1), yes: code.slice(open + 2, close - 1), no: code.slice(close + 9, -2) };
}

export function strArg(code: string): string {
  const branches = ifElse(code);
  if (branches) return `if ${branches.test} { ${strArg(branches.yes)} } else { ${strArg(branches.no)} }`;
  if (/^\(\*\w+\)$/.test(code)) return bare(code);
  const m = /^&\*(\**)(.*)$/s.exec(code);
  if (m && !m[1]) {
    const lazy = /^\(\*(\w+)\)$/.exec(m[2]!)?.[1];
    if (lazy !== undefined) return `&${lazy}`;
  }
  if (!m || (binding(m[2]!) < ATOM && !enclosed(m[2]!))) return code;
  return m[1] ? m[2]! : `&${m[2]}`;
}

export function callOn(recv: string, call: string): string {
  const branches = ifElse(recv);
  if (branches) return `if ${branches.test} { ${callOn(branches.yes, call)} } else { ${callOn(branches.no, call)} }`;
  return `${receiver(recv)}.${call}`;
}

export function receiver(code: string): string {
  const m = /^[&*]+(.*)$/s.exec(code);
  return m && binding(m[1]!) === ATOM ? m[1]! : atom(code);
}

/** `code` as the scrutinee of an `if let`, where the parentheses around a lazy value's read are
 * redundant. */
export function scrutinee(code: string): string {
  return code.replace(/^\(\*(\w+)\)$/, "*$1");
}
