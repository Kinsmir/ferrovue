/* TypeScript types read as Rust ones: props, interfaces, aliases, shared type files, defaults. */

import { parse as parseJs } from "@babel/parser";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { type Component, type Field, type N, type Struct, type Ty, BOOL, fail, FLOAT, INT, opt, RUST_PRELUDE, rustStr, sameTy, snake, STR, tagAst } from "./model.ts";
import { CONFIG_FILE, ctx, TYPES_MODULE } from "./context.ts";
import { childOf } from "./expr.ts";

import { storeHome } from "./stores.ts";

/** The local names \`TrustedHtml\` and \`Float\` are imported under from \`ferrovue/types\`. */
export function typesImports(comp: Component, body: N[]): void {
  for (const s of body) {
    if (s.type !== "ImportDeclaration" || s.source.value !== TYPES_MODULE) continue;
    for (const sp of s.specifiers) {
      if (sp.type !== "ImportSpecifier") continue;
      const name = sp.imported.name ?? sp.imported.value;
      if (name === "TrustedHtml") comp.trustedName = sp.local.name;
      if (name === "Float") comp.floatName = sp.local.name;
    }
  }
}

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
    case "TSTypeOperator":
      // `readonly string[]`: the same list, which the server never writes to anyway.
      if (t.operator === "readonly") return tyOfTs(comp, t.typeAnnotation, structs, seen);
      break;
    case "TSLiteralType":
      // A literal type is a value of its kind: `"sm"` a string, `3` a number.
      if (t.literal.type === "StringLiteral" || t.literal.type === "TemplateLiteral") return STR;
      if (t.literal.type === "NumericLiteral") return Number.isInteger(t.literal.value) ? INT : FLOAT;
      if (t.literal.type === "BooleanLiteral") return BOOL;
      break;
    case "TSUnionType": {
      // `"sm" | "md"` is a string; `T | undefined` is an optional `T`. `null` is a different value.
      const parts: N[] = t.types.filter((u: N) => u.type !== "TSUndefinedKeyword");
      if (t.types.some((u: N) => u.type === "TSNullKeyword" || (u.type === "TSLiteralType" && u.literal.type === "NullLiteral"))) {
        return fail(comp, "`null` in a type: use `undefined`, which is what an absent value is", t);
      }
      const tys = parts.map((u) => tyOfTs(comp, u, structs, seen));
      const first = tys[0];
      if (!first || tys.some((x) => !sameTy(x, first))) return fail(comp, "a union of different types has no Rust type", t);
      return parts.length < t.types.length ? opt(first) : first;
    }
    case "TSTypeReference": {
      const name: string | undefined = t.typeName.type === "Identifier" ? t.typeName.name : undefined;
      if (name === undefined) break;
      // `Array<T>` and `ReadonlyArray<T>`, as `T[]`.
      if ((name === "Array" || name === "ReadonlyArray") && t.typeParameters?.params?.length === 1) {
        return { k: "list", of: tyOfTs(comp, t.typeParameters.params[0], structs, seen) };
      }
      if (structs.has(name)) return { k: "struct", name };
      if (comp.childProps.has(name)) return { k: "child", name: comp.childProps.get(name)! };
      if (comp.floatName !== null && name === comp.floatName) return FLOAT;
      if (comp.trustedName !== null && name === comp.trustedName) {
        if (ctx.trustedHtml === null) {
          fail(comp, `a \`TrustedHtml\` prop needs \`trustedHtml\` in ${CONFIG_FILE}: the Rust type it is`, t);
        }
        return { k: "html" };
      }
      const imported = comp.importedTypes.get(name);
      if (imported) return imported;
      const alias = comp.aliases.get(name);
      if (alias) {
        if (seen.has(name)) fail(comp, `type \`${name}\` refers to itself through an alias`, t);
        return tyOfTs(comp, alias, structs, new Set(seen).add(name));
      }
      return fail(comp, `unsupported prop type \`${name}\`: declare it as an interface in the component, or import it from a \`.ts\` file`, t);
    }
  }
  return fail(comp, `unsupported prop type \`${t.type}\``, t);
}

/** Every local name an interface or object type alias declares a struct for, and every other
 * alias: what a type in that block may name. */
export function declareTypes(comp: Component, body: N[], structs: Map<string, Struct>, aliases: Map<string, N>): N[] {
  const decls: N[] = [];
  for (const st of body) {
    const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (d?.type === "TSInterfaceDeclaration") decls.push({ name: d.id.name, members: d.body.body, node: d });
    else if (d?.type === "TSTypeAliasDeclaration") {
      if (d.typeAnnotation.type === "TSTypeLiteral") decls.push({ name: d.id.name, members: d.typeAnnotation.members, node: d });
      else aliases.set(d.id.name, d.typeAnnotation);
    }
  }
  for (const d of decls) {
    if (RUST_PRELUDE.has(d.name)) {
      fail(comp, `an interface called \`${d.name}\` would hide Rust's own \`${d.name}\` in the generated code; rename it`, d.node);
    }
    structs.set(d.name, { name: d.name, fields: [] });
  }
  return decls;
}

