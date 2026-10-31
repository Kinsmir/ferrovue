import { type Component, type EnumDef, type N, type Scope, type Ty, type Val, absence, enumOf, fail, FLOAT, joinAbsence, joinTy, literalsOf, literalTy, neverEmpty, nothing, refusalAt, sameTy, STR, withAbsence } from "./model.ts";
import { GenError } from "./errors.ts";
import { annotatedStr, exactlyEnum, intoEnum, knownLiteral } from "./enums.ts";
import { ctx } from "./context.ts";
import { atom, bare, condition, enclosed, occurrences, strArg } from "./parens.ts";
import { collected, sliced, typedEmpty, untypedEmpty } from "./lists.ts";
import { asCow, isTemporary, loneOf, piecesOf } from "./strings.ts";
import { asF64, intFromF64, isCast, isNumber } from "./numbers.ts";
import { choice, known, literalNarrowing, narrowTo, type Presence, presence, truthTested, truthy } from "./narrowing.ts";
import { ownedStruct, ownedStructs } from "./objects.ts";
import { split, splits } from "./blocks.ts";
import { fresh, jsHint } from "./names.ts";
import { coerce, expr } from "./expr.ts";

interface Branches {
  comp: Component;
  n: N;
  a: Val;
  b: Val;
  emptyA: boolean;
  emptyB: boolean;
  choose: (yes: string, no: string) => string;
  head: () => { test: string; yes: Val; no: Val };
  lone: { lone?: true };
}

/** The value of a conditional expression, `test ? a : b`. */
export function conditionalOf(s: Scope, n: N): Val {
  if (splits(s, n.test)) return expr(s, split(n));
  const t = truthTested(s, n.test);
  const k = known(t);
  if (k !== undefined) return knownBranch(s, n, k);
  return branches(s, n, t);
}

function knownBranch(s: Scope, n: N, k: boolean): Val {
  const comp = s.comp;
  const chosen = expr(s, k ? n.consequent : n.alternate);
  const held = chosen.variant !== undefined && chosen.ty.k === "str" ? enumOf(chosen.ty) : undefined;
  if (!untypedEmpty(chosen) && held === undefined) return chosen;
  ctx.trying++;
  try {
    return besideOther(comp, expr(s, k ? n.alternate : n.consequent), chosen, held);
  } catch (e) {
    if (!(e instanceof GenError)) throw e;
    return chosen;
  } finally {
    ctx.trying--;
  }
}

function besideOther(comp: Component, other: Val, chosen: Val, held: EnumDef | undefined): Val {
  if (held !== undefined) {
    if (other.ty.k !== "str" || enumOf(other.ty) !== undefined) return chosen;
    const theirs = literalsOf(other.ty);
    return annotatedStr(chosen, theirs === undefined ? STR : literalTy("str", [...new Set([...(literalsOf(chosen.ty) ?? held.literals), ...theirs])]));
  }
  return other.ty.k === "list" && other.ty.of.k !== "undef" ? typedEmpty(comp, other.ty.of) : chosen;
}

