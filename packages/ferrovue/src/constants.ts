import { type Absence, type Component, type EnumDef, type Field, type N, type Scope, type Struct, type Ty, type Val, absence, blankComponent, BOOL, distinctFields, enumOf, enumTy, fail, GenError, FLOAT, INT, joinAbsence, joinTy, literalsOf, literalTy, nothing, NULL, rustStr, sameTy, snake, STR, UNDEF, variantPath, withAbsence } from "./model.ts";
import { aliasEnum, knownLiteral, matchOver } from "./enums.ts";

const TYPES_HOME = blankComponent("types", "types", "types");
import { ONE_NOTHING, reachType, tyOfTs } from "./typescript.ts";
import { ctx } from "./context.ts";
import { asF64, exactPower, numberVal } from "./numbers.ts";
import { describeTy, expr } from "./expr.ts";
import { pathOf } from "./narrowing.ts";
import { atom, bare } from "./parens.ts";
import { structLifetime } from "./rust.ts";

export type Const =
  | { k: "scalar"; js: Scalar }
  | { k: "list"; items: Const[]; node: N; home: Component; path: string; typed: string | null }
  | { k: "object"; fields: Map<string, Const>; node: N; home: Component; name: string }
  | { k: "map"; entries: Map<string | number, Const>; node: N; home: Component };

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
    if (c.k === "object" && d.node.type !== "TSEnumDeclaration") typeValues(d.home, d.node, c);
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

function valueType(t: N): N | null {
  if (t?.type === "TSTypeOperator") return valueType(t.typeAnnotation);
  if (t?.type === "TSMappedType") return t.typeAnnotation ?? null;
  if (t?.type !== "TSTypeReference" || t.typeName.type !== "Identifier") return null;
  const params: N[] = t.typeParameters?.params ?? [];
  if (["Readonly", "Partial", "Required"].includes(t.typeName.name) && params.length === 1) return valueType(params[0]);
  return t.typeName.name === "Record" && params.length === 2 ? params[1] : null;
}

function typeValues(home: Component, decl: N, c: Const & { k: "object" }): void {
  const names: N[] = [decl.id.typeAnnotation?.typeAnnotation];
  for (let n = decl.init; n?.type === "TSAsExpression" || n?.type === "TSSatisfiesExpression"; n = n.expression) names.push(n.typeAnnotation);
  const value = names.map(valueType).find((t) => t !== null);
  if (!value) return;
  let def: EnumDef | undefined;
  try {
    def = aliasEnum(tyOfTs(home, value, home.structs));
  } catch (e) {
    if (e instanceof GenError) return;
    throw e;
  }
  if (def === undefined) return;
  for (const [key, f] of c.fields) {
    if (f.k !== "scalar" || typeof f.js !== "string") continue;
    if (!def.literals.includes(f.js)) {
      let init = decl.init;
      while (init?.type === "TSAsExpression" || init?.type === "TSSatisfiesExpression") init = init.expression;
      const at = init?.type === "ObjectExpression" ? init.properties.find((p: N) => p.type === "ObjectProperty" && !p.computed && (p.key.name ?? String(p.key.value)) === key) : undefined;
      fail(home, "FV0228", `\`${key}\` of \`${decl.id.name}\` is one of ${def.literals.map((l) => JSON.stringify(l)).join(" | ")}, the members of \`${def.name}\` its type gives its values, and ${JSON.stringify(f.js)} is not: give it one of them`, at?.value ?? decl);
    }
    VALUE_ENUMS.set(f, def);
  }
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
      return { k: "scalar", js: n.quasis.map((q: N, i: number) => `${q.value.cooked as string}${i < n.expressions.length ? String(scalarOf(home, n.expressions[i], path)) : ""}`).join("") };
    case "UnaryExpression":
      if (n.operator === "-" || n.operator === "+") {
        const v = scalarOf(home, n.argument, path);
        if (typeof v === "number") return { k: "scalar", js: n.operator === "-" ? -v : v };
        return fail(home, "FV0207", `unary \`${n.operator}\` in a constant takes a number`, n);
      }
      break;
    case "BinaryExpression":
      if (["+", "-", "*", "/", "%", "**"].includes(n.operator)) return { k: "scalar", js: folded(home, n, path) };
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
    case "NewExpression":
      if (n.callee.type === "Identifier" && n.callee.name === "Map" && !files.get(home)?.has("Map")) return mapConst(home, n, path);
      break;
    case "ObjectExpression": {
      const fields = new Map<string, Const>();
      for (const p of n.properties) {
        if (p.type !== "ObjectProperty") fail(home, "FV0206", "a constant object holds plain keys and values", p);
        const key = p.computed ? computedKey(home, p.key, path) : String(p.key.name ?? p.key.value);
        if (!p.computed && key === "__proto__") fail(home, "FV0206", "`__proto__:` in an object literal sets its prototype, whose fields the object then reads as its own: write the fields out", p);
        fields.set(key, evaluate(home, p.value, `${path}_${key}`, null));
      }
      return { k: "object", fields, node: n, home, name: path };
    }
  }
  return fail(home, "FV0207", "a constant the compiler evaluates is a literal, `+`, `-`, `*`, `/`, `%`, `**` or a template literal of such values, a list or an object of them, or another such constant of the same file", n);
}

