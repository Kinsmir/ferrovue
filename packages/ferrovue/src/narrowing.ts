import { type EnumDef, type N, type Scope, type Ty, type Val, absence, BOOL, enumOf, fail, falsyLiteral, keptLiterals, literalsOf, literalTy, nothing, rustStr, STR, UNDEF, unionStr, variantPath } from "./model.ts";
import { GenError } from "./errors.ts";
import { ownKeyTest, pickPresent } from "./constants.ts";
import { isObjectCall } from "./calls.ts";
import { ctx } from "./context.ts";
import { claim } from "./plugin.ts";
import { atom, bare, binary, condition, ifElse, logical, not, occurrences, receiver } from "./parens.ts";
import { isNumber, negatedOrder } from "./numbers.ts";
import { describeTy, expr } from "./expr.ts";
import { fresh, jsHint } from "./names.ts";

export function known(v: Val): boolean | undefined {
  if (v.konst !== undefined) return v.konst;
  if (nothing(v.ty)) return false;
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
    case "opt": {
      const each = truthy({ code: "v", ty: v.ty.of });
      return each === "true" ? `${atom(v.code)}.is_some()` : `${atom(v.code)}.is_some_and(|v| ${each})`;
    }
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
  if (n.computed && n.property.type === "NumericLiteral") return `${base}[${n.property.value}]`;
  const key = n.computed ? pathOf(n.property) : null;
  return key === null ? null : `${base}[${key}]`;
}

/** The narrowed values of `narrowed` whose paths read none of `names`, which a scope binds anew. */
export function unbound(narrowed: Map<string, Val>, names: Iterable<string>): Map<string, Val> {
  const bound = [...names].map((b) => new RegExp(`(?:^|\\[)${b.replace(/\$/g, "\\$")}(?=$|[.[\\]])`));
  return new Map([...narrowed].filter(([path]) => !bound.some((re) => re.test(path))));
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
    fail(s.comp, "FV0626", `\`${op}= ${t.literal}\` of a value that may be \`null\` or \`undefined\`, which its Rust \`Option\` cannot tell apart: test both with \`${op} null\``, t.target);
  }
  const other = t.literal === "null" ? "undefined" : "null";
  const what = none === "null" ? "is `T | null`, never `undefined`" : "is optional, which is `undefined` when absent, never `null`";
  fail(s.comp, "FV0627", `\`${op}= ${t.literal}\` of a value that ${what}: compare with \`${other}\``, t.target);
}

/** `typeof target === literal`, `!==`, `==` or `!=`, either way round. */
export interface TypeofCompare {
  target: N;
  literal: string;
  equal: boolean;
}

export function typeofCompare(n: N): TypeofCompare | null {
  if (n.type !== "BinaryExpression" || !["===", "!==", "==", "!="].includes(n.operator)) return null;
  const isTypeof = (m: N) => m.type === "UnaryExpression" && m.operator === "typeof";
  const [t, lit] = isTypeof(n.left) && n.right.type === "StringLiteral" ? [n.left, n.right] : isTypeof(n.right) && n.left.type === "StringLiteral" ? [n.right, n.left] : [null, null];
  return t ? { target: t.argument, literal: lit.value, equal: n.operator.startsWith("=") } : null;
}

function typeName(s: Scope, ty: Ty, n: N): string {
  switch (ty.k) {
    case "str":
    case "html":
      return "string";
    case "int":
    case "float":
      return "number";
    case "bool":
      return "boolean";
    case "undef":
      return "undefined";
    case "null":
    case "list":
    case "record":
    case "entry":
    case "struct":
    case "child":
    case "date":
      return "object";
    default:
      return fail(s.comp, "FV0722", `\`typeof\` of ${describeTy(ty)}, whose JavaScript type the compiler does not know`, n);
  }
}

/** What `typeof v` gives: `present` for a value that is there, and `absent` for an optional one
 * that is not (`null` when `v` cannot be absent, `either` when it may be `null` or `undefined`). */
function typeNames(s: Scope, v: Val, n: N): { present: string; absent: string | null } {
  if (v.ty.k !== "opt") return { present: typeName(s, v.ty, n), absent: null };
  const absent = v.ty.none === "null" ? "object" : v.ty.none === "either" ? "either" : "undefined";
  return { present: typeName(s, v.ty.of, n), absent };
}

function eitherRefused(s: Scope, literal: string, n: N): never {
  return fail(s.comp, "FV0722", `\`typeof\` compared with "${literal}" of a value that may be \`null\` (an "object") or \`undefined\`, which its Rust \`Option\` cannot tell apart: test it with \`== null\``, n);
}

export function typeofVal(s: Scope, n: N): Val {
  const v = expr(s, n.argument);
  const { present, absent } = typeNames(s, v, n.argument);
  if (absent === null || absent === present) return { code: rustStr(present), ty: STR };
  if (absent === "either") return eitherRefused(s, present, n);
  return { code: `if ${atom(v.code)}.is_some() { ${rustStr(present)} } else { ${rustStr(absent)} }`, ty: STR };
}

