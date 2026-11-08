import { type Absence, type Component, type EnumDef, type N, type Scope, type Ty, type Val, absence, BOOL, enumOf, enumTy, fail, FLOAT, joinAbsence, joinTy, keptLiterals, literalsOf, nothing, sameTy, UNDEF, variantPath, withAbsence } from "./model.ts";
import { GenError } from "./errors.ts";
import { knownLiteral, matchOver, overVariants } from "./enums.ts";
import { asF64 } from "./numbers.ts";
import { describeTy, expr } from "./expr.ts";
import { pathOf } from "./narrowing.ts";
import { atom, bare } from "./parens.ts";
import { type Const, VALUE_ENUMS } from "./const-decls.ts";
import { constVal } from "./const-values.ts";

type Sym = { k: "const"; c: Const } | { k: "none"; short: boolean } | { k: "pick"; on: Val; keys: readonly (string | number)[]; arms: Sym[] };

/** What an expression reading constants stands for: one constant, or one chosen by a key known only when rendering. */
export interface Named {
  sym: Sym;
  what: string;
}

/** The test that `key` is among `keys`, the own keys of a constant object or the keys of a constant
 * `Map`, and the keys it may then be: `null` where `key` is not a string or an integer. */
export function keyAmong(comp: Component, key: Val, keys: readonly (string | number)[]): { test: string; among: (string | number)[] } | null {
  if (key.ty.k !== "str" && key.ty.k !== "int") return null;
  const mine = keys.filter((k) => (key.ty.k === "str" ? typeof k === "string" : typeof k === "number"));
  const fixed = key.ty.k === "str" && /^"[^"\\]*"$/.test(key.code) ? (JSON.parse(key.code) as string) : key.ty.k === "int" && key.num !== undefined && key.code === `${key.num}i64` ? key.num : undefined;
  const literals = fixed !== undefined ? [fixed] : literalsOf(key.ty);
  const among = literals === undefined ? mine : mine.filter((k) => literals.includes(k));
  if (literals !== undefined && among.length === literals.length) return { test: "true", among };
  if (among.length === 0) return { test: "false", among };
  const { subject, pattern } = matchOver(comp, key, among);
  return { test: `matches!(${subject}, ${pattern(among)})`, among };
}

/** \`Object.hasOwn(obj, key)\` of a constant object: the key, the test, and the keys it may then
 * be; \`null\` where \`obj\` is not a constant object. */
export function ownKeyTest(s: Scope, obj: N, keyNode: N): { key: Val; test: string; among: (string | number)[] } | null {
  const named = constOf(s, obj);
  if (named?.sym.k !== "const" || named.sym.c.k !== "object") return null;
  const key = expr(s, keyNode);
  const names = ownKeys(named.sym.c);
  const keys = key.ty.k === "int" ? names.filter((k) => /^(?:0|-?[1-9]\d*)$/.test(k) && Number.isSafeInteger(Number(k))).map(Number) : names;
  const found = keyAmong(s.comp, key, keys);
  if (found === null) {
    return fail(s.comp, "FV0814", `\`Object.hasOwn()\` of the constant object \`${named.what}\` by a key that is ${describeTy(key.ty)}: it takes a string or an integer that is present`, keyNode);
  }
  return { key, ...found };
}

/** The keys of a constant object, as \`Object.keys()\` gives them: integer keys first, in numeric
 * order, then the others in the order they were written. */
export function ownKeys(c: Const & { k: "object" }): string[] {
  return Object.keys(Object.fromEntries([...c.fields.keys()].map((k) => [k, 0])));
}

