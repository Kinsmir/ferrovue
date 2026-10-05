import { relative } from "node:path";
import { type Component, type N, type Scope, type Ty, type Val, absence, blankComponent, camelize, fail, nothing, opt, sameTy, snake } from "../model.ts";
import { ctx } from "../context.ts";
import { type Declared } from "../constants.ts";
import { lookupStruct, markHome, resolveImport, tyOfTs } from "../typescript.ts";
import { describeTy, expr } from "../expr.ts";
import { slotFieldBorrows, slotFieldTy, slotFieldValue } from "../slots.ts";
import { fieldInit, ownInto } from "../children.ts";
import { setupSource } from "../script.ts";
import { header } from "../rust.ts";
import { isTemporary } from "../strings.ts";
import { bare } from "../parens.ts";
import { type Plugin, runOf, scopeOf, slotFieldsOf } from "../plugin.ts";

interface Key {
  id: string;
  label: string;
  file: string | null;
  field: string;
  declared: { ty: Ty | null; ref: boolean } | null;
  ty: Ty | null;
  typedAt: Component | null;
}

interface Site {
  comp: Component;
  node: N;
  key: Key;
}

interface Provided extends Site {
  ref: boolean | Key;
  client: boolean;
}

interface ProvideRun {
  keys: Map<string, Key>;
  provided: Map<N, Provided>;
  injected: Map<N, Site>;
  sites: Map<Component, { provided: Provided[]; injected: Site[] }>;
}

interface ProvideScope {
  provide: Set<string>;
  inject: Set<string>;
  entries: { key: Key; code: string }[];
  lets: string[];
  injected: Set<string>;
}

const REF_CALLS = new Set(["ref", "shallowRef", "computed", "toRef", "customRef", "defineModel"]);
const READONLY = new Set(["readonly", "shallowReadonly"]);
const REACTIVE = new Set(["reactive", "shallowReactive"]);
const REF_TYPES = new Set(["Ref", "ShallowRef", "ComputedRef", "WritableComputedRef"]);
const HELD = new Set(["str", "int", "float", "bool", "list", "struct", "child", "html"]);
const INJECTED = " injected";

function calls(n: N, names: Set<string>): boolean {
  return n?.type === "CallExpression" && n.callee.type === "Identifier" && names.has(n.callee.name);
}

function unwrapped(n: N, names: Set<string>): N {
  let v = n;
  while (calls(v, names)) v = v.arguments[0];
  return v;
}

function vueNames(script: N[]): { provide: Set<string>; inject: Set<string> } {
  const found = { provide: new Set<string>(), inject: new Set<string>() };
  for (const st of script) {
    if (st.type !== "ImportDeclaration" || st.source.value !== "vue") continue;
    for (const sp of st.specifiers) {
      const name: string | null = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
      if (name === "provide" || name === "inject") found[name].add(sp.local.name);
    }
  }
  return found;
}

function importOf(script: N[], local: string): { from: string; name: string } | null {
  for (const st of script) {
    if (st.type !== "ImportDeclaration" || st.importKind === "type") continue;
    for (const sp of st.specifiers) {
      if (sp.type === "ImportSpecifier" && sp.local.name === local && sp.importKind !== "type") return { from: st.source.value, name: sp.imported.name ?? sp.imported.value };
    }
  }
  return null;
}

function symbolInit(init: N): boolean {
  let n = init;
  while (n?.type === "TSAsExpression" || n?.type === "TSSatisfiesExpression") n = n.expression;
  return n?.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "Symbol";
}

function refInner(t: N): N | null {
  if (t?.type !== "TSTypeReference" || t.typeName.type !== "Identifier") return null;
  const arg = t.typeParameters?.params?.[0];
  if (REF_TYPES.has(t.typeName.name)) return arg ?? null;
  if (t.typeName.name === "Readonly") return refInner(arg);
  return null;
}