export function typeofTest(s: Scope, t: TypeofCompare, n: N): Val {
  const v = expr(s, t.target);
  const { present, absent } = typeNames(s, v, t.target);
  const konst = (is: boolean): Val => ({ code: String(is === t.equal), ty: BOOL, konst: is === t.equal });
  if (absent === null) return konst(present === t.literal);
  if (absent === "either" && (t.literal === "undefined" || t.literal === "object")) return eitherRefused(s, t.literal, n);
  if (present === t.literal && absent === t.literal) return konst(true);
  if (present === t.literal) return boolOf(t.equal ? `${atom(v.code)}.is_some()` : `${atom(v.code)}.is_none()`);
  if (absent === t.literal) return boolOf(t.equal ? `${atom(v.code)}.is_none()` : `${atom(v.code)}.is_some()`);
  return konst(false);
}

export interface Presence {
  path: string;
  pick?: true;
  pattern: (name: string) => string;
  option: string;
  present: string;
  of: Ty;
  negated: boolean;
  truthy: boolean;
  variant?: true;
  /** For an optional value of a generated enum, the Rust expression of the `Option` the test reads. */
  source?: { code: string; def: EnumDef };
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
    const tested = typeofCompare(n);
    const test = nullTest(n);
    if (tested) {
      target = tested.target;
      byTruth = false;
    } else if (!test) return null;
    else {
      target = test.target;
      negated = test.is;
      byTruth = false;
    }
  }
  if (isObjectCall(target, "hasOwn") && target.arguments.length === 2) return ownKeyPresence(s, target, negated);
  const path = pathOf(target);
  if (path === null) return null;
  const strictNull = n.type === "BinaryExpression" && nullTest(n)?.strict === true && nullTest(n)?.literal === "null";
  const picked = typeofCompare(n) || strictNull ? null : pickPresent(s, target);
  if (picked !== null) {
    const option = `${atom(picked)}.then_some(())`;
    return { path, pick: true, of: UNDEF, negated, truthy: byTruth, option, present: picked, pattern: (name) => `let Some(${name}) = ${option}` };
  }
  const v = expr(s, target);
  if (v.ty.k !== "opt" || v.owned) return null;
  const tested = typeofCompare(n);
  if (tested) {
    const { present, absent } = typeNames(s, v, target);
    if (absent === "either" || present === absent) return null;
    if (tested.literal === present) negated = !tested.equal;
    else if (tested.literal === absent) negated = tested.equal;
    else return null;
  } else if (n.type === "BinaryExpression") checkNullTest(s, nullTest(n)!, v);
  const of: Ty = v.ty.of;
  const def = v.variant !== undefined ? enumOf(v.ty) : undefined;
  if (def !== undefined) {
    const empty = byTruth && (literalsOf(of) ?? def.literals).includes("");
    const option = empty ? `${atom(v.variant!)}.filter(|v| *v != ${variantPath(s.comp, def, "")})` : v.variant!;
    const kept = empty ? keptLiterals(of, (l) => l !== "") : of;
    return { path, of: kept, negated, truthy: byTruth, option, present: `${atom(option)}.is_some()`, pattern: (name) => `let Some(${name}) = ${option}`, variant: true, source: { code: v.variant!, def } };
  }
  const scalar = of.k === "str" || of.k === "int" || of.k === "float" || of.k === "bool";
  const filtered = byTruth && scalar;
  const option = filtered ? `${atom(v.code)}.filter(|v| ${truthy({ code: "*v", ty: of })})` : v.code;
  const present = filtered ? truthy(v) : `${atom(v.code)}.is_some()`;
  return { path, of, negated, truthy: byTruth, option, present, pattern: (name) => `let Some(${name}) = ${option}` };
}

function ownKeyPresence(s: Scope, call: N, negated: boolean): Presence | null {
  const path = pathOf(call.arguments[1]);
  const found = path === null ? null : ownKeyTest(s, call.arguments[0], call.arguments[1]);
  if (path === null || found === null || found.test === "true" || found.test === "false") return null;
  const of = literalTy(found.key.ty.k === "int" ? "int" : "str", found.among);
  const option = `${found.test}.then_some(${bare(found.key.code)})`;
  return { path, of, negated, truthy: false, option, present: found.test, pattern: (name) => `let Some(${name}) = ${option}` };
}

/** Where the test `n` holds and where it fails, the scopes in which a string of a union of
 * literals it tests is narrowed as TypeScript narrows it: by `===`, `!==`, `==` or `!=` with a
 * string literal, either way round, or by its truth, and by `!` of either, with the path it
 * narrows, the value the path holds and whether the test holds for a literal. Null when `n`
 * tests no such value, or, unless `always`, when it narrows none. */
