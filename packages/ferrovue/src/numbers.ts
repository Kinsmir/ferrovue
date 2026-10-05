/* Numbers as JavaScript computes them: integers and doubles, literals folded now, arithmetic and
 * comparisons. */

import { type N, type Scope, type Ty, type Val, BOOL, FLOAT, INT } from "./model.ts";
import { AS, binary, FLIPPED, operand } from "./parens.ts";
import { expr } from "./expr.ts";

/** Whether a value is a JavaScript number: an integer or a fraction. */
export function isNumber(ty: Ty): boolean {
  return ty.k === "int" || ty.k === "float";
}

/** A number as an `f64`, as JavaScript holds every number. */
export function asF64(v: Val): string {
  if (v.f64 !== undefined) return v.f64;
  return v.ty.k === "float" ? v.code : `${operand(v.code, AS)} as f64`;
}

/** An integer computed on doubles, as JavaScript computes it: the \`i64\` and the double it came from. */
export function intFromF64(f64: string): Val {
  return { code: `${operand(f64, AS)} as i64`, ty: INT, f64 };
}

/** A double as a Rust literal: JavaScript's own spelling, which Rust reads back to the same double. */
function floatLiteral(x: number): string {
  if (Number.isNaN(x)) return "f64::NAN";
  if (!Number.isFinite(x)) return x > 0 ? "f64::INFINITY" : "f64::NEG_INFINITY";
  const spelled = String(Math.abs(x)).replace("e+", "e");
  return `${x < 0 || Object.is(x, -0) ? "-" : ""}${/[.e]/.test(spelled) ? spelled : `${spelled}.0`}f64`;
}

/** A number known at generation time — a literal, or literals JavaScript computed — as an integer
 * when it is one of the operations that keep integers, a fraction otherwise. */
export function numberVal(x: number, int: boolean): Val {
  if (!int) return { code: floatLiteral(x), ty: FLOAT, num: x };
  if (!Number.isSafeInteger(x)) return { ...intFromF64(floatLiteral(x)), num: x };
  // `-0` is the integer 0, and the double it came from keeps its sign.
  return { code: `${x === 0 ? 0 : x}i64`, ty: INT, f64: floatLiteral(x), num: x };
}

/** `a op b` on two numbers JavaScript computes now, as it would at run time. */
function fold(a: number, op: string, b: number): number | boolean {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "%":
      return a % b;
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case ">=":
      return a >= b;
    default:
      return a === b;
  }
}

/** `a op b` on two numbers, on doubles as JavaScript computes it — now, when both are known. `int`
 * keeps the result an integer. */
export function arithmetic(a: Val, op: string, b: Val, int: boolean): Val {
  if (a.num !== undefined && b.num !== undefined) return numberVal(fold(a.num, op, b.num) as number, int);
  const f64 = binary(asF64(a), op, asF64(b));
  return int ? intFromF64(f64) : { code: f64, ty: FLOAT };
}

/** A comparison of two numbers, as doubles. */
export function compare(a: Val, op: string, b: Val): Val {
  if (a.num !== undefined && b.num !== undefined) {
    const konst = fold(a.num, op, b.num) as boolean;
    return { code: String(konst), ty: BOOL, konst };
  }
  return { code: binary(asF64(a), op, asF64(b)), ty: BOOL };
}

/** `!(a < b)` of two integers: `a >= b`, as neither is ever NaN. `null` for anything else. */
export function negatedOrder(s: Scope, n: N): Val | null {
  if (n.type !== "BinaryExpression" || !(n.operator in FLIPPED)) return null;
  const a = expr(s, n.left);
  const b = expr(s, n.right);
  return a.ty.k === "int" && b.ty.k === "int" ? compare(a, FLIPPED[n.operator]!, b) : null;
}
