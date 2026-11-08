import { type Component, type N, type Ty, type Val, fail, isTuple, STR, UNDEF } from "./model.ts";
import { atom } from "./parens.ts";
import { lookupStruct } from "./typescript.ts";
import { fieldVal } from "./expr.ts";

/** Part `i` of a `[key, value]` pair of `Object.entries()`: the key, the value, or `undefined`. */
export function entryPart(v: Val, i: number): Val {
  if (v.ty.k !== "entry") throw new Error("a pair's part read from a value that is not a pair");
  const lone = v.lone ? { lone: true as const } : {};
  if (i === 0) return { code: `${atom(v.code)}.0`, ty: STR, ...lone };
  if (i !== 1) return { code: "None", ty: UNDEF };
  const of = v.ty.of;
  const place = `${atom(v.code)}.1`;
  if (of.k === "str") return { code: `&**${place}`, ty: of, ...lone };
  if (of.k === "int" || of.k === "float" || of.k === "bool") return { code: `*${place}`, ty: of };
  if (of.k === "date") return { code: `fv::date::js_time_of(${place})`, ty: of };
  return { code: place, ty: of, ...lone };
}

/** How many parts the tuple of type `ty` has, or null when `ty` is no tuple's struct. */
export function tupleParts(comp: Component, ty: Ty): number | null {
  if (ty.k !== "struct") return null;
  const { st } = lookupStruct(comp, ty);
  return st !== undefined && isTuple(st) ? st.fields.length : null;
}

/** Binds the names of `pattern`, an array pattern of a tuple, to its parts. */
export function bindTuple(comp: Component, pattern: N, v: Val, locals: Map<string, Val>, bound: string[], code: "FV0808" | "FV0818" | "FV0821"): void {
  const parts = tupleParts(comp, v.ty)!;
  const refuse = (at: N) => fail(comp, code, `a tuple of ${parts} is destructured to plain names, without defaults or a rest element: \`[${Array.from({ length: parts }, (_, i) => `p${i}`).join(", ")}]\`, or with holes`, at);
  if (pattern.elements.length > parts) refuse(pattern);
  pattern.elements.forEach((x: N, i: number) => {
    if (!x) return;
    if (x.type !== "Identifier") refuse(x);
    locals.set(x.name, fieldVal(comp, v.code, v.ty, String(i), x));
    bound.push(x.name);
  });
}

/** Binds the names of `pattern`, an array pattern of a `[key, value]` pair, to its parts. */
export function bindEntry(comp: Component, pattern: N, v: Val, locals: Map<string, Val>, bound: string[], code: "FV0808" | "FV0818"): void {
  const refuse = (at: N) => fail(comp, code, "a `[key, value]` pair is destructured to plain names, and an object value to an object pattern of plain names, without defaults or a rest element: `[key, value]`, `[key]`, `[, value]` or `[key, { id, name }]`", at);
  if (pattern.elements.length > 2) refuse(pattern);
  pattern.elements.forEach((x: N, i: number) => {
    if (!x) return;
    const part = entryPart(v, i);
    if (x.type === "Identifier") {
      locals.set(x.name, part);
      bound.push(x.name);
      return;
    }
    if (x.type !== "ObjectPattern" || i !== 1 || (part.ty.k !== "struct" && part.ty.k !== "child")) refuse(x);
    for (const prop of x.properties) {
      if (prop.type !== "ObjectProperty" || prop.computed || prop.value.type !== "Identifier") refuse(prop);
      locals.set(prop.value.name, fieldVal(comp, part.code, part.ty, prop.key.name ?? prop.key.value, prop));
      bound.push(prop.value.name);
    }
  });
}
