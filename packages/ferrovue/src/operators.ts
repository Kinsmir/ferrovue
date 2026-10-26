import { type Component, type N, type Scope, type Ty, type Val, absence, BOOL, fail, FLOAT, nothing, refusalAt, sameTy, STR } from "./model.ts";
import { annotatedStr, enumEquality, knownLiteral, refuseOutside } from "./enums.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, negate, not, strArg } from "./parens.ts";
import { formatted, meet, stringsEqual } from "./strings.ts";
import { arithmetic, asF64, compare, intFromF64, isNumber, negatedOrder, numberVal, power } from "./numbers.ts";
import { boolOf, checkNullTest, nullTest, truthTested, truthy, typeofCompare, typeofTest, typeofVal } from "./narrowing.ts";
import { describeTy, expr } from "./expr.ts";

/** The value of a binary expression: `+`, arithmetic, an order or an equality. */
export function binaryOf(s: Scope, n: N): Val {
  const comp = s.comp;
  if (n.operator === "+") return plus(s, n);
  if (n.operator === "**") return power(s, n.left, n.right, n, "`**`");
  if (n.operator === "in" || n.operator === "instanceof") {
    const what =
      n.operator === "in"
        ? "tests whether an object has a key, which the server does not translate: for a record, write `Object.keys(r).includes(key)`"
        : "tests an object's prototype, which the server's typed values do not carry: each value's type is known when compiling";
    return fail(comp, "FV0631", `\`${n.operator}\` ${what}`, n);
  }
  if (["&", "|", "^", "<<", ">>", ">>>"].includes(n.operator)) {
    return fail(comp, "FV0632", `\`${n.operator}\` works on the 32-bit integers JavaScript converts its operands to, which the server does not translate: compute it in Rust and pass it as a prop`, n);
  }
  if (["-", "*", "%", "/", "<", ">", "<=", ">="].includes(n.operator)) return arithmeticOrOrder(s, n);
  return equality(s, n);
}

function plus(s: Scope, n: N): Val {
  const comp = s.comp;
  const a = expr(s, n.left);
  const b = expr(s, n.right);
  const joinable = (t: Ty) => t.k === "str" || isNumber(t);
  if ((a.ty.k === "str" || b.ty.k === "str") && joinable(a.ty) && joinable(b.ty)) {
    meet(comp, a, b, "`+`", n, "join");
    const joined = formatted(comp, [a, b], n, "`+`");
    return joined.variant !== undefined ? annotatedStr(joined, STR) : joined;
  }
  if (isNumber(a.ty) && isNumber(b.ty)) return arithmetic(a, "+", b, a.ty.k === "int" && b.ty.k === "int", refusalAt(comp, n));
  return fail(comp, "FV0608", "`+` joins a string to a string or a number, or adds two numbers", n);
}

function arithmeticOrOrder(s: Scope, n: N): Val {
  const comp = s.comp;
  const a = expr(s, n.left);
  const b = expr(s, n.right);
  const comparison = ["<", ">", "<=", ">="].includes(n.operator);
  const ordered = comparison ? claim((p) => p.values?.order?.(a, n.operator, b)) : undefined;
  if (ordered) return ordered;
  if (comparison && a.ty.k === "str" && b.ty.k === "str") {
    meet(comp, a, b, `\`${n.operator}\``, n, "order");
    const is = { "<": "lt", ">": "gt", "<=": "le", ">=": "ge" }[n.operator as "<"];
    return { code: `fv::strings::js_cmp(${strArg(a.code)}, ${strArg(b.code)}).is_${is}()`, ty: BOOL };
  }
  if (!isNumber(a.ty) || !isNumber(b.ty)) return notNumbers(comp, n, a, b, comparison);
  if (["<", ">", "<=", ">="].includes(n.operator)) return compare(a, n.operator, b);
  const intDivisor = n.right.type === "NumericLiteral" && Number.isInteger(n.right.value) && n.right.value !== 0;
  const int = a.ty.k === "int" && b.ty.k === "int" && n.operator !== "/" && (n.operator !== "%" || intDivisor);
  return arithmetic(a, n.operator, b, int, refusalAt(comp, n));
}

function notNumbers(comp: Component, n: N, a: Val, b: Val, comparison: boolean): never {
  const why =
    a.ty.k === "opt" || b.ty.k === "opt"
      ? "narrow an optional one with `v-if` first"
      : `the other is ${describeTy(isNumber(a.ty) ? b.ty : a.ty)}`;
  const between = comparison ? "two numbers, two strings or two dates" : "two numbers";
  return fail(comp, "FV0609", `\`${n.operator}\` is supported between ${between} that are present: ${why}`, n);
}

function equality(s: Scope, n: N): Val {
  const comp = s.comp;
  const tested = typeofCompare(n);
  if (tested) return claim((p) => p.equality?.(s, n)) ?? typeofTest(s, tested, n);
  const test = nullTest(n);
  if (n.operator !== "===" && n.operator !== "!==" && !test) {
    const [a, b] = [expr(s, n.left), expr(s, n.right)];
    claim((p) => p.values?.refuseEquality?.(s, a, b, n));
  }
  if (n.operator !== "===" && n.operator !== "!==" && !test) fail(comp, "FV0619", `\`${n.operator}\`: \`==\` and \`!=\` compare with \`null\` or \`undefined\` only; use \`===\``, n);
  const whole = claim((p) => p.equality?.(s, n));
  if (whole) return whole;
  const byNull = test ? nullTested(s, n, test) : null;
  return byNull ?? strictEquality(s, n);
}

