import { type Component, type N } from "./model.ts";
import { type EnumDef } from "./literal-types.ts";
import { fail } from "./locate.ts";
import { ctx } from "./context.ts";
import { aliasEnum } from "./enums.ts";
import { tyOfTs } from "./typescript.ts";
import { GenError } from "./errors.ts";
import { exactPower } from "./numbers.ts";

export type Const =
  | { k: "scalar"; js: Scalar }
  | { k: "list"; items: Const[]; node: N; home: Component; path: string; typed: string | null }
  | { k: "object"; fields: Map<string, Const>; node: N; home: Component; name: string }
  | { k: "map"; entries: Map<string | number, Const>; node: N; home: Component };

export type Scalar = string | number | boolean | null;

export interface Declared {
  node: N;
  home: Component;
}

const files = new WeakMap<Component, Map<string, Declared>>();

const evaluated = new WeakMap<N, Const>();

const inProgress = new WeakSet<N>();

let enumScope: { name: string; fields: Map<string, Const>; node: N } | null = null;

/** Remember the constants and enums a file declares at its top level, to evaluate when one is used. */
export function declareConsts(home: Component, body: N[]): Map<string, Declared> {
  const found = new Map<string, Declared>();
  for (const st of body) {
    const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (d?.type === "TSEnumDeclaration") found.set(d.id.name, { node: d, home });
    if (d?.type === "VariableDeclaration" && d.kind === "const") {
      for (const v of d.declarations) if (v.id.type === "Identifier" && v.init) found.set(v.id.name, { node: v, home });
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
  const outer = enumScope;
  enumScope = null;
  try {
    const c = d.node.type === "TSEnumDeclaration" ? enumConst(d.home, d.node) : evaluate(d.home, d.node.init, d.node.id.name, typedAs(d.node));
    if (c.k === "object" && d.node.type !== "TSEnumDeclaration") typeValues(d.home, d.node, c);
    evaluated.set(d.node, c);
    return c;
  } finally {
    inProgress.delete(d.node);
    enumScope = outer;
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

function valueType(home: Component, t: N, seen: Set<string> = new Set()): N | null {
  if (t?.type === "TSMappedType") return t.typeAnnotation ?? null;
  if (t?.type !== "TSTypeReference" || t.typeName.type !== "Identifier") return null;
  const params: N[] = t.typeParameters?.params ?? [];
  const name: string = t.typeName.name;
  if (["Readonly", "Partial", "Required"].includes(name) && params.length === 1) return valueType(home, params[0], seen);
  if (name === "Record") return params.length === 2 ? params[1] : null;
  const alias = params.length === 0 && !seen.has(name) ? home.aliases.get(name) : undefined;
  return alias === undefined ? null : valueType(home, alias, new Set(seen).add(name));
}

function typeValues(home: Component, decl: N, c: Const & { k: "object" }): void {
  const names: N[] = [decl.id.typeAnnotation?.typeAnnotation];
  for (let n = decl.init; n?.type === "TSAsExpression" || n?.type === "TSSatisfiesExpression"; n = n.expression) names.push(n.typeAnnotation);
  const value = names.map((t) => valueType(home, t)).find((t) => t !== null);
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
  const outer = enumScope;
  enumScope = { name: d.id.name, fields, node: d };
  try {
    return enumFields(home, d, fields);
  } finally {
    enumScope = outer;
  }
}

function enumFields(home: Component, d: N, fields: Map<string, Const>): Const {
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
      const own = enumScope;
      const member = own?.fields.get(n.name);
      if (member !== undefined) return member;
      if (own !== null && own.name === n.name) return { k: "object", fields: own.fields, node: own.node, home, name: own.name };
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

export const VALUE_ENUMS = new WeakMap<Const, EnumDef>();
