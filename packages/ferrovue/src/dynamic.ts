import { parse as parseJs } from "@babel/parser";
import { isHTMLTag, isVoidTag } from "@vue/shared";
import { basename } from "node:path";
import { type Component, type N, type Scope, camelize, fail, GenError, rustStr, tagAst } from "./model.ts";
import { ctx } from "./context.ts";
import { expr } from "./expr.ts";
import { cond, known } from "./narrowing.ts";
import { condition } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { isAttrs, mergedParts, renderAttrs } from "./attrs.ts";
import { claim } from "./plugin.ts";
import { definePropsType, resolveImport } from "./typescript.ts";
import { setupSource } from "./script.ts";
import { slotBody } from "./slots.ts";
import { push, statements } from "./template.ts";

type Choice = { tag: string } | { local: string; child: string };

type Pick =
  | { k: "one"; choice: Choice }
  | { k: "if"; test: N; yes: Pick; no: Pick }
  | { k: "match"; on: N; arms: [string, Pick][] };

interface Dynamic {
  is: N;
  props: N;
  slots: N;
  parent: N;
  sid: N | undefined;
  at: N;
}

const setupAsts = new WeakMap<Component, N[]>();
const vnodeSlots = new WeakMap<Component, Set<string>>();

const RESERVED_TAGS = new Set(["template", "slot", "component", "textarea"]);

const OPEN = "`<component :is>` renders a closed set of choices: imported components, element names, a `computed` or `?:` choosing among them, a prop typed as a union of string literals, or an object of imported components read by such a prop";

/** Whether the content a parent gives `slot` of `child` is rendered as virtual nodes, as it is
 * inside an element a `<component :is>` chooses. */
export function slotAsVnodes(child: Component, slot: string): boolean {
  return vnodeSlots.get(child)?.has(slot) ?? false;
}

function dynamicOf(st: N): Dynamic | null {
  const c = st?.type === "ExpressionStatement" ? st.expression : null;
  if (c?.type !== "CallExpression" || c.callee.type !== "Identifier" || c.callee.name !== "_ssrRenderVNode") return null;
  const vnode = c.arguments[1];
  const resolved = vnode?.type === "CallExpression" && vnode.callee.type === "Identifier" && vnode.callee.name === "_createVNode" ? vnode.arguments[0] : null;
  if (resolved?.type !== "CallExpression" || resolved.callee.type !== "Identifier" || resolved.callee.name !== "_resolveDynamicComponent") return null;
  return { is: resolved.arguments[0], props: vnode.arguments[1], slots: vnode.arguments[2], parent: c.arguments[2], sid: c.arguments[3], at: vnode };
}

/** Whether a statement of a compiled template renders a `<component :is>`. */
export function isDynamicComponent(st: N): boolean {
  return dynamicOf(st) !== null;
}

function unwrap(n: N): N {
  while (n && ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"].includes(n.type)) n = n.expression;
  return n;
}

function setupName(n: N): string | null {
  if (n?.type === "MemberExpression" && n.object.type === "Identifier" && (n.object.name === "$setup" || n.object.name === "_ctx")) {
    return n.computed ? (n.property.type === "StringLiteral" ? n.property.value : null) : n.property.name;
  }
  return n?.type === "Identifier" ? n.name : null;
}

function declared(s: Scope, name: string): N | null {
  for (const st of setupAsts.get(s.comp) ?? []) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) if (d.id.type === "Identifier" && d.id.name === name) return d;
  }
  return null;
}

function destructuredProp(s: Scope, local: string): string | null {
  for (const st of setupAsts.get(s.comp) ?? []) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      if (d.id.type !== "ObjectPattern" || !definePropsType(d.init)) continue;
      for (const p of d.id.properties) {
        if (p.type !== "ObjectProperty") continue;
        const target = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
        if (target.type === "Identifier" && target.name === local) return p.key.name ?? p.key.value;
      }
    }
  }
  return null;
}

