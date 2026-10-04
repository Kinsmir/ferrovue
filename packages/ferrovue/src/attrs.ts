/* Attributes as Vue's server renderer writes them: `class`, `style`, booleans, merged objects. */

import { escapeHtml, hyphenate, isBooleanAttr, isSSRSafeAttrName, parseStringStyle, propsToAttrMap } from "@vue/shared";
import { type N, type Scope, type Ty, type Val, fail, GenError, rustStr, STR } from "./model.ts";
import { CONFIG_FILE, ctx } from "./context.ts";
import { cond, expr, known, meet, truthy, unquote } from "./expr.ts";
import { atom, bare, condition, logical, not, receiver, strArg } from "./parens.ts";
import { Emitter } from "./emitter.ts";

/** What a number written at run time is expected to take: most a page shows are shorter, and the
 * reservation is an estimate. */
const NUMBER_BYTES = 6;

/** A string, a number or a boolean written escaped: now when it is known, by JavaScript itself. */
function display(e: Emitter, v: Val): boolean {
  if (v.ty.k === "str" && known(v) !== undefined) e.lit(escapeHtml(unquote(v.code)));
  else if ((v.ty.k === "int" || v.ty.k === "float") && v.num !== undefined) e.lit(String(v.num));
  else if (v.ty.k === "bool" && v.konst !== undefined) e.lit(String(v.konst));
  else if (v.ty.k === "str") e.stmt(`fv::escape_into(out, ${strArg(v.code)});`);
  else if (v.ty.k === "int" || v.ty.k === "float") {
    e.stmt(`fv::${v.ty.k === "int" ? "push_int" : "push_number"}(out, ${bare(v.code)});`);
    // Counted in the reservation, or a page of numbers outgrows it and is copied to a larger one.
    e.expect(NUMBER_BYTES);
  } else if (v.ty.k === "bool") e.stmt(`out.push_str(if ${condition(v.code)} { "true" } else { "false" });`);
  else return false;
  return true;
}

/** `toDisplayString`, escaped. */
export function interpolate(e: Emitter, v: Val): void {
  if (display(e, v)) return;
  switch (v.ty.k) {
    case "undef":
      return;
    // `toDisplayString` of a query value: a string, nothing for `null`, an array as JSON.
    case "query":
      e.stmt(`${atom(v.code)}.write_display(out);`);
      return;
    case "opt":
      e.open(`if let Some(v) = ${v.code}`);
      interpolate(e, { code: "v", ty: v.ty.of });
      e.close();
      return;
    default:
      throw new GenError("only strings, numbers and booleans can be interpolated");
  }
}

/** The value half of `key="value"`, escaped. */
export function attrValue(e: Emitter, v: Val): void {
  if (!display(e, v)) throw new GenError("an attribute value must be a string, a number or a boolean");
}

/** `ssrRenderAttr(key, value)`: absent for null/undefined, `key="value"` for anything else. */
export function renderAttr(e: Emitter, key: string, v: Val): void {
  if (v.ty.k === "undef") return;
  // Only a single query value is an attribute's value; `null` and an array leave it out.
  if (v.ty.k === "query") v = { code: `${atom(v.code)}.attr_value()`, ty: { k: "opt", of: STR } };
  if (v.ty.k === "opt") {
    e.open(`if let Some(v) = ${v.code}`);
    renderAttr(e, key, { code: "v", ty: v.ty.of });
    e.close();
    return;
  }
  e.lit(` ${key}="`);
  attrValue(e, v);
  e.lit(`"`);
}

/** `ssrRenderDynamicAttr(key, value)`: as `renderAttr`, but a boolean attribute is present or
 * absent, and an empty string renders the name alone. */
