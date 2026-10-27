import { type Component, type N, type Scope, type StructTy, type Ty, type Val, enumItems, enumOf, fail, literalsOf, nothing, sameTy } from "./model.ts";
import { GenError } from "./errors.ts";
import { intoEnum, knownLiteral, refuseUnproven } from "./enums.ts";
import { describeTy, expr, holdsNothing, typedBy } from "./expr.ts";
import { lookupStruct, markHome } from "./typescript.ts";
import { fieldInit, ownInto } from "./children.ts";
import { items } from "./lists.ts";
import { asCow, isTemporary, loneOf } from "./strings.ts";
import { atom, bare, receiver } from "./parens.ts";

const COW = "std::borrow::Cow::<str>";

const LOCAL = /\bfv_(?!a\d|i\d)[a-z]+\d+\b/;

/** A type as a syntax node, for `typedBy` to give a value whose type is known only as a `Ty`. */
export function tyNode(ty: Ty): N {
  return { type: "FvTy", ty };
}

/** Refuse an object literal no type reaches, saying where it is and how to give it one. */
export function untypedObject(s: Scope, n: N): never {
  const fix = s.mapping
    ? "type the callback's return, `.map((x): Row => ({ … }))`, or the list it makes, as `computed<Row[]>(…)` or a prop typed `Row[]`"
    : s.within === "computed"
      ? "annotate the `computed`, as `computed<Card>(() => …)` or `computed((): Card => …)`"
      : s.within === "function"
        ? "give the function a return type, `function card(): Card`"
        : s.within === "setup"
          ? "annotate the `const`, `const card: Card = { … }`"
          : "pass it to a prop typed with an interface, or build it in a `computed` typed with one";
  const where = s.mapping ? "a `.map()` callback" : s.within === "computed" ? "a `computed`" : s.within === "function" ? "a function" : s.within === "setup" ? "setup" : "the template";
  return fail(s.comp, "FV0634", `an object literal in ${where} whose type is not known, which the server builds as the Rust struct of an interface: ${fix}`, n);
}

/** Refuse a value built from object literals where the server would have to borrow from it after the expression that builds it. */
export function refuseInPlace(comp: Component, what: string, n: N): never {
  return fail(comp, "FV0636", `${what} of a value built from object literals in place, which the server holds only while the expression that builds it runs: give it a \`computed\` of its own and read that`, n);
}

function keyOf(s: Scope, p: N): string {
  const k = p.key;
  if (!p.computed) return k.type === "Identifier" ? k.name : String(k.value);
  if (k.type === "StringLiteral" || k.type === "NumericLiteral") return String(k.value);
  if (k.type === "TemplateLiteral" && k.expressions.length === 0) return k.quasis[0].value.cooked as string;
  const v = expr(s, k);
  const known = literalsOf(v.ty);
  if (v.ty.k === "str" && known?.length === 1) return String(known[0]);
  if ((v.ty.k === "int" || v.ty.k === "float") && v.num !== undefined) return String(v.num);
  return fail(s.comp, "FV0635", "an object literal's computed key is a string or a number the compiler knows, as a constant or an enum member", k);
}

function str(v: Val): string {
  if (isTemporary(v)) return asCow(v);
  return LOCAL.test(v.code) ? `${COW}::Owned(str::to_owned(${bare(v.code)}))` : `${COW}::Borrowed(${bare(v.code)})`;
}

function literalStrings(s: Scope, n: N): string[] | null {
  let inner = n;
  while (inner.type === "ParenthesizedExpression") inner = inner.expression;
  if (inner.type !== "ArrayExpression" || inner.elements.length === 0 || inner.elements.some((el: N) => !el || el.type === "SpreadElement")) return null;
  return inner.elements.map((el: N) => str(expr(s, el)));
}

/** `v` as an owned struct of its type. */
export function ownedStruct(v: Val): string {
  return v.owned ? v.code : `${receiver(v.code)}.clone()`;
}

/** `v` as an owned list of structs. */
export function ownedStructs(v: Val): string {
  if (v.owned) return v.code;
  if (v.ty.k === "list" && v.ty.of.k === "undef") return "Vec::new()";
  return `${items(v)}.cloned().collect::<Vec<_>>()`;
}