/** \`m.get(key)\` and \`m.has(key)\` of a constant \`Map\`. */
export function mapCall(s: Scope, named: Named, method: string, args: N[], n: N): Val {
  const c = (named.sym as { c: Const & { k: "map" } }).c;
  if ((method !== "get" && method !== "has") || args.length !== 1 || args[0].type === "SpreadElement") {
    return fail(s.comp, "FV0227", `\`${named.what}.${method}()\` of a constant \`Map\`, which the server reads with \`.get(key)\` and \`.has(key)\``, n);
  }
  const key = expr(s, args[0]);
  const keys = [...c.entries.keys()];
  const found = keyAmong(s.comp, key, keys);
  if (found === null) {
    return fail(s.comp, "FV0227", `\`${named.what}.${method}()\` by ${describeTy(key.ty)}: a constant \`Map\` is read by a string or an integer that is present`, args[0]);
  }
  if (method === "has") return found.test === "true" || found.test === "false" ? { code: found.test, ty: BOOL, konst: found.test === "true" } : { code: found.test, ty: BOOL };
  const what = `${named.what}.get(…)`;
  const literals = literalsOf(key.ty);
  const arms: Sym[] = found.among.map((k) => ({ k: "const", c: c.entries.get(k)! }));
  if (found.test !== "true" && literals === undefined) return symVal({ k: "pick", on: key, keys: [...found.among, ""], arms: [...arms, { k: "none", short: false }] }, { comp: s.comp, node: n, what });
  const on = literals ?? found.among;
  return symVal({ k: "pick", on: key, keys: on, arms: on.map((k) => (c.entries.has(k) ? { k: "const", c: c.entries.get(k)! } : { k: "none", short: false })) }, { comp: s.comp, node: n, what });
}

function objectLike(sym: Sym): boolean {
  if (sym.k === "const") return sym.c.k === "object";
  if (sym.k === "none") return true;
  return sym.arms.every(objectLike) && sym.arms.some((a) => a.k !== "none");
}

function quoted(keys: readonly (string | number)[]): string {
  return keys.map((k) => `\`${k}\``).join(", ");
}

function staticKey(s: Scope, n: N): string | null {
  if (!n.computed) return n.property.name as string;
  const p = n.property;
  if (p.type === "StringLiteral" || p.type === "NumericLiteral") return String(p.value);
  if (p.type === "TemplateLiteral" && p.expressions.length === 0) return p.quasis[0].value.cooked as string;
  const named = constOf(s, p);
  if (named?.sym.k === "const" && named.sym.c.k === "scalar" && (typeof named.sym.c.js === "string" || typeof named.sym.c.js === "number")) return String(named.sym.c.js);
  return null;
}

/** The constant an expression names: an imported or declared binding, or a field of one, by a key
 * known when compiling or by a value of a union of literals. */
export function constOf(s: Scope, n: N): Named | null {
  if (n.type === "Identifier") {
    const c = !s.locals.has(n.name) && !s.setup.has(n.name) ? s.consts.get(n.name) : undefined;
    return c ? { sym: { k: "const", c }, what: n.name } : null;
  }
  if (n.type !== "MemberExpression" && n.type !== "OptionalMemberExpression") return null;
  if (n.type === "MemberExpression" && n.object.type === "Identifier" && (n.object.name === "$setup" || n.object.name === "_ctx")) {
    const name: string | undefined = n.computed ? (n.property.type === "StringLiteral" ? n.property.value : undefined) : n.property.name;
    const c = name !== undefined ? s.consts.get(name) : undefined;
    return c && name !== undefined ? { sym: { k: "const", c }, what: name } : null;
  }
  const base = constOf(s, n.object);
  if (base === null || !objectLike(base.sym)) return null;
  const chain = n.type === "OptionalMemberExpression";
  const key = staticKey(s, n);
  if (key !== null) {
    const what = n.computed ? `${base.what}[${JSON.stringify(key)}]` : `${base.what}.${key}`;
    return { sym: step(s, base, key, n, chain, []), what };
  }
  const v = homeVariant(expr(s, n.property), n.property);
  const path = pathOf(n.property);
  const what = `${base.what}[${path === null ? "…" : path.replace(/^(?:_ctx|\$props|\$setup)\./, "").replace(new RegExp(`^${s.propsIdent ?? "\\$^"}\\.`), "")}]`;
  const keys = literalsOf(v.ty);
  const fixed = v.ty.k === "str" && /^"[^"\\]*"$/.test(v.code) ? (JSON.parse(v.code) as string) : v.ty.k === "int" && v.num !== undefined && v.code === `${v.num}i64` ? String(v.num) : v.ty.k === "float" && v.num !== undefined && /^-?[0-9.e+-]+f64$/.test(v.code) ? String(v.num) : floatConst(s, n.property);
  if (fixed !== null) return { sym: step(s, base, fixed, n, chain, []), what: `${base.what}[${JSON.stringify(fixed)}]` };
  if (v.ty.k === "opt" || nothing(v.ty)) {
    return fail(s.comp, "FV0223", `\`${base.what}\` read by a key that may be absent, where JavaScript reads the field \`undefined\`: narrow the key with \`v-if\` first, or give it a default`, n.property);
  }
  const mapped = keys === undefined && v.ty.k === "str" ? mappedKey(s, n.property) : null;
  if (mapped !== null) {
    const among = literalsOf(mapped.on.ty)!;
    return { sym: { k: "pick", on: mapped.on, keys: among, arms: among.map((k) => step(s, base, mapped.key(k), n, chain, [mapped.key(k)])) }, what };
  }
  if (keys === undefined || (v.ty.k !== "str" && v.ty.k !== "int")) {
    const is = v.ty.k === "str" ? "a `string`, which may name a field every object has, as `toString` or `constructor`" : v.ty.k === "int" ? "a `number`" : describeTy(v.ty);
    return fail(s.comp, "FV0222", `\`${base.what}\` read by a key that is ${is}: type the key as a union of string literals, as \`"sm" | "md" | "lg"\`, or an \`enum\` of them`, n.property);
  }
  const arms = keys.map((k) => step(s, base, String(k), n, chain, [k]));
  const whole = pathOf(n);
  if (whole !== null && s.narrowed.get(whole)?.pick && arms.some((a) => a.k !== "none")) {
    const kept = keys.filter((_, i) => arms[i]!.k !== "none");
    return { sym: { k: "pick", on: v, keys: kept, arms: arms.filter((a) => a.k !== "none") }, what };
  }
  return { sym: { k: "pick", on: v, keys, arms }, what };
}