function mapConst(home: Component, n: N, path: string): Const {
  const entries = new Map<string | number, Const>();
  const [given, ...more] = n.arguments as N[];
  if (more.length) fail(home, "FV0207", "a constant `Map` is built from one array literal of `[key, value]` pairs", more[0]);
  if (given && given.type !== "ArrayExpression") fail(home, "FV0207", "a constant `Map` is built from an array literal of `[key, value]` pairs, written out", given);
  for (const pair of given?.elements ?? []) {
    if (pair?.type !== "ArrayExpression" || pair.elements.length !== 2 || pair.elements.some((e: N) => !e || e.type === "SpreadElement")) {
      fail(home, "FV0207", "a constant `Map`'s entry is a `[key, value]` pair, written out", pair ?? given);
    }
    const key = scalarOf(home, pair.elements[0], path);
    if (typeof key !== "string" && !(typeof key === "number" && Number.isSafeInteger(key))) fail(home, "FV0207", "a constant `Map`'s key is a string or an integer", pair.elements[0]);
    entries.set(Object.is(key, -0) ? 0 : key, evaluate(home, pair.elements[1], `${path}_${String(key)}`, null));
  }
  return { k: "map", entries, node: n, home };
}

function scalarOf(home: Component, n: N, path: string): Scalar {
  const c = evaluate(home, n, path, null);
  if (c.k === "scalar") return c.js;
  return fail(home, "FV0207", "arithmetic and template literals in a constant take strings, numbers, booleans and `null`, and this is a list or an object", n);
}

function folded(home: Component, n: N, path: string): Scalar {
  const a = scalarOf(home, n.left, path);
  const b = scalarOf(home, n.right, path);
  if (n.operator === "+") {
    if (typeof a === "string" || typeof b === "string") return `${String(a)}${String(b)}`;
    if (typeof a === "number" && typeof b === "number") return a + b;
  } else if (typeof a === "number" && typeof b === "number") {
    if (n.operator === "**") {
      const r = exactPower(a, b);
      if (r === null) return fail(home, "FV0720", `\`**\` of ${String(a)} and ${String(b)}, which is not an integer to a whole power from 0 with a result within ±2⁵³: engines round such powers in their own ways`, n);
      return r;
    }
    return n.operator === "-" ? a - b : n.operator === "*" ? a * b : n.operator === "/" ? a / b : a % b;
  }
  return fail(home, "FV0207", `\`${n.operator}\` in a constant ${n.operator === "+" ? "joins strings or adds numbers" : "takes two numbers"}, and these are ${typeof a === "object" ? "null" : typeof a} and ${typeof b === "object" ? "null" : typeof b}`, n);
}

function computedKey(home: Component, key: N, path: string): string {
  const c = evaluate(home, key, path, null);
  if (c.k === "scalar" && (typeof c.js === "string" || typeof c.js === "number")) return String(c.js);
  return fail(home, "FV0206", "a constant object's computed key is a string or a number the compiler evaluates, as an enum member", key);
}

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
  const v = expr(s, n.property);
  const path = pathOf(n.property);
  const what = `${base.what}[${path === null ? "…" : path.replace(/^(?:_ctx|\$props|\$setup)\./, "").replace(new RegExp(`^${s.propsIdent ?? "\\$^"}\\.`), "")}]`;
  const keys = literalsOf(v.ty);
  const fixed = v.ty.k === "str" && /^"[^"\\]*"$/.test(v.code) ? (JSON.parse(v.code) as string) : v.ty.k === "int" && v.num !== undefined && v.code === `${v.num}i64` ? String(v.num) : null;
  if (fixed !== null) return { sym: step(s, base, fixed, n, chain, []), what: `${base.what}[${JSON.stringify(fixed)}]` };
  if (v.ty.k === "opt" || nothing(v.ty)) {
    return fail(s.comp, "FV0223", `\`${base.what}\` read by a key that may be absent, where JavaScript reads the field \`undefined\`: narrow the key with \`v-if\` first, or give it a default`, n.property);
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
  if (ty.k === "list" || literals.some((l) => l === undefined)) return { code, ty, ...slice };
  const optional = ty.k === "opt";
  const into = (def: EnumDef): string | null => {
    if (!literals.every((l) => l === null || def.literals.includes(l!))) return null;
    return picked(literals.map((l) => (l === null ? "None" : optional ? `Some(${variantPath(at.comp, def, l!)})` : variantPath(at.comp, def, l!))));
  };
  const typed = valueEnum(sym.arms);
  const variant = typed === undefined ? null : into(typed);
  if (typed !== undefined && variant !== null) return { code, ty: withAbsence(enumTy(typed), optional ? absence(ty) : null), variant, asEnum: { of: code, into } };
  return { code, ty, asEnum: { of: code, into } };
}

const VALUE_ENUMS = new WeakMap<Const, EnumDef>();

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
