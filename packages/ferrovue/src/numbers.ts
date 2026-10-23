import { type N, type Scope, type Ty, type Val, BOOL, fail, FLOAT, INT } from "./model.ts";
import { AS, atom, binary, FLIPPED, operand, UNARY } from "./parens.ts";
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

/** The value as JavaScript writes it: an integer computed as an `f64` is written from the `f64`. */
export function asWritten(v: Val): Val {
  return v.ty.k === "int" && v.f64 !== undefined && v.code.endsWith(" as i64") ? { ...v, code: v.f64, ty: FLOAT } : v;
}

function floatLiteral(x: number): string {
  if (Number.isNaN(x)) return "f64::NAN";
  if (!Number.isFinite(x)) return x > 0 ? "f64::INFINITY" : "f64::NEG_INFINITY";
  const spelled = String(Math.abs(x)).replace("e+", "e");
  return `${x < 0 || Object.is(x, -0) ? "-" : ""}${/[.e]/.test(spelled) ? spelled : `${spelled}.0`}f64`;
}

const RUST_CONSTANTS = new Map(
  Object.entries({
    E: "2.71828182845904523536028747135266250",
    FRAC_1_PI: "0.318309886183790671537767526745028724",
    FRAC_1_SQRT_2: "0.707106781186547524400844362104849039",
    FRAC_2_PI: "0.636619772367581343075535053490057448",
    FRAC_2_SQRT_PI: "1.12837916709551257389615890312154517",
    FRAC_PI_2: "1.57079632679489661923132169163975144",
    FRAC_PI_3: "1.04719755119659774615421446109316763",
    FRAC_PI_4: "0.785398163397448309615660845819875721",
    FRAC_PI_6: "0.52359877559829887307710723054658381",
    FRAC_PI_8: "0.39269908169872415480783042290993786",
    LN_10: "2.30258509299404568401799145468436421",
    LN_2: "0.693147180559945309417232121458176568",
    LOG10_2: "0.301029995663981195213738894724493027",
    LOG10_E: "0.434294481903251827651128918916605082",
    LOG2_10: "3.32192809488736234787031942948939018",
    LOG2_E: "1.44269504088896340735992468100189214",
    PI: "3.14159265358979323846264338327950288",
    SQRT_2: "1.41421356237309504880168872420969808",
    TAU: "6.28318530717958647692528676655900577",
  }).map(([name, digits]) => [Number(digits), `std::f64::consts::${name}`]),
);

export function numberVal(x: number, int: boolean): Val {
  const constant = int ? undefined : RUST_CONSTANTS.get(Math.abs(x));
  if (constant !== undefined) return { code: x < 0 ? `-${constant}` : constant, ty: FLOAT, num: x };
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
  if (asF64(a) === asF64(b)) {
    if (op === "<" || op === ">") return { code: "false", ty: BOOL, konst: false };
    if (a.ty.k === "int") return { code: "true", ty: BOOL, konst: true };
    return { code: `!${atom(asF64(a))}.is_nan()`, ty: BOOL };
  }
  return { code: binary(asF64(a), op, asF64(b)), ty: BOOL };
}

export function negatedOrder(s: Scope, n: N): Val | null {
  if (n.type !== "BinaryExpression" || !(n.operator in FLIPPED)) return null;
  const a = expr(s, n.left);
  const b = expr(s, n.right);
  return a.ty.k === "int" && b.ty.k === "int" ? compare(a, FLIPPED[n.operator]!, b) : null;
}

/** `a ** b` where every engine gives the same answer: an integer to a whole power from 0 whose
 * result is an integer within ±2⁵³, worked out exactly; `null` for any other. */
export function exactPower(a: number, b: number): number | null {
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < 0 || Math.abs(a) > 2 ** 53) return null;
  if (b === 0) return 1;
  if (Object.is(a, -0)) return b % 2 === 1 ? -0 : 0;
  if (Math.abs(a) > 1 && b > 53) return null;
  const r = BigInt(a) ** BigInt(b);
  const limit = 2n ** 53n;
  return r > limit || r < -limit ? null : Number(r);
}

export function power(s: Scope, base: N, exponent: N, n: N, what: string): Val {
  const [a, b] = [expr(s, base), expr(s, exponent)];
  if (!isNumber(a.ty) || !isNumber(b.ty)) return fail(s.comp, "FV0720", `${what} of numbers that are present`, n);
  const engines = "Node 22 writes `10 ** -20` as `1.0000000000000001e-20`, and engines round powers beyond 2⁵³ in their own ways";
  if (a.num === undefined || b.num === undefined) {
    return fail(s.comp, "FV0720", `${what} of a value known only when rendering: ferrovue works ${what} out when compiling, for an integer to a whole power from 0 whose result is within ±2⁵³, since ${engines}: compute it in Rust and pass it as a prop`, n);
  }
  const r = exactPower(a.num, b.num);
  if (r === null) return fail(s.comp, "FV0720", `${what} of ${String(a.num)} and ${String(b.num)}, which is not an integer to a whole power from 0 with a result within ±2⁵³: ${engines}`, n);
  return numberVal(r, true);
}
