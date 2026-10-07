import { parse as parseJs } from "@babel/parser";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { relativePath } from "./paths.ts";
import { type Absence, type Component, type Field, type N, type Struct, type Ty, absence, blankComponent, BOOL, fail, FLOAT, GenError, INT, joinAbsence, opt, RUST_PRELUDE, rustStr, sameTy, snake, STR, tagAst, withAbsence } from "./model.ts";
import { CONFIG_FILE, ctx, INLINE_HTML, TYPES_MODULE } from "./context.ts";
import { childOf } from "./expr.ts";
import { claim } from "./plugin.ts";
import { declareConsts, enumType } from "./constants.ts";

export function typesImports(comp: Component, body: N[]): void {
  for (const s of body) {
    if (s.type !== "ImportDeclaration" || s.source.value !== TYPES_MODULE) continue;
    for (const sp of s.specifiers) {
      if (sp.type !== "ImportSpecifier") continue;
      const name = sp.imported.name ?? sp.imported.value;
      if (name === "TrustedHtml") comp.trustedName = sp.local.name;
      if (name === "InlineHtml") comp.inlineName = sp.local.name;
      if (name === "Float") comp.floatName = sp.local.name;
    }
  }
}

export const ONE_NOTHING = "its Rust type is an `Option`, whose `None` cannot be both, as `=== null` and the props sent to the client would need";

const NULL_OR_UNDEFINED = `a type that is both \`null\` and \`undefined\`: ${ONE_NOTHING}; keep one of them`;

export function tyOfTs(comp: Component, t: N, structs: Map<string, Struct>, seen: Set<string> = new Set()): Ty {
  switch (t.type) {
    case "TSStringKeyword":
      return STR;
    case "TSNumberKeyword":
      return INT;
    case "TSBooleanKeyword":
      return BOOL;
    case "TSArrayType":
      return { k: "list", of: tyOfTs(comp, t.elementType, structs, seen) };
    case "TSParenthesizedType":
      return tyOfTs(comp, t.typeAnnotation, structs, seen);
    case "TSTypeLiteral": {
      const [sig] = t.members;
      const key = sig?.parameters?.[0]?.typeAnnotation?.typeAnnotation;
      if (t.members.length === 1 && sig.type === "TSIndexSignature" && key?.type === "TSStringKeyword" && sig.typeAnnotation) {
        return recordOf(comp, sig.typeAnnotation.typeAnnotation, structs, seen);
      }
      return fail(comp, "FV0310", "an object type in place: declare it as an interface, or as `{ [key: string]: T }` for a dictionary", t);
    }
    case "TSTypeOperator":
      if (t.operator === "readonly") return tyOfTs(comp, t.typeAnnotation, structs, seen);
      break;
    case "TSLiteralType":
      if (t.literal.type === "StringLiteral" || t.literal.type === "TemplateLiteral") return STR;
      if (t.literal.type === "NumericLiteral") return Number.isInteger(t.literal.value) ? INT : FLOAT;
      if (t.literal.type === "BooleanLiteral") return BOOL;
      break;
    case "TSUnionType": {
      const isNull = (u: N) => u.type === "TSNullKeyword" || (u.type === "TSLiteralType" && u.literal.type === "NullLiteral");
      let none: Absence | null = null;
      const tys: Ty[] = [];
      for (const u of t.types) {
        if (u.type === "TSUndefinedKeyword") none = joinAbsence(none, "undefined");
        else if (isNull(u)) none = joinAbsence(none, "null");
        else {
          const ty = tyOfTs(comp, u, structs, seen);
          none = joinAbsence(none, absence(ty));
          tys.push(ty.k === "opt" ? ty.of : ty);
        }
      }
      if (none === "either") return fail(comp, "FV0311", NULL_OR_UNDEFINED, t);
      const first = tys[0];
      if (!first || tys.some((x) => !sameTy(x, first))) return fail(comp, "FV0312", "a union of different types has no Rust type", t);
      return withAbsence(first, none);
    }
    case "TSTypeReference": {
      const name: string | undefined = t.typeName.type === "Identifier" ? t.typeName.name : undefined;
      if (name === undefined) break;
      if ((name === "Array" || name === "ReadonlyArray") && t.typeParameters?.params?.length === 1) {
        return { k: "list", of: tyOfTs(comp, t.typeParameters.params[0], structs, seen) };
      }
      if (name === "Record" && t.typeParameters?.params?.length === 2) {
        const [key, value] = t.typeParameters.params;
        if (key.type !== "TSStringKeyword") fail(comp, "FV0313", "a `Record` is keyed by `string`", key);
        return recordOf(comp, value, structs, seen);
      }
      if (structs.has(name)) return { k: "struct", name };
      if (comp.childProps.has(name)) return { k: "child", name: comp.childProps.get(name)! };
      if (comp.floatName !== null && name === comp.floatName) return FLOAT;
      if (comp.inlineName !== null && name === comp.inlineName) return { k: "html", inline: true };
      if (comp.trustedName !== null && name === comp.trustedName) {
        if (ctx.trustedHtml === null) {
          fail(comp, "FV1503", `a \`TrustedHtml\` prop needs \`trustedHtml\` in ${CONFIG_FILE}: the Rust type it is, or type it \`InlineHtml\` (inline tags only, \`ferrovue::InlineHtml\`)`, t);
        }
        return ctx.trustedHtml === INLINE_HTML ? { k: "html", inline: true } : { k: "html" };
      }
      const imported = comp.importedTypes.get(name);
      if (imported) return imported;
      const alias = comp.aliases.get(name);
      if (alias) {
        if (seen.has(name)) fail(comp, "FV0314", `type \`${name}\` refers to itself through an alias`, t);
        return tyOfTs(comp, alias, structs, new Set(seen).add(name));
      }
      return fail(comp, "FV0315", `unsupported prop type \`${name}\`: declare it as an interface in the component, or import it from a \`.ts\` file`, t);
    }
  }
  return fail(comp, "FV0316", `unsupported prop type \`${t.type}\``, t);
}

