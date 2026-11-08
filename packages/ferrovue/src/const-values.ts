import { type Component, type Field, type N, type Struct, type Ty, type Val, blankComponent, BOOL, FLOAT, INT, NULL, STR, UNDEF, withAbsence } from "./model.ts";
import { distinctFields, rustStr, snake } from "./rust-syntax.ts";
import { enumOf, joinTy, literalTy, sameTy, variantPath } from "./literal-types.ts";
import { fail } from "./locate.ts";
import { type Const, type Scalar } from "./const-decls.ts";
import { numberVal } from "./numbers.ts";
import { ONE_NOTHING, reachType } from "./typescript.ts";
import { ctx } from "./context.ts";
import { structLifetime } from "./rust.ts";

const TYPES_HOME = blankComponent("types", "types", "types");

const vals = new WeakMap<Const, Val>();

function scalarVal(js: Scalar, float = false): Val {
  if (js === null) return { code: "None", ty: NULL };
  if (typeof js === "string") return { code: rustStr(js), ty: literalTy("str", [js]) };
  if (typeof js === "boolean") return { code: String(js), ty: BOOL, konst: js };
  if (!float && Number.isSafeInteger(js)) return { ...numberVal(js, true), ty: literalTy("int", [js]) };
  return numberVal(js, !float && Number.isSafeInteger(js));
}

function scalarTy(js: Scalar): Ty {
  if (js === null) return NULL;
  return typeof js === "string" ? STR : typeof js === "boolean" ? BOOL : Number.isSafeInteger(js) ? INT : FLOAT;
}

/** What a constant is as a value in Rust; an object has none, only its fields. */
export function constVal(c: Const, at: { comp: Component; node: N; what: string }): Val {
  if (c.k === "scalar") return scalarVal(c.js);
  if (c.k === "object") return fail(at.comp, "FV0208", `\`${at.what}\` is an object, read one field at a time: \`${at.what}.${[...c.fields.keys()][0] ?? "x"}\``, at.node);
  if (c.k === "map") return fail(at.comp, "FV0227", `\`${at.what}\` is a constant \`Map\`, which the server reads with \`.get(key)\` and \`.has(key)\``, at.node);
  const done = vals.get(c);
  if (done) return done;
  const val = listVal(c);
  vals.set(c, val);
  return val;
}

function listVal(c: Const & { k: "list" }): Val {
  if (c.items.length === 0) return { code: "[]", ty: { k: "list", of: UNDEF } };
  if (c.items.every((i) => i.k === "scalar")) {
    const js = c.items.map((i) => (i as { js: Scalar }).js);
    if (js.includes(null)) fail(c.home, "FV0209", "a constant list of strings, numbers or booleans holds no `null`", c.node);
    const tys = js.map(scalarTy);
    const numbers = tys.every((t) => t.k === "int" || t.k === "float");
    const float = numbers && tys.some((t) => t.k === "float");
    if (!numbers && tys.some((t) => !sameTy(t, tys[0]!))) fail(c.home, "FV0210", "a constant list holds strings, numbers or booleans, all of one type", c.node);
    const values = js.map((v) => scalarVal(v, float));
    return { code: `[${values.map((v) => v.code).join(", ")}]`, ty: { k: "list", of: values.map((v) => v.ty).reduce((a: Ty, b: Ty) => joinTy(a, b)) } };
  }
  if (!c.items.every((i) => i.k === "object")) fail(c.home, "FV0211", "a constant list holds plain values of one kind, or objects", c.node);
  const objects = c.items as (Const & { k: "object" })[];
  if (c.typed !== null) reachType(c.typed);
  const st = c.typed !== null ? ctx.typeStructs.get(c.typed)! : itemStruct(c, objects);
  const name = rustConstName(c.path);
  const owner = ctx.typeConsts.get(name);
  if (owner && owner.of !== c) fail(c.home, "FV0212", `a constant list called \`${name}\` in Rust comes from ${owner.file} too; rename one`, c.node);
  const life = structLifetime(st, blankComponent("types", "types", "types", ctx.typeStructs)) ? "<'static>" : "";
  const rows = objects.map((o, i) => {
    for (const key of o.fields.keys()) if (!st.fields.some((f) => f.js === key) && !st.refused?.has(key)) fail(c.home, "FV0204", `\`${st.name}\` has no field \`${key}\``, o.node);
    const inits = st.fields.map((f) => `${f.rust}: ${fieldLiteral(c, f, o.fields.get(f.js), objects[i]!.node)}`);
    return `    ${st.name} { ${inits.join(", ")} },`;
  });
  ctx.typeConsts.set(name, { of: c, file: c.home.file, text: `/// \`${c.path.replaceAll("_", ".")}\` in \`${c.home.file}\`.\npub const ${name}: &[${st.name}${life}] = &[\n${rows.join("\n")}\n];\n` });
  return { code: `super::types::${name}`, ty: { k: "list", of: { k: "struct", name: st.name, home: "types" } } };
}

