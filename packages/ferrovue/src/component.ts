/* One `.vue` file read: its props, models, imported types, and Vue's SSR compilation of its template. */

import { compileScript, compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import { readFileSync } from "node:fs";
import { SourceMapConsumer } from "source-map-js";
import { basename, relative } from "node:path";
import { type Component, type N, fail, opt, snake, tagAst } from "./model.ts";
import { ctx } from "./context.ts";
import { typesImports, declareTypes, defaultValue, definePropsType, readTypeFile, resolveImport, runtimeDefaults, structOf, tyOfTs } from "./typescript.ts";

/** A Vue compiler error's position as a node \`fail\` can point at: its line and 1-based column,
 * offset by where the template starts when the error is in the template's content. */
function vueErrorNode(err: unknown, within?: { line: number; column: number }): N {
  const loc = (err as { loc?: { start: { line: number; column: number } } }).loc;
  if (!loc) return undefined;
  const { line, column } = loc.start;
  const at = !within ? { line, column: column - 1 } : line === 1 ? { line: within.line, column: within.column - 1 + column - 1 } : { line: within.line + line - 1, column: column - 1 };
  return { type: "VueError", loc: { start: at }, __fv: "source" };
}

export function readComponent(file: string, root: string): { comp: Component; ast: N[]; ssr: string } {
  const name = basename(file, ".vue");
  const source = readFileSync(file, "utf8");
  const { descriptor, errors } = parseSfc(source, { filename: file });
  const rel = relative(root, file);
  const comp: Component = {
    name,
    module: snake(name),
    file: rel,
    props: { name: "Props", fields: [] },
    structs: new Map(),
    trustedName: null,
    floatName: null,
    childProps: new Map(),
    imports: new Set(),
    slotNames: [],
    routerView: false,
    routerLink: false,
    readsRoute: false,
    usesRoute: false,
    readsStores: false,
    usesStores: false,
    readsI18n: false,
    usesI18n: false,
    readsTeleports: false,
    usesTeleports: false,
    models: new Map(),
    aliases: new Map(),
    importedTypes: new Map(),
    slotShapes: new Map(),
  };
  comp.source = source;
  if (errors.length) fail(comp, String(errors[0]), vueErrorNode(errors[0]));
  if (!descriptor.scriptSetup || !descriptor.template) {
    fail(comp, "an island needs `<script setup lang=\"ts\">` and a `<template>`");
  }
  // A global `<style>` block changes no markup. A scoped one adds `data-v-…` attributes whose hash
  // the bundler chooses, a CSS module renames classes, and `v-bind()` in CSS writes variables onto
  // the root: none of which the server can know.
  for (const st of descriptor.styles) {
    if (st.scoped) fail(comp, "`<style scoped>` adds `data-v-` attributes whose id the bundler chooses; use a global `<style>` or a stylesheet");
    if (st.module) fail(comp, "`<style module>` renames classes in the bundler; use a global `<style>` or a stylesheet");
  }
  if (descriptor.cssVars.length) fail(comp, "`v-bind()` in `<style>` sets variables the server does not render; bind `:style` instead");

  const script = compileScript(descriptor, { id: name });
  const ast: N[] = script.scriptSetupAst ?? [];
  tagAst(ast, "source");
  // A plain `<script>` beside the setup one may declare the types the setup block uses.
  const plainAst: N[] = script.scriptAst ?? [];
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

  // Types imported from elsewhere: a store's file, a shared `.ts` file, or another component.
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
      const module = typeFile.replace(/\.ts$/, "");
      if ([...ctx.stores.values()].some((x) => x.module === module)) {
        if (ctx.storeStructs.has(typeName)) comp.importedTypes.set(sp.local.name, { k: "struct", name: typeName, store: true });
        continue;
      }
      if (ctx.helperModule !== null && from === ctx.helperModule && !isType) continue;
      readTypeFile(typeFile);
      if (ctx.typeStructs.has(typeName)) comp.importedTypes.set(sp.local.name, { k: "struct", name: typeName, home: "types" });
      else if (ctx.typeAliases.has(typeName)) comp.aliases.set(sp.local.name, ctx.typeAliases.get(typeName));
    }
  }

  // Interfaces in two passes: every name first, so one may name another declared after it, or
  // itself — a tree node's children are tree nodes.
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
  // A component without `defineProps` takes no props.
  if (!propsTy) {
    // nothing to read
  } else if (propsTy.type === "TSTypeLiteral") {
    comp.props = structOf(comp, "Props", propsTy.members, comp.structs);
  } else if (propsTy.type === "TSTypeReference" && comp.structs.has(propsTy.typeName.name)) {
    comp.props = { name: "Props", fields: comp.structs.get(propsTy.typeName.name)!.fields };
  } else {
    fail(comp, "`defineProps` takes a type literal or an interface declared in the same block", propsTy);
  }

  // `defineModel`: a prop of its own (`modelValue` unless named), which the binding reads.
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
      comp.props.fields.push({ js: named, rust: snake(named), ty: required ? base : opt(base) });
      comp.models.set(d.id.name, named);
    }
  }

  // What Vue uses for an absent optional prop: the default `compileScript` resolved — from
  // `withDefaults`, a destructured default, or `defineModel`'s options — or `false` for a boolean.
  const defaults = runtimeDefaults(comp, script.content);
  for (const f of comp.props.fields) {
    if (f.ty.k !== "opt") continue;
    const node = defaults.get(f.js);
    if (node) f.dflt = defaultValue(comp, f, node);
    else if (f.ty.of.k === "bool") f.dflt = "false";
  }

  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: name,
    ssr: true,
    ssrCssVars: [],
    compilerOptions: { bindingMetadata: script.bindings, sourceMap: true },
  });
  const start = descriptor.template.loc.start;
  comp.templateStart = { line: start.line, column: start.column };
  if (compiled.map) comp.templateMap = new SourceMapConsumer(compiled.map);
  // A template error's position is within the template's content.
  if (compiled.errors.length) fail(comp, String(compiled.errors[0]), vueErrorNode(compiled.errors[0], comp.templateStart));
  for (const m of compiled.code.matchAll(/_ssrRenderSlot\(_ctx\.\$slots, "([^"]+)"/g)) {
    if (!comp.slotNames.includes(m[1]!)) comp.slotNames.push(m[1]!);
  }
  // Resolved by name, as globally registered components are, or imported from `vue-router`.
  const imported = (exported: string) =>
    [...plainAst, ...ast].some(
      (st) => st.type === "ImportDeclaration" && st.source.value === "vue-router" &&
        st.specifiers.some((sp: N) => sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === exported),
    );
  comp.routerLink = compiled.code.includes('_resolveComponent("RouterLink")') || imported("RouterLink");
  comp.routerView = compiled.code.includes('_resolveComponent("RouterView")') || imported("RouterView");
  comp.readsRoute = compiled.code.includes("_ctx.$route");
  comp.readsI18n = compiled.code.includes("_ctx.$t(");
  comp.readsTeleports = compiled.code.includes("_ssrRenderTeleport(");
  return { comp, ast, ssr: compiled.code };
}
