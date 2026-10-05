import { parse as parseJs } from "@babel/parser";
import { compileScript, compileTemplate, parse as parseSfc, type SFCBlock } from "@vue/compiler-sfc";
import { readFileSync } from "node:fs";
import { SourceMapConsumer } from "source-map-js";
import { basename, relative } from "node:path";
import { type Component, type N, absence, blankComponent, fail, opt, snake, sourceAt, tagAst } from "./model.ts";
import { ctx } from "./context.ts";
import { typesImports, declareTypes, defaultValue, definePropsType, ONE_NOTHING, readTypeFile, resolveImport, runtimeDefaults, structOf, tyOfTs } from "./typescript.ts";
import { claim } from "./plugin.ts";

function vueErrorNode(err: unknown, within?: { line: number; column: number }): N {
  const loc = (err as { loc?: { start: { line: number; column: number } } }).loc;
  if (!loc) return undefined;
  const { line, column } = loc.start;
  const at = !within ? { line, column: column - 1 } : line === 1 ? { line: within.line, column: within.column - 1 + column - 1 } : { line: within.line + line - 1, column: column - 1 };
  return { type: "VueError", loc: { start: at }, __fv: "source" };
}

function inheritAttrs(comp: Component, statements: N[]): boolean {
  let found = true;
  for (const st of statements) {
    const call = st.type === "ExpressionStatement" ? st.expression : null;
    const options =
      call?.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "defineOptions"
        ? call.arguments[0]
        : st.type === "ExportDefaultDeclaration"
          ? st.declaration
          : null;
    if (options?.type !== "ObjectExpression") continue;
    for (const p of options.properties) {
      if (p.type !== "ObjectProperty" || p.computed || (p.key.name ?? p.key.value) !== "inheritAttrs") continue;
      if (p.value.type !== "BooleanLiteral") fail(comp, "`inheritAttrs` is `true` or `false`", p.value);
      found = p.value.value;
    }
  }
  return found;
}

function sourceDefault(ast: N[], key: string): N | null {
  const named = (p: N) => (p.key?.name ?? p.key?.value) === key;
  for (const st of ast) {
    for (const d of st.type === "VariableDeclaration" ? st.declarations : []) {
      if (d.id.type !== "ObjectPattern" || !definePropsType(d.init)) continue;
      const p = d.id.properties.find((q: N) => q.type === "ObjectProperty" && named(q));
      if (p?.value.type === "AssignmentPattern") return p.value.right;
    }
    const call = st.type === "ExpressionStatement" ? st.expression : st.type === "VariableDeclaration" ? st.declarations[0]?.init : null;
    if (call?.type !== "CallExpression" || call.callee.name !== "withDefaults" || call.arguments[1]?.type !== "ObjectExpression") continue;
    const p = call.arguments[1].properties.find((q: N) => q.type === "ObjectProperty" && named(q));
    if (p) return p.value;
  }
  return null;
}

function blockAt(source: string, block: SFCBlock): N {
  return sourceAt(source, source.lastIndexOf(`<${block.type}`, block.loc.start.offset));
}

