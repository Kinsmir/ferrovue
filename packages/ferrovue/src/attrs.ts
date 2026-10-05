import { escapeHtml, hyphenate, isBooleanAttr, isSSRSafeAttrName, propsToAttrMap } from "@vue/shared";
import { type N, type Scope, type Ty, type Val, fail, nothing, GenError, rustStr } from "./model.ts";
import { CONFIG_FILE, ctx } from "./context.ts";
import { describeTy, expr } from "./expr.ts";
import { known, truthy } from "./narrowing.ts";
import { asCow, isTemporary, unquote } from "./strings.ts";
import { atom, bare, condition, receiver, strArg } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { isDollarAttrs } from "./fallthrough.ts";
import { claim } from "./plugin.ts";
import { classAttr, classPresent, literalClass, maybeEqual, renderClass } from "./classes.ts";
import { mergedStyle, renderStyle, styleAttr } from "./styles.ts";

const NUMBER_BYTES = 6;

export function display(e: Emitter, v: Val): boolean {
  if (v.ty.k === "str" && known(v) !== undefined) e.lit(escapeHtml(unquote(v.code)));
  else if ((v.ty.k === "int" || v.ty.k === "float") && v.num !== undefined) e.lit(String(v.num));
  else if (v.ty.k === "bool" && v.konst !== undefined) e.lit(String(v.konst));
  else if (v.ty.k === "str") e.stmt(`fv::escape_into(out, ${strArg(v.code)});`);
  else if (v.ty.k === "int" || v.ty.k === "float") {
    e.stmt(`fv::${v.ty.k === "int" ? "push_int" : "push_number"}(out, ${bare(v.code)});`);
    e.expect(NUMBER_BYTES);
  } else if (v.ty.k === "bool") e.stmt(`out.push_str(if ${condition(v.code)} { "true" } else { "false" });`);
  else return false;
  return true;
}

export function interpolate(s: Scope, e: Emitter, v: Val, n: N): void {
  if (display(e, v)) return;
  switch (v.ty.k) {
    case "undef":
    case "null":
      return;
    case "opt":
      e.open(`if let Some(v) = ${v.code}`);
      interpolate(s, e, { code: "v", ty: v.ty.of }, n);
      e.close();
      return;
    default:
      if (ctx.plugins.some((p) => p.values?.interpolate?.(e, v))) return;
      fail(s.comp, `\`{{ }}\` of ${describeTy(v.ty)}: only strings, numbers and booleans can be interpolated`, n);
  }
}

export function attrValue(e: Emitter, v: Val): void {
  if (!display(e, v)) throw new GenError("an attribute value must be a string, a number or a boolean");
}

function renderable(s: Scope, key: string, v: Val, n: N): void {
  const ty = v.ty.k === "opt" ? v.ty.of : v.ty;
  if (ty.k === "str" || ty.k === "int" || ty.k === "float" || ty.k === "bool" || nothing(ty)) return;
  const own = claim((p) => p.values?.unbindable?.(ty));
  const what = own?.what ?? describeTy(ty);
  const fix = own?.fix ?? (ty.k === "list" ? 'join it into one string, as `.join(",")`' : "bind a string, a number or a boolean");
  fail(s.comp, `\`${key}\` is bound to ${what}: Vue's server renderer leaves the attribute out, and hydration then sets it, changing the page; ${fix}`, n);
}

export function renderAttr(s: Scope, e: Emitter, key: string, v: Val, n: N): void {
  renderable(s, key, v, n);
  if (nothing(v.ty)) return;
  if (v.ty.k === "opt") {
    e.open(`if let Some(v) = ${v.code}`);
    renderAttr(s, e, key, { code: "v", ty: v.ty.of }, n);
    e.close();
    return;
  }
  e.lit(` ${key}="`);
  attrValue(e, v);
  e.lit(`"`);
}

export function renderDynamicAttr(s: Scope, e: Emitter, key: string, v: Val, n: N): void {
  const name = propsToAttrMap[key] ?? key.toLowerCase();
  if (!isSSRSafeAttrName(name)) fail(s.comp, `unsafe attribute name \`${name}\``, n);
  renderable(s, key, v, n);
  if (nothing(v.ty)) return;
  const boolean = (t: Ty) => isBooleanAttr(name) || (name === "hidden" && (t.k === "bool" || t.k === "int" || t.k === "float"));
  if (v.ty.k === "opt" && boolean(v.ty.of)) {
    e.open(`if ${v.ty.of.k === "str" ? `${atom(v.code)}.is_some()` : truthy(v)}`);
    e.lit(` ${name}`);
    e.close();
    return;
  }
  if (v.ty.k === "opt") {
    e.open(`if let Some(v) = ${v.code}`);
    renderDynamicAttr(s, e, key, { code: "v", ty: v.ty.of }, n);
    e.close();
    return;
  }
  if (boolean(v.ty)) {
    const k = v.ty.k === "str" ? true : known(v);
    if (k === true) e.lit(` ${name}`);
    else if (k === undefined) {
      e.open(`if ${condition(truthy(v))}`);
      e.lit(` ${name}`);
      e.close();
    }
    return;
  }
  if (v.ty.k === "str" && known(v) === false) {
    e.lit(` ${name}`);
    return;
  }
  if (v.ty.k === "str" && known(v) === undefined) {
    e.open(`if ${receiver(v.code)}.is_empty()`);
    e.lit(` ${name}`);
    e.close(" else {");
    e.lit(` ${name}="`);
    attrValue(e, v);
    e.lit(`"`);
    e.close();
    return;
  }
  e.lit(` ${name}="`);
  attrValue(e, v);
  e.lit(`"`);
}