function recordOf(comp: Component, value: N, structs: Map<string, Struct>, seen: Set<string>): Ty {
  const of = tyOfTs(comp, value, structs, seen);
  const plain = (t: Ty): boolean => ["str", "int", "float", "bool", "struct", "child"].includes(t.k) || (t.k === "list" && plain(t.of));
  if (!plain(of)) fail(comp, "FV0317", "a `Record`'s values are strings, numbers, booleans, objects or lists of those", value);
  return { k: "record", of };
}

export function declareTypes(comp: Component, body: N[], structs: Map<string, Struct>, aliases: Map<string, N>): N[] {
  const decls: N[] = [];
  for (const st of body) {
    const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (d?.type === "TSInterfaceDeclaration") decls.push({ name: d.id.name, members: d.body.body, node: d });
    else if (d?.type === "TSTypeAliasDeclaration") {
      const dictionary = d.typeAnnotation.members?.some((m: N) => m.type === "TSIndexSignature");
      if (d.typeAnnotation.type === "TSTypeLiteral" && !dictionary) decls.push({ name: d.id.name, members: d.typeAnnotation.members, node: d });
      else aliases.set(d.id.name, d.typeAnnotation);
    } else if (d?.type === "TSEnumDeclaration") {
      try {
        aliases.set(d.id.name, enumType(comp, d));
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
      }
    }
  }
  for (const d of decls) {
    if (RUST_PRELUDE.has(d.name)) {
      fail(comp, "FV0318", `an interface called \`${d.name}\` would hide Rust's own \`${d.name}\` in the generated code; rename it`, d.node);
    }
    structs.set(d.name, { name: d.name, fields: [] });
  }
  return decls;
}

export function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(ctx.rootDir, dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")]) {
    try {
      if (statSync(candidate).isFile() && candidate.endsWith(".ts")) return candidate;
    } catch {
    }
  }
  return null;
}

export function readTypeFile(file: string): void {
  if (ctx.typeRead.has(file)) return;
  ctx.typeRead.add(file);
  const rel = relativePath(ctx.rootDir, file);
  const home = blankComponent(basename(rel), "types", rel, ctx.typeStructs);
  home.aliases = ctx.typeAliases;
  home.source = readFileSync(file, "utf8");
  const body: N[] = parseJs(home.source, { sourceType: "module", plugins: ["typescript"] }).program.body;
  tagAst(body, "source");
  typesImports(home, body);
  ctx.constDecls.set(file, declareConsts(home, body));
  const before = new Set(ctx.typeStructs.keys());
  const local = new Map<string, Struct>();
  const decls = declareTypes(home, body, local, ctx.typeAliases);
  for (const d of decls) {
    if (before.has(d.name)) fail(home, "FV0319", `\`${d.name}\` is declared by ${ctx.typeFiles.get(d.name)} too`, d.node);
    ctx.typeStructs.set(d.name, local.get(d.name)!);
    ctx.typeFiles.set(d.name, rel);
  }
  for (const d of decls) {
    const st = structOf(home, d.name, d.members, ctx.typeStructs);
    for (const f of st.fields) f.ty = markHome(f.ty, "types");
    ctx.typeStructs.set(d.name, st);
  }
}