/** The `.vue` files a component imports, by name. */
export function importsOf(source: string): string[] {
  return [...source.matchAll(/\bfrom\s*["'](?:[^"']*\/)?([^"'/]+)\.vue["']/g)].map((m) => m[1]!);
}

function generics(comp: Component, source: string, block: SFCBlock): void {
  const text = block.attrs.generic;
  if (typeof text !== "string") return;
  const open = source.lastIndexOf("<script", block.loc.start.offset);
  const attr = source.slice(open, block.loc.start.offset).search(/\bgeneric\s*=\s*["']/);
  const valueAt = open + attr + /^generic\s*=\s*["']/.exec(source.slice(open + attr))![0].length;
  const at = sourceAt(source, valueAt).loc.start;
  const prefix = "type T<";
  let params: N[];
  try {
    params = (parseJs(`${prefix}${text}> = 0;`, { sourceType: "module", plugins: ["typescript"] }).program.body[0] as N).typeParameters.params;
  } catch {
    return fail(comp, "`generic` is a list of type parameters, as `T extends string`", sourceAt(source, valueAt));
  }
  const rebase = (n: N): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(rebase);
    const start = n.loc?.start;
    if (start && typeof n.type === "string") {
      n.loc = { ...n.loc, start: start.line === 1 ? { line: at.line, column: at.column + start.column - prefix.length } : { line: at.line + start.line - 1, column: start.column } };
    }
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && v && typeof v === "object") rebase(v);
  };
  rebase(params);
  tagAst(params, "source");
  for (const p of params) {
    const name: string = typeof p.name === "string" ? p.name : p.name.name;
    if (!p.constraint) fail(comp, `\`${name}\` in \`generic\` has no constraint: the server renders \`${name}\` as the type it extends, \`${name} extends string\``, p);
    comp.aliases.set(name, p.constraint);
  }
}

export function readComponent(file: string, root: string, isChild: boolean): { comp: Component; ast: N[]; ssr: string } {
  const name = basename(file, ".vue");
  const source = readFileSync(file, "utf8");
  const { descriptor, errors } = parseSfc(source, { filename: file });
  const rel = relative(root, file);
  const comp = blankComponent(name, snake(name), rel);
  comp.source = source;
  if (errors.length) fail(comp, String(errors[0]), vueErrorNode(errors[0]));
  if (descriptor.script && !descriptor.scriptSetup) {
    const needs = isChild ? "a child component must have" : "an island needs";
    fail(comp, `${needs} \`<script setup lang="ts">\`, or no script at all: a \`<script>\` without \`setup\` (the Options API, \`defineComponent\`) is not translated`, blockAt(source, descriptor.script));
  }
  if (!descriptor.template) fail(comp, "a component needs a `<template>`: a render function is not translated", sourceAt(source, 0));
  for (const st of descriptor.styles) {
    if (st.module) fail(comp, "`<style module>` renames classes in the bundler; use a global or scoped `<style>`, or a stylesheet", blockAt(source, st));
  }
  const cssVar = descriptor.styles.find((st) => /\bv-bind\s*\(/.test(st.content));
  if (descriptor.cssVars.length) fail(comp, "`v-bind()` in `<style>` sets variables the server does not render; bind `:style` instead", cssVar ? blockAt(source, cssVar) : undefined);
  for (const p of ctx.plugins) p.sfc?.(comp, descriptor, file, source);

  const script = descriptor.scriptSetup ? compileScript(descriptor, { id: name }) : null;
  const ast: N[] = script?.scriptSetupAst ?? [];
  tagAst(ast, "source");
  const plainAst: N[] = script?.scriptAst ?? [];
  tagAst(plainAst, "source");

  for (const s of [...plainAst, ...ast]) {
    if (s.type !== "ImportDeclaration" || !s.source.value.endsWith(".vue")) continue;
    const from = basename(s.source.value, ".vue");
    if (s.specifiers.some((sp: N) => sp.type === "ImportDefaultSpecifier")) comp.imports.add(from);
    for (const sp of s.specifiers) {
      if (sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === "Props") {
        comp.childProps.set(sp.local.name, from);
      }
    }
  }
  typesImports(comp, [...plainAst, ...ast]);
  comp.inheritAttrs = inheritAttrs(comp, [...plainAst, ...ast]);

  for (const st of [...plainAst, ...ast]) {
    if (st.type !== "ImportDeclaration") continue;
    const from: string = st.source.value;
    for (const sp of st.specifiers) {
      if (sp.type !== "ImportSpecifier") continue;
      const typeName: string = sp.imported.name ?? sp.imported.value;
      if (from.endsWith(".vue")) {
        if (typeName !== "Props") comp.importedTypes.set(sp.local.name, { k: "struct", name: typeName, home: basename(from, ".vue") });
        continue;
      }
      const isType = st.importKind === "type" || sp.importKind === "type";
      const typeFile = resolveImport(comp.file, from);
      if (!typeFile) continue;
      if (ctx.plugins.some((p) => p.importedType?.(comp, typeFile, typeName, sp.local.name))) continue;
      if (ctx.helperModule !== null && from === ctx.helperModule && !isType) continue;
      readTypeFile(typeFile);
      if (ctx.typeStructs.has(typeName)) comp.importedTypes.set(sp.local.name, { k: "struct", name: typeName, home: "types" });
      else if (ctx.typeAliases.has(typeName)) comp.aliases.set(sp.local.name, ctx.typeAliases.get(typeName));
    }
  }

  if (descriptor.scriptSetup) generics(comp, source, descriptor.scriptSetup);
  const decls = declareTypes(comp, [...plainAst, ...ast], comp.structs, comp.aliases);
  for (const d of decls) comp.structs.set(d.name, structOf(comp, d.name, d.members, comp.structs));
  let propsTy: N = null;
  for (const s of ast) {
    const call = s.type === "ExpressionStatement" ? s.expression : s.type === "VariableDeclaration" ? s.declarations[0]?.init : null;
    const inner = call?.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "withDefaults" ? call.arguments[0] : call;
    if (inner?.type === "CallExpression" && inner.callee.type === "Identifier" && inner.callee.name === "defineProps" && !inner.typeParameters) {
      fail(comp, "props are declared with a type, `defineProps<{ ... }>()`: a runtime declaration has no Rust type", inner);
    }
    const found = definePropsType(call);
    if (found) propsTy = found;
  }
  if (!propsTy) {
  } else if (propsTy.type === "TSTypeLiteral") {
    comp.props = structOf(comp, "Props", propsTy.members, comp.structs);
  } else if (propsTy.type === "TSTypeReference" && comp.structs.has(propsTy.typeName.name)) {
    comp.props = { name: "Props", fields: comp.structs.get(propsTy.typeName.name)!.fields };
  } else {
    fail(comp, "`defineProps` takes a type literal or an interface declared in the same block", propsTy);
  }

  for (const st of ast) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      const call = d.init;
      if (call?.type !== "CallExpression" || call.callee.type !== "Identifier" || call.callee.name !== "defineModel") continue;
      const t = call.typeParameters?.params?.[0];
      if (!t) fail(comp, "`defineModel` needs its type: `defineModel<string>()`", call);
      const named = call.arguments[0]?.type === "StringLiteral" ? call.arguments[0].value : "modelValue";
      const options = call.arguments.find((a: N) => a.type === "ObjectExpression");
      const required = options?.properties.some(
        (p: N) => p.type === "ObjectProperty" && (p.key.name ?? p.key.value) === "required" && p.value.type === "BooleanLiteral" && p.value.value,
      );
      const base = tyOfTs(comp, t, comp.structs);
      if (!required && absence(base) === "null") fail(comp, `a \`defineModel\` of \`T | null\` that is not \`required\` may be absent, which is \`undefined\`, or \`null\`: ${ONE_NOTHING}`, call);
      comp.props.fields.push({ js: named, rust: snake(named), ty: required ? base : opt(base) });
      comp.models.set(d.id.name, named);
    }
  }

  const defaults = runtimeDefaults(comp, script?.content ?? "");
  for (const f of comp.props.fields) {
    if (f.ty.k !== "opt") continue;
    const node = defaults.get(f.js);
    if (f.ty.none !== undefined) {
      if (node) fail(comp, `a default for \`${f.js}\`, which is \`T | null\`: Vue gives it only when \`${f.js}\` is absent, which its Rust type, an \`Option\`, cannot be; fall back in the template with \`??\``, sourceDefault(ast, f.js) ?? node);
      continue;
    }
    if (node) f.dflt = defaultValue(comp, f, node, sourceDefault(ast, f.js) ?? undefined);
    else if (f.ty.of.k === "bool") f.dflt = "false";
  }

  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    ...(claim((p) => p.templateOptions?.(comp)) ?? { id: name, scoped: false, slotted: false }),
    ssr: true,
    ssrCssVars: [],
    compilerOptions: { ...(script ? { bindingMetadata: script.bindings } : {}), sourceMap: true },
  });
  const kids = (n: N): N[] => n.children.filter((c: N) => c.type !== 3 && !(c.type === 2 && !c.content.trim()));
  const roots = descriptor.template.ast ? kids(descriptor.template.ast) : [];
  const wrapper = roots.length === 1 && roots[0].type === 1 && roots[0].tagType === 1 && ["Transition", "transition", "KeepAlive", "keep-alive"].includes(roots[0].tag) ? roots[0] : null;
  if (wrapper) {
    const inner = kids(wrapper);
    const lone = inner.length === 1 && inner[0].type === 1 && (inner[0].tagType === 0 || inner[0].tagType === 1) && !inner[0].props.some((p: N) => p.type === 7 && ["if", "else-if", "else", "for"].includes(p.name));
    if (!lone) comp.attrsDropped = { type: "VueTemplate", loc: { start: { line: wrapper.loc.start.line, column: wrapper.loc.start.column - 1 } }, __fv: "source" };
  }
  comp.templateAst = descriptor.template.ast;
  const start = descriptor.template.loc.start;
  comp.templateStart = { line: start.line, column: start.column };
  if (compiled.map) comp.templateMap = new SourceMapConsumer(compiled.map);
  if (compiled.errors.length) fail(comp, String(compiled.errors[0]), vueErrorNode(compiled.errors[0], comp.templateStart));
  for (const m of compiled.code.matchAll(/_ssrRenderSlot\(_ctx\.\$slots, "([^"]+)"/g)) {
    if (!comp.slotNames.includes(m[1]!)) comp.slotNames.push(m[1]!);
  }
  for (const p of ctx.plugins) p.compiled?.(comp, compiled.code, [...plainAst, ...ast]);
  return { comp, ast, ssr: compiled.code };
}
