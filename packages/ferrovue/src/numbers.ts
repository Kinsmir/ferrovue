import { type N, type Scope, type Ty, type Val, BOOL, FLOAT, INT } from "./model.ts";
import { AS, binary, FLIPPED, operand, UNARY } from "./parens.ts";
import { expr } from "./expr.ts";

export function isNumber(ty: Ty): boolean {
  return ty.k === "int" || ty.k === "float";
}

export function asF64(v: Val): string {
  if (v.f64 !== undefined) return v.f64;
  return v.ty.k === "float" ? v.code : `${operand(v.code, AS)} as f64`;
}

export function intFromF64(f64: string): Val {
  return { code: `${operand(f64, AS)} as i64`, ty: INT, f64 };
}

function floatLiteral(x: number): string {
  if (Number.isNaN(x)) return "f64::NAN";
  if (!Number.isFinite(x)) return x > 0 ? "f64::INFINITY" : "f64::NEG_INFINITY";
  const spelled = String(Math.abs(x)).replace("e+", "e");
  return `${x < 0 || Object.is(x, -0) ? "-" : ""}${/[.e]/.test(spelled) ? spelled : `${spelled}.0`}f64`;
}

export function numberVal(x: number, int: boolean): Val {
  if (!int) return { code: floatLiteral(x), ty: FLOAT, num: x };
  if (!Number.isSafeInteger(x)) return { ...intFromF64(floatLiteral(x)), num: x };
  return { code: `${x === 0 ? 0 : x}i64`, ty: INT, f64: floatLiteral(x), num: x };
}

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

export function arithmetic(a: Val, op: string, b: Val, int: boolean): Val {
  if (a.num !== undefined && b.num !== undefined) return numberVal(fold(a.num, op, b.num) as number, int);
  const negated = op === "*" ? (b.num === -1 ? a : a.num === -1 ? b : null) : null;
  const f64 = negated ? `-${operand(asF64(negated), UNARY)}` : binary(asF64(a), op, asF64(b));
  return int ? intFromF64(f64) : { code: f64, ty: FLOAT };
}

export function compare(a: Val, op: string, b: Val): Val {
  if (a.num !== undefined && b.num !== undefined) {
    const konst = fold(a.num, op, b.num) as boolean;
    return { code: String(konst), ty: BOOL, konst };
  }
  return { code: binary(asF64(a), op, asF64(b)), ty: BOOL };
}

export function negatedOrder(s: Scope, n: N): Val | null {
  if (n.type !== "BinaryExpression" || !(n.operator in FLIPPED)) return null;
  const a = expr(s, n.left);
  const b = expr(s, n.right);
  return a.ty.k === "int" && b.ty.k === "int" ? compare(a, FLIPPED[n.operator]!, b) : null;
}