function nullTested(s: Scope, n: N, test: NonNullable<ReturnType<typeof nullTest>>): Val | null {
  const comp = s.comp;
  const v = expr(s, test.target);
  const none = absence(v.ty);
  if (v.ty.k === "opt") {
    checkNullTest(s, test, v);
    const is = `${atom(v.code)}.is_none()`;
    return boolOf(test.is ? is : not(is));
  }
  if (none !== null) {
    const konst = (!test.strict || none === test.literal) === test.is;
    return { code: String(konst), ty: BOOL, konst };
  }
  if (!test.strict && claim((p) => p.values?.describe?.(v.ty)) === undefined) {
    return { code: String(!test.is), ty: BOOL, konst: !test.is };
  }
  if (!test.strict) fail(comp, "FV0620", `\`${n.operator}\` of ${describeTy(v.ty)}: compare with \`${test.is ? "===" : "!=="} undefined\``, n);
  return null;
}

function strictEquality(s: Scope, n: N): Val {
  const comp = s.comp;
  const a = expr(s, n.left);
  const b = expr(s, n.right);
  const strish = (t: Ty) => t.k === "str" || (t.k === "opt" && t.of.k === "str");
  if (strish(a.ty) && strish(b.ty)) meet(comp, a, b, `\`${n.operator}\``, n, "equal");
  claim((p) => p.values?.refuseEquality?.(s, a, b, n));
  refuseOutside(comp, a, b, n);
  const own = claim((p) => p.values?.equals?.(a, b));
  const byEnum = knownLiteral(a) !== undefined && knownLiteral(b) !== undefined ? null : enumEquality(comp, a, b);
  if (own !== undefined) return equalOrNot(n, own);
  if (byEnum !== null) return equalOrNot(n, byEnum);
  if ((nothing(b.ty) && a.ty.k === "opt") || (nothing(a.ty) && b.ty.k === "opt")) {
    const [v, literal] = a.ty.k === "opt" ? [a, b] : [b, a];
    checkNullTest(s, { target: n, literal: literal.ty.k === "null" ? "null" : "undefined", strict: true, is: n.operator === "===" }, v);
    return equalOrNot(n, `${atom(v.code)}.is_none()`);
  }
  if (nothing(a.ty) || nothing(b.ty)) return equalNothing(comp, n, a, b);
  return equalOrNot(n, valuesEqual(comp, n, a, b));
}

function equalOrNot(n: N, eq: string): Val {
  return boolOf(n.operator === "===" ? eq : not(eq));
}

function equalNothing(comp: Component, n: N, a: Val, b: Val): Val {
  const other = nothing(a.ty) ? b.ty : a.ty;
  const opaque = nothing(other) ? undefined : claim((p) => p.values?.describe?.(other));
  if (opaque !== undefined) fail(comp, "FV0621", `\`${n.operator}\` between ${opaque} and ${describeTy(nothing(a.ty) ? a.ty : b.ty)}`, n);
  const same = a.ty.k === b.ty.k;
  const konst = n.operator === "===" ? same : !same;
  return { code: String(konst), ty: BOOL, konst };
}

function valuesEqual(comp: Component, n: N, a: Val, b: Val): string {
  const scalar = (t: Ty) => t.k === "str" || t.k === "int" || t.k === "bool";
  if (isNumber(a.ty) && isNumber(b.ty)) return compare(a, "==", b).code;
  if (a.ty.k === "str" && b.ty.k === "str") return stringsEqual(a, b);
  if (a.ty.k === "bool" && b.ty.k === "bool" && (a.konst !== undefined || b.konst !== undefined)) {
    const [k, other] = a.konst !== undefined ? [a.konst, b.code] : [b.konst!, a.code];
    return k ? other : not(other);
  }
  if (sameTy(a.ty, b.ty) && (scalar(a.ty) || (a.ty.k === "opt" && scalar(a.ty.of)))) return binary(a.code, "==", b.code);
  if (a.ty.k === "opt" && sameTy(a.ty.of, b.ty) && scalar(b.ty)) return binary(a.code, "==", `Some(${bare(b.code)})`);
  if (b.ty.k === "opt" && sameTy(b.ty.of, a.ty) && scalar(a.ty)) return binary(`Some(${bare(a.code)})`, "==", b.code);
  return fail(comp, "FV0622", "`===` between these types", n);
}

/** The value of a unary expression: `!`, `-` or `typeof`. */
export function unaryOf(s: Scope, n: N): Val {
  const comp = s.comp;
  if (n.operator === "!") {
    return negatedOrder(s, n.argument) ?? boolOf(not(truthy(truthTested(s, n.argument))));
  }
  if (n.operator === "-") {
    const a = expr(s, n.argument);
    if (isNumber(a.ty) && a.num !== undefined) return numberVal(-a.num, a.ty.k === "int");
    if (a.ty.k === "int") return intFromF64(negate(asF64(a)), refusalAt(comp, n));
    if (a.ty.k === "float") return { code: negate(a.code), ty: FLOAT };
  }
  if (n.operator === "typeof") return typeofVal(s, n);
  return fail(comp, "FV0618", `unary \`${n.operator}\``, n);
}