function declaredOf(d: Declared): { ty: Ty | null; ref: boolean } {
  let t: N = d.node.id.typeAnnotation?.typeAnnotation;
  for (let init = d.node.init; !t && (init?.type === "TSAsExpression" || init?.type === "TSSatisfiesExpression"); init = init.expression) t = init.typeAnnotation;
  const arg = t?.type === "TSTypeReference" && t.typeName.type === "Identifier" && t.typeName.name === "InjectionKey" ? t.typeParameters?.params?.[0] : null;
  if (!arg) fail(d.home, "FV1602", `\`${d.node.id.name}\` names the type of what it is provided with: \`InjectionKey<T>\``, d.node);
  if (arg.type === "TSFunctionType") return { ty: null, ref: false };
  const inner = refInner(arg);
  return { ty: markHome(tyOfTs(d.home, inner ?? arg, ctx.typeStructs), "types"), ref: inner !== null };
}

function fieldName(name: string): string {
  const plain = camelize(name.replace(/[^A-Za-z0-9_-]+/g, "_")).replace(/^(?=\d|$)/, "k_");
  return snake(plain);
}

function keyNamed(comp: Component, n: N, id: string, label: string, file: string | null, field: string, declared: () => Key["declared"]): Key {
  const run = runOf(provideInject);
  const had = run.keys.get(id);
  if (had) return had;
  const clash = [...run.keys.values()].find((k) => k.field === field);
  if (clash) fail(comp, "FV1615", `${label} and ${clash.label} would both be the field \`${field}\` of the generated \`Provides\`; rename one`, n);
  const d = declared();
  const key: Key = { id, label, file, field, declared: d, ty: d?.ty ?? null, typedAt: null };
  run.keys.set(id, key);
  return key;
}

function keyOf(comp: Component, n: N, script: N[]): Key {
  if (n?.type === "StringLiteral" || (n?.type === "TemplateLiteral" && n.expressions.length === 0)) {
    const name: string = n.type === "StringLiteral" ? n.value : n.quasis[0].value.cooked;
    return keyNamed(comp, n, JSON.stringify(name), `\`${JSON.stringify(name)}\``, null, fieldName(name), () => null);
  }
  if (n?.type === "Identifier") {
    const imported = importOf(script, n.name);
    const file = imported ? resolveImport(comp.file, imported.from) : null;
    const decl = file !== null ? ctx.constDecls.get(file)?.get(imported!.name) : undefined;
    if (decl?.exported && decl.node.type === "VariableDeclarator" && symbolInit(decl.node.init)) {
      const rel = relative(ctx.rootDir, file!);
      return keyNamed(comp, n, `${rel}#${imported!.name}`, `\`${imported!.name}\``, rel, snake(imported!.name), () => declaredOf(decl));
    }
  }
  return fail(comp, "FV1601", "an injection key is a string literal, or a `Symbol` exported from one of the project's `.ts` files: `export const ThemeKey: InjectionKey<string> = Symbol()`", n);
}