function homeVariant(v: Val, node: N): Val {
  const home = v.variant === undefined && v.asEnum?.of === v.code ? v.asEnum.home : undefined;
  const keys = literalsOf(v.ty);
  if (home === undefined || v.ty.k !== "str" || keys === undefined || !keys.every((k) => typeof k === "string" && home.literals.includes(k))) return v;
  const variant = v.asEnum!.into(home, node);
  return variant === null ? v : { ...v, ty: keptLiterals(enumTy(home), (k) => keys.includes(k)), variant };
}

function floatConst(s: Scope, n: N): string | null {
  const c = n.type === "Identifier" && !s.locals.has(n.name) ? s.consts.get(n.name) : undefined;
  return c?.k === "scalar" && typeof c.js === "number" ? String(c.js) : null;
}

/** A key built from a value of a union of literals by \`.toUpperCase()\`, \`.toLowerCase()\` or a
 * template literal: the value it is built from, and the key each of its literals gives. */
function mappedKey(s: Scope, n: N): { on: Val; key: (literal: string | number) => string } | null {
  let inner = n;
  while (inner.type === "ParenthesizedExpression" || inner.type === "TSNonNullExpression") inner = inner.expression;
  const method = inner.type === "CallExpression" && inner.arguments.length === 0 && inner.callee.type === "MemberExpression" && !inner.callee.computed ? (inner.callee.property.name as string) : null;
  if (method === "toUpperCase" || method === "toLowerCase") {
    const from = keyOf(s, inner.callee.object);
    return from === null ? null : { on: from.on, key: (l) => (method === "toUpperCase" ? from.key(l).toUpperCase() : from.key(l).toLowerCase()) };
  }
  if (inner.type === "TemplateLiteral") {
    const parts = inner.expressions.map((e: N) => keyOf(s, e));
    const open = parts.filter((p: ReturnType<typeof keyOf>) => p !== null && literalsOf(p.on.ty)!.length > 1);
    if (parts.some((p: ReturnType<typeof keyOf>) => p === null) || open.length !== 1) return null;
    const one = open[0]!;
    const fixed = (p: NonNullable<ReturnType<typeof keyOf>>): string => p.key(literalsOf(p.on.ty)![0]!);
    return { on: one.on, key: (l) => inner.quasis.map((q: N, i: number) => (q.value.cooked as string) + (i < parts.length ? (parts[i] === one ? one.key(l) : fixed(parts[i])) : "")).join("") };
  }
  return null;
}

function keyOf(s: Scope, n: N): { on: Val; key: (literal: string | number) => string } | null {
  const mapped = mappedKey(s, n);
  if (mapped !== null) return mapped;
  let v: Val;
  try {
    v = expr(s, n);
  } catch (e) {
    if (e instanceof GenError) return null;
    throw e;
  }
  const literals = literalsOf(v.ty);
  if ((v.ty.k !== "str" && v.ty.k !== "int") || literals === undefined || !literals.length) return null;
  return { on: v, key: (l) => String(l) };
}

/** For a constant object read by a key known only when rendering, which is \`undefined\` for some
 * keys and an object for the rest, the test that it is an object. */