/** A relative import's file, resolved as a bundler resolves a TypeScript import. */
export function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(ctx.rootDir, dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts"), base.replace(/\.js$/, ".ts")]) {
    try {
      if (statSync(candidate).isFile() && candidate.endsWith(".ts")) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
}

/** A shared `.ts` file of types, read once: its interfaces and object types become structs in
 * `types.rs`, its other aliases are resolved where they are used. */
export function readTypeFile(file: string): void {
  if (ctx.typeRead.has(file)) return;
  ctx.typeRead.add(file);
  const rel = relative(ctx.rootDir, file);
  const home = storeHome(rel);
  home.structs = ctx.typeStructs;
  home.aliases = ctx.typeAliases;
  home.source = readFileSync(file, "utf8");
  const body: N[] = parseJs(home.source, { sourceType: "module", plugins: ["typescript"] }).program.body;
  tagAst(body, "source");
  typesImports(home, body);
  const before = new Set(ctx.typeStructs.keys());
  const local = new Map<string, Struct>();
  const decls = declareTypes(home, body, local, ctx.typeAliases);
  for (const d of decls) {
    if (before.has(d.name)) fail(home, `\`${d.name}\` is declared by ${ctx.typeFiles.get(d.name)} too`, d.node);
    ctx.typeStructs.set(d.name, local.get(d.name)!);
    ctx.typeFiles.set(d.name, rel);
  }
  for (const d of decls) {
    const st = structOf(home, d.name, d.members, ctx.typeStructs);
    for (const f of st.fields) f.ty = markHome(f.ty, "types");
    ctx.typeStructs.set(d.name, st);
  }
}

/** A type read in the file that declares it, marked with where it lives for readers elsewhere. */
export function markHome(ty: Ty, home: string): Ty {
  if (ty.k === "struct" && !ty.store && !ty.home && ty.name !== "Props") return { ...ty, home };
  if (ty.k === "opt" || ty.k === "list") return { ...ty, of: markHome(ty.of, home) };
  return ty;
}

/** Where a struct type is declared: its fields, the component whose types its fields name, and
 * the path the generated code names it by. */
export function lookupStruct(comp: Component, ty: Ty & { k: "struct" }): { st: Struct | undefined; owner: Component; path: string } {
  // Named from the module being written: plainly within its own, by path from any other.
  if (ty.store) return { st: ctx.storeStructs.get(ty.name), owner: comp, path: comp.module === "stores" ? "" : "super::stores::" };
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
      fail(comp, `\`${name}\` may only hold plain named fields`, m);
    }
    const base = tyOfTs(comp, m.typeAnnotation.typeAnnotation, structs);
    if (m.optional && base.k === "opt") {
      fields.push({ js: m.key.name, rust: snake(m.key.name), ty: base });
      continue;
    }
    fields.push({ js: m.key.name, rust: snake(m.key.name), ty: m.optional ? opt(base) : base });
  }
  return { name, fields };
}

/** The type literal (or interface) `defineProps<...>()` was given, seen through `withDefaults`. */
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

/** The `default` of each prop in the runtime declaration `compileScript` wrote, by prop name. */
export function runtimeDefaults(comp: Component, content: string): Map<string, N> {
  const out = new Map<string, N>();
  let program: N[];
  try {
    program = parseJs(content, { sourceType: "module", plugins: ["typescript"] }).program.body;
  } catch {
    return out;
  }
  /** An object literal's properties, with `...{ … }` spreads opened, as `defineModel` writes them. */
  const props = (o: N): N[] =>
    o?.type !== "ObjectExpression"
      ? []
      : o.properties.flatMap((p: N) => (p.type === "SpreadElement" ? props(p.argument) : [p]));
  const visit = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (n.type === "ObjectProperty" && !n.computed && (n.key.name ?? n.key.value) === "props") {
      // `props: { … }`, or `_mergeModels({ … }, { … })` when there is a `defineModel`.
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

/** A prop's default as a Rust value of its type: a literal, or an empty list from `() => []`. */
export function defaultValue(comp: Component, f: Field, node: N): string {
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
  return fail(comp, `the default of \`${f.js}\` must be a literal of its type, or \`() => []\` for a list`, node);
}

export function markStore(ty: Ty): Ty {
  if (ty.k === "struct") return { ...ty, store: true };
  if (ty.k === "opt" || ty.k === "list") return { ...ty, of: markStore(ty.of) };
  return ty;
}
