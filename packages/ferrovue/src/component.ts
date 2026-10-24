import { parse as parseJs } from "@babel/parser";
import { compileScript, compileTemplate, parse as parseSfc, type SFCBlock, type SFCDescriptor, type SFCScriptBlock } from "@vue/compiler-sfc";
import { SourceMapConsumer } from "source-map-js";
import { basename } from "node:path";
import { relativePath } from "./paths.ts";
import { type Component, type N, absence, blankComponent, distinctFields, fail, GenError, opt, snake, sourceAt, tagAst } from "./model.ts";
import { ctx, readSource } from "./context.ts";
import { typesImports, declareTypes, defaultValue, definePropsType, ONE_NOTHING, reachLocal, readTypeFile, refuseDates, runtimeDefaults, structOf, tyOfTs } from "./typescript.ts";
import { enumField } from "./enums.ts";
import { claim } from "./plugin.ts";
import { asyncChildren } from "./script.ts";
import { resolveImport } from "./resolve.ts";

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
      if (p.value.type !== "BooleanLiteral") fail(comp, "FV0101", "`inheritAttrs` is `true` or `false`", p.value);
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

function cssVarsAt(source: string, descriptor: SFCDescriptor): N[] {
  const at = new Map<string, N>();
  for (const st of descriptor.styles) {
    for (const m of st.content.matchAll(/v-bind\s*\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]*))/g)) {
      const raw = m[1] ?? m[2] ?? m[3]!.trim();
      if (!at.has(raw)) at.set(raw, sourceAt(source, st.loc.start.offset + m.index));
    }
  }
  const block = descriptor.styles.find((st) => /\bv-bind\s*\(/.test(st.content));
  return descriptor.cssVars.map((v) => at.get(v) ?? (block ? blockAt(source, block) : sourceAt(source, 0)));
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
    return fail(comp, "FV0301", "`generic` is a list of type parameters, as `T extends string`", sourceAt(source, valueAt));
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
    if (!p.constraint) fail(comp, "FV0302", `\`${name}\` in \`generic\` has no constraint: the server renders \`${name}\` as the type it extends, \`${name} extends string\``, p);
    comp.aliases.set(name, p.constraint);
  }
}

function scriptOf(comp: Component, descriptor: SFCDescriptor): SFCScriptBlock {
  try {
    return compileScript(descriptor, { id: comp.name });
  } catch (e) {
    if (!(e instanceof SyntaxError)) {
      refuseImportedMacroType(comp, descriptor);
      throw e;
    }
    const at = (e as { loc?: { line: number; column: number } }).loc;
    const block = descriptor.scriptSetup!.loc.start;
    const where = !at || descriptor.script ? {} : at.line === 1 ? { line: block.line, column: block.column + at.column } : { line: block.line + at.line - 1, column: at.column + 1 };
    throw new GenError("FV0001", e.message, { file: comp.file, ...where }, e.message.split("\n")[0]);
  }
}

type Imported = { name: string; from: string; node: N };