function branches(s: Scope, n: N, t: Val): Val {
  const comp = s.comp;
  const p = presence(s, n.test);
  const name = p ? fresh("n", jsHint(p.path)) : "";
  const literals = p ? null : literalNarrowing(s, n.test);
  let a = expr(p && !p.negated ? narrowTo(s, p, name) : (literals?.yes ?? s), n.consequent);
  let b = expr(p && p.negated ? narrowTo(s, p, name) : (literals?.no ?? s), n.alternate);
  if (sameTy(a.ty, b.ty) && neverEmpty(a.ty) === neverEmpty(b.ty) && a.code === b.code && (!name || !occurrences(a.code, name))) return a;
  const placed = (v: Val): Val => (["struct", "child", "record"].includes(v.ty.k) && /^\w+(?:\.[\w#]+)+$/.test(v.code) ? { ...v, code: `&${v.code}` } : v);
  [a, b] = [placed(a), placed(b)];
  const [emptyA, emptyB] = [untypedEmpty(a), untypedEmpty(b)];
  if (emptyA && b.ty.k === "list") a = { ...a, ty: b.ty };
  if (emptyB && a.ty.k === "list") b = { ...b, ty: a.ty };
  const [x, y] = [a, b];
  const head = (): { test: string; yes: Val; no: Val } => {
    if (!p) return { test: condition(truthy(t)), yes: x, no: y };
    const [present, absent] = p.negated ? [y, x] : [x, y];
    return { test: occurrences(present.code, name) ? p.pattern(name) : condition(p.present), yes: present, no: absent };
  };
  return choiceOf({ comp, n, a, b, emptyA, emptyB, choose: chooser(t, p, name, a), head, lone: loneOf(a, b) });
}

function chooser(t: Val, p: Presence | null, name: string, a: Val): (yes: string, no: string) => string {
  const second = (code: string) => (a.ty.k === "str" ? strArg(code) : bare(code));
  return (yes: string, no: string): string => {
    if (!p) return choice(truthy(t), bare(yes), second(no));
    const [present, absent] = p.negated ? [bare(no), second(yes)] : [bare(yes), second(no)];
    if (present === `Some(${name})` && absent === "None") return p.option;
    if (present === name) return `${atom(p.option)}.unwrap_or(${absent})`;
    if (absent === "None" && present.startsWith("Some(") && enclosed(present.slice(4))) return `${atom(p.option)}.map(|${name}| ${bare(present.slice(5, -1))})`;
    if (occurrences(present, name)) return `if ${p.pattern(name)} { ${present} } else { ${absent} }`;
    return choice(p.present, present, absent);
  };
}

function choiceOf(c: Branches): Val {
  const { a, b, choose, lone } = c;
  const owned = a.owned || b.owned ? ownedBranches(c) : null;
  if (owned !== null) return owned;
  if (sameTy(a.ty, b.ty) && a.ty.k === "str" && (isTemporary(a) || isTemporary(b))) {
    const code = `&*(${choose(asCow(a), asCow(b))})`;
    const joins = (v: Val): boolean => piecesOf(v) !== undefined || v.branches?.of === v.code;
    return { code, ty: STR, ...lone, ...(joins(a) || joins(b) ? { branches: { of: code, ...c.head() } } : {}) };
  }
  if (sameTy(a.ty, b.ty) && a.ty.k === "list" && a.ty.of.k !== "undef") return listChoice(c);
  return scalarChoice(c);
}

function scalarChoice(c: Branches): Val {
  const { comp, n, a, b, choose } = c;
  if (a.ty.k === "int" && b.ty.k === "int" && (isCast(a) || isCast(b))) return intFromF64(choose(asF64(a), asF64(b)), a.at ?? b.at ?? refusalAt(comp, n));
  if (sameTy(a.ty, b.ty) && a.ty.k !== "opt") return sameChoice(c);
  if (isNumber(a.ty) && isNumber(b.ty)) return { code: choose(asF64(a), asF64(b)), ty: FLOAT };
  return optionalChoice(c);
}

function ownedBranches(c: Branches): Val | null {
  const { comp, n, a, b, choose, lone } = c;
  const owned = ownedChoice(comp, a, b, n);
  if (owned !== null) return { code: choose(owned.a, owned.b), ty: owned.ty, owned: true, ...lone };
  return null;
}

function listChoice(c: Branches): Val {
  const { a, b, emptyA, emptyB, choose, lone } = c;
  const owned = (v: Val, empty: boolean): boolean => !empty && (v.iter !== undefined || v.code.startsWith("["));
  if (owned(a, emptyA) || owned(b, emptyB)) {
    const both = `(${choose(emptyA ? "Vec::new()" : collected(a), emptyB ? "Vec::new()" : collected(b))})`;
    return { code: both, ty: joinTy(a.ty, b.ty), iter: `${both}.into_iter()`, ...lone };
  }
  return { code: choose(emptyA ? "&[]" : sliced(a), emptyB ? "&[]" : sliced(b)), ty: joinTy(a.ty, b.ty), slice: true, ...lone };
}

function sameChoice(c: Branches): Val {
  const { comp, a, b, choose, lone } = c;
  const code = choose(a.code, b.code);
  const both = a.ty.k === "str" && exactlyEnum(a) && exactlyEnum(b) ? [a, b] : null;
  const into = (def: EnumDef, node: N): string | null => {
    const [x, y] = both!.map((v) => intoEnum(comp, v, def, node));
    return x == null || y == null ? null : choose(x, y);
  };
  const over = (pick: (literal: string) => string | null): string | null => {
    const [x, y] = both!.map((v) => pickedBy(v, pick));
    return x == null || y == null ? null : choose(x, y);
  };
  return { code, ty: joinTy(a.ty, b.ty), ...lone, ...(both ? { asEnum: { of: code, into, over } } : {}) };
}

function optionalChoice(c: Branches): Val {
  const { comp, n, a, b } = c;
  const base = (ty: Ty): Ty | null => (ty.k === "opt" ? ty.of : nothing(ty) ? null : ty);
  const [baseA, baseB] = [base(a.ty), base(b.ty)];
  const of = baseA !== null && baseB !== null ? joinTy(baseA, baseB) : (baseA ?? baseB);
  if (of !== null && (baseA === null || baseB === null || sameTy(baseA, baseB))) return eitherAbsent(c, of);
  return fail(comp, "FV0623", "the two branches of `?:` differ in type", n);
}

function eitherAbsent(c: Branches, of: Ty): Val {
  const { comp, n, a, b, choose, lone } = c;
  const optStr = (v: Val) => nothing(v.ty) || (v.ty.k === "opt" && v.ty.of.k === "str") || v.ty.k === "str";
  const ty = withAbsence(of, joinAbsence(absence(a.ty), absence(b.ty)));
  if (optStr(a) && optStr(b) && (isTemporary(a) || isTemporary(b) || a.held !== undefined || b.held !== undefined)) {
    const held = (v: Val): string =>
      v.held ?? (nothing(v.ty) ? "None" : v.ty.k === "opt" ? `${atom(v.code)}.map(std::borrow::Cow::<str>::Borrowed)` : `Some(${asCow(v)})`);
    const both = atom(choose(held(a), held(b)));
    return { code: `${both}.as_deref()`, ty, held: both, ...lone };
  }
  if (sameTy(a.ty, b.ty)) return { code: choose(a.code, b.code), ty: joinTy(a.ty, b.ty), ...lone };
  const code = choose(coerce(comp, a, ty, n), coerce(comp, b, ty, n));
  const parts = of.k === "str" && [a, b].every((v) => nothing(v.ty) || exactlyEnum(v)) ? [a, b] : null;
  const into = (def: EnumDef, node: N): string | null => {
    const [x, y] = parts!.map((v) => (nothing(v.ty) ? "None" : intoEnum(comp, v, def, node)));
    const some = (made: string, v: Val): string => (made === "None" || v.ty.k === "opt" ? made : `Some(${bare(made)})`);
    return x == null || y == null ? null : choose(some(x, a), some(y, b));
  };
  return { code, ty, ...lone, ...(parts ? { asEnum: { of: code, into } } : {}) };
}

function pickedBy(v: Val, pick: (literal: string) => string | null): string | null {
  const literal = knownLiteral(v);
  if (literal !== undefined) return pick(literal);
  return v.asEnum?.of === v.code && v.asEnum.over !== undefined ? v.asEnum.over(pick) : null;
}

function ownedChoice(comp: Component, a: Val, b: Val, n: N): { a: string; b: string; ty: Ty } | null {
  const base = (ty: Ty): Ty | null => (ty.k === "opt" ? ty.of : nothing(ty) ? null : ty);
  const [ba, bb] = [base(a.ty), base(b.ty)];
  const of = ba !== null && bb !== null ? joinTy(ba, bb) : (ba ?? bb);
  if (of === null || (ba !== null && bb !== null && !sameTy(ba, bb))) return null;
  const ty = withAbsence(of, joinAbsence(absence(a.ty), absence(b.ty)));
  if (ty.k === "opt" && ty.of.k !== "struct") {
    return fail(comp, "FV0636", "`?:` between a list built from object literals and `undefined` or `null`, which the server does not hold as an optional list: type the value as the list, `Row[]`, with `[]` for none", n);
  }
  const empty = (v: Val): boolean => v.code === "[]" || untypedEmpty(v);
  const own = (v: Val): string => {
    if (nothing(v.ty)) return "None";
    if (ty.k === "opt") return v.ty.k === "opt" ? (v.owned ? v.code : `${atom(v.code)}.cloned()`) : `Some(${bare(ownedStruct(v))})`;
    if (ty.k === "struct") return ownedStruct(v);
    if (ty.k === "list" && ty.of.k === "struct") return empty(v) ? "Vec::new()" : ownedStructs(v);
    if (ty.k === "list") return v.owned ? v.code : empty(v) ? "Vec::new()" : v.iter !== undefined ? collected(v) : `${atom(v.code)}.to_vec()`;
    return v.code;
  };
  if (ty.k !== "opt" && ty.k !== "struct" && ty.k !== "list") return null;
  return { a: own(a), b: own(b), ty };
}