export function renderDynamicAttr(s: Scope, e: Emitter, key: string, v: Val, n: N): void {
  const name = propsToAttrMap[key] ?? key.toLowerCase();
  if (!isSSRSafeAttrName(name)) fail(s.comp, `unsafe attribute name \`${name}\``, n);
  if (v.ty.k === "undef") return;
  if (v.ty.k === "query") v = { code: `${atom(v.code)}.attr_value()`, ty: { k: "opt", of: STR } };
  const boolean = (t: Ty) => isBooleanAttr(name) || (name === "hidden" && (t.k === "bool" || t.k === "int" || t.k === "float"));
  if (v.ty.k === "opt" && boolean(v.ty.of)) {
    // Present, or truthy when it is not a string: one test, with nothing to bind.
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
    // Re-evaluated rather than bound: every string expression here is a borrow or a pure call.
    attrValue(e, v);
    e.lit(`"`);
    e.close();
    return;
  }
  e.lit(` ${name}="`);
  attrValue(e, v);
  e.lit(`"`);
}

/** One item of a class list once it is flattened: literal text, known now, or a Rust `&str`
 * expression evaluated at run time — empty when the item contributes nothing. */
export type ClassItem = { lit: string } | { code: string };

/** `normalizeClass`'s view of a class binding, flattened: a string, an array of items, an object
 * of `name: condition`, `cond && "name"`, `cond ? "a" : null`. Every item is trimmed and the empty
 * ones dropped before they are joined with one space, which is what `class_into` does too, so an
 * object's keys become items of their own. */
export function classItems(s: Scope, n: N): ClassItem[] {
  switch (n.type) {
    case "StringLiteral": {
      const t = n.value.trim();
      return t ? [{ lit: t }] : [];
    }
    case "ArrayExpression":
      return n.elements.flatMap((el: N) => (el ? classItems(s, el) : []));
    case "ObjectExpression":
      // A computed name may hold spaces, which Vue keeps between the names it joins: such an object
      // is normalised whole, at run time, as Vue normalises it.
      // Normalised whole, at run time, as a JavaScript object: when a name is computed (and may hold
      // spaces, repeat another, or be an array index), or a literal name repeats or is an index —
      // which a JavaScript object lists first, in numeric order.
      const literalNames = n.properties
        .filter((p: N) => p.type === "ObjectProperty" && !p.computed)
        .map((p: N) => (p.key.type === "Identifier" ? p.key.name : String(p.key.value)));
      const arrayIndex = (k: string) => /^(0|[1-9]\d*)$/.test(k) && Number(k) < 2 ** 32 - 1;
      if (
        n.properties.some((p: N) => p.type === "ObjectProperty" && p.computed) ||
        literalNames.some(arrayIndex) ||
        new Set(literalNames).size !== literalNames.length
      ) {
        const keys: Val[] = [];
        const entries = n.properties.map((p: N) => {
          if (p.type !== "ObjectProperty") fail(s.comp, "a class object holds `name: condition` pairs", p);
          const key: Val = p.computed ? expr(s, p.key) : { code: rustStr(p.key.type === "Identifier" ? p.key.name : String(p.key.value)), ty: STR };
          if (key.ty.k !== "str") fail(s.comp, "a computed class name is a string", p.key);
          // Names are told apart, which two halves of surrogate pairs would not be.
          for (const other of keys) meet(s.comp, other, key, "a class object's names", p.key, "equal");
          keys.push(key);
          return `(${bare(cond(s, p.value))}, ${bare(key.code)})`;
        });
        return [{ code: `&*fv::class_object(&[${entries.join(", ")}])` }];
      }
      return n.properties.flatMap((p: N): ClassItem[] => {
        if (p.type !== "ObjectProperty") fail(s.comp, "a class object holds `name: condition` pairs", p);
        // A literal name is written as it is: an object's names are joined, not trimmed one by one.
        let name: ClassItem;
        if (!p.computed) {
          const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
          if (key !== key.trim() || !key) fail(s.comp, `class name \`${key}\` has spaces around it`, p);
          name = { lit: key };
        } else {
          const k = expr(s, p.key);
          if (k.ty.k !== "str") fail(s.comp, "a computed class name is a string", p.key);
          name = { code: `fv::js_trim(${strArg(k.code)})` };
        }
        const v = expr(s, p.value);
        const on = known(v);
        if (on !== undefined) return on ? [name] : [];
        const text = "lit" in name ? rustStr(name.lit) : name.code;
        return [{ code: `if ${condition(truthy(v))} { ${bare(text)} } else { "" }` }];
      });
    case "LogicalExpression":
      if (n.operator === "&&") {
        return conditional(cond(s, n.left), classItems(s, n.right));
      }
      break;
    case "ConditionalExpression":
      if (n.consequent.type === "NullLiteral" || n.alternate.type === "NullLiteral") {
        const branch = n.consequent.type === "NullLiteral" ? n.alternate : n.consequent;
        const test = cond(s, n.test);
        return conditional(n.consequent.type === "NullLiteral" ? not(test) : test, classItems(s, branch));
      }
      break;
  }
  const v = expr(s, n);
  if (v.ty.k === "str") return [{ code: v.code }];
  if (v.ty.k === "opt" && v.ty.of.k === "str") return [{ code: `${atom(v.code)}.unwrap_or("")` }];
  if (v.ty.k === "undef") return [];
  return fail(s.comp, "a class is a string, an array, or an object of conditions", n);
}