export const IGNORED_PROPS = new Set(["", "key", "ref", "innerHTML", "textContent", "ref_key", "ref_for"]);

function inheritedAttrs(s: Scope, e: Emitter): void {
  if (s.attrs !== null) e.stmt(`out.push_str(${s.attrs});`);
}

export function directiveProps(s: Scope, n: N): boolean {
  if (n?.type !== "CallExpression" || n.callee.type !== "Identifier" || n.callee.name !== "_ssrGetDirectiveProps") return false;
  const dir = n.arguments[1];
  let name: string | null = null;
  if (dir?.type === "MemberExpression") {
    const local: string = dir.computed ? dir.property.value : dir.property.name;
    name = hyphenate(local.replace(/^v(?=[A-Z])/, "")).replace(/^-/, "");
  } else if (dir?.type === "Identifier") name = s.directives.get(dir.name) ?? null;
  if (name === null || !ctx.clientDirectives.has(name)) {
    fail(s.comp, `custom directive \`v-${name ?? "?"}\` may add attributes on the server; if it has no \`getSSRProps\`, list \`${name ?? "?"}\` in \`clientDirectives\` in ${CONFIG_FILE}`, n);
  }
  return true;
}

export function isAttrs(n: N): boolean {
  return n?.type === "Identifier" && n.name === "_attrs";
}

export function dollarAttrs(s: Scope, n: N): boolean {
  if (!isDollarAttrs(n, s.attrsBindings)) return false;
  if (s.comp.idsInAttrs) {
    fail(s.comp, `\`$attrs\` in ${s.comp.name}, the root of a component that may be handed scope ids: it would hold them as attributes too`, n);
  }
  return true;
}

export function mergedParts(n: N): N[] {
  return n?.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_mergeProps" ? n.arguments : [n];
}

export function renderAttrs(s: Scope, e: Emitter, n: N): void {
  const parts = mergedParts(n);
  const passed = (p: N): boolean => s.fallthrough !== null && ((isAttrs(p) && s.comp.inheritAttrs) || dollarAttrs(s, p));
  if (!parts.some(passed)) {
    staticAttrs(s, e, n);
    return;
  }
  e.open(`if ${s.fallthrough}.is_empty()`);
  const at = e.lines.length;
  staticAttrs(s, e, n);
  e.flush();
  if (e.lines.length === at) e.replace(at - 1, `if ${s.fallthrough}.is_empty()`, `if !${s.fallthrough}.is_empty()`);
  else e.close(" else {");
  if (parts.length === 1 && parts[0] === n) {
    e.stmt(`fv::passed_attrs_into(out, ${s.fallthrough}.list(), ${isAttrs(n) && s.attrs !== null ? s.attrs : '""'});`);
    e.close();
    return;
  }
  const sources: string[] = [];
  let idsAt = -1;
  for (const p of parts) {
    if (directiveProps(s, p)) continue;
    if (isAttrs(p)) idsAt = sources.length;
    if (passed(p)) sources.push(`${s.fallthrough}.list()`);
    else if (isAttrs(p)) sources.push("&[]");
    else if (p.type === "ObjectExpression") sources.push(`&[${attrEntries(s, p, "own").join(", ")}]`);
    else fail(s.comp, "attributes must be an object literal", p);
  }
  const ids = idsAt >= 0 && s.attrs !== null ? s.attrs : '""';
  e.stmt(`fv::attrs_into(out, &[${sources.join(", ")}], ${idsAt >= 0 ? idsAt : sources.length}, ${ids});`);
  e.close();
}

function staticAttrs(s: Scope, e: Emitter, n: N): void {
  if (isAttrs(n)) {
    inheritedAttrs(s, e);
    return;
  }
  if (dollarAttrs(s, n) || directiveProps(s, n)) return;
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_mergeProps") {
    const merged = mergeProps(s, n);
    const at = n.arguments.findIndex(isAttrs);
    if (at < 0) {
      objectAttrs(s, e, merged, true);
      return;
    }
    const before = new Set(mergeProps(s, { ...n, arguments: n.arguments.slice(0, at) }).properties.map((p: N) => p.key.name ?? p.key.value));
    const part = (early: boolean): N => ({ ...merged, properties: merged.properties.filter((p: N) => before.has(p.key.name ?? p.key.value) === early) });
    objectAttrs(s, e, part(true), true);
    inheritedAttrs(s, e);
    objectAttrs(s, e, part(false), true);
    return;
  }
  objectAttrs(s, e, n, false);
}