/** `v` held as a value of type `want`, owning what it would otherwise borrow from a local. */
export function owning(comp: Component, v: Val, want: Ty, node: N): string {
  if (enumItems(want) !== undefined) return ownInto(comp, v, want, node);
  if (v.owned) {
    if (sameTy(v.ty, want)) return v.code;
    if (want.k === "opt" && sameTy(v.ty, want.of)) return `Some(${bare(v.code)})`;
  }
  if (want.k === "list" && v.slice && /^<&\[.*\]>::default\(\)$/.test(v.code)) return "Vec::new()";
  if (want.k === "opt" && want.of.k === "bool" && sameTy(v.ty, want)) return v.code;
  if (want.k === "str" && v.ty.k === "str") return str(v);
  if (want.k === "opt" && want.of.k === "str") {
    if (nothing(v.ty)) return "None";
    if (v.ty.k === "str") return `Some(${str(v)})`;
    if (v.ty.k === "opt" && v.ty.of.k === "str") {
      if (v.held !== undefined) return v.held;
      return LOCAL.test(v.code) ? `${atom(v.code)}.map(|v| ${COW}::Owned(v.to_owned()))` : `${atom(v.code)}.map(${COW}::Borrowed)`;
    }
  }
  if (want.k === "list" && want.of.k === "str" && v.ty.k === "list" && v.ty.of.k === "str" && (LOCAL.test(v.iter ?? v.code) || v.iter !== undefined)) {
    return `${items(v)}.map(|v| ${COW}::Owned(v.into_owned())).collect()`;
  }
  return ownInto(comp, v, want, node);
}

function fieldOwned(comp: Component, v: Val, want: Ty, node: N, what: string): string {
  const def = enumOf(want);
  if (def !== undefined) {
    if (want.k === "opt" && nothing(v.ty)) return "None";
    const into = (v.ty.k === "opt" ? v.ty.of : v.ty).k === "str" && (v.ty.k !== "opt" || want.k === "opt") ? intoEnum(comp, v, def, node) : null;
    if (into === null) {
      refuseUnproven(v);
      const literal = knownLiteral(v);
      const inner = v.ty.k === "opt" ? v.ty.of : v.ty;
      const among = inner.k === "str" ? literalsOf(inner) : undefined;
      const given = literal !== undefined ? JSON.stringify(literal) : among !== undefined ? `one of ${among.map((l) => JSON.stringify(l)).join(" | ")}` : inner.k === "str" ? `${describeTy(v.ty)} that may be any other` : describeTy(v.ty);
      return fail(comp, "FV0635", `${what} is one of ${def.literals.map((l) => JSON.stringify(l)).join(" | ")}, the members of \`${def.name}\`, and the value given is ${given}: give one of them, or a value typed as the union`, node);
    }
    return want.k === "opt" && v.ty.k !== "opt" ? `Some(${bare(into)})` : into;
  }
  try {
    return owning(comp, v, want, node);
  } catch (e) {
    if (!(e instanceof GenError) || !["FV0509", "FV0510", "FV0511"].includes(e.code)) throw e;
    return fail(comp, "FV0635", `${what} is ${describeTy(want)}, and the value given is ${describeTy(v.ty)}`, node);
  }
}

/** An object literal built as the Rust struct `want` names: each key a field of it, in the order
 * JavaScript evaluates them, the optional fields it leaves out absent. */