/** Class items that apply only when \`test\` holds: each one, or nothing, decided now if it can be. */
function conditional(test: string, items: ClassItem[]): ClassItem[] {
  if (test === "true" || test === "false") return test === "true" ? items : [];
  return items.map((it) => ({ code: `if ${condition(test)} { ${"lit" in it ? rustStr(it.lit) : bare(it.code)} } else { "" }` }));
}

/** `ssrRenderClass(value)`: normalised, then escaped. `after` says a class was already written. */
export function renderClass(s: Scope, e: Emitter, n: N, after = false): void {
  const items = classItems(s, n);
  // Literal items before the first run-time one are written now; the rest go to `class_into`,
  // which decides at run time whether each needs a separator.
  let wrote = after;
  let i = 0;
  for (; i < items.length; i++) {
    const it = items[i]!;
    if (!("lit" in it)) break;
    e.lit((wrote ? " " : "") + escapeHtml(it.lit));
    wrote = true;
  }
  if (i < items.length) {
    const rest = items.slice(i).map((it) => ("lit" in it ? rustStr(it.lit) : it.code));
    e.stmt(`fv::class_into(out, ${wrote}, &[${rest.join(", ")}]);`);
  }
}

export const IGNORED_PROPS = new Set(["", "key", "ref", "innerHTML", "textContent", "ref_key", "ref_for"]);

/** `ssrRenderAttrs(_attrs)` on the root: the scope ids a parent handed it, already written as Vue
 * writes them. They are all `_attrs` holds, since a parent passes a child only the props it
 * declares and nothing else falls through. */
function inheritedAttrs(s: Scope, e: Emitter): void {
  if (s.attrs !== null) e.stmt(`out.push_str(${s.attrs});`);
}

/** `ssrGetDirectiveProps(_ctx, dir)`: a custom directive's server props, which are none for a
 * directive the configuration declares client-only. `false` when `n` is not such a call. */
export function directiveProps(s: Scope, n: N): boolean {
  if (n?.type !== "CallExpression" || n.callee.type !== "Identifier" || n.callee.name !== "_ssrGetDirectiveProps") return false;
  const dir = n.arguments[1];
  // `$setup["vFocus"]` for an imported directive, `_directive_focus` for a registered one.
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

/** `ssrRenderAttrs(obj)`, key by key in the object's order, and the inherited scope ids where the
 * root's `_attrs` is merged in. */
export function renderAttrs(s: Scope, e: Emitter, n: N): void {
  const isAttrs = (a: N): boolean => a.type === "Identifier" && a.name === "_attrs";
  if (isAttrs(n)) {
    inheritedAttrs(s, e);
    return;
  }
  if (directiveProps(s, n)) return;
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_mergeProps") {
    const merged = mergeProps(s, n);
    const at = n.arguments.findIndex(isAttrs);
    if (at < 0) {
      renderAttrs(s, e, merged);
      return;
    }
    // The inherited ids take their place among the keys: after those given before `_attrs`, before
    // those first given after it, such as `v-show`'s `style` when there is no other.
    const before = new Set(mergeProps(s, { ...n, arguments: n.arguments.slice(0, at) }).properties.map((p: N) => p.key.name ?? p.key.value));
    const part = (early: boolean): N => ({ ...merged, properties: merged.properties.filter((p: N) => before.has(p.key.name ?? p.key.value) === early) });
    renderAttrs(s, e, part(true));
    inheritedAttrs(s, e);
    renderAttrs(s, e, part(false));
    return;
  }
  if (n.type !== "ObjectExpression") fail(s.comp, "attributes must be an object literal", n);
  for (const p of n.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "attribute objects hold plain keys", p);
    const raw: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    if (IGNORED_PROPS.has(raw) || /^on[^a-z]/.test(raw) || raw.startsWith(".")) continue;
    // Vue strips the `^` attribute-binding prefix before it looks at the name.
    const key = raw.startsWith("^") ? raw.slice(1) : raw;
    if (key === "className") {
      fail(s.comp, "`className` renders by its own rule in Vue; bind `class`", p);
    } else if (key === "class") {
      e.lit(` class="`);
      renderClass(s, e, p.value);
      e.lit(`"`);
    } else if (key === "style") {
      e.lit(` style="`);
      renderStyle(s, e, p.value);
      e.lit(`"`);
    } else {
      renderDynamicAttr(s, e, key, expr(s, p.value), p);
    }
  }
}