export function pickPresent(s: Scope, n: N): string | null {
  const named = n.type === "MemberExpression" && n.computed ? constOf(s, n) : null;
  const sym = named?.sym;
  if (sym?.k !== "pick" || !sym.arms.every((a) => a.k === "none" || (a.k === "const" && a.c.k === "object"))) return null;
  const yes = sym.keys.filter((_, i) => sym.arms[i]!.k !== "none");
  if (yes.length === sym.keys.length) return "true";
  if (yes.length === 0) return "false";
  const no = sym.keys.filter((_, i) => sym.arms[i]!.k === "none");
  const { subject, pattern } = matchOver(s.comp, sym.on, sym.keys);
  return sym.arms.at(-1)!.k === "none" ? `matches!(${subject}, ${pattern(yes)})` : `!matches!(${subject}, ${pattern(no)})`;
}

function step(s: Scope, base: Named, key: string, n: N, chain: boolean, path: readonly (string | number)[]): Sym {
  const sym = base.sym;
  if (sym.k === "pick") {
    return { ...sym, arms: sym.arms.map((a, i) => step(s, { sym: a, what: base.what }, key, n, chain, [...path, sym.keys[i]!])) };
  }
  if (sym.k === "none") {
    if (chain && (n.optional || sym.short)) return { k: "none", short: true };
    const where = path.length ? `, as it is for the key ${quoted(path)}` : "";
    return fail(s.comp, "FV0224", `\`${base.what}\` may be \`undefined\`${where}, and reading \`.${key}\` of it fails: read it with \`?.${key}\``, n);
  }
  if (sym.c.k !== "object") return fail(s.comp, "FV0204", `\`${base.what}\` has no field \`${key}\``, n);
  const f = sym.c.fields.get(key);
  if (f) return { k: "const", c: f };
  if (path.length === 0) return fail(s.comp, "FV0204", `\`${base.what}\` has no field \`${key}\``, n);
  if (key in Object.prototype) {
    return fail(s.comp, "FV0226", `\`${base.what}\` has no field \`${key}\` for the key ${quoted(path)}, where JavaScript reads \`Object.prototype.${key}\`, which the server does not have: add the key to the object`, n);
  }
  return { k: "none", short: false };
}

/** What a constant, or a constant chosen by a key, is as a value in Rust. */
export function namedVal(named: Named, at: { comp: Component; node: N }): Val {
  return symVal(named.sym, { ...at, what: named.what });
}

function symVal(sym: Sym, at: { comp: Component; node: N; what: string }): Val {
  if (sym.k === "const") return constVal(sym.c, at);
  if (sym.k === "none") return { code: "None", ty: UNDEF };
  const arms = sym.arms.map((a) => symVal(a, at));
  const { ty, codes } = unified(arms, at);
  const slice = ty.k === "list" ? { slice: true } : {};
  const { subject, pattern, last: lastArm } = matchOver(at.comp, sym.on, sym.keys);
  const picked = (values: readonly string[]): string => {
    const groups: [(string | number)[], string][] = [];
    sym.keys.forEach((key, i) => {
      const g = groups.find(([, code]) => code === values[i]);
      if (g) g[0].push(key);
      else groups.push([[key], values[i]!]);
    });
    if (groups.length === 1) return groups[0]![1];
    const named = sym.keys as readonly string[];
    const over = sym.on.asEnum?.of === sym.on.code ? sym.on.asEnum.over : undefined;
    const composed = over === undefined ? null : over((k) => (named.includes(k) ? values[named.indexOf(k)]! : null));
    if (composed !== null) return composed;
    const def = sym.on.variant !== undefined && sym.on.ty.k !== "opt" ? enumOf(sym.on.ty) : undefined;
    const one = def !== undefined && named.length < def.literals.length && named.every((k) => def.literals.includes(k)) ? overVariants(at.comp, sym.on, named, (k) => (named.includes(k) ? values[named.indexOf(k)]! : null)) : null;
    if (one !== null) return one;
    const last = groups.findIndex(([, code]) => code === values[values.length - 1]);
    groups.push(...groups.splice(last, 1));
    const branches = groups.map(([keys, code], i) => `${i === groups.length - 1 ? lastArm(keys) : pattern(keys)} => ${code}`);
    return `match ${subject} { ${branches.join(", ")} }`;
  };
  if (new Set(codes).size === 1) return { code: codes[0]!, ty, ...slice };
  if (ty.k === "bool" && codes.every((code) => code === "true" || code === "false")) {
    const yes = sym.keys.filter((_, i) => codes[i] === "true");
    const no = sym.keys.filter((_, i) => codes[i] === "false");
    return { code: codes.at(-1) === "true" ? `!matches!(${subject}, ${pattern(no)})` : `matches!(${subject}, ${pattern(yes)})`, ty };
  }
  const code = picked(codes);
  const literals = arms.map((a) => (nothing(a.ty) ? null : knownLiteral(a)));
  const nested = (a: Val): boolean => a.ty.k === "str" && a.asEnum?.of === a.code;
  if (ty.k === "list" || literals.some((l, i) => l === undefined && !nested(arms[i]!))) return { code, ty, ...slice };
  const optional = ty.k === "opt";
  const into = (def: EnumDef, node: N): string | null => {
    const made = literals.map((l, i) => {
      if (l === undefined) {
        const inner = arms[i]!.asEnum!.into(def, node);
        return inner === null ? null : optional ? `Some(${bare(inner)})` : inner;
      }
      if (l !== null && !def.literals.includes(l)) return null;
      return l === null ? "None" : optional ? `Some(${variantPath(at.comp, def, l)})` : variantPath(at.comp, def, l);
    });
    return made.some((m) => m === null) ? null : picked(made as string[]);
  };
  const typed = valueEnum(sym.arms);
  const variant = typed === undefined ? null : into(typed, at.node);
  if (typed !== undefined && variant !== null) return { code, ty: withAbsence(enumTy(typed), optional ? absence(ty) : null), variant, asEnum: { of: code, into } };
  return { code, ty, asEnum: { of: code, into } };
}

