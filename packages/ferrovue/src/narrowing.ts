import { type N, type Scope, type Ty, type Val, absence, BOOL, fail } from "./model.ts";
import { ctx } from "./context.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, condition, ifElse, logical, not, occurrences, receiver } from "./parens.ts";
import { isNumber, negatedOrder } from "./numbers.ts";
import { expr } from "./expr.ts";

export function known(v: Val): boolean | undefined {
  if (v.konst !== undefined) return v.konst;
  if (v.ty.k === "str" && /^"(?:[^"\\]|\\.)*"$/.test(v.code)) return v.code !== '""';
  if (v.num !== undefined) return v.num !== 0 && !Number.isNaN(v.num);
  return undefined;
}

export function truthy(v: Val): string {
  const k = known(v);
  if (k !== undefined) return String(k);
  const branches = v.ty.k === "str" || isNumber(v.ty) ? ifElse(v.code) : null;
  if (branches) return choice(branches.test, truthy({ code: branches.yes, ty: v.ty }), truthy({ code: branches.no, ty: v.ty }));
  switch (v.ty.k) {
    case "str":
      return `!${receiver(v.code)}.is_empty()`;
    case "int":
      return binary(v.code, "!=", "0");
    case "float":
      return `${binary(v.code, "!=", "0.0")} && !${receiver(v.code)}.is_nan()`;
    case "bool":
      return v.code;
    case "undef":
    case "null":
      return "false";
    case "opt":
      return `${atom(v.code)}.is_some_and(|v| ${truthy({ code: "v", ty: v.ty.of })})`;
    default:
      return claim((p) => p.values?.truthy?.(v)) ?? "true";
  }
}

export function pathOf(n: N): string | null {
  if (n.type === "Identifier") return n.name;
  if (n.type !== "MemberExpression") return null;
  const base = pathOf(n.object);
  if (base === null) return null;
  if (!n.computed && n.property.type === "Identifier") return `${base}.${n.property.name}`;
  if (n.computed && n.property.type === "StringLiteral") return `${base}.${n.property.value}`;
  return null;
}

export interface NullTest {
  target: N;
  literal: "null" | "undefined";
  strict: boolean;
  is: boolean;
}

function nothingLiteral(n: N): "null" | "undefined" | null {
  if (n.type === "NullLiteral") return "null";
  if (n.type === "Identifier" && n.name === "undefined") return "undefined";
  return null;
}

export function nullTest(n: N): NullTest | null {
  if (n.type !== "BinaryExpression" || !["===", "!==", "==", "!="].includes(n.operator)) return null;
  const right = nothingLiteral(n.right);
  const left = nothingLiteral(n.left);
  const literal = right ?? left;
  if (literal === null) return null;
  return { target: right !== null ? n.left : n.right, literal, strict: n.operator.length === 3, is: n.operator.startsWith("=") };
}

export function checkNullTest(s: Scope, t: NullTest, v: Val): void {
  const none = absence(v.ty);
  if (none === null || !t.strict || none === t.literal) return;
  const op = t.is ? "==" : "!=";
  if (none === "either") {
    fail(s.comp, `\`${op}= ${t.literal}\` of a value that may be \`null\` or \`undefined\`, which its Rust \`Option\` cannot tell apart: test both with \`${op} null\``, t.target);
  }
  const other = t.literal === "null" ? "undefined" : "null";
  const what = none === "null" ? "is `T | null`, never `undefined`" : "is optional, which is `undefined` when absent, never `null`";
  fail(s.comp, `\`${op}= ${t.literal}\` of a value that ${what}: compare with \`${other}\``, t.target);
}

export interface Presence {
  path: string;
  pattern: (name: string) => string;
  option: string;
  present: string;
  of: Ty;
  negated: boolean;
  truthy: boolean;
}

export function presence(s: Scope, n: N): Presence | null {
  for (const p of ctx.plugins) {
    const own = p.presence?.(s, n);
    if (own !== undefined) return own;
  }
  let target: N = n;
  let negated = false;
  let byTruth = true;
  if (n.type === "UnaryExpression" && n.operator === "!") {
    target = n.argument;
    negated = true;
  } else if (n.type === "BinaryExpression") {
    const test = nullTest(n);
    if (!test) return null;
    target = test.target;
    negated = test.is;
    byTruth = false;
  }
  const path = pathOf(target);
  if (path === null) return null;
  const v = expr(s, target);
  if (v.ty.k !== "opt") return null;
  if (n.type === "BinaryExpression") checkNullTest(s, nullTest(n)!, v);
  const of: Ty = v.ty.of;
  const scalar = of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool";
  const filtered = byTruth && scalar;
  const option = filtered ? `${atom(v.code)}.filter(|v| ${truthy({ code: "*v", ty: of })})` : v.code;
  const present = filtered ? truthy(v) : `${atom(v.code)}.is_some()`;
  return { path, of, negated, truthy: byTruth, option, present, pattern: (name) => `let Some(${name}) = ${option}` };
}

export function narrowTo(s: Scope, p: Presence, name: string): Scope {
  return { ...s, narrowed: new Map(s.narrowed).set(p.path, { code: name, ty: p.of }) };
}

export function narrowing(s: Scope, p: Presence, present: (s: Scope) => string, absent: (s: Scope) => string): string {
  const name = `n${++ctx.narrowCount}`;
  const then = bare(present(narrowTo(s, p, name)));
  const otherwise = bare(absent(s));
  if (occurrences(then, name)) return `if ${p.pattern(name)} { ${then} } else { ${otherwise} }`;
  return choice(p.present, then, otherwise);
}

export function choice(test: string, yes: string, no: string): string {
  const binds = test.startsWith("let ");
  if (yes === no && !binds) return yes;
  if (yes === "true" && no === "false" && !binds) return test;
  if (yes === "false" && no === "true" && !binds) return not(test);
  return `if ${condition(test)} { ${yes} } else { ${no} }`;
}

export function cond(s: Scope, n: N): string {
  if (n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&")) {
    const p = presence(s, n.left);
    if (p && p.negated === (n.operator === "||")) {
      return narrowing(s, p, (inner) => cond(inner, n.right), () => String(n.operator === "||"));
    }
    return logical(cond(s, n.left), n.operator, cond(s, n.right));
  }
  if (n.type === "UnaryExpression" && n.operator === "!") return negatedOrder(s, n.argument)?.code ?? not(cond(s, n.argument));
  return truthy(expr(s, n));
}

export function boolOf(code: string): Val {
  return code === "true" || code === "false" ? { code, ty: BOOL, konst: code === "true" } : { code, ty: BOOL };
}