function propOf(s: Scope, n: N): string | null {
  const own = (name: string): string | null => (s.comp.props.fields.some((f) => f.js === name) ? name : null);
  if (n?.type === "MemberExpression" && !n.computed && n.property.type === "Identifier") {
    const o = n.object;
    if (o.type === "Identifier" && (o.name === "$props" || o.name === "_ctx" || (o.name === s.propsIdent && !s.locals.has(o.name)))) return own(n.property.name);
    if (s.propsIdent !== null && setupName(o) === s.propsIdent && o.type === "MemberExpression") return own(n.property.name);
  }
  const name = n?.type === "Identifier" && s.locals.has(n.name) ? null : setupName(n);
  return name === null ? null : destructuredProp(s, name);
}

function literalUnion(comp: Component, t: N, seen: Set<string> = new Set()): string[] | null {
  switch (t?.type) {
    case "TSParenthesizedType":
      return literalUnion(comp, t.typeAnnotation, seen);
    case "TSLiteralType":
      if (t.literal.type === "StringLiteral") return [t.literal.value];
      if (t.literal.type === "TemplateLiteral" && !t.literal.expressions.length) return [t.literal.quasis[0].value.cooked];
      return null;
    case "TSUnionType": {
      const all: string[] = [];
      for (const u of t.types) {
        const lits = literalUnion(comp, u, seen);
        if (lits === null) return null;
        for (const l of lits) if (!all.includes(l)) all.push(l);
      }
      return all;
    }
    case "TSTypeReference": {
      const name: string | undefined = t.typeName.type === "Identifier" ? t.typeName.name : undefined;
      const alias = name === undefined || seen.has(name) ? undefined : comp.aliases.get(name);
      return alias ? literalUnion(comp, alias, new Set(seen).add(name!)) : null;
    }
  }
  return null;
}

function propType(s: Scope, name: string): N {
  const ast = setupAsts.get(s.comp) ?? [];
  let t: N = null;
  for (const st of ast) {
    const call = st.type === "ExpressionStatement" ? st.expression : st.type === "VariableDeclaration" ? st.declarations[0]?.init : null;
    t = definePropsType(call) ?? t;
  }
  let members: N[] = t?.type === "TSTypeLiteral" ? t.members : [];
  if (t?.type === "TSTypeReference") {
    for (const st of ast) {
      const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
      if (d?.type === "TSInterfaceDeclaration" && d.id.name === t.typeName.name) members = d.body.body;
      if (d?.type === "TSTypeAliasDeclaration" && d.id.name === t.typeName.name && d.typeAnnotation.type === "TSTypeLiteral") members = d.typeAnnotation.members;
    }
  }
  return members.find((m) => m.type === "TSPropertySignature" && (m.key.name ?? m.key.value) === name)?.typeAnnotation?.typeAnnotation ?? null;
}

function keysOf(s: Scope, n: N, at: N): { on: N; keys: string[] } {
  const name = propOf(s, n);
  if (name === null) fail(s.comp, "FV0418", `${OPEN}; this value is not one of those`, n);
  const field = s.comp.props.fields.find((f) => f.js === name)!;
  const keys = literalUnion(s.comp, propType(s, name));
  if (keys === null) fail(s.comp, "FV0418", `${OPEN}; \`${name}\` is not typed as a union of string literals, as \`"h1" | "h2"\``, n);
  if (field.ty.k === "opt" && field.dflt === undefined) {
    fail(s.comp, "FV0420", `\`${name}\` may be absent, where Vue renders \`<!---->\` or fails: make it required, or give it a default`, at);
  }
  return { on: n, keys };
}

function element(s: Scope, tag: string, n: N): Choice {
  const self = s.comp.name;
  if (!isHTMLTag(tag) || RESERVED_TAGS.has(tag) || self === tag || self === camelize(tag) || self === camelize(tag).replace(/^./, (c) => c.toUpperCase())) {
    fail(s.comp, "FV0419", `\`${tag}\` is not an HTML element \`<component :is>\` renders: name an HTML element other than \`<textarea>\`, \`<template>\` and \`<slot>\`, or bind an imported component`, n);
  }
  return { tag };
}

function component(s: Scope, name: string): Choice | null {
  const child = s.children.get(name);
  return child === undefined ? null : { local: name, child };
}

interface Table {
  entries: Map<string, N>;
  home: Component;
  name: string;
  imports: Map<string, string>;
}

function vueImports(body: N[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const st of body) {
    if (st.type !== "ImportDeclaration" || !st.source.value.endsWith(".vue")) continue;
    for (const sp of st.specifiers) if (sp.type === "ImportDefaultSpecifier") found.set(sp.local.name, basename(st.source.value, ".vue"));
  }
  return found;
}