function objectAttrs(s: Scope, e: Emitter, n: N, merged: boolean): void {
  if (n.type !== "ObjectExpression") fail(s.comp, "attributes must be an object literal", n);
  for (const p of n.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "attribute objects hold plain keys", p);
    const raw: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    if (IGNORED_PROPS.has(raw) || /^on[^a-z]/.test(raw) || raw.startsWith(".")) continue;
    const key = raw.startsWith("^") ? raw.slice(1) : raw;
    if (key === "className") {
      fail(s.comp, "`className` renders by its own rule in Vue; bind `class`", p);
    } else if (key === "class") {
      const present = merged ? classPresent(s, p.value) : "true";
      if (present === "false") continue;
      if (present !== "true") e.open(`if ${condition(present)}`);
      e.lit(` class="`);
      renderClass(s, e, p.value);
      e.lit(`"`);
      if (present !== "true") e.close();
    } else if (key === "style") {
      e.lit(` style="`);
      if (merged) mergedStyle(s, e, p.value);
      else renderStyle(s, e, p.value);
      e.lit(`"`);
    } else {
      renderDynamicAttr(s, e, key, expr(s, p.value), p);
    }
  }
}

export function mergeProps(s: Scope, n: N): N {
  const merged = new Map<string, N>();
  for (const a of n.arguments) {
    if (isAttrs(a) || dollarAttrs(s, a)) continue;
    if (directiveProps(s, a)) continue;
    if (a.type !== "ObjectExpression") fail(s.comp, "`_mergeProps` of object literals is supported", a);
    for (const p of a.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "attribute objects hold plain keys", p);
      const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
      const had = merged.get(key);
      if (had && key === "class" && maybeEqual(s, p.value)) {
        const before = literalClass(had.value);
        if (before === null || p.value.type !== "StringLiteral") {
          fail(s.comp, "a class merged with a string that may equal the class before it, which Vue then writes once: bind an array", p);
        }
        if (before !== p.value.value) merged.set(key, { ...p, value: { type: "ArrayExpression", elements: [had.value, p.value], fvMerged: true } });
      } else if (had && (key === "class" || key === "style")) {
        merged.set(key, { ...p, value: { type: "ArrayExpression", elements: [had.value, p.value], fvMerged: true } });
      } else if (had) {
        merged.set(key, { ...had, value: p.value });
      } else merged.set(key, p);
    }
  }
  return { type: "ObjectExpression", properties: [...merged.values()] };
}

export function attrEntries(s: Scope, obj: N, side: "vnode" | "own"): string[] {
  const out: string[] = [];
  for (const p of obj.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "attribute objects hold plain keys", p);
    const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
    if (IGNORED_PROPS.has(key) || /^on[^a-z]/.test(key) || key.startsWith(".")) continue;
    out.push(`(${rustStr(key)}, ${attrOf(s, key, p.value, side)})`);
  }
  return out;
}

export function attrOf(s: Scope, key: string, n: N, side: "vnode" | "own"): string {
  if (key === "className") fail(s.comp, "`className` renders by its own rule in Vue; bind `class`", n);
  if (key === "class") return classAttr(s, n, side);
  if (key === "style") return styleAttr(s, n);
  if (n.type === "NullLiteral") return "fv::Attr::Undefined";
  return valueAttr(s, expr(s, n), n);
}

export function valueAttr(s: Scope, v: Val, n: N): string {
  switch (v.ty.k) {
    case "str":
      return isTemporary(v) ? `fv::Attr::Str(${asCow(v)})` : `fv::Attr::str(${strArg(v.code)})`;
    case "int":
      return `fv::Attr::Int(${bare(v.code)})`;
    case "float":
      return `fv::Attr::Float(${bare(v.code)})`;
    case "bool":
      return `fv::Attr::Bool(${bare(v.code)})`;
    case "undef":
    case "null":
      return "fv::Attr::Undefined";
    case "opt": {
      const of = v.ty.of.k;
      const make = of === "str" ? "fv::Attr::str" : of === "int" ? "fv::Attr::Int" : of === "float" ? "fv::Attr::Float" : of === "bool" ? "fv::Attr::Bool" : null;
      if (make !== null) return `${atom(v.code)}.map_or(fv::Attr::Undefined, ${make})`;
    }
  }
  return fail(s.comp, "an attribute that may fall through is a string, a number or a boolean", n);
}
