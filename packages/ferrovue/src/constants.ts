import { type Component, type Field, type N, type Scope, type Struct, type Ty, type Val, blankComponent, BOOL, fail, FLOAT, INT, NULL, RUST_PRELUDE, rustStr, sameTy, snake, STR, UNDEF, withAbsence } from "./model.ts";
import { ONE_NOTHING } from "./typescript.ts";
import { ctx } from "./context.ts";
import { numberVal } from "./numbers.ts";
import { structLifetime } from "./rust.ts";

export type Const =
  | { k: "scalar"; js: Scalar }
  | { k: "list"; items: Const[]; node: N; home: Component; path: string; typed: string | null }
  | { k: "object"; fields: Map<string, Const>; node: N; home: Component; name: string };

type Scalar = string | number | boolean | null;

export interface Declared {
  node: N;
  home: Component;
  exported: boolean;
}

const files = new WeakMap<Component, Map<string, Declared>>();
const vals = new WeakMap<Const, Val>();
const evaluated = new WeakMap<N, Const>();
const inProgress = new WeakSet<N>();

/** Remember the constants and enums a file declares at its top level, to evaluate when one is used. */
export function declareConsts(home: Component, body: N[]): Map<string, Declared> {
  const found = new Map<string, Declared>();
  for (const st of body) {
    const exported = st.type === "ExportNamedDeclaration";
    const d = exported ? st.declaration : st;
    if (d?.type === "TSEnumDeclaration") found.set(d.id.name, { node: d, home, exported });
    if (d?.type === "VariableDeclaration" && d.kind === "const") {
      for (const v of d.declarations) if (v.id.type === "Identifier" && v.init) found.set(v.id.name, { node: v, home, exported });
    }
  }
  files.set(home, found);
  return found;
}

/** What a declared constant or enum stands for, evaluated once. */
export function constOfDecl(d: Declared): Const {
  const done = evaluated.get(d.node);
  if (done) return done;
  if (inProgress.has(d.node)) fail(d.home, "FV0201", "a constant that refers to itself", d.node);
  inProgress.add(d.node);
  try {
    const c = d.node.type === "TSEnumDeclaration" ? enumConst(d.home, d.node) : evaluate(d.home, d.node.init, d.node.id.name, typedAs(d.node));
    evaluated.set(d.node, c);
    return c;
  } finally {
    inProgress.delete(d.node);
  }
}

function typedAs(decl: N): string | null {
  const names: N[] = [decl.id.typeAnnotation?.typeAnnotation];
  for (let n = decl.init; n?.type === "TSAsExpression" || n?.type === "TSSatisfiesExpression"; n = n.expression) names.push(n.typeAnnotation);
  for (let t of names) {
    if (t?.type === "TSTypeOperator") t = t.typeAnnotation;
    const item = t?.type === "TSArrayType" ? t.elementType : t?.type === "TSTypeReference" && ["Array", "ReadonlyArray"].includes(t.typeName.name) ? t.typeParameters?.params?.[0] : null;
    if (item?.type === "TSTypeReference" && item.typeName.type === "Identifier" && ctx.typeStructs.has(item.typeName.name)) return item.typeName.name;
  }
  return null;
}

function enumConst(home: Component, d: N): Const {
  const fields = new Map<string, Const>();
  let next: number | null = 0;
  for (const m of d.members) {
    const key: string = m.id.type === "Identifier" ? m.id.name : m.id.value;
    let value: string | number;
    if (!m.initializer) {
      if (next === null) fail(home, "FV0202", `enum member \`${key}\` follows a string member, so it needs a value`, m);
      value = next;
    } else {
      const c = evaluate(home, m.initializer, key, null);
      if (c.k !== "scalar" || typeof c.js === "boolean" || c.js === null) return fail(home, "FV0203", "an enum member's value is a string or a number literal", m.initializer);
      value = c.js;
    }
    fields.set(key, { k: "scalar", js: value });
    if (typeof value === "number") fields.set(String(value), { k: "scalar", js: key });
    next = typeof value === "number" ? value + 1 : null;
  }
  return { k: "object", fields, node: d, home, name: d.id.name };
}

/** The type an enum stands for: the union of its members' literal types. */
export function enumType(home: Component, d: N): N {
  const c = enumConst(home, d);
  const members = c.k === "object" ? d.members.map((m: N) => c.fields.get(m.id.type === "Identifier" ? m.id.name : m.id.value)) : [];
  const literal = (js: unknown): N =>
    typeof js === "string" ? { type: "StringLiteral", value: js } : { type: "NumericLiteral", value: js };
  return { type: "TSUnionType", types: members.map((m: N) => ({ type: "TSLiteralType", literal: literal(m.js), loc: d.loc, __fv: d.__fv })), loc: d.loc, __fv: d.__fv };
}