function objectEntries(home: Component, name: string, init: N): Map<string, N> | null {
  const obj = unwrap(init);
  if (obj?.type !== "ObjectExpression") return null;
  const entries = new Map<string, N>();
  for (const p of obj.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(home, "FV0418", `${OPEN}; \`${name}\` holds plain keys`, p);
    entries.set(p.key.type === "Identifier" ? p.key.name : String(p.key.value), p.value);
  }
  return entries;
}

function tableOf(s: Scope, n: N): Table | null {
  const name = setupName(n);
  if (name === null || s.locals.has(name)) return null;
  const local = declared(s, name);
  if (local) {
    const entries = objectEntries(s.comp, name, local.init);
    return entries && { entries, home: s.comp, name, imports: new Map() };
  }
  for (const st of setupAsts.get(s.comp) ?? []) {
    if (st.type !== "ImportDeclaration" || st.importKind === "type") continue;
    const sp = st.specifiers.find((x: N) => x.type === "ImportSpecifier" && x.local.name === name && x.importKind !== "type");
    if (!sp) continue;
    const file = resolveImport(s.comp.file, st.source.value);
    const d = file === null ? undefined : ctx.constDecls.get(file)?.get(sp.imported.name ?? sp.imported.value);
    if (!d?.exported || d.node.type !== "VariableDeclarator") return null;
    const entries = objectEntries(d.home, name, d.node.init);
    if (!entries) return null;
    const body: N[] = parseJs(d.home.source ?? "", { sourceType: "module", plugins: ["typescript"] }).program.body;
    return { entries, home: d.home, name, imports: vueImports(body) };
  }
  return null;
}

function entry(s: Scope, table: Table, key: string, at: N): Choice {
  const value = unwrap(table.entries.get(key));
  if (!value) fail(s.comp, "FV0421", `\`${key}\` is not a key of \`${table.name}\`, where Vue finds no component and renders \`<!---->\``, at);
  if (value.type === "StringLiteral") return element(s, value.value, value);
  if (value.type === "Identifier") {
    if (table.home === s.comp) {
      const found = component(s, value.name);
      if (found) return found;
    } else {
      const child = table.imports.get(value.name);
      if (child !== undefined && s.components.has(child)) {
        const local = `${child}.vue`;
        s.children.set(local, child);
        return { local, child };
      }
    }
  }
  return fail(table.home, "FV0418", `${OPEN}; \`${table.name}.${key}\` is not a component imported from a \`.vue\` file among the components compiled, or an element name`, value);
}

function pickOf(s: Scope, raw: N, seen: Set<string> = new Set()): Pick {
  const n = unwrap(raw);
  if (n?.type === "StringLiteral") return { k: "one", choice: element(s, n.value, n) };
  if (n?.type === "TemplateLiteral" && !n.expressions.length) return { k: "one", choice: element(s, n.quasis[0].value.cooked, n) };
  if (n?.type === "ConditionalExpression") return { k: "if", test: n.test, yes: pickOf(s, n.consequent, seen), no: pickOf(s, n.alternate, seen) };
  const prop = propOf(s, n);
  if (prop !== null) {
    const { on, keys } = keysOf(s, n, n);
    return { k: "match", on, arms: keys.map((key) => [key, { k: "one", choice: element(s, key, n) }]) };
  }
  if (n?.type === "MemberExpression" && !(n.object.type === "Identifier" && ["$setup", "_ctx", "$props"].includes(n.object.name))) {
    const table = tableOf(s, n.object);
    if (table) {
      const key = n.computed ? unwrap(n.property) : { type: "StringLiteral", value: n.property.name };
      if (key.type === "StringLiteral") return { k: "one", choice: entry(s, table, key.value, n) };
      const { on, keys } = keysOf(s, key, n);
      return { k: "match", on, arms: keys.map((k) => [k, { k: "one", choice: entry(s, table, k, n) }]) };
    }
  }
  const name = n?.type === "Identifier" && s.locals.has(n.name) ? null : setupName(n);
  if (name !== null) {
    const found = component(s, name);
    if (found) return { k: "one", choice: found };
    const d = seen.has(name) ? null : declared(s, name);
    const source = d?.init ? setupSource(d.init) : null;
    if (source) return pickOf(s, source, new Set(seen).add(name));
    if (tableOf(s, n)) fail(s.comp, "FV0418", `${OPEN}; \`${name}\` is an object: read one of its components by key, as \`${name}[key]\``, raw);
  }
  return fail(s.comp, "FV0418", `${OPEN}; this value is not one of those`, raw);
}

