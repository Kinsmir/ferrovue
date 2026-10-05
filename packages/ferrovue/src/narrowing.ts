/* Truthiness and presence: what a test makes of a value, and an optional value narrowed where a test
 * found it present, as TypeScript narrows it. */

import { type N, type Scope, type Ty, type Val, BOOL } from "./model.ts";
import { ctx } from "./context.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, condition, ifElse, logical, not, occurrences, receiver } from "./parens.ts";
import { isNumber, negatedOrder } from "./numbers.ts";
import { expr } from "./expr.ts";

/** A value's truthiness when it is known at generation time: a boolean constant, a string literal,
 * a number JavaScript computed. */
export function known(v: Val): boolean | undefined {
  if (v.konst !== undefined) return v.konst;
  if (v.ty.k === "str" && /^"(?:[^"\\]|\\.)*"$/.test(v.code)) return v.code !== '""';
  if (v.num !== undefined) return v.num !== 0 && !Number.isNaN(v.num);
  return undefined;
}

export function truthy(v: Val): string {
  const k = known(v);
  if (k !== undefined) return String(k);
  // Of a value one of two branches gives, each branch's own truthiness.
  const branches = v.ty.k === "str" || isNumber(v.ty) ? ifElse(v.code) : null;
  if (branches) return choice(branches.test, truthy({ code: branches.yes, ty: v.ty }), truthy({ code: branches.no, ty: v.ty }));
  switch (v.ty.k) {
    case "str":
      return `!${receiver(v.code)}.is_empty()`;
    case "int":
      return binary(v.code, "!=", "0");
    // JavaScript's falsy numbers: 0, -0 and NaN.
    case "float":
      return `${binary(v.code, "!=", "0.0")} && !${receiver(v.code)}.is_nan()`;
    case "bool":
      return v.code;
    case "undef":
      return "false";
    case "opt":
      return `${atom(v.code)}.is_some_and(|v| ${truthy({ code: "v", ty: v.ty.of })})`;
    default:
      return claim((p) => p.values?.truthy?.(v)) ?? "true";
  }
}

/** The JavaScript path an expression names — `$props.user`, `item.author.name` — or `null` when it
 * is not a plain chain of names. */
export function pathOf(n: N): string | null {
  if (n.type === "Identifier") return n.name;
  if (n.type !== "MemberExpression") return null;
  const base = pathOf(n.object);
  if (base === null) return null;
  if (!n.computed && n.property.type === "Identifier") return `${base}.${n.property.name}`;
  if (n.computed && n.property.type === "StringLiteral") return `${base}.${n.property.value}`;
  return null;
}

/** A test that an optional value is present, as TypeScript narrows on it: `x`, `x !== undefined`,
 * and, `negated`, `!x` and `x === undefined`, after which the value is present in the other branch. */
export interface Presence {
  path: string;
  /** The value bound where it is present, and its type there. */
  pattern: (name: string) => string;
  /** The `Option` the pattern matches: the value, or for a truthiness test only its truthy values. */
  option: string;
  /** The test alone, for a branch that never reads the value. */
  present: string;
  of: Ty;
  negated: boolean;
  /** Tested by truthiness, so the test itself is a boolean only when it is negated. */
  truthy: boolean;
}

export function presence(s: Scope, n: N): Presence | null {
  // A test of a plugin's own, such as a query value narrowed to a single string.
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
  } else if (n.type === "BinaryExpression" && (n.operator === "===" || n.operator === "!==")) {
    const isUndef = (m: N) => m.type === "Identifier" && m.name === "undefined";
    if (isUndef(n.right)) target = n.left;
    else if (isUndef(n.left)) target = n.right;
    else return null;
    negated = n.operator === "===";
    byTruth = false;
  }
  const path = pathOf(target);
  if (path === null) return null;
  const v = expr(s, target);
  if (v.ty.k !== "opt") return null;
  const of: Ty = v.ty.of;
  // A truthiness test keeps JavaScript's: an empty string, a 0 and `false` are not taken — while an
  // object and a list, empty or not, always are.
  const scalar = of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool";
  const filtered = byTruth && scalar;
  const option = filtered ? `${atom(v.code)}.filter(|v| ${truthy({ code: "*v", ty: of })})` : v.code;
  const present = filtered ? truthy(v) : `${atom(v.code)}.is_some()`;
  return { path, of, negated, truthy: byTruth, option, present, pattern: (name) => `let Some(${name}) = ${option}` };
}

/** The scope with `p`'s value present, bound as `name`. */
export function narrowTo(s: Scope, p: Presence, name: string): Scope {
  return { ...s, narrowed: new Map(s.narrowed).set(p.path, { code: name, ty: p.of }) };
}

/** `if let Some(name) = … { then } else { otherwise }`, each branch translated in its own scope —
 * the value present in one of them — with only the test for a branch that never reads it. */
export function narrowing(s: Scope, p: Presence, present: (s: Scope) => string, absent: (s: Scope) => string): string {
  const name = `n${++ctx.narrowCount}`;
  const then = bare(present(narrowTo(s, p, name)));
  const otherwise = bare(absent(s));
  if (occurrences(then, name)) return `if ${p.pattern(name)} { ${then} } else { ${otherwise} }`;
  return choice(p.present, then, otherwise);
}

/** `if test { yes } else { no }`, or less when the branches allow: one value when they are the same,
 * the test itself when they are `true` and `false`. A test that binds a value keeps its branches. */
export function choice(test: string, yes: string, no: string): string {
  const binds = test.startsWith("let ");
  if (yes === no && !binds) return yes;
  if (yes === "true" && no === "false" && !binds) return test;
  if (yes === "false" && no === "true" && !binds) return not(test);
  return `if ${condition(test)} { ${yes} } else { ${no} }`;
}

/* A test, as a Rust boolean. Only its truthiness is used, so `||`, `&&` and `!` combine the truthiness
 * of their operands whatever their types — where as a VALUE `a || b` is `a` or `b`, and stays held to
 * the stricter rules `expr` applies. `x && …` and `!x || …` read `x` present on the right. */
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

/** A boolean computed at run time, or known now when it folded to a constant. */
export function boolOf(code: string): Val {
  return code === "true" || code === "false" ? { code, ty: BOOL, konst: code === "true" } : { code, ty: BOOL };
}