/** `mergeProps(a, _attrs, b, …)` as one object literal, without `_attrs`: it holds only scope ids,
 * which the caller writes after the rest. Of the rest, `class` and `style` values are merged as an
 * array, and any other key keeps the place it first had with the last value given. */
export function mergeProps(s: Scope, n: N): N {
  const merged = new Map<string, N>();
  for (const a of n.arguments) {
    if (a.type === "Identifier" && a.name === "_attrs") continue;
    if (directiveProps(s, a)) continue;
    if (a.type !== "ObjectExpression") fail(s.comp, "`_mergeProps` of object literals is supported", a);
    for (const p of a.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "attribute objects hold plain keys", p);
      const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
      const had = merged.get(key);
      if (had && (key === "class" || key === "style")) {
        merged.set(key, { ...p, value: { type: "ArrayExpression", elements: [had.value, p.value] } });
      } else if (had) {
        // `Map` keeps a key where it was first set, as a JavaScript object does.
        merged.set(key, { ...had, value: p.value });
      } else merged.set(key, p);
    }
  }
  return { type: "ObjectExpression", properties: [...merged.values()] };
}

/** One object of a style binding, and the run-time condition under which it is part of it. */
export interface StyleItem {
  cond: string | null;
  entries: { key: string; css: string; value: N }[];
}

/** The objects a style binding merges, in order: an object literal, a static `style` the compiler
 * parsed, `v-show`'s `cond ? null : { display: "none" }`, and arrays of those. */
export function styleItems(s: Scope, n: N, when: string | null): StyleItem[] {
  // A condition known now: an object that never applies is left out, one that always does is not
  // conditional.
  if (when === "false") return [];
  if (when === "true") when = null;
  const both = (a: string | null, b: string) => (a === null ? b : logical(a, "&&", b));
  switch (n.type) {
    case "NullLiteral":
      return [];
    case "ArrayExpression":
      return n.elements.flatMap((el: N) => (el ? styleItems(s, el, when) : []));
    case "StringLiteral":
      // Parsed as `normalizeStyle` parses a string inside an array, by Vue's own function.
      return [{ cond: when, entries: Object.entries(parseStringStyle(n.value)).map(([key, v]) => ({ key, css: key, value: { type: "StringLiteral", value: v } })) }];
    case "ConditionalExpression": {
      const t = cond(s, n.test);
      return [...styleItems(s, n.consequent, both(when, t)), ...styleItems(s, n.alternate, both(when, not(t)))];
    }
    case "LogicalExpression":
      if (n.operator === "&&") return styleItems(s, n.right, both(when, cond(s, n.left)));
      break;
    case "ObjectExpression":
      return [{
        cond: when,
        entries: n.properties.map((p: N) => {
          if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "a style object holds plain `property: value` pairs", p);
          const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
          // An integer-like key comes first in a JavaScript object whatever the order written.
          if (/^\d+$/.test(key) || key.startsWith(":")) fail(s.comp, `style property \`${key}\``, p);
          return { key, css: key.startsWith("--") ? key : hyphenate(key), value: p.value };
        }),
      }];
  }
  return fail(s.comp, "a style binding is an object, an array of objects, or a string on its own", n);
}