export function literalNarrowing(s: Scope, n: N, always = false): { yes: Scope; no: Scope; path: string; v: Val; holds: (literal: string | number) => boolean; absent: boolean } | null {
  let test = unparenthesized(n);
  let negated = false;
  while (test.type === "UnaryExpression" && test.operator === "!") {
    test = unparenthesized(test.argument);
    negated = !negated;
  }
  let target: N = test;
  let holds: (literal: string | number) => boolean = (l) => !falsyLiteral(l);
  if (test.type === "BinaryExpression" && ["===", "!==", "==", "!="].includes(test.operator)) {
    const [side, literal] = test.right.type === "StringLiteral" ? [test.left, test.right.value] : test.left.type === "StringLiteral" ? [test.right, test.left.value] : [null, null];
    if (side === null) return null;
    target = unparenthesized(side);
    holds = (l) => l === literal;
    if (test.operator.startsWith("!")) negated = !negated;
  }
  const path = pathOf(target);
  if (path === null) return null;
  let v: Val;
  try {
    v = expr(s, target);
  } catch (e) {
    if (e instanceof GenError) return null;
    throw e;
  }
  if (v.pick || v.owned || (v.ty.k === "opt" ? v.ty.of : v.ty).k !== "str") return null;
  const narrowed = (keep: (literal: string | number) => boolean): Scope => {
    const ty = keptLiterals(v.ty, keep);
    return ty === v.ty ? s : { ...s, narrowed: new Map(s.narrowed).set(path, { ...v, ty }) };
  };
  const [yes, no] = [narrowed(holds), narrowed((l) => !holds(l))];
  if (yes === s && no === s && !always) return null;
  return negated ? { yes: no, no: yes, path, v, holds: (l) => !holds(l), absent: true } : { yes, no, path, v, holds, absent: false };
}

export function narrowTo(s: Scope, p: Presence, name: string): Scope {
  return { ...s, narrowed: new Map(s.narrowed).set(p.path, narrowedVal(p, name)) };
}

/** The value a path `p` tests stands for where the test holds, bound to `name`. */
export function narrowedVal(p: Presence, name: string): Val {
  if (p.variant) return { code: unionStr(name), ty: p.of, variant: name };
  return p.pick ? { code: name, ty: p.of, pick: true } : { code: name, ty: p.of };
}

export function narrowing(s: Scope, p: Presence, present: (s: Scope) => string, absent: (s: Scope) => string): string {
  const name = fresh("n", jsHint(p.path));
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

function unparenthesized(n: N): N {
  while (n?.type === "ParenthesizedExpression") n = n.expression;
  return n;
}

function narrowsFor(s: Scope, side: N, negated: boolean): boolean {
  const inner = unparenthesized(side);
  if (inner.type === "LogicalExpression" && inner.operator === (negated ? "||" : "&&")) return narrowsFor(s, inner.left, negated) || narrowsFor(s, inner.right, negated);
  try {
    return presence(s, inner)?.negated === negated;
  } catch (e) {
    if (e instanceof GenError) return false;
    throw e;
  }
}

/** `(a && b) && c` as `a && (b && c)`, and the same of `||`, where `a` or `b` narrows a value, so
 * that the narrowing holds in `c`, as TypeScript narrows it. JavaScript gives the same value either
 * way round. */
export function reassociated(s: Scope, n: N): N {
  if (n.type !== "LogicalExpression" || (n.operator !== "&&" && n.operator !== "||")) return n;
  const left = unparenthesized(n.left);
  if (left.type !== "LogicalExpression" || left.operator !== n.operator || !narrowsFor(s, left, n.operator === "||")) return n;
  return reassociated(s, { ...n, left: left.left, right: { ...left, left: left.right, right: n.right } });
}

export function cond(s: Scope, n: N): string {
  if (n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&")) {
    const chained = reassociated(s, n);
    if (chained !== n) return cond(s, chained);
    const p = presence(s, n.left);
    if (p && p.negated === (n.operator === "||")) {
      return narrowing(s, p, (inner) => cond(inner, n.right), () => String(n.operator === "||"));
    }
    const narrowed = literalNarrowing(s, n.left);
    return logical(cond(s, n.left), n.operator, cond(narrowed === null ? s : n.operator === "&&" ? narrowed.yes : narrowed.no, n.right));
  }
  if (n.type === "UnaryExpression" && n.operator === "!") return negatedOrder(s, n.argument)?.code ?? not(cond(s, n.argument));
  return truthy(truthTested(s, n));
}

/** A value tested for truth: as \`expr\` gives it, or, for a constant object read by a key known
 * only when rendering, whether it is one. */
export function truthTested(s: Scope, n: N): Val {
  const picked = pickPresent(s, n);
  return picked === null ? expr(s, n) : boolOf(picked);
}

export function boolOf(code: string): Val {
  return code === "true" || code === "false" ? { code, ty: BOOL, konst: code === "true" } : { code, ty: BOOL };
}