function choicesOf(p: Pick): Choice[] {
  if (p.k === "one") return [p.choice];
  if (p.k === "if") return [...choicesOf(p.yes), ...choicesOf(p.no)];
  return p.arms.flatMap(([, a]) => choicesOf(a));
}

function ownScopeId(comp: Component): string | null {
  const options = claim((p) => p.templateOptions?.(comp));
  return options?.scoped ? options.id : null;
}

function defaultSlot(slots: N): N | null {
  if (!slots || slots.type !== "ObjectExpression") return null;
  return slots.properties.find((p: N) => p.type === "ObjectProperty" && (p.key.name ?? p.key.value) === "default")?.value ?? null;
}

function renderElement(s: Scope, e: Emitter, tag: string | { code: string }, d: Dynamic): void {
  if (s.fill) e.stmt("filled = true;");
  const parts = !d.props || d.props.type === "NullLiteral" ? [] : mergedParts(d.props);
  const inherited = parts.some(isAttrs) ? s.attrs : null;
  const slotted = d.sid?.type === "Identifier" && d.sid.name === "_scopeId" ? s.sid : null;
  const own = ownScopeId(s.comp);
  const name = (): void => (typeof tag === "string" ? e.lit(tag) : e.stmt(`out.push_str(${tag.code});`));
  e.lit("<");
  name();
  if (parts.length) renderAttrs({ ...s, attrs: null }, e, d.props);
  if (inherited === null && slotted === null) {
    if (own !== null) e.lit(` ${own}`);
  } else {
    e.stmt(`out.push_str(&fv::scope_attrs(${inherited ?? '""'}, ${own === null ? '""' : rustStr(own)}, ${slotted ?? '""'}));`);
  }
  e.lit(">");
  if (typeof tag === "string" && isVoidTag(tag)) return;
  const content = defaultSlot(d.slots);
  if (content) statements({ ...s, vnode: true, fill: false, sid: slotted }, e, slotBody(s, content));
  e.lit("</");
  name();
  e.lit(">");
}

function renderChoice(s: Scope, e: Emitter, choice: Choice, d: Dynamic): void {
  if ("tag" in choice) {
    renderElement(s, e, choice.tag, d);
    return;
  }
  const at = { loc: d.at.loc, __fv: d.at.__fv };
  const target = { type: "MemberExpression", computed: true, object: { type: "Identifier", name: "$setup", ...at }, property: { type: "StringLiteral", value: choice.local, ...at }, ...at };
  const takes = s.components.get(choice.child)?.slotNames;
  const slots =
    d.slots?.type === "ObjectExpression" && takes
      ? { ...d.slots, properties: d.slots.properties.filter((p: N) => ["_", ...takes].includes(p.key?.name ?? p.key?.value)) }
      : (d.slots ?? { type: "NullLiteral", ...at });
  const args = [target, d.props ?? { type: "NullLiteral", ...at }, slots, d.parent, ...(d.sid ? [d.sid] : [])];
  push(s, e, { type: "CallExpression", callee: { type: "Identifier", name: "_ssrRenderComponent", ...at }, arguments: args, ...at });
}

function same(a: Pick, b: Pick): boolean {
  return a.k === "one" && b.k === "one" && JSON.stringify(a.choice) === JSON.stringify(b.choice);
}