function refNames(script: N[]): { refs: Set<string>; functions: Set<string> } {
  const refs = new Set<string>();
  const functions = new Set<string>();
  for (const st of script) {
    if (st.type === "FunctionDeclaration" && st.id) functions.add(st.id.name);
    for (const d of st.type === "VariableDeclaration" ? st.declarations : []) {
      const init = d.init;
      if (d.id.type === "Identifier" && (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression")) functions.add(d.id.name);
      if (d.id.type === "Identifier" && calls(init, REF_CALLS)) refs.add(d.id.name);
      if (d.id.type === "ObjectPattern" && calls(init, new Set(["storeToRefs", "toRefs"]))) {
        for (const p of d.id.properties) if (p.type === "ObjectProperty" && p.value.type === "Identifier") refs.add(p.value.name);
      }
    }
  }
  return { refs, functions };
}

function injectCall(init: N, names: Set<string>): N | null {
  let n = init;
  while (n?.type === "TSAsExpression" || n?.type === "TSSatisfiesExpression" || n?.type === "TSNonNullExpression") n = n.expression;
  return calls(n, names) ? n : null;
}

function readSites(comp: Component, script: N[]): void {
  const vue = vueNames(script);
  if (!vue.provide.size && !vue.inject.size) return;
  const run = runOf(provideInject);
  const own: { provided: Provided[]; injected: Site[] } = { provided: [], injected: [] };
  const { refs, functions } = refNames(script);
  const injectedKeys = new Map<string, Key>();
  for (const st of script) {
    for (const d of st.type === "VariableDeclaration" ? st.declarations : []) {
      const call = injectCall(d.init, vue.inject);
      if (!call) continue;
      if (call.arguments.length < 1 || call.arguments.length > 3) fail(comp, "FV1603", "`inject` takes a key, and may take a default and whether the default is a factory", call);
      const site: Site = { comp, node: call, key: keyOf(comp, call.arguments[0], script) };
      run.injected.set(call, site);
      own.injected.push(site);
      if (d.id.type === "Identifier") injectedKeys.set(d.id.name, site.key);
    }
  }
  for (const st of script) {
    const call = st.type === "ExpressionStatement" ? st.expression : null;
    if (!calls(call, vue.provide)) continue;
    if (call.arguments.length !== 2) fail(comp, "FV1603", "`provide` takes a key and a value", call);
    const key = keyOf(comp, call.arguments[0], script);
    const value = unwrapped(call.arguments[1], READONLY);
    const client = value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression" || (value.type === "Identifier" && functions.has(value.name));
    const ref = calls(value, REF_CALLS) || (value.type === "Identifier" && refs.has(value.name)) ? true : value.type === "Identifier" ? (injectedKeys.get(value.name) ?? false) : false;
    const site: Provided = { comp, node: call, key, ref, client };
    run.provided.set(call, site);
    own.provided.push(site);
  }
  run.sites.set(comp, own);
}

function providedAt(key: Key): Provided[] {
  return [...runOf(provideInject).provided.values()].filter((p) => p.key === key);
}

function clientKey(key: Key): boolean {
  if (key.declared) return key.declared.ty === null;
  return providedAt(key)[0]?.client ?? false;
}

function refOf(key: Key, seen: Set<Key> = new Set()): boolean | null {
  if (key.declared) return key.declared.ref;
  if (seen.has(key)) return null;
  seen.add(key);
  for (const p of providedAt(key)) {
    const ref = typeof p.ref === "boolean" ? p.ref : refOf(p.ref, seen);
    if (ref !== null) return ref;
  }
  return null;
}

function providesHere(comp: Component): boolean {
  return runOf(provideInject).sites.get(comp)?.provided.some((p) => !clientKey(p.key)) ?? false;
}

function reads(comp: Component): boolean {
  const own = runOf(provideInject).sites.get(comp);
  return !!own && (providesHere(comp) || own.injected.some((i) => !clientKey(i.key)));
}

function serverKeys(): Key[] {
  return [...runOf(provideInject).keys.values()].filter((k) => !clientKey(k) && k.ty !== null);
}

function lifeOf(name: string): string {
  return serverKeys().some((k) => slotFieldBorrows(k.ty!)) ? `<${name}>` : "";
}

function settle(key: Key, ty: Ty, comp: Component, node: N): void {
  if (key.ty === null) {
    key.ty = ty;
    key.typedAt = comp;
    return;
  }
  if (sameTy(key.ty, ty)) return;
  const was = key.declared ? `${key.label} is declared to hold ${describeTy(key.ty)}` : `${key.label} holds ${describeTy(key.ty)} in ${key.typedAt?.file ?? "another component"}`;
  fail(comp, "FV1608", `${was}, and here ${describeTy(ty)}: every \`provide\` and \`inject\` of a key agree on its type; two objects agree when both are one interface from a shared \`.ts\` file`, node);
}

function isRef(s: Scope, n: N): boolean {
  return calls(n, REF_CALLS) || (n?.type === "Identifier" && s.refs.has(n.name) && !s.locals.has(n.name));
}

function bodyOf(fn: N): N | null {
  if (fn.body.type !== "BlockStatement") return fn.body;
  const only = fn.body.body.length === 1 ? fn.body.body[0] : null;
  return only?.type === "ReturnStatement" ? only.argument : null;
}

function concrete(ty: Ty): boolean {
  if (nothing(ty) || absence(ty) !== null) return false;
  return ty.k === "list" || ty.k === "record" ? concrete(ty.of) : true;
}

function structLiteral(s: Scope, key: Key, obj: N, reactive: boolean, what: string): string {
  if (key.ty?.k !== "struct") {
    const has = key.ty ? `holds ${describeTy(key.ty)}` : "has no declared type";
    fail(s.comp, "FV1611", `an object is ${what} under ${key.label}, which ${has}: use an \`InjectionKey<T>\` whose \`T\` is an interface from a shared \`.ts\` file`, obj);
  }
  const { st, path } = lookupStruct(s.comp, key.ty);
  const given = new Map<string, N>();
  for (const p of obj.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "FV1612", `an object ${what} holds plain keys and values: a function goes under a key of its own`, p);
    const name: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
    const field = st!.fields.find((f) => camelize(f.js) === camelize(name));
    if (!field) fail(s.comp, "FV1612", `\`${st!.name}\` has no field \`${name}\``, p);
    if (p.value.type === "ArrowFunctionExpression" || p.value.type === "FunctionExpression") fail(s.comp, "FV1612", `an object ${what} holds plain keys and values: a function goes under a key of its own`, p);
    if (!reactive && isRef(s, p.value)) {
      fail(s.comp, "FV1612", `\`${name}\` is a ref, which a plain object keeps as one: wrap the object in \`reactive()\`, which reads it, or use \`.value\``, p.value);
    }
    given.set(field.js, p.value);
  }
  const inits = st!.fields.map((f) => {
    const node = given.get(f.js);
    if (!node) {
      if (f.ty.k !== "opt") fail(s.comp, "FV1612", `\`${st!.name}\` requires \`${f.js}\``, obj);
      return `${f.rust}: None`;
    }
    const v = expr(s, setupSource(node) ?? node);
    return fieldInit(f.rust, ownInto(s.comp, { ...v, ty: markHome(v.ty, s.comp.name) }, f.ty, node));
  });
  return `${path}${st!.name} { ${inits.join(", ")} }`;
}

function provideObject(s: Scope, site: Provided, obj: N, reactive: boolean): void {
  const key = site.key;
  const literal = structLiteral(s, key, obj, reactive, "provided");
  const name = `fv_provided_${key.field.replace(/^r#/, "")}`;
  const own = scopeOf(provideInject, s);
  own.lets.push(`let ${name} = ${literal};`);
  own.entries.push({ key, code: `Some(&${name})` });
}

function provide(s: Scope, call: N): void {
  const site = runOf(provideInject).provided.get(call)!;
  const key = site.key;
  const client = clientKey(key);
  if (site.client !== client) {
    fail(s.comp, "FV1619", `${key.label} is provided with ${client ? "a function" : "a value"} elsewhere, and with ${site.client ? "a function" : "a value"} here`, call.arguments[1]);
  }
  if (client) return;
  if (slotFieldsOf(s.comp).length) {
    fail(s.comp, "FV1616", `${s.comp.name} holds \`<RouterView>\`, whose page is rendered from Rust and cannot see what ${s.comp.name} provides; provide ${key.label} through the \`Provides\` the page is rendered with`, call);
  }
  const own = scopeOf(provideInject, s);
  if (own.entries.some((x) => x.key === key)) fail(s.comp, "FV1614", `${key.label} is provided twice by ${s.comp.name}: provide it once`, call);
  const ref = typeof site.ref === "boolean" ? site.ref : refOf(site.ref);
  const want = refOf(key);
  if (want !== null && ref !== null && ref !== want) {
    fail(s.comp, "FV1613", `${key.label} is provided ${want ? "as a ref" : "as a plain value"} elsewhere, and ${ref ? "as a ref" : "as a plain value"} here: \`.value\` on what is injected would read differently`, call.arguments[1]);
  }
  const value = unwrapped(call.arguments[1], READONLY);
  const reactive = calls(value, REACTIVE);
  const inner = reactive ? value.arguments[0] : value;
  if (inner?.type === "ObjectExpression") {
    provideObject(s, site, inner, reactive);
    return;
  }
  const node = setupSource(inner) ?? inner;
  const v = expr(s, node);
  if (nothing(v.ty) || absence(v.ty) !== null) {
    fail(s.comp, "FV1609", `the value provided under ${key.label} may be ${describeTy(v.ty).replace(/^an optional .*/, "`undefined`")}, which \`inject\` hands on as it is where its default would apply without a provider: fall back with \`??\` before providing it`, call.arguments[1]);
  }
  if (!HELD.has(v.ty.k)) fail(s.comp, "FV1610", `${describeTy(v.ty)} is provided under ${key.label}, which the generated \`Provides\` has no field type for`, call.arguments[1]);
  if (v.ty.k === "list" && (v.iter !== undefined || v.code.startsWith("["))) {
    fail(s.comp, "FV1610", "a provided list is one the component holds: a prop, or a `computed` of one", call.arguments[1]);
  }
  settle(key, markHome(v.ty, s.comp.name), s.comp, call.arguments[1]);
  if (isTemporary(v)) {
    const name = `fv_provided_${key.field.replace(/^r#/, "")}`;
    own.lets.push(`let ${name} = ${bare(v.code)};`);
    own.entries.push({ key, code: `Some(${name})` });
    return;
  }
  own.entries.push({ key, code: `Some(${slotFieldValue(s, v, node)})` });
}

function inject(s: Scope, d: N, init: N, asserted: boolean, lets: string[]): void {
  const site = runOf(provideInject).injected.get(init)!;
  const key = site.key;
  if (asserted) fail(s.comp, "FV1605", `\`!\` asserts that an ancestor provides ${key.label}, which a render without one breaks: read it with \`?.\`, or give \`inject\` a default`, d.init);
  if (d.id.type !== "Identifier") fail(s.comp, "FV1604", "what `inject` returns is bound to a name: `const theme = inject(ThemeKey)`", d.id);
  const local: string = d.id.name;
  if (clientKey(key)) {
    s.clientOnly.set(local, "it is injected under a key that holds a function, which only an event handler may call");
    return;
  }
  const [, dflt, factory] = init.arguments as N[];
  if (factory !== undefined && factory.type !== "BooleanLiteral") fail(s.comp, "FV1603", "`inject`'s third argument is `true` or `false`", factory);
  const fn = dflt?.type === "ArrowFunctionExpression" || dflt?.type === "FunctionExpression";
  let fallback: N = dflt ?? null;
  if (factory?.value) {
    fallback = fn && dflt.params.length === 0 ? bodyOf(dflt) : null;
    if (fallback === null) fail(s.comp, "FV1607", "with `true`, `inject`'s default is a function of no arguments returning the value: `inject(key, () => …, true)`", dflt ?? init);
  } else if (fn) {
    fail(s.comp, "FV1607", "a function given as `inject`'s default is the value itself, which only an event handler may call; pass `true` as the third argument to call it for the value", dflt);
  }
  let defaultRef: boolean | null = null;
  if (fallback !== null) {
    defaultRef = calls(fallback, REF_CALLS);
    if (defaultRef) fallback = setupSource(fallback) ?? fallback;
  }
  const keyRef = refOf(key);
  if (keyRef !== null && defaultRef !== null && keyRef !== defaultRef) {
    fail(s.comp, "FV1613", `${key.label} is provided ${keyRef ? "as a ref" : "as a plain value"}, and this default is ${defaultRef ? "a ref" : "not one"}: \`.value\` would read differently with a provider and without one; make the default ${keyRef ? "`ref(…)` or `computed(…)`" : "a plain value"}`, dflt);
  }
  const typeArg = init.typeParameters?.params?.[0];
  if (typeArg) settle(key, markHome(tyOfTs(s.comp, refInner(typeArg) ?? typeArg, s.comp.structs), s.comp.name), s.comp, typeArg);
  const object = fallback !== null ? unwrapped(fallback, REACTIVE) : null;
  if (object?.type === "ObjectExpression") {
    const literal = structLiteral(s, key, object, defaultRef === true || calls(fallback, REACTIVE), "given as a default");
    const name = `fv_default_${snake(local).replace(/^r#/, "")}`;
    lets.push(`let ${name} = ${literal};`);
    s.setup.set(local, { code: `${providesHere(s.comp) ? "fv_inherited" : "fv_provides"}.${key.field}.unwrap_or(&${name})`, ty: key.ty! });
    if (keyRef ?? defaultRef ?? false) s.refs.add(local);
    scopeOf(provideInject, s).injected.add(local);
    return;
  }
  if (key.ty === null && fallback !== null) {
    const ty = expr(s, fallback).ty;
    if (concrete(ty)) settle(key, markHome(ty, s.comp.name), s.comp, fallback);
  }
  if (key.ty === null) {
    fail(s.comp, "FV1606", `${key.label} has no type here: give \`inject\` a type argument, \`inject<string>(${key.label.slice(1, -1)})\`, or a default`, init);
  }
  const raw: Val = { code: `${providesHere(s.comp) ? "fv_inherited" : "fv_provides"}.${key.field}`, ty: opt(key.ty) };
  let v = raw;
  if (fallback !== null) {
    s.locals.set(INJECTED, raw);
    try {
      v = expr(s, { type: "LogicalExpression", operator: "??", left: { type: "Identifier", name: INJECTED }, right: fallback });
    } finally {
      s.locals.delete(INJECTED);
    }
  }
  s.setup.set(local, v);
  if (keyRef ?? defaultRef ?? false) s.refs.add(local);
  scopeOf(provideInject, s).injected.add(local);
}

function rootName(n: N): string | null {
  let target = n;
  while (target?.type === "MemberExpression") target = target.object;
  return target?.type === "Identifier" ? target.name : null;
}

function stringInject(comp: Component, seen: Set<Component>): Key | null {
  if (seen.has(comp)) return null;
  seen.add(comp);
  const own = runOf(provideInject).sites.get(comp)?.injected.find((i) => i.key.file === null && !clientKey(i.key));
  if (own) return own.key;
  for (const name of comp.imports) {
    const child = ctx.components.get(name);
    const found = child ? stringInject(child, seen) : null;
    if (found) return found;
  }
  return null;
}

function providesSource(): string {
  const home = blankComponent("provides", "provides", "provides");
  const keys = serverKeys();
  const fields = keys.map((k) => {
    const where = k.file === null ? "" : `, exported from \`${k.file}\``;
    return `    /// What is provided under ${k.label}${where}.\n    pub ${k.field}: Option<${slotFieldTy(k.ty!, home).replace(/'v\b/g, "'p")}>,`;
  });
  const life = lifeOf("'p");
  const debug = keys.some((k) => JSON.stringify(k.ty).includes('"html"')) ? "" : "Debug, ";
  return `${header(ctx.componentsDir, "the components")}
//! What components \`provide\` and \`inject\`, which each render hands on to the components below it.

${fields.some((f) => /Cow</.test(f)) ? "use std::borrow::Cow;\n\n" : ""}/// What a component's ancestors provide, by key, as it renders: \`None\` where none does, and
/// \`inject\` gives its default. A component rendered from Rust takes one: [\`Provides::default()\`],
/// or the values the client app gives \`app.provide\`.
#[derive(${debug}Clone, Copy, Default)]
pub struct Provides${life} {
${fields.join("\n")}
}
`;
}

export const provideInject: Plugin<ProvideRun, ProvideScope> = {
  name: "provide",
  configure: () => ({ keys: new Map(), provided: new Map(), injected: new Map(), sites: new Map() }),
  compiled: (comp, _code, script) => readSites(comp, script),
  scope: () => ({ provide: new Set(), inject: new Set(), entries: [], lets: [], injected: new Set() }),
  scriptImport(s, st, from) {
    if (from !== "vue") return false;
    const names = vueNames([st]);
    const own = scopeOf(provideInject, s);
    for (const n of names.provide) own.provide.add(n);
    for (const n of names.inject) own.inject.add(n);
    return false;
  },
  scriptBinding(s, d, lets) {
    const own = scopeOf(provideInject, s);
    if (!own.inject.size) return false;
    let init = d.init;
    let asserted = false;
    while (init?.type === "TSAsExpression" || init?.type === "TSSatisfiesExpression" || init?.type === "TSNonNullExpression") {
      asserted ||= init.type === "TSNonNullExpression";
      init = init.expression;
    }
    if (!calls(init, own.inject)) return false;
    inject(s, d, init, asserted, lets);
    return true;
  },
  scriptStatement(s, st) {
    const own = scopeOf(provideInject, s);
    const e = st.expression;
    if (calls(e, own.provide)) {
      provide(s, e);
      return true;
    }
    const target = e?.type === "AssignmentExpression" ? e.left : e?.type === "UpdateExpression" ? e.argument : null;
    const root = rootName(target);
    if (root !== null && own.injected.has(root)) {
      fail(s.comp, "FV1618", `setup assigns to \`${root}\`, which an ancestor provides: the components rendered before this one would show the value it had`, st);
    }
    return false;
  },
  call(s, n) {
    const own = scopeOf(provideInject, s);
    if (calls(n, own.inject)) fail(s.comp, "FV1620", "`inject` is called at the top of `<script setup>` and bound to a name: `const theme = inject(ThemeKey)`", n);
    if (calls(n, own.provide)) fail(s.comp, "FV1620", "`provide` is a statement of its own at the top of `<script setup>`", n);
    return null;
  },
  child(s, child, n) {
    if (s.opaque === null || !child.takes.has("fv_provides")) return;
    const key = stringInject(child, new Set());
    if (key) {
      fail(s.comp, "FV1617", `${child.name} injects ${key.label}, in the slot of ${s.opaque}, a Rust twin whose component may provide that key on the client: use an \`InjectionKey\` symbol`, n);
    }
  },
  prelude(s) {
    const own = scopeOf(provideInject, s);
    if (!providesHere(s.comp)) return { before: [], after: [] };
    const all = own.entries.length === serverKeys().length;
    const fields = own.entries.map((x) => fieldInit(x.key.field, x.code));
    return {
      before: ["let fv_inherited = fv_provides;"],
      after: [...own.lets, `let fv_provides = super::provides::Provides { ${[...fields, ...(all ? [] : ["..fv_inherited"])].join(", ")} };`],
    };
  },
  params: [
    {
      name: "fv_provides",
      get ty() {
        return `super::provides::Provides${lifeOf("'_")}`;
      },
      get pageTy() {
        return `super::provides::Provides${lifeOf("'p")}`;
      },
      reads,
      test: { lines: [], arg: "provides::Provides::default()" },
      get slotContext() {
        return `provides::Provides${lifeOf("'_")}`;
      },
    },
  ],
  modules: () => (serverKeys().length && [...ctx.components.values()].some((c) => c.takes.has("fv_provides")) ? [["provides.rs", providesSource()]] : []),
};