export function markHome(ty: Ty, home: string): Ty {
  if (ty.k === "struct" && !claim((p) => p.struct?.(ty)) && !ty.home && ty.name !== "Props") return { ...ty, home };
  if (ty.k === "opt" || ty.k === "list" || ty.k === "record") return { ...ty, of: markHome(ty.of, home) };
  return ty;
}

export function lookupStruct(comp: Component, ty: Ty & { k: "struct" }): { st: Struct | undefined; owner: Component; path: string } {
  const own = claim((p) => p.struct?.(ty));
  if (own) return { st: own.st, owner: comp, path: comp.module === own.module ? "" : `super::${own.module}::` };
  if (ty.home === "types") return { st: ctx.typeStructs.get(ty.name), owner: comp, path: comp.module === "types" ? "" : "super::types::" };
  if (ty.home !== undefined && ty.home !== comp.name) {
    const owner = childOf(ty.home);
    return { st: owner.structs.get(ty.name), owner, path: `super::${owner.module}::` };
  }
  return { st: ty.name === "Props" ? comp.props : comp.structs.get(ty.name), owner: comp, path: "" };
}

export function structOf(comp: Component, name: string, members: N[], structs: Map<string, Struct>): Struct {
  const fields: Field[] = [];
  for (const m of members) {
    if (m.type !== "TSPropertySignature" || m.key.type !== "Identifier") {
      fail(comp, "FV0320", `\`${name}\` may only hold plain named fields`, m);
    }
    const base = tyOfTs(comp, m.typeAnnotation.typeAnnotation, structs);
    if (m.optional && absence(base) === "null") {
      fail(comp, "FV0321", `\`${m.key.name}?: T | null\` may be absent, which is \`undefined\`, or \`null\`: ${ONE_NOTHING}; declare it \`${m.key.name}: T | null\` or \`${m.key.name}?: T\``, m);
    }
    if (m.optional && base.k === "opt") {
      fields.push({ js: m.key.name, rust: snake(m.key.name), ty: base });
      continue;
    }
    fields.push({ js: m.key.name, rust: snake(m.key.name), ty: m.optional ? opt(base) : base });
  }
  return { name, fields };
}

export function definePropsType(call: N): N | null {
  if (call?.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "withDefaults") {
    return definePropsType(call.arguments[0]);
  }
  if (
    call?.type === "CallExpression" &&
    call.callee.type === "Identifier" &&
    call.callee.name === "defineProps"
  ) {
    return call.typeParameters?.params?.[0] ?? null;
  }
  return null;
}

export function runtimeDefaults(comp: Component, content: string): Map<string, N> {
  const out = new Map<string, N>();
  let program: N[];
  try {
    program = parseJs(content, { sourceType: "module", plugins: ["typescript"] }).program.body;
  } catch {
    return out;
  }
  const props = (o: N): N[] =>
    o?.type !== "ObjectExpression"
      ? []
      : o.properties.flatMap((p: N) => (p.type === "SpreadElement" ? props(p.argument) : [p]));
  const visit = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (n.type === "ObjectProperty" && !n.computed && (n.key.name ?? n.key.value) === "props") {
      const objects = n.value.type === "CallExpression" ? n.value.arguments : [n.value];
      for (const o of objects) {
        for (const p of props(o)) {
          if (p.type !== "ObjectProperty") continue;
          const d = props(p.value).find((q: N) => q.type === "ObjectProperty" && (q.key.name ?? q.key.value) === "default");
          if (d) out.set(p.key.name ?? p.key.value, d.value);
        }
      }
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object" && typeof v.type === "string") visit(v);
    }
  };
  program.forEach(visit);
  void comp;
  return out;
}

export function defaultValue(comp: Component, f: Field, node: N, written?: N): string {
  const of = f.ty.k === "opt" ? f.ty.of : f.ty;
  if (of.k === "str" && node.type === "StringLiteral") return rustStr(node.value);
  if (of.k === "int" && node.type === "NumericLiteral" && Number.isInteger(node.value)) return `${node.value}i64`;
  if (of.k === "int" && node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral" && Number.isInteger(node.argument.value)) {
    return `-${node.argument.value}i64`;
  }
  if (of.k === "bool" && node.type === "BooleanLiteral") return String(node.value);
  if (of.k === "list" && node.type === "ArrowFunctionExpression" && node.body.type === "ArrayExpression" && node.body.elements.length === 0) {
    return "&[]";
  }
  return fail(comp, "FV0322", `the default of \`${f.js}\` must be a literal of its type, or \`() => []\` for a list`, written ?? node);
}
