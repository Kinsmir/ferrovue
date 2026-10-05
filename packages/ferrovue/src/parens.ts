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

function literalEnd(code: string, i: number): number {
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

function closing(code: string, i: number): number {
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
    const nan = [a, b].filter((x) => !/^-?[\d.]+(?:e-?\d+)?(?:f64)?$/.test(x)).map((x) => `${receiver(x)}.is_nan()`);
    return [binary(a, FLIPPED[order.op]!, b), ...nan].join(" || ");
  }
  return `!${operand(code, UNARY)}`;
}

export function logical(a: string, op: "&&" | "||", b: string): string {
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
  const m = /^&\*(\**)(.*)$/s.exec(code);
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
