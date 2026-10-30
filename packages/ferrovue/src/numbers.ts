import { type N, type Scope, type Ty, type Val, asciiTy, BOOL, fail, FLOAT, INT, kept, REFUSALS } from "./model.ts";
import type { ErrorCode } from "./errors.ts";
import { AS, atom, bare, binary, FLIPPED, operand, pure, receiver, UNARY } from "./parens.ts";
import { expr } from "./expr.ts";

export function isNumber(ty: Ty): boolean {
  return ty.k === "int" || ty.k === "float";
}

export function asF64(v: Val): string {
  if (v.f64 !== undefined) return v.f64;
  return v.ty.k === "float" ? v.code : `${operand(v.code, AS)} as f64`;
}

/** An integer computed as an `f64`, held as the `i64` an integer is: refused at render time where
 * it is beyond the range of `i64`, unless `at` is `null`, for a result that cannot be. */
export function intFromF64(f64: string, at: string | null): Val {
  if (at === null) return { code: `${operand(f64, AS)} as i64`, ty: INT, f64 };
  return { code: kept(`fv::render::try_int(${bare(f64)})`, at), ty: INT, f64, at };
}

/** A bound on the magnitude of a count of items held in memory, as an index or a length is. */
export const COUNT = 2 ** 48;

/** The bound on the magnitude of an integer whose `i64` gives the same value as its `f64`, where it
 * has one: a count, a safe integer literal, or a sum of those within 2⁵³. */
function exactBound(v: Val): number | undefined {
  if (v.ty.k !== "int" || isCast(v)) return undefined;
  if (v.num !== undefined) return Number.isSafeInteger(v.num) && !Object.is(v.num, -0) ? Math.abs(v.num) : undefined;
  return v.upTo;
}

function exactCode(v: Val): string {
  return v.num !== undefined ? String(v.num) : v.code;
}

/** Whether `v` is an integer computed as an `f64` and held as an `i64`. */
export function isCast(v: Val): boolean {
  return v.ty.k === "int" && v.f64 !== undefined && (v.num === undefined || v.code.endsWith(" as i64") || v.code.startsWith(`${REFUSALS}.keep(fv::render::try_int(`));
}

/** The value as JavaScript writes it: an integer computed as an `f64` is written from the `f64`. */
export function asWritten(v: Val): Val {
  return isCast(v) ? { ...v, code: v.f64!, ty: FLOAT } : v;
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

export function numberVal(x: number, int: boolean, at: string | null = null): Val {
  const constant = int ? undefined : RUST_CONSTANTS.get(Math.abs(x));
  if (constant !== undefined) return { code: x < 0 ? `-${constant}` : constant, ty: FLOAT, num: x };
  if (!int) return { code: floatLiteral(x), ty: FLOAT, num: x };
  if (!Number.isSafeInteger(x)) return { ...intFromF64(floatLiteral(x), Math.abs(x) < 2 ** 63 ? null : (at ?? "0, 0")), num: x };
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

export function arithmetic(a: Val, op: string, b: Val, int: boolean, at: string): Val {
  if (a.num !== undefined && b.num !== undefined) return numberVal(fold(a.num, op, b.num) as number, int, at);
  if ((op === "-" || op === "/") && asF64(a) === asF64(b) && pure(asF64(a))) return selfArithmetic(a, op, int, at);
  const [ab, bb] = [exactBound(a), exactBound(b)];
  if (int && (op === "+" || op === "-") && ab !== undefined && bb !== undefined && ab + bb <= 2 ** 53) {
    if (b.num === 0) return a;
    if (a.num === 0 && op === "+") return b;
    return { code: binary(exactCode(a), op, exactCode(b)), ty: INT, upTo: ab + bb };
  }
  const negated = op === "*" ? (b.num === -1 ? a : a.num === -1 ? b : null) : null;
  const f64 = negated ? `-${operand(asF64(negated), UNARY)}` : binary(asF64(a), op, asF64(b));
  return int ? intFromF64(f64, at) : { code: f64, ty: FLOAT };
}

function selfArithmetic(a: Val, op: string, int: boolean, at: string): Val {
  if (op === "-" && a.ty.k === "int" && a.f64 === undefined) return numberVal(0, int, at);
  const x = `${receiver(asF64(a))}.abs()`;
  const f64 = binary(x, op, x);
  return int ? intFromF64(f64, at) : { code: f64, ty: FLOAT };
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
  const literal = a.num !== undefined || b.num !== undefined;
  if (exactBound(a) !== undefined && exactBound(b) !== undefined && (op === "==" || literal)) return { code: binary(exactCode(a), op, exactCode(b)), ty: BOOL };
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

const DIGITS = new Map<string, [ErrorCode, number, string]>([
  ["toFixed", ["FV0705", 0, "number of digits"]],
  ["toPrecision", ["FV0716", 1, "precision"]],
  ["toExponential", ["FV0717", 0, "number of digits"]],
]);

/** Translates `.toFixed()`, `.toPrecision()`, `.toExponential()` and `.toString()` of a number, or returns null for another method or receiver. */
export function numberMethod(s: Scope, target: Val, method: string, args: N[], n: N): Val | null {
  if (!isNumber(target.ty)) return null;
  const digits = args.length <= 1 ? DIGITS.get(method) : undefined;
  if (digits) return withDigits(s, target, method, args[0], digits, n);
  if (method === "toString" && args.length === 0) return jsString(target);
  return null;
}

function literalDigits(a: N | undefined): number | undefined {
  if (a === undefined || (a.type === "Identifier" && a.name === "undefined")) return undefined;
  return a.type === "NumericLiteral" ? Math.trunc(a.value) : NaN;
}

function withDigits(s: Scope, target: Val, method: string, a: N | undefined, [code, low, what]: [ErrorCode, number, string], n: N): Val {
  const given = literalDigits(a);
  if (given !== undefined && !(given >= low && given <= 100)) fail(s.comp, code, `\`.${method}()\` takes a literal ${what}, from ${low} to 100`, n);
  const x = bare(asF64(target));
  if (method === "toFixed") return { code: `&*fv::core::js_to_fixed(${x}, ${given ?? 0})`, ty: asciiTy() };
  if (method === "toExponential") return { code: `&*fv::core::js_to_exponential(${x}, ${given === undefined ? "None" : `Some(${given})`})`, ty: asciiTy() };
  if (given === undefined) return jsString(target);
  return { code: `&*fv::core::js_to_precision(${x}, ${given})`, ty: asciiTy() };
}

function jsString(target: Val): Val {
  return { code: `&*fv::core::Js(${bare(asWritten(target).code)}).to_string()`, ty: asciiTy() };
}