/** `ssrRenderStyle(value)`: a string as it is, or the objects merged — each property where it first
 * appears, with the last value given — and written `name:value;`, all escaped. */
export function renderStyle(s: Scope, e: Emitter, n: N): void {
  // A string on its own is written as it is, with no normalising.
  if (n.type === "StringLiteral") {
    e.lit(escapeHtml(n.value));
    return;
  }
  if (n.type !== "ObjectExpression" && n.type !== "ArrayExpression" && n.type !== "ConditionalExpression" && n.type !== "LogicalExpression" && n.type !== "NullLiteral") {
    const v = expr(s, n);
    if (v.ty.k === "str") e.stmt(`fv::escape_into(out, ${strArg(v.code)});`);
    else if (v.ty.k === "opt" && v.ty.of.k === "str") {
      e.open(`if let Some(v) = ${v.code}`);
      e.stmt("fv::escape_into(out, v);");
      e.close();
    } else if (v.ty.k !== "undef") fail(s.comp, "a style binding is a string, an object or an array", n);
    return;
  }
  const items = styleItems(s, n, null);
  // Each property, where it first appears, with every place that sets it.
  const order: string[] = [];
  const sets = new Map<string, { cond: string | null; css: string; value: N }[]>();
  for (const it of items) {
    for (const en of it.entries) {
      if (!sets.has(en.key)) {
        order.push(en.key);
        sets.set(en.key, []);
      }
      sets.get(en.key)!.push({ cond: it.cond, css: en.css, value: en.value });
    }
  }
  const write = (css: string, value: N): void => {
    // A literal is stringified now, by JavaScript itself: `0.5`, `"1px"`.
    if (value.type === "StringLiteral" || value.type === "NumericLiteral") {
      e.lit(escapeHtml(`${css}:${String(value.value)};`));
      return;
    }
    const v = expr(s, value);
    const one = (w: Val): void => {
      if (w.ty.k === "str" || w.ty.k === "int" || w.ty.k === "float") {
        e.lit(`${escapeHtml(css)}:`);
        display(e, w);
        e.lit(";");
      } else if (w.ty.k === "opt") {
        e.open(`if let Some(v) = ${w.code}`);
        one({ code: "v", ty: w.ty.of });
        e.close();
      }
      // A boolean or `undefined` writes nothing — and, set later, removes what was set before.
    };
    one(v);
  };
  // A property's place is where an object that is present first sets it. When that object is
  // conditional and the property is set again after another one first appears, the order would be
  // decided at run time.
  const flat = items.flatMap((it, i) => it.entries.map((en) => ({ key: en.key, item: i, cond: it.cond })));
  for (const key of order) {
    const at = flat.filter((f) => f.key === key);
    if (at.length < 2 || at[0]!.cond === null) continue;
    const first = flat.indexOf(at[0]!);
    const again = flat.indexOf(at[at.length - 1]!);
    const between = flat.slice(first + 1, again).some((f) => order.indexOf(f.key) > order.indexOf(key));
    if (between) fail(s.comp, `the place of style property \`${key}\` would depend on a condition; set it unconditionally first`, n);
  }
  for (const key of order) {
    // The last place that sets it wins: walked back to the first that always applies.
    const chain: { cond: string | null; css: string; value: N }[] = [];
    for (const set of sets.get(key)!.toReversed()) {
      chain.push(set);
      if (set.cond === null) break;
    }
    if (chain.length === 1 && chain[0]!.cond === null) {
      write(chain[0]!.css, chain[0]!.value);
      continue;
    }
    chain.forEach((set, i) => {
      if (set.cond === null) {
        e.close(" else {");
      } else if (i === 0) {
        e.open(`if ${condition(set.cond)}`);
      } else {
        e.close(` else if ${condition(set.cond)} {`);
      }
      write(set.css, set.value);
    });
    e.close();
  }
}