function refuseImportedMacroType(comp: Component, descriptor: SFCDescriptor): void {
  const blocks = [descriptor.script, descriptor.scriptSetup].flatMap((b) => (b ? [b] : []));
  const statements: { st: N; offset: number }[] = [];
  for (const b of blocks) {
    let body: N[];
    try {
      body = parseJs(b.content, { sourceType: "module", plugins: ["typescript"] }).program.body;
    } catch {
      return;
    }
    for (const st of body) statements.push({ st: st.type === "ExportNamedDeclaration" && st.declaration ? st.declaration : st, offset: b.loc.start.offset });
  }
  const imports = new Map<string, string>();
  for (const { st } of statements) {
    if (st.type !== "ImportDeclaration") continue;
    for (const sp of st.specifiers) imports.set(sp.local.name, st.source.value);
  }
  const declared = new Map<string, { st: N; offset: number }>();
  for (const d of statements) {
    if (d.st.type === "TSInterfaceDeclaration" || d.st.type === "TSTypeAliasDeclaration") declared.set(d.st.id.name, d);
  }
  const seen = new Set<string>();
  const reach = (t: N, offset: number): Imported | null => {
    if (!t || typeof t !== "object") return null;
    if (t.type === "TSParenthesizedType") return reach(t.typeAnnotation, offset);
    if (t.type === "TSUnionType" || t.type === "TSIntersectionType") {
      for (const part of t.types) {
        const found = reach(part, offset);
        if (found) return found;
      }
      return null;
    }
    if (t.type !== "TSTypeReference" && t.type !== "TSExpressionWithTypeArguments" && t.type !== "TSInterfaceHeritage") return null;
    let head = t.typeName ?? t.expression;
    while (head?.type === "TSQualifiedName" || head?.type === "MemberExpression") head = head.left ?? head.object;
    const name: string | undefined = head?.type === "Identifier" ? head.name : undefined;
    if (name !== undefined && imports.has(name)) return { name, from: imports.get(name)!, node: sourceAt(comp.source ?? "", offset + t.start) };
    for (const arg of (t.typeParameters ?? t.typeArguments)?.params ?? []) {
      const found = reach(arg, offset);
      if (found) return found;
    }
    const local = name === undefined || seen.has(name) ? undefined : declared.get(name);
    if (local === undefined) return null;
    seen.add(name!);
    if (local.st.type === "TSTypeAliasDeclaration") return reach(local.st.typeAnnotation, local.offset);
    for (const base of local.st.extends ?? []) {
      const found = reach(base, local.offset);
      if (found) return found;
    }
    return null;
  };
  for (const { st, offset } of statements) {
    const call = st.type === "ExpressionStatement" ? st.expression : st.type === "VariableDeclaration" ? st.declarations[0]?.init : null;
    const inner = call?.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "withDefaults" ? call.arguments[0] : call;
    if (inner?.type !== "CallExpression" || inner.callee.type !== "Identifier") continue;
    const macro: string = inner.callee.name;
    if (macro !== "defineProps" && macro !== "defineEmits") continue;
    const arg = inner.typeParameters?.params?.[0];
    const found = arg ? reach(arg, offset) : null;
    if (!found) continue;
    const what = macro === "defineProps" ? "props" : "events";
    const write = macro === "defineProps" ? "`defineProps<{ label: string }>()` or an interface the component declares, whose fields may have types imported from a `.ts` file" : '`defineEmits<{ (e: "save"): void }>()` or an interface the component declares';
    fail(comp, "FV0327", `the ${what} of \`${macro}\` are read from \`${found.name}\`, imported from \`${found.from}\`: declare them in the component, as ${write}`, found.node);
  }
}

/** Refuse a component written with the Options API, which `readComponent` read no further: as a
 * child when another component imports it, as an island otherwise. */
export function refuseOptionsApi(comp: Component, script: N, isChild: boolean): never {
  const needs = isChild ? "a child component must have" : "an island needs";
  return fail(comp, "FV0003", `${needs} \`<script setup lang="ts">\`, or no script at all: a \`<script>\` without \`setup\` (the Options API, \`defineComponent\`) is not translated`, script);
}

/** A component, read and its template compiled. One written with the Options API is read no
 * further than its `<script>`, `optionsApi`, for `refuseOptionsApi` once every component is read. */