function renderPick(s: Scope, e: Emitter, p: Pick, d: Dynamic): void {
  if (p.k === "one") {
    renderChoice(s, e, p.choice, d);
    return;
  }
  if (p.k === "if") {
    const t = cond(s, p.test);
    if (t === "true" || t === "false") {
      renderPick(s, e, t === "true" ? p.yes : p.no, d);
      return;
    }
    e.open(`if ${condition(t)}`);
    renderPick(s, e, p.yes, d);
    e.close(" else {");
    renderPick(s, e, p.no, d);
    e.close();
    return;
  }
  const v = expr(s, p.on);
  const k = known(v);
  if (v.ty.k === "str" && k !== undefined) {
    const value = JSON.parse(v.code) as string;
    const arm = p.arms.find(([key]) => key === value) ?? p.arms.at(-1)!;
    renderPick(s, e, arm[1], d);
    return;
  }
  const groups: [string[], Pick][] = [];
  for (const [key, arm] of p.arms) {
    const g = groups.find(([, q]) => same(q, arm));
    if (g) g[0].push(key);
    else groups.push([[key], arm]);
  }
  if (groups.length === 1) {
    renderPick(s, e, groups[0]![1], d);
    return;
  }
  const tags = groups.map(([, arm]) => (arm.k === "one" && "tag" in arm.choice ? arm.choice.tag : null));
  if (tags.every((t) => t !== null && !isVoidTag(t))) {
    const name = `fv_tag${++ctx.narrowCount}`;
    const arms = groups.map(([keys], i) => `${i === groups.length - 1 ? "_" : keys.map(rustStr).join(" | ")} => ${rustStr(tags[i]!)}`);
    e.stmt(`let ${name} = match ${v.code} { ${arms.join(", ")} };`);
    e.expect(Math.max(...tags.map((t) => t!.length)) * 2);
    renderElement(s, e, { code: name }, d);
    return;
  }
  e.open(`match ${v.code}`);
  groups.forEach(([keys, arm], i) => {
    e.open(`${i === groups.length - 1 ? "_" : keys.map(rustStr).join(" | ")} =>`);
    renderPick(s, e, arm, d);
    e.close();
  });
  e.close();
}

/** Render `_ssrRenderVNode` of a `<component :is>`, or return false for a statement that is not one. */
export function dynamicComponent(s: Scope, e: Emitter, st: N): boolean {
  const d = dynamicOf(st);
  if (d === null) return false;
  renderPick(s, e, pickOf(s, d.is), d);
  return true;
}

function refuseContentDirectives(comp: Component): void {
  const visit = (n: N): void => {
    if (n.type === 1 && n.tag === "component") {
      const dir = n.props.find((p: N) => p.type === 7 && (p.name === "html" || p.name === "text"));
      if (dir) {
        const at = { type: "VueTemplate", loc: { start: { line: dir.loc.start.line, column: dir.loc.start.column - 1 } }, __fv: "source" };
        fail(comp, "FV0422", `\`v-${dir.name}\` on \`<component :is>\`: Vue's server renders the element empty, which hydration then fills; put the content inside it`, at);
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  if (comp.templateAst) visit(comp.templateAst);
}

interface Outlet {
  name: string;
  vnode: boolean;
  fallback: boolean;
  node: N;
}

interface Prepared {
  comp: Component;
  scope: Scope;
  program: N;
  code: string;
  picks: Map<N, Choice[]>;
}

function outletsOf(p: Prepared, byName: Map<string, Component>): Outlet[] {
  const outlets: Outlet[] = [];
  const childOf = (target: N): Component | undefined => {
    const name = setupName(target);
    const file = name === null ? undefined : p.scope.children.get(name);
    return file === undefined ? undefined : byName.get(file);
  };
  const slotsWith = (slots: N, mode: (name: string) => boolean | null, walkAs: (n: N, vnode: boolean) => void): void => {
    if (slots?.type !== "ObjectExpression") return;
    for (const prop of slots.properties) {
      const name = prop.key?.name ?? prop.key?.value;
      const as = name === "_" ? null : mode(name);
      if (as !== null) walkAs(prop.value, as);
    }
  };
  const walk = (n: N, vnode: boolean): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x, vnode);
      return;
    }
    const choices = p.picks.get(n);
    if (choices) {
      const d = dynamicOf(n)!;
      walk(d.props, vnode);
      for (const c of choices) {
        const child = "tag" in c ? undefined : byName.get(c.child);
        slotsWith(d.slots, (name) => ("tag" in c ? (name === "default" ? true : null) : child !== undefined && slotAsVnodes(child, name)), walk);
      }
      return;
    }
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_ssrRenderComponent") {
      const child = childOf(n.arguments[0]);
      walk(n.arguments[1], vnode);
      slotsWith(n.arguments[2], (name) => (child ? slotAsVnodes(child, name) : false), walk);
      return;
    }
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_ssrRenderSlot" && n.arguments[1]?.type === "StringLiteral") {
      const fallback = n.arguments[3];
      outlets.push({ name: n.arguments[1].value, vnode, fallback: !!fallback && fallback.type !== "NullLiteral", node: n });
    }
    for (const [key, v] of Object.entries(n)) if (key !== "loc" && key !== "start" && key !== "end" && key !== "__fv") walk(v, vnode);
  };
  walk(p.program, false);
  return outlets;
}