function evaluate(home: Component, n: N, path: string, typed: string | null): Const {
  switch (n.type) {
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ParenthesizedExpression":
      return evaluate(home, n.expression, path, typed);
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return { k: "scalar", js: n.value };
    case "NullLiteral":
      return { k: "scalar", js: null };
    case "TemplateLiteral":
      if (n.expressions.length === 0) return { k: "scalar", js: n.quasis[0].value.cooked };
      break;
    case "UnaryExpression":
      if (n.operator === "-" && n.argument.type === "NumericLiteral") return { k: "scalar", js: -n.argument.value };
      break;
    case "Identifier": {
      const d = files.get(home)?.get(n.name);
      if (d) return constOfDecl(d);
      break;
    }
    case "MemberExpression": {
      const key = n.computed ? (n.property.type === "StringLiteral" || n.property.type === "NumericLiteral" ? String(n.property.value) : null) : n.property.name;
      const base = evaluate(home, n.object, path, null);
      if (base.k === "object" && key !== null) {
        const f = base.fields.get(key);
        if (f) return f;
        return fail(home, "FV0204", `\`${base.name}\` has no field \`${key}\``, n.property);
      }
      break;
    }
    case "ArrayExpression":
      return {
        k: "list",
        items: n.elements.map((el: N) => (el && el.type !== "SpreadElement" ? evaluate(home, el, path, null) : fail(home, "FV0205", "a constant list holds plain values", n))),
        node: n,
        home,
        path,
        typed,
      };
    case "ObjectExpression": {
      const fields = new Map<string, Const>();
      for (const p of n.properties) {
        if (p.type !== "ObjectProperty" || p.computed) fail(home, "FV0206", "a constant object holds plain keys and values", p);
        const key = String(p.key.name ?? p.key.value);
        fields.set(key, evaluate(home, p.value, `${path}_${key}`, null));
      }
      return { k: "object", fields, node: n, home, name: path };
    }
  }
  return fail(home, "FV0207", "a constant the compiler evaluates is a literal, a list or an object of literals, or another such constant of the same file", n);
}

function scalarVal(js: Scalar, float = false): Val {
  if (js === null) return { code: "None", ty: NULL };
  if (typeof js === "string") return { code: rustStr(js), ty: STR };
  if (typeof js === "boolean") return { code: String(js), ty: BOOL, konst: js };
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
    return { code: `[${values.map((v) => v.code).join(", ")}]`, ty: { k: "list", of: values[0]!.ty } };
  }
  if (!c.items.every((i) => i.k === "object")) fail(c.home, "FV0211", "a constant list holds plain values of one kind, or objects", c.node);
  const objects = c.items as (Const & { k: "object" })[];
  const st = c.typed !== null ? ctx.typeStructs.get(c.typed)! : itemStruct(c, objects);
  const name = rustConstName(c.path);
  const owner = ctx.typeConsts.get(name);
  if (owner && owner.of !== c) fail(c.home, "FV0212", `a constant list called \`${name}\` in Rust comes from ${owner.file} too; rename one`, c.node);
  const life = structLifetime(st, blankComponent("types", "types", "types", ctx.typeStructs)) ? "<'static>" : "";
  const rows = objects.map((o, i) => {
    for (const key of o.fields.keys()) if (!st.fields.some((f) => f.js === key)) fail(c.home, "FV0204", `\`${st.name}\` has no field \`${key}\``, o.node);
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
  const code = typeof v.js === "string" ? `Cow::Borrowed(${rustStr(v.js)})` : typeof v.js === "number" ? numberVal(v.js, want.k === "int").code.replace(/i64$/, "") : String(v.js);
  return f.ty.k === "opt" ? `Some(${code})` : code;
}

function describe(t: Ty): string {
  return t.k === "str" ? "a string" : t.k === "bool" ? "a boolean" : t.k === "int" || t.k === "float" ? "a number" : "a string, a number or a boolean";
}

function itemStruct(c: Const & { k: "list" }, objects: (Const & { k: "object" })[]): Struct {
  const name = `${pascal(c.path)}Item`;
  const keys = [...new Set(objects.flatMap((o) => [...o.fields.keys()]))];
  const fields: Field[] = keys.map((key) => {
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
  });
  const existing = ctx.typeStructs.get(name);
  if (existing && ctx.typeFiles.get(name) !== c.home.file) fail(c.home, "FV0220", `\`${name}\`, the type of this list's objects, is declared by ${ctx.typeFiles.get(name)} too`, c.node);
  if (RUST_PRELUDE.has(name)) fail(c.home, "FV0221", `\`${name}\`, the type of this list's objects, would hide Rust's own; rename the constant`, c.node);
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

/** The constant an expression names: an imported or enum binding, or a field of one. */
export function constOf(s: Scope, n: N): { c: Const; what: string } | null {
  if (n.type === "Identifier") {
    const c = !s.locals.has(n.name) && !s.setup.has(n.name) ? s.consts.get(n.name) : undefined;
    return c ? { c, what: n.name } : null;
  }
  if (n.type !== "MemberExpression") return null;
  if (n.object.type === "Identifier" && (n.object.name === "$setup" || n.object.name === "_ctx")) {
    const name: string | undefined = n.computed ? (n.property.type === "StringLiteral" ? n.property.value : undefined) : n.property.name;
    const c = name !== undefined ? s.consts.get(name) : undefined;
    return c && name !== undefined ? { c, what: name } : null;
  }
  const base = constOf(s, n.object);
  if (base?.c.k !== "object") return null;
  const key = n.computed ? (n.property.type === "StringLiteral" || n.property.type === "NumericLiteral" ? String(n.property.value) : null) : (n.property.name as string);
  if (key === null) {
    return fail(s.comp, "FV0222", `\`${base.what}\` read by a key chosen at run time, which may name none of its fields; write the choices out with \`v-if\`, or pass the value as a prop`, n);
  }
  const f = base.c.fields.get(key);
  if (!f) return fail(s.comp, "FV0204", `\`${base.what}\` has no field \`${key}\``, n);
  return { c: f, what: `${base.what}.${key}` };
}