export function objectLiteral(s: Scope, n: N, want: StructTy): Val {
  const comp = s.comp;
  const { st, owner, path } = lookupStruct(comp, want);
  if (!st) return fail(comp, "FV0634", `an object literal of type \`${want.name}\`, which the server has no struct for`, n);
  const named = `\`${want.name}\``;
  const inits: string[] = [];
  const given = new Set<string>();
  const values: Val[] = [];
  let spread: Val | null = null;
  n.properties.forEach((p: N, i: number) => {
    if (p.type === "SpreadElement") {
      if (i !== 0) fail(comp, "FV0635", `a spread \`...\` after other keys of an object literal of type ${named}, which it would write over, or not, as the object it spreads holds them: put the spread first`, p);
      const v = expr(s, p.argument);
      if (v.ty.k !== "struct" || !sameTy(markHome(v.ty, comp.name), markHome(want, comp.name))) {
        fail(comp, "FV0635", `\`...\` of ${describeTy(v.ty)} in an object literal of type ${named}: a spread copies an object of the same type, which is present`, p);
      }
      spread = v;
      values.push(v);
      return;
    }
    if (p.type !== "ObjectProperty") fail(comp, "FV0635", `a method or an accessor in an object literal of type ${named}, which holds plain keys and values`, p);
    const key = keyOf(s, p);
    if (key === "__proto__") fail(comp, "FV0635", "`__proto__` in an object literal, which sets the object's prototype or makes a key that no interface field names: write the fields out", p);
    if (given.has(key)) fail(comp, "FV0635", `\`${key}\` given twice in an object literal of type ${named}`, p);
    given.add(key);
    const field = st.fields.find((f) => f.js === key);
    if (!field) {
      const refused = st.refused?.get(key);
      if (refused !== undefined) throw refused;
      fail(comp, "FV0635", `\`${key}\` is not a field of ${named}, which an object literal of that type holds only the fields of`, p);
    }
    const ty = owner === comp ? field.ty : markHome(field.ty, owner.name);
    const v = expr(s, typedBy(p.value, tyNode(ty)));
    values.push(v);
    const strings = ty.k === "list" && ty.of.k === "str" && enumItems(ty) === undefined && v.ty.k === "list" && v.ty.of.k === "str" ? literalStrings(s, p.value) : null;
    if (strings !== null) {
      inits.push(`${field.rust}: Vec::from([${strings.join(", ")}])`);
      return;
    }
    holdsNothing(comp, v, ty, p.value, `\`${key}\` of ${named}`);
    inits.push(fieldInit(field.rust, fieldOwned(comp, v, ty, p.value, `\`${key}\` of ${named}`)));
  });
  for (const f of st.fields) {
    if (given.has(f.js) || spread !== null) continue;
    if (f.ty.k !== "opt" || f.ty.none !== undefined) fail(comp, "FV0635", `an object literal of type ${named} leaves out \`${f.js}\`, which ${named} requires`, n);
    inits.push(`${f.rust}: None`);
  }
  const rest = spread === null ? "" : `${inits.length ? ", " : ""}..${ownedStruct(spread)}`;
  const body = inits.length || rest ? ` ${inits.join(", ")}${rest} ` : "";
  return { code: `${path}${want.name} {${body}}`, ty: want, owned: true, ...loneOf(...values) };
}

/** An array literal built as the tuple struct `want` names: an item for each part, in order. */
export function tupleValue(s: Scope, n: N, want: StructTy): Val {
  const comp = s.comp;
  const { st, owner, path } = lookupStruct(comp, want);
  const named = `\`${want.name}\``;
  const loose = n.elements.findIndex((el: N) => !el || el.type === "SpreadElement");
  if (loose >= 0) fail(comp, "FV0635", `an array literal of the tuple ${named} holds each part by itself, without a spread or a hole`, n.elements[loose] ?? n);
  if (n.elements.length !== st!.fields.length) {
    fail(comp, "FV0635", `an array literal of the tuple ${named} holds its ${st!.fields.length} parts, and this one holds ${n.elements.length}`, n);
  }
  const values: Val[] = [];
  const parts = st!.fields.map((field, i) => {
    const el: N = n.elements[i];
    const ty = owner === comp ? field.ty : markHome(field.ty, owner.name);
    const v = expr(s, typedBy(el, tyNode(ty)));
    values.push(v);
    holdsNothing(comp, v, ty, el, `part ${i} of ${named}`);
    return bare(fieldOwned(comp, v, ty, el, `part ${i} of ${named}`));
  });
  return { code: `${path}${want.name}(${parts.join(", ")})`, ty: want, owned: true, ...loneOf(...values) };
}

/** An array literal of objects built as a list of the struct `of` names. */
export function structList(s: Scope, n: N, of: StructTy): Val {
  const values = n.elements.map((el: N) => {
    if (!el || el.type === "SpreadElement") return fail(s.comp, "FV0635", `an array literal of \`${of.name}\` objects holds each item by itself, without a spread or a hole`, el ?? n);
    const v = expr(s, typedBy(el, tyNode(of)));
    if (v.ty.k !== "struct" || !sameTy(markHome(v.ty, s.comp.name), markHome(of, s.comp.name))) {
      fail(s.comp, "FV0635", `an array literal of \`${of.name}\` objects holds ${describeTy(v.ty)}`, el);
    }
    return v;
  });
  return { code: `Vec::from([${values.map(ownedStruct).join(", ")}])`, ty: { k: "list", of }, owned: true, ...loneOf(...values) };
}