function fieldLiteral(c: Const & { k: "list" }, f: Field, v: Const | undefined, node: N): string {
  const want = f.ty.k === "opt" ? f.ty.of : f.ty;
  const none = f.ty.k === "opt" ? (f.ty.none ?? "undefined") : null;
  if (v === undefined) return none === "undefined" || none === "either" ? "None" : fail(c.home, "FV0213", `this object needs \`${f.js}\``, node);
  if (v.k === "scalar" && v.js === null) return none === "null" || none === "either" ? "None" : fail(c.home, "FV0214", `\`${f.js}\` in a constant list's object is not \`null\``, node);
  const plain = v.k === "scalar" && (scalarTy(v.js).k === want.k || (want.k === "float" && typeof v.js === "number"));
  if (!plain || v.k !== "scalar") return fail(c.home, "FV0215", `\`${f.js}\` in a constant list's object is ${describe(want)}`, node);
  const def = enumOf(want);
  if (def !== undefined && !def.literals.includes(v.js as string)) {
    return fail(c.home, "FV0215", `\`${f.js}\` in a constant list's object is one of ${def.literals.map((l) => JSON.stringify(l)).join(" | ")}, and ${JSON.stringify(v.js)} is not`, node);
  }
  const code = def !== undefined ? variantPath(TYPES_HOME, def, v.js as string) : typeof v.js === "string" ? `Cow::Borrowed(${rustStr(v.js)})` : typeof v.js === "number" ? numberVal(v.js, want.k === "int").code.replace(/i64$/, "") : String(v.js);
  return f.ty.k === "opt" ? `Some(${code})` : code;
}

function describe(t: Ty): string {
  return t.k === "str" ? "a string" : t.k === "bool" ? "a boolean" : t.k === "int" || t.k === "float" ? "a number" : "a string, a number or a boolean";
}

function itemStruct(c: Const & { k: "list" }, objects: (Const & { k: "object" })[]): Struct {
  const name = `${pascal(c.path)}Item`;
  const keys = [...new Set(objects.flatMap((o) => [...o.fields.keys()]))];
  const fields: Field[] = distinctFields(keys.map((key): Field => {
    const values = objects.map((o) => o.fields.get(key));
    const present = values.filter((v): v is Const => v !== undefined);
    if (present.some((v) => v.k !== "scalar")) fail(c.home, "FV0216", `\`${key}\` in a constant list's objects is a string, a number or a boolean`, c.node);
    const nulls = present.filter((v) => (v as { js: Scalar }).js === null).length;
    const tys = present.filter((v) => (v as { js: Scalar }).js !== null).map((v) => scalarTy((v as { js: Scalar }).js));
    if (!tys.length) fail(c.home, "FV0217", `\`${key}\` in a constant list's objects is only ever \`null\`: declare the list with an interface that gives its type`, c.node);
    if (nulls && present.length < values.length) fail(c.home, "FV0218", `\`${key}\` in a constant list's objects is \`null\` in some and absent in others: ${ONE_NOTHING}; write \`null\` in each`, c.node);
    const numbers = tys.every((t) => t.k === "int" || t.k === "float");
    const ty = numbers && tys.some((t) => t.k === "float") ? FLOAT : tys[0]!;
    if (!numbers && tys.some((t) => !sameTy(t, ty))) fail(c.home, "FV0219", `\`${key}\` in a constant list's objects holds values of different types`, c.node);
    return { js: key, rust: snake(key), ty: withAbsence(ty, nulls ? "null" : present.length < values.length ? "undefined" : null) };
  }));
  const existing = ctx.typeStructs.get(name);
  if (existing && ctx.typeFiles.get(name) !== c.home.file) fail(c.home, "FV0220", `\`${name}\`, the type of this list's objects, is declared by ${ctx.typeFiles.get(name)} too`, c.node);
  const st: Struct = { name, fields };
  ctx.typeStructs.set(name, st);
  ctx.typeFiles.set(name, c.home.file);
  return st;
}

function pascal(path: string): string {
  return path
    .split(/_|(?=[A-Z][a-z])/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function rustConstName(path: string): string {
  return path
    .split("_")
    .map((w) => (/^[A-Z0-9]+$/.test(w) ? w : snake(w).replace(/^r#/, "").toUpperCase()))
    .join("_");
}