function expanded(p: Prepared): string {
  const text = (n: N): string => {
    const inner: N[] = [];
    const find = (x: N): void => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) {
        x.forEach(find);
        return;
      }
      if (x !== n && p.picks.has(x)) {
        inner.push(x);
        return;
      }
      for (const [key, v] of Object.entries(x)) if (key !== "loc" && key !== "__fv") find(v);
    };
    find(n);
    if (p.picks.has(n)) {
      const d = dynamicOf(n)!;
      const arg = (x: N | undefined): string => (x ? text(x) : "null");
      return p.picks
        .get(n)!
        .map((c) =>
          "tag" in c
            ? `_fvElement(${arg(d.props)}, ${arg(d.slots)});`
            : `_push(_ssrRenderComponent($setup[${JSON.stringify(c.local)}], ${arg(d.props)}, ${arg(d.slots)}, ${arg(d.parent)}${d.sid ? `, ${text(d.sid)}` : ""}));`,
        )
        .join("\n");
    }
    inner.sort((a, b) => a.start - b.start);
    let out = "";
    let at = n.start;
    for (const x of inner) {
      out += p.code.slice(at, x.start) + text(x);
      at = x.end;
    }
    return out + p.code.slice(at, n.end);
  };
  return text(p.program);
}

/** Resolve every `<component :is>` of the components before any is generated: the slots whose
 * content renders as virtual nodes, and the compiled templates as the analyses read them, with
 * each `<component :is>` written out as its choices. */
export function prepareDynamic(read: { comp: Component; ast: N[]; ssr: string; scope: Scope }[]): string[] {
  for (const r of read) setupAsts.set(r.comp, r.ast);
  const prepared: Prepared[] = read.map((r) => {
    const program = parseJs(r.ssr, { sourceType: "module" }).program;
    tagAst(program, "template");
    const picks = new Map<N, Choice[]>();
    const visit = (n: N): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        n.forEach(visit);
        return;
      }
      const d = dynamicOf(n);
      if (d) {
        try {
          const choices = choicesOf(pickOf(r.scope, d.is));
          for (const c of choices) if (!("tag" in c)) r.comp.imports.add(c.child);
          picks.set(n, choices);
        } catch (e) {
          if (!(e instanceof GenError)) throw e;
        }
      }
      for (const [key, v] of Object.entries(n)) if (key !== "loc" && key !== "__fv") visit(v);
    };
    visit(program);
    if (picks.size) refuseContentDirectives(r.comp);
    return { comp: r.comp, scope: r.scope, program, code: r.ssr, picks };
  });
  const byName = new Map(read.map((r) => [r.comp.name, r.comp]));
  const outlets = new Map<Component, Outlet[]>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of prepared) {
      if (!p.picks.size && !p.code.includes("_ssrRenderSlot")) continue;
      const found = outletsOf(p, byName);
      outlets.set(p.comp, found);
      const set = vnodeSlots.get(p.comp) ?? new Set<string>();
      for (const o of found) {
        if (o.vnode && !set.has(o.name)) {
          set.add(o.name);
          changed = true;
        }
      }
      vnodeSlots.set(p.comp, set);
    }
  }
  for (const [comp, found] of outlets) {
    for (const o of found) {
      const outlet = `\`<slot${o.name === "default" ? "" : ` name="${o.name}"`}>\``;
      if (o.vnode && o.fallback) {
        fail(comp, "FV0919", `${outlet} has fallback content and is rendered inside an element \`<component :is>\` chooses, where Vue tests its content by other rules: move the fallback into the parent`, o.node);
      }
      if (!o.vnode && found.some((q) => q.vnode && q.name === o.name)) {
        fail(comp, "FV0920", `${outlet} is rendered both inside an element \`<component :is>\` chooses and outside one, where Vue renders the content it is given differently`, o.node);
      }
    }
  }
  return prepared.map(expanded);
}