function valueEnum(arms: readonly Sym[]): EnumDef | undefined {
  let def: EnumDef | undefined;
  for (const a of arms) {
    if (a.k === "none") continue;
    const own = a.k === "const" ? VALUE_ENUMS.get(a.c) : undefined;
    if (own === undefined || (def !== undefined && own !== def)) return undefined;
    def = own;
  }
  return def;
}

function unified(arms: Val[], at: { comp: Component; node: N; what: string }): { ty: Ty; codes: string[] } {
  let none: Absence | null = null;
  for (const a of arms) none = joinAbsence(none, absence(a.ty));
  const present = arms.filter((a) => !nothing(a.ty));
  if (present.length === 0) {
    if (none === "either") fail(at.comp, "FV0225", `\`${at.what}\` is \`null\` for some keys and \`undefined\` for others`, at.node);
    return { ty: arms[0]!.ty, codes: arms.map(() => "None") };
  }
  const bases = present.map((a) => (a.ty.k === "opt" ? a.ty.of : a.ty));
  const first = bases[0]!;
  const numbers = bases.every((t) => t.k === "int" || t.k === "float");
  const float = numbers && bases.some((t) => t.k === "float");
  const same = bases.every((t) => sameTy(t, first) || (t.k === "list" && first.k === "list" && (t.of.k === "undef" || first.of.k === "undef")));
  if (!(numbers || (same && ["str", "int", "bool", "list"].includes(first.k)))) {
    const kinds = [...new Set(bases.map(describeTy))];
    fail(at.comp, "FV0225", `\`${at.what}\` is ${kinds.length > 1 ? `${kinds.join(" for some keys and ")} for others` : describeTy(first)}, where a value read by a key known only when rendering is a string, a number, a boolean or a list of them, of one type for every key`, at.node);
  }
  let of: Ty = float ? FLOAT : bases.reduce((a: Ty, b: Ty) => joinTy(a, b));
  if (of.k === "list") {
    const items: Ty[] = bases.map((t) => (t as { of: Ty }).of).filter((t) => t.k !== "undef");
    of = { k: "list", of: items.length ? items.reduce((a: Ty, b: Ty) => joinTy(a, b)) : UNDEF };
  }
  const ty = withAbsence(of, none);
  const codes = arms.map((a) => {
    if (nothing(a.ty)) return "None";
    let code = !float ? a.code : a.ty.k === "int" ? asF64(a) : a.ty.k === "opt" && a.ty.of.k === "int" ? `${atom(a.code)}.map(|v| v as f64)` : a.code;
    if (of.k === "list") code = code.startsWith("[") ? `&${code}[..]` : code;
    return none !== null && a.ty.k !== "opt" ? `Some(${bare(code)})` : code;
  });
  return { ty, codes };
}