export function readComponent(file: string, root: string, name = basename(file, ".vue")): { comp: Component; ast: N[]; ssr: string; optionsApi?: N } {
  const source = readSource(file);
  const { descriptor, errors } = parseSfc(source, { filename: file });
  const rel = relativePath(root, file);
  const comp = blankComponent(name, snake(name), rel);
  comp.source = source;
  if (errors.length) fail(comp, "FV0002", String(errors[0]).replaceAll(file, rel), vueErrorNode(errors[0]) ?? sourceAt(source, 0));
  if (descriptor.script && !descriptor.scriptSetup) return { comp, ast: [], ssr: "", optionsApi: blockAt(source, descriptor.script) };
  if (!descriptor.template) fail(comp, "FV0004", "a component needs a `<template>`: a render function is not translated", sourceAt(source, 0));
  if (descriptor.template.src) fail(comp, "FV0009", `the \`<template>\` is read from \`${descriptor.template.src}\`: write the template inside the \`<template>\` block of the component`, blockAt(source, descriptor.template));
  if (descriptor.template.lang && descriptor.template.lang !== "html") fail(comp, "FV0008", `the \`<template>\` is written in \`${descriptor.template.lang}\`: write it in HTML, with no \`lang\` or \`lang="html"\``, blockAt(source, descriptor.template));
  comp.cssVarsAt = cssVarsAt(source, descriptor);
  for (const p of ctx.plugins) p.sfc?.(comp, descriptor, file, source);

  const script = descriptor.scriptSetup ? scriptOf(comp, descriptor) : null;
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
  for (const loaded of asyncChildren(comp, ast).values()) comp.imports.add(loaded);
  typesImports(comp, [...plainAst, ...ast]);
  comp.inheritAttrs = inheritAttrs(comp, [...plainAst, ...ast]);

  for (const st of [...plainAst, ...ast]) {
    if (st.type !== "ImportDeclaration") continue;
    const from: string = st.source.value;
    for (const sp of st.specifiers) {
      if (sp.type !== "ImportSpecifier") {
        if (!from.endsWith(".vue") && resolveImport(comp.file, from) === null) comp.unresolved.set(sp.local.name, from);
        continue;
      }
      const typeName: string = sp.imported.name ?? sp.imported.value;
      if (from.endsWith(".vue")) {
        if (typeName !== "Props") comp.importedTypes.set(sp.local.name, { k: "struct", name: typeName, home: basename(from, ".vue") });
        continue;
      }
      const isType = st.importKind === "type" || sp.importKind === "type";
      const typeFile = resolveImport(comp.file, from);
      if (!typeFile) {
        comp.unresolved.set(sp.local.name, from);
        continue;
      }
      if (ctx.plugins.some((p) => p.importedType?.(comp, typeFile, typeName, sp.local.name))) continue;
      if (ctx.helperModule !== null && from === ctx.helperModule && !isType) continue;
      readTypeFile(typeFile);
      if (ctx.typeStructs.has(typeName)) comp.importedTypes.set(sp.local.name, { k: "struct", name: typeName, home: "types" });
      else if (ctx.typeAliases.has(typeName)) comp.aliases.set(sp.local.name, ctx.typeAliases.get(typeName));
    }
  }

  if (descriptor.scriptSetup) generics(comp, source, descriptor.scriptSetup);
  const decls = declareTypes(comp, [...plainAst, ...ast], comp.structs, comp.aliases);
  for (const d of decls) comp.typeDecls.set(d.name, { members: d.members, node: d.node });
  let propsTy: N = null;
  for (const s of ast) {
    const call = s.type === "ExpressionStatement" ? s.expression : s.type === "VariableDeclaration" ? s.declarations[0]?.init : null;
    const inner = call?.type === "CallExpression" && call.callee.type === "Identifier" && call.callee.name === "withDefaults" ? call.arguments[0] : call;
    if (inner?.type === "CallExpression" && inner.callee.type === "Identifier" && inner.callee.name === "defineProps" && !inner.typeParameters) {
      fail(comp, "FV0303", "props are declared with a type, `defineProps<{ ... }>()`: a runtime declaration has no Rust type", inner);
    }
    const found = definePropsType(call);
    if (found) propsTy = found;
  }
  if (!propsTy) {
  } else if (propsTy.type === "TSTypeLiteral") {
    comp.props = structOf(comp, "Props", propsTy.members, comp.structs);
  } else if (propsTy.type === "TSTypeReference" && comp.structs.has(propsTy.typeName.name)) {
    reachLocal(comp, propsTy.typeName.name);
    const st = comp.structs.get(propsTy.typeName.name)!;
    const refused = st.refused?.values().next().value;
    if (refused !== undefined) throw refused;
    comp.props = { name: "Props", fields: st.fields };
  } else {
    fail(comp, "FV0304", "`defineProps` takes a type literal or an interface declared in the same block", propsTy);
  }

  for (const st of ast) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      const call = d.init;
      if (call?.type !== "CallExpression" || call.callee.type !== "Identifier" || call.callee.name !== "defineModel") continue;
      const t = call.typeParameters?.params?.[0];
      if (!t) fail(comp, "FV0305", "`defineModel` needs its type: `defineModel<string>()`", call);
      const named = call.arguments[0]?.type === "StringLiteral" ? call.arguments[0].value : "modelValue";
      const options = call.arguments.find((a: N) => a.type === "ObjectExpression");
      const required = options?.properties.some(
        (p: N) => p.type === "ObjectProperty" && (p.key.name ?? p.key.value) === "required" && p.value.type === "BooleanLiteral" && p.value.value,
      );
      const base = tyOfTs(comp, t, comp.structs);
      refuseDates(comp, base, "a `defineModel`", t);
      if (!required && absence(base) === "null") fail(comp, "FV0306", `a \`defineModel\` of \`T | null\` that is not \`required\` may be absent, which is \`undefined\`, or \`null\`: ${ONE_NOTHING}`, call);
      if (named.startsWith("$")) reservedProp(comp, named, call.arguments[0]);
      comp.props.fields.push({ js: named, rust: snake(named), ty: enumField(comp, comp.name, named, call, required ? base : opt(base)) });
      comp.models.set(d.id.name, named);
    }
  }
  const reserved = comp.props.fields.find((f) => f.js.startsWith("$"));
  if (reserved !== undefined) reservedProp(comp, reserved.js, propsTy?.members?.find((m: N) => (m.key?.name ?? m.key?.value) === reserved.js) ?? propsTy);
  comp.props = { ...comp.props, fields: distinctFields(comp.props.fields) };

  comp.propsAt = propsTy;
  const defaults = runtimeDefaults(comp, script?.content ?? "");
  for (const f of comp.props.fields) {
    if (f.ty.k !== "opt") continue;
    const node = defaults.get(f.js);
    if (f.ty.none !== undefined) {
      if (node) fail(comp, "FV0307", `a default for \`${f.js}\`, which is \`T | null\`: Vue gives it only when \`${f.js}\` is absent, which its Rust type, an \`Option\`, cannot be; fall back in the template with \`??\``, sourceDefault(ast, f.js) ?? node);
      continue;
    }
    if (node) f.dflt = defaultValue(comp, f, node, sourceDefault(ast, f.js) ?? undefined);
    else if (f.ty.of.k === "bool") f.dflt = "false";
  }

  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    ...(claim((p) => p.templateOptions?.(comp)) ?? { id: name, scoped: false, slotted: false, ssrCssVars: [], isProd: true }),
    ssr: true,
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
  if (compiled.errors.length) fail(comp, "FV0005", String(compiled.errors[0]), vueErrorNode(compiled.errors[0], comp.templateStart));
  for (const m of compiled.code.matchAll(/_ssrRenderSlot\(_ctx\.\$slots, "([^"]+)"/g)) {
    if (!comp.slotNames.includes(m[1]!)) comp.slotNames.push(m[1]!);
  }
  for (const p of ctx.plugins) p.compiled?.(comp, compiled.code, [...plainAst, ...ast]);
  return { comp, ast, ssr: compiled.code };
}

function reservedProp(comp: Component, name: string, at: N): never {
  fail(comp, "FV0328", `the prop \`${name}\` starts with \`$\`, which Vue keeps for its own properties: it leaves the prop out and renders it as an attribute; rename it without the \`$\``, at);
}
