/* The compiled template's statements: pushes, conditions, lists, child components and slots. */

import { type Component, type Field, type N, type Scope, type Struct, type Ty, type Val, camelize, declares, fail, GenError, INT, rustStr, sameTy, snake, STR, takesAttrs } from "./model.ts";
import { ctx } from "./context.ts";
import { markHome } from "./typescript.ts";
import { expr, fieldVal } from "./expr.ts";
import { isObjectCall } from "./calls.ts";
import { type Presence, boolOf, cond, known, narrowTo, presence, truthy } from "./narrowing.ts";
import { asF64 } from "./numbers.ts";
import { atom, bare, CMP, condition, occurrences, operand, OR, strArg, UNARY } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { attrOf, dollarAttrs, IGNORED_PROPS, interpolate, isAttrs, mergedParts, renderAttr, renderAttrs, renderClass, renderDynamicAttr, renderStyle } from "./attrs.ts";
import { passedKey } from "./fallthrough.ts";
import { isSSRSafeAttrName, propsToAttrMap } from "@vue/shared";
import { rustTy } from "./rust.ts";
import { claim, paramsOf, slotFieldsOf } from "./plugin.ts";

/** One `${...}` inside a pushed template literal. */
export function slot(s: Scope, e: Emitter, n: N): void {
  // The slot scope id slot content is given, written onto its elements: nothing unless the
  // component it is given to passes one.
  if (n.type === "Identifier" && n.name === "_scopeId") {
    if (s.sid !== null) e.stmt(`out.push_str(${s.sid});`);
    return;
  }
  if (n.type === "CallExpression" && n.callee.type === "Identifier") {
    const a: N[] = n.arguments;
    switch (n.callee.name) {
      case "_ssrInterpolate":
        interpolate(e, expr(s, a[0]));
        return;
      case "_ssrRenderAttr":
        if (a[0].type !== "StringLiteral") fail(s.comp, "attribute names are literal", n);
        renderAttr(s, e, a[0].value, expr(s, a[1]), a[1]);
        return;
      // `:hidden`, whose rendering depends on the value's type: Vue cannot decide it at compile time.
      case "_ssrRenderDynamicAttr":
        if (a[0].type !== "StringLiteral") fail(s.comp, "attribute names are literal", n);
        renderDynamicAttr(s, e, a[0].value, expr(s, a[1]), n);
        return;
      case "_ssrRenderAttrs":
        if (a.length > 1) fail(s.comp, "`ssrRenderAttrs` with a tag argument", n);
        renderAttrs(s, e, a[0]);
        return;
      case "_ssrRenderClass":
        renderClass(s, e, a[0]);
        return;
      case "_ssrRenderStyle":
        renderStyle(s, e, a[0]);
        return;
    }
  }
  /* `v-html`, which Vue compiles to the bare value with an empty-string fallback and no escaping.
   * Only a `TrustedHtml` prop may arrive here; anything else would be a string written raw. */
  if (n.type === "LogicalExpression" && n.operator === "??" && n.right.type === "StringLiteral" && n.right.value === "") {
    const v = expr(s, n.left);
    if (v.ty.k === "html") {
      e.stmt(`fv::trusted_into(out, ${v.code});`);
      return;
    }
    if (v.ty.k === "opt" && v.ty.of.k === "html") {
      e.open(`if let Some(html) = ${v.code}`);
      e.stmt("fv::trusted_into(out, html);");
      e.close();
      return;
    }
    fail(s.comp, "`v-html` renders only a `TrustedHtml` prop (from `ferrovue/types`)", n);
  }
  if (n.type === "ConditionalExpression" && n.consequent.type === "StringLiteral" && n.alternate.type === "StringLiteral") {
    const t = expr(s, n.test);
    const k = known(t);
    if (k !== undefined) {
      e.lit(k ? n.consequent.value : n.alternate.value);
      return;
    }
    e.open(`if ${condition(truthy(t))}`);
    e.lit(n.consequent.value);
    if (n.alternate.value) {
      e.close(" else {");
      e.lit(n.alternate.value);
    }
    e.close();
    return;
  }
  fail(s.comp, "this expression cannot be rendered on the server", n);
}

/** `isComment` in `@vue/server-renderer`: a chunk that is only comments and whitespace. */
export function isComment(text: string): boolean {
  if (!/^<!--[\s\S]*-->$/.test(text)) return false;
  return text.length <= 8 || !text.replace(/<!--[^]*?-->/gm, "").trim();
}

/** Whether a `_push` argument is content to `ssrRenderSlot` rather than only comments — `"run"`
 * when that depends on the values it interpolates (`${of1}<!--[-->` is a comment when `of1` writes
 * nothing). Vue asks it of each pushed string, so the generated code asks `fv::is_comment` of what
 * that push wrote. */
export function pushesContent(n: N): boolean | "run" {
  if (n.type === "StringLiteral") return !isComment(n.value);
  if (n.type === "TemplateLiteral") {
    const quasis: string[] = n.quasis.map((q: N) => q.value.cooked);
    if (n.expressions.length === 0) return !isComment(quasis[0]!);
    // A comment starts with `<!--` and ends with `-->`: literal text that cannot decides it now.
    const first = quasis[0]!;
    const last = quasis.at(-1)!;
    if (!"<!--".startsWith(first) && !first.startsWith("<!--")) return true;
    if (!"-->".endsWith(last) && !last.endsWith("-->")) return true;
    /* An interpolated value is escaped, so it writes no `<` or `>`: every comment starts and ends in
     * the literal text — unless a value is raw (`v-html`), or a marker could be split across text
     * and a value. Then literal text left over once the comments are taken out is content, whatever
     * the values write. */
    const raw = n.expressions.some((x: N) => x.type !== "CallExpression" && !(x.type === "Identifier" && x.name === "_scopeId"));
    const split = quasis.some((q, i) => (i > 0 && /^(?:-|--|!--|->|>)/.test(q)) || (i < quasis.length - 1 && /(?:<|<!|<!-|-|--)$/.test(q)));
    if (!raw && !split && /\S/.test(quasis.join("\0").replace(/<!--[^]*?-->/g, "").replaceAll("\0", ""))) return true;
    return "run";
  }
  // A component's render is a buffer, never a comment.
  return true;
}

export function push(s: Scope, e: Emitter, n: N): void {
  const content = s.fill ? pushesContent(n) : false;
  if (content === true) e.stmt("filled = true;");
  if (content !== "run") {
    pushed(s, e, n);
    return;
  }
  e.stmt("let fv_chunk = out.len();");
  pushed(s, e, n);
  e.stmt("filled |= !fv::is_comment(&out[fv_chunk..]);");
}

/** What one `_push` writes. */
function pushed(s: Scope, e: Emitter, n: N): void {
  const text = n.type === "StringLiteral" ? n.value : n.type === "TemplateLiteral" && !n.expressions.length ? n.quasis[0].value.cooked : null;
  if (s.vnode && text === "<!---->") {
    e.lit("<!--v-if-->");
    return;
  }
  if (n.type === "StringLiteral") {
    e.lit(n.value);
    return;
  }
  if (n.type === "TemplateLiteral") {
    n.quasis.forEach((q: N, i: number) => {
      e.lit(q.value.cooked);
      if (i < n.expressions.length) slot(s, e, n.expressions[i]);
    });
    return;
  }
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_ssrRenderComponent") {
    // A component a plugin renders itself, such as `<RouterLink>`, or an imported one.
    if (!ctx.plugins.some((p) => p.component?.(s, e, n))) renderChild(s, e, n);
    return;
  }
  fail(s.comp, "this cannot be pushed", n);
}

export function renderChild(s: Scope, e: Emitter, n: N): void {
  const [target, rawProps, slots, , slotScopeId] = n.arguments;
  let local: string | null = null;
  if (target.type === "MemberExpression" && target.object.name === "$setup") {
    local = target.computed ? target.property.value : target.property.name;
  }
  const isSelf = target.type === "Identifier" && target.name === s.selfAlias.name;
  const childName = isSelf ? s.comp.name : local ? s.children.get(local) : undefined;
  const child = childName ? s.components.get(childName) : undefined;
  if (!child) fail(s.comp, "a child component must be an imported island", n);
  for (const p of ctx.plugins) p.child?.(s, child, n);
  // What the props merge: object literals — a `{ ref_for: true }` marker inside a `v-for` among
  // them, which renders nothing — the parent's `_attrs` when the child is its root, and `$attrs`.
  const parts: N[] = !rawProps || rawProps.type === "NullLiteral" ? [] : mergedParts(rawProps);
  const merges = parts.length > 0 && parts[0] !== rawProps;
  const passesAttrs = parts.some(isAttrs);
  const passed = (p: N): boolean => s.fallthrough !== null && ((isAttrs(p) && s.comp.inheritAttrs) || dollarAttrs(s, p));
  const marker = (p: N): boolean =>
    p.type === "ObjectExpression" && p.properties.length > 0 && p.properties.every((q: N) => q.type === "ObjectProperty" && IGNORED_PROPS.has(q.key.name ?? q.key.value));
  const objects = parts.filter((p) => !isAttrs(p) && !dollarAttrs(s, p) && !marker(p));
  // Attributes this component is passed reach the child's props too, where a prop would take them.
  if (parts.some(passed)) {
    for (const name of s.comp.attrNames) {
      if (declares(child, name)) {
        fail(s.comp, `\`${name}\`, an attribute ${s.comp.name} may be passed, would reach ${child.name} as its prop \`${camelize(name)}\`, which an attribute has no type for`, n);
      }
    }
  }
  // The scope ids its root is handed, which only a plugin gives (scoped styles).
  const ids = claim((p) => p.childIds?.(s, child, passesAttrs, !!slotScopeId, n)) ?? null;
  // `v-bind="x"`, where `x` is exactly the child's own `Props`: handed over as it is.
  if (objects.length === 1 && objects[0].type !== "ObjectExpression") {
    const v = expr(s, objects[0]);
    // The component itself, however the template reached it: its own `Props` struct is the type.
    const own = child.name === s.comp.name && v.ty.k === "struct" && v.ty.name === "Props";
    if (own || (v.ty.k === "child" && v.ty.name === child.name)) {
      callChild(s, e, child, v.code, slots, childAttrsArg(s, child, parts, merges, null, ids));
      return;
    }
    fail(s.comp, `child props must be an object literal, or \`v-bind\` of ${child.name}'s own \`Props\``, n);
  }
  for (const p of objects) {
    if (p.type !== "ObjectExpression") fail(s.comp, `child props must be an object literal, or \`v-bind\` of ${child.name}'s own \`Props\``, p);
  }

  const given = new Map<string, N>();
  // Keys the child does not declare are attributes, which fall through to its root.
  const fallthrough = new Set<N>();
  for (const obj of objects) {
    for (const p of obj.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "child props hold plain keys", p);
      const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
      // Listeners, `v-model`'s `onUpdate:…` among them, run on the client alone; a model's modifiers
      // change only what an update writes.
      if (!passedKey(child, key)) continue;
      const field = child.props.fields.find((f) => camelize(f.js) === camelize(key));
      if (field) {
        given.set(field.js, p.value);
        continue;
      }
      if (array(key)) fail(s.comp, `an attribute named \`${key}\`, which JavaScript would put before the others`, p);
      const name = propsToAttrMap[key] ?? key.toLowerCase();
      if (key !== "class" && key !== "style" && !isSSRSafeAttrName(name)) fail(s.comp, `unsafe attribute name \`${name}\``, p);
      fallthrough.add(p);
    }
  }
  const inits = child.props.fields.map((f) => {
    const node = given.get(f.js);
    if (!node) {
      if (f.ty.k !== "opt") fail(s.comp, `${child.name} requires \`${f.js}\``, n);
      return `${f.rust}: None`;
    }
    // Each side's own types named by the component that declares them, so that a type the parent
    // imports from the child's `.vue` file is the child's type.
    const v = expr(s, node);
    return fieldInit(f.rust, ownInto(s.comp, { ...v, ty: markHome(v.ty, s.comp.name) }, markHome(f.ty, child.name), node));
  });
  callChild(s, e, child, `&super::${child.module}::Props { ${inits.join(", ")} }`, slots, childAttrsArg(s, child, parts, merges, fallthrough, ids));
}

/** Whether a name is an array index, which a JavaScript object lists before its other keys. */
function array(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1;
}

/** The last argument of a child's `render_scoped`: for a child a parent may pass attributes, the
 * `fv::Attrs` this call passes — the keys of its props objects it does not declare, and what this
 * component was passed, merged in their order — with the scope ids; for any other, the ids. */
function childAttrsArg(s: Scope, child: Component, parts: N[], merges: boolean, fallthrough: Set<N> | null, ids: string | null): string | null {
  const sources: string[] = [];
  for (const p of parts) {
    if (s.fallthrough !== null && ((isAttrs(p) && s.comp.inheritAttrs) || dollarAttrs(s, p))) {
      sources.push(`${s.fallthrough}.list()`);
    } else if (p.type === "ObjectExpression" && fallthrough !== null) {
      const entries = p.properties.filter((q: N) => fallthrough.has(q)).map((q: N) => {
        const key: string = q.key.type === "Identifier" ? q.key.name : String(q.key.value);
        return `(${rustStr(key)}, ${attrOf(s, key, q.value, "vnode")})`;
      });
      if (entries.length) sources.push(`&[${entries.join(", ")}]`);
    }
  }
  if (!takesAttrs(child)) {
    if (sources.length) throw new GenError(`${s.comp.file}: ${child.name} is passed attributes it does not take`);
    return ids;
  }
  if (!sources.length) return ids === null ? "&fv::Attrs::NONE" : `&fv::Attrs::scoped(${ids})`;
  // One object literal, or `_attrs` or `$attrs` alone, is the child's as it is: only `_mergeProps`
  // normalises what it merges, even one object.
  if (sources.length === 1 && !merges) return `&fv::Attrs::new(${sources[0]}, ${ids ?? '""'})`;
  return `&fv::Attrs::merged(&[${sources.join(", ")}], ${ids ?? '""'})`;
}

/** `name: value` in a struct literal, or the name alone when the value is a variable of that name. */
export function fieldInit(name: string, value: string): string {
  return value === name ? name : `${name}: ${bare(value)}`;
}

/** A borrow of an object or a list a template reads. A variable already holds a borrow: a loop's
 * item, a narrowed value, a setup binding, a scoped slot's prop. */
function borrowed(code: string): string {
  return code.startsWith("&") || /^\w+$/.test(code) || /^fv_sp\d+\.\w+$/.test(code) ? code : `&${operand(code, UNARY)}`;
}

/** Whether a component takes a `Slots` argument. */
export function takesSlots(c: Component): boolean {
  return c.slotNames.length > 0 || slotFieldsOf(c).length > 0;
}

/** The arguments after `props` that a component's `render` takes. */
export function extraParams(c: Component): string {
  return (takesSlots(c) ? ", fv_slots: Slots<'_>" : "") + paramsOf(c).map((p) => `, ${p.name}: ${p.ty}`).join("");
}

/** `render(out, props[, slots][, …])` for a child, with the slot content this template gives
 * it as closures; `render_scoped`, with the scope ids its root is handed last — and the attributes
 * it is passed, as `fv::Attrs` — for a child that may be handed some. */
export function callChild(s: Scope, e: Emitter, child: Component, propsCode: string, slots: N, attrs: string | null): void {
  const given = new Map<string, N>();
  if (slots && slots.type !== "NullLiteral") {
    if (slots.type !== "ObjectExpression") fail(s.comp, "slots must be an object literal", slots);
    for (const p of slots.properties) {
      const key: string = p.key?.type === "Identifier" ? p.key.name : p.key?.value;
      if (key === "_") continue;
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "slots hold plain keys", p);
      if (!child.slotNames.includes(key)) fail(s.comp, `${child.name} has no slot \`${key}\``, p);
      given.set(key, p.value);
    }
  }
  const m = `super::${child.module}`;
  const scoped = child.inherits || takesAttrs(child);
  const trailing = paramsOf(child).map((p) => `, ${p.name}`).join("") + (scoped ? `, ${attrs ?? (takesAttrs(child) ? "&fv::Attrs::NONE" : '""')}` : "");
  const render = scoped ? "render_scoped" : "render";
  if (!takesSlots(child)) {
    e.stmt(`${m}::${render}(out, ${propsCode}${trailing});`);
    return;
  }
  e.open(`${m}::${render}(out, ${propsCode}, ${m}::Slots`);
  for (const name of child.slotNames) {
    const field = snake(name);
    const value = given.get(name);
    if (!value) {
      e.stmt(`${field}: None,`);
      continue;
    }
    const { body, param } = slotContent(s, value);
    const shape = child.slotShapes.get(name);
    const takesNone = param?.type === "Identifier" && param.name === "_";
    // The slot scope id the child's outlets give the content, when they may give one.
    const sid = child.passesSlotIds ? `fv_sid${++ctx.narrowCount}` : null;
    const sidParam = sid === null ? "" : `, ${sid}: &str`;
    /** The content's statements, then whether it pushed anything but comments. */
    const content = (inner: Scope): void => {
      if (staticallyFilled(body)) {
        statements({ ...inner, fill: false }, e, body);
        e.stmt("true");
      } else {
        e.stmt("let mut filled = false;");
        statements({ ...inner, fill: true }, e, body);
        e.stmt("filled");
      }
    };
    /** A parameter the content never reads, named so that Rust does not warn of it. */
    const unread = (opened: number, binding: string | null): void => {
      if (binding !== null && !e.reads(binding, opened + 1)) e.replace(opened, `${binding}:`, `_${binding}:`);
    };
    if (shape) {
      // A scoped slot: content given the outlet's props, bound as the parent destructured them.
      const sp = `fv_sp${++ctx.narrowCount}`;
      const ty: Ty = { k: "struct", name: shape.name, home: child.name };
      const locals = new Map(s.locals);
      if (param?.type === "ObjectPattern") {
        for (const p of param.properties) {
          if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
            fail(s.comp, "slot props are destructured into plain names, without defaults", p);
          }
          locals.set(p.value.name, fieldVal(s.comp, sp, ty, p.key.name ?? p.key.value, p));
        }
      } else if (param?.type === "Identifier" && !takesNone) {
        locals.set(param.name, { code: sp, ty });
      } else if (!takesNone) fail(s.comp, "slot props are a name or an object pattern", param);
      const life = shape.fields.some((f) => slotFieldBorrows(f.ty)) ? "<'_>" : "";
      e.open(`${field}: Some(&|out: &mut String, ${sp}: &${m}::${shape.name}${life}${sidParam}| -> bool`);
      const opened = e.lines.length - 1;
      content({ ...s, locals, sid });
      unread(opened, sp);
      unread(opened, sid);
      e.close("),");
      continue;
    }
    if (!takesNone) fail(s.comp, `\`<slot${name === "default" ? "" : ` name="${name}"`}>\` in ${child.name} passes no props`, param);
    const inner: Scope = { ...s, sid };
    if (sid !== null) {
      e.open(`${field}: Some(fv::Slot::slotted(&|out: &mut String${sidParam}| -> bool`);
      const opened = e.lines.length - 1;
      content(inner);
      unread(opened, sid);
      e.close(")),");
    } else if (staticallyFilled(body)) {
      e.open(`${field}: Some(fv::Slot::new(&|out: &mut String|`);
      statements({ ...inner, fill: false }, e, body);
      e.close(")),");
    } else {
      e.open(`${field}: Some(fv::Slot::markup(&|out: &mut String| -> bool`);
      e.stmt("let mut filled = false;");
      statements({ ...inner, fill: true }, e, body);
      e.stmt("filled");
      e.close(")),");
    }
  }
  e.close(`${trailing});`);
}

/** The statements a parent's slot content pushes: the `if (_push)` half of its `_withCtx`. */
export function slotBody(s: Scope, value: N): N[] {
  return slotContent(s, value).body;
}

/** A parent's slot content: what it pushes, and the parameter its scoped slot props are bound to
 * (`_` when it takes none). */
export function slotContent(s: Scope, value: N): { body: N[]; param: N } {
  const fn =
    value.type === "CallExpression" && value.callee.type === "Identifier" && value.callee.name === "_withCtx"
      ? value.arguments[0]
      : null;
  if (fn?.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected slot content", value);
  }
  const branch = fn.body.body.length === 1 ? fn.body.body[0] : null;
  if (branch?.type !== "IfStatement" || branch.test.type !== "Identifier" || branch.test.name !== "_push") {
    fail(s.comp, "unexpected slot content", fn);
  }
  const body = branch.consequent.type === "BlockStatement" ? branch.consequent.body : [branch.consequent];
  return { body, param: fn.params[0] };
}

/** Whether slot content always pushes something that is not a comment: a push of content outside
 * any `if` or loop. Then nothing has to be decided at run time. */
export function staticallyFilled(body: N[]): boolean {
  return body.some(
    (st) =>
      st.type === "ExpressionStatement" && st.expression.type === "CallExpression" &&
      st.expression.callee.type === "Identifier" && st.expression.callee.name === "_push" &&
      pushesContent(st.expression.arguments[0]) === true,
  );
}

/** `RowSlotProps`, `RowSlot`: the names of a scoped slot's props struct and content type. */
export function slotTypeName(slotName: string, suffix: string): string {
  return slotName.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") + suffix;
}

/** Whether a scoped slot prop's Rust type borrows, and so needs the props' lifetime `'v`. */
export function slotFieldBorrows(ty: Ty): boolean {
  const copied = (t: Ty) => t.k === "int" || t.k === "float" || t.k === "bool";
  return !(copied(ty) || (ty.k === "opt" && copied(ty.of)));
}

/** A scoped slot prop's Rust type: a scalar copied, anything else borrowed from the render for `'v`. */
export function slotFieldTy(ty: Ty, comp: Component): string {
  const owned = (t: Ty) => rustTy(t, comp).replace(/'a\b/g, "'v");
  switch (ty.k) {
    case "int":
      return "i64";
    case "float":
      return "f64";
    case "bool":
      return "bool";
    case "str":
      return "&'v str";
    case "list":
      return `&'v [${owned(ty.of)}]`;
    case "struct":
    case "child":
    case "html":
      return `&'v ${owned(ty)}`;
    case "opt":
      return `Option<${slotFieldTy(ty.of, comp)}>`;
    default:
      throw new GenError(`no Rust type for a slot prop of type ${JSON.stringify(ty)}`);
  }
}

/** A value an outlet passes, as the scoped slot prop field holds it. */
export function slotFieldValue(s: Scope, v: Val, n: N): string {
  switch (v.ty.k) {
    case "str":
      return strArg(v.code);
    case "int":
    case "float":
    case "bool":
      return bare(v.code);
    case "list":
      // An array literal is a Rust array of `&str`, and a computed list holds its items in a form
      // of its own: neither is the list a slot prop borrows.
      if (v.code.startsWith("[")) fail(s.comp, "a slot prop is not an array literal: pass a list the component holds", n);
      if (v.iter !== undefined) fail(s.comp, "a slot prop is not a computed list: pass a list the component holds", n);
      return borrowed(v.code);
    case "struct":
    case "child":
    case "html":
      return borrowed(v.code);
    case "opt":
      if (v.ty.of.k === "list") return `${atom(v.code)}.map(|v| &v[..])`;
      if (v.ty.of.k === "opt" || v.ty.of.k === "undef") break;
      return v.code;
  }
  return fail(s.comp, "a slot prop is a string, a number, a boolean, an object or a list", n);
}

/** `<slot name="x" :prop="…">fallback</slot>`: `ssrRenderSlot`, with the props a scoped slot passes. */
export function slotOutlet(s: Scope, e: Emitter, c: N): void {
  const [, nameNode, slotProps, fallback] = c.arguments;
  if (nameNode?.type !== "StringLiteral") fail(s.comp, "a slot's name is literal", c);
  if (slotProps?.type !== "ObjectExpression") fail(s.comp, "a slot's props are attributes or a `v-bind` object literal", c);
  const slotName: string = nameNode.value;
  const field = `fv_slots.${snake(slotName)}`;
  const outlet = `\`<slot${slotName === "default" ? "" : ` name="${slotName}"`}>\``;
  let fn = "fv::slot_into";
  let args = field;
  if (slotProps.properties.length) {
    const fields: Field[] = [];
    const values: string[] = [];
    for (const p of slotProps.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "slot props hold plain names", p);
      const key: string = p.key.name ?? p.key.value;
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) fail(s.comp, `slot prop \`${key}\` is not a plain name; write it in camelCase`, p);
      const v = expr(s, p.value);
      fields.push({ js: key, rust: snake(key), ty: v.ty });
      values.push(fieldInit(snake(key), slotFieldValue(s, v, p.value)));
    }
    const name = slotTypeName(slotName, "SlotProps");
    const shape: Struct = { name, fields, slot: true };
    const had = s.comp.slotShapes.get(slotName);
    if (had && JSON.stringify(had.fields) !== JSON.stringify(fields)) {
      fail(s.comp, `every ${outlet} passes the same props, of the same types`, c);
    }
    if (!had) {
      if (s.comp.structs.has(name) && !s.comp.structs.get(name)!.slot) fail(s.comp, `\`${name}\` names this slot's props; rename the interface`, c);
      s.comp.slotShapes.set(slotName, shape);
      s.comp.structs.set(name, shape);
    }
    fn = "fv::scoped_slot_into";
    args = `${field}, &${name} { ${values.join(", ")} }`;
  } else if (s.comp.slotShapes.has(slotName)) {
    fail(s.comp, `every ${outlet} passes the same props, of the same types`, c);
  }
  // The slot scope id: `"data-v-…-s"` from a component with `:slotted()` styles, followed inside
  // slot content by the id that content was given, or that id alone.
  const id = c.arguments[6];
  let slotted: string | null = null;
  if (id?.type === "StringLiteral") slotted = rustStr(id.value);
  else if (id?.type === "BinaryExpression" && id.operator === "+" && id.left.type === "StringLiteral" && id.right.type === "Identifier" && id.right.name === "_scopeId") {
    slotted = s.sid === null ? rustStr(id.left.value) : `&[${rustStr(id.left.value)}, ${s.sid}].concat()`;
  } else if (id?.type === "Identifier" && id.name === "_scopeId") slotted = s.sid;
  else if (id && id.type !== "NullLiteral") fail(s.comp, "unexpected slot scope id", id);
  if (s.comp.passesSlotIds) {
    fn = fn === "fv::slot_into" ? "fv::slot_into_slotted" : "fv::scoped_slot_into_slotted";
    args += `, ${slotted ?? '""'}`;
  } else if (slotted !== null) fail(s.comp, "a slot scope id passed to content that does not take one", c);
  const call = (rest: string) => (s.fill ? `if ${fn}(out, ${args}, ${rest}) { filled = true; }` : `${fn}(out, ${args}, ${rest});`);
  if (fallback?.type === "NullLiteral" || !fallback) {
    e.stmt(call("None"));
    return;
  }
  if (fallback.type !== "ArrowFunctionExpression" || fallback.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected slot fallback", fallback);
  }
  // The fallback writes to the same buffer as the outlet, so inside slot content it fills it too.
  e.open(`${s.fill ? "if " : ""}${fn}(out, ${args}, Some(&mut |out: &mut String|`);
  statements(s, e, fallback.body.body);
  e.close(s.fill ? ")) { filled = true; }" : "));");
}

/** A value into a child's props field, whose strings are `Cow`s. */
export function ownInto(comp: Component, v: Val, want: Ty, node: N): string {
  if (want.k === "str") {
    if (v.ty.k !== "str") fail(comp, "a string prop needs a string", node);
    return `std::borrow::Cow::Borrowed(${bare(v.code)})`;
  }
  if (want.k === "opt" && want.of.k === "str") {
    if (v.ty.k === "undef") return "None";
    if (v.ty.k === "str") return `Some(std::borrow::Cow::Borrowed(${bare(v.code)}))`;
    if (v.ty.k === "opt" && v.ty.of.k === "str") return `${atom(v.code)}.map(std::borrow::Cow::Borrowed)`;
  }
  if (sameTy(v.ty, want) && (want.k === "int" || want.k === "float" || want.k === "bool")) return v.code;
  if (want.k === "opt" && sameTy(v.ty, want.of) && (v.ty.k === "int" || v.ty.k === "float" || v.ty.k === "bool")) return `Some(${bare(v.code)})`;
  // An integer handed to a prop that takes a fraction.
  if (want.k === "float" && v.ty.k === "int") return asF64(v);
  if (want.k === "opt" && want.of.k === "float" && v.ty.k === "int") return `Some(${asF64(v)})`;
  // A computed list: its items collected into the child's own list, objects cloned.
  if (v.iter !== undefined && v.ty.k === "list" && want.k === "list" && sameTy(v.ty.of, want.of)) {
    return want.of.k === "struct" || want.of.k === "child" ? `${v.iter}.cloned().collect()` : `${v.iter}.collect()`;
  }
  // An object, a list of objects, a record, or an optional one, of the type the child declares:
  // cloned, which copies its strings only where they are owned.
  const objecty = (t: Ty): boolean => t.k === "struct" || t.k === "child" || t.k === "record" || ((t.k === "list" || t.k === "opt") && objecty(t.of));
  if (objecty(want) && sameTy(v.ty, want)) return `${atom(v.code)}.${v.ty.k === "opt" ? "cloned" : "to_owned"}()`;
  if (want.k === "opt" && objecty(want.of) && sameTy(v.ty, want.of)) return `Some(${atom(v.code)}.to_owned())`;
  if (objecty(want) && v.ty.k === want.k && JSON.stringify(v.ty).includes('"struct"')) {
    fail(comp, `a ${JSON.stringify(v.ty)} where the child takes a ${JSON.stringify(want)}: two components share a type only when both import it from one \`.ts\` file`, node);
  }
  // A list of strings or numbers: each item borrowed, or copied, into the child's own list.
  if (want.k === "list" && v.ty.k === "list" && v.ty.of.k === "undef") return "Vec::new()";
  if (want.k === "opt" && want.of.k === "list" && v.ty.k === "list") return `Some(${ownInto(comp, v, want.of, node)})`;
  if (want.k === "list" && v.ty.k === "list" && sameTy(v.ty.of, want.of)) {
    if (want.of.k === "str") return `${atom(v.code)}.iter().map(|v| std::borrow::Cow::Borrowed(&**v)).collect()`;
    if (want.of.k === "int" || want.of.k === "float" || want.of.k === "bool") return `${atom(v.code)}.to_vec()`;
  }
  return fail(comp, `a ${JSON.stringify(v.ty)} into a ${JSON.stringify(want)} prop`, node);
}

export function statements(s: Scope, e: Emitter, body: N[]): void {
  for (const st of body) {
    if (st.type === "ExpressionStatement" && st.expression.type === "CallExpression") {
      const c = st.expression;
      const callee = c.callee.type === "Identifier" ? c.callee.name : null;
      if (callee === "_push") {
        push(s, e, c.arguments[0]);
        continue;
      }
      if (callee === "_ssrRenderList") {
        list(s, e, c);
        continue;
      }
      if (callee === "_ssrRenderSlot") {
        slotOutlet(s, e, c);
        continue;
      }
      // `<Suspense>`: its default content, rendered in place — ferrovue renders nothing async.
      if (callee === "_ssrRenderSuspense") {
        const def = c.arguments[1]?.properties?.find((p: N) => (p.key?.name ?? p.key?.value) === "default");
        if (!def) e.lit("<!---->");
        else if (def.value.type === "ArrowFunctionExpression" && def.value.body.type === "BlockStatement") statements(s, e, def.value.body.body);
        else fail(s.comp, "unexpected `<Suspense>` content", c);
        continue;
      }
      if (ctx.plugins.some((p) => p.statement?.(s, e, c, st))) continue;
      if (callee === "_ssrRenderVNode") {
        fail(s.comp, "`<component :is>` chooses its component at run time; write the choices out with `v-if`", st);
      }
    }
    /* `const _component_X = _resolveComponent("X", true)`: a component that uses itself, which is
     * how a tree renders. Any other component resolved by name is one this compiler cannot see. */
    if (st.type === "VariableDeclaration" && st.declarations.length === 1) {
      const d = st.declarations[0];
      const init = d.init;
      if (
        init?.type === "CallExpression" && init.callee.type === "Identifier" &&
        init.callee.name === "_resolveComponent" && init.arguments[0]?.type === "StringLiteral" &&
        init.arguments[0].value === s.comp.name && init.arguments[1]?.type === "BooleanLiteral"
      ) {
        s.selfAlias.name = d.id.name;
        continue;
      }
      // A component a plugin provides by name, such as `RouterLink`.
      const named = init?.type === "CallExpression" && init.callee.type === "Identifier" &&
        init.callee.name === "_resolveComponent" && init.arguments.length === 1 &&
        init.arguments[0]?.type === "StringLiteral" ? init.arguments[0].value : null;
      if (named !== null && ctx.plugins.some((p) => p.resolveComponent?.(s, d.id.name, named))) continue;
      // `const _directive_focus = _resolveDirective("focus")`: a globally registered directive.
      if (init?.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === "_resolveDirective" && init.arguments[0]?.type === "StringLiteral") {
        s.directives.set(d.id.name, init.arguments[0].value);
        continue;
      }
      fail(s.comp, "a component the template resolves by name must be imported, or be this one", st);
    }
    if (st.type === "IfStatement") {
      const branch = (b: N): N[] => (b.type === "BlockStatement" ? b.body : [b]);
      /* `a && b && …`, where a leading operand is an optional value: present for the whole branch,
       * so it is bound and narrowed there, as TypeScript narrows it — a Rust let-chain, which is why
       * generated code needs edition 2024. */
      if (st.test.type === "LogicalExpression" && st.test.operator === "&&") {
        const operands: N[] = [];
        const flatten = (n: N): void => {
          if (n.type === "LogicalExpression" && n.operator === "&&") {
            flatten(n.left);
            flatten(n.right);
          } else operands.push(n);
        };
        flatten(st.test);
        const narrowed = new Map(s.narrowed);
        const bound = new Map<string, Presence>();
        const parts: string[] = [];
        for (const op of operands) {
          const inner = { ...s, narrowed };
          const p = presence(inner, op);
          if (p && !p.negated) {
            const name = `n${++ctx.narrowCount}`;
            parts.push(p.pattern(name));
            narrowed.set(p.path, { code: name, ty: p.of });
            bound.set(name, p);
          } else {
            parts.push(operand(cond(inner, op), CMP));
          }
        }
        // A condition known now: a `false` decides the branch, a `true` adds nothing.
        if (parts.includes("false")) {
          if (st.alternate) statements(s, e, branch(st.alternate));
          continue;
        }
        if (parts.includes("true")) parts.splice(0, parts.length, ...parts.filter((p) => p !== "true"));
        if (narrowed.size > s.narrowed.size) {
          e.open(`if ${parts.join(" && ")}`);
          const at = e.lines.length - 1;
          statements({ ...s, narrowed }, e, branch(st.consequent));
          // A value the branch never reads is only tested for presence.
          for (const [name, p] of bound) {
            // Read by the branch, or by a later condition of the same chain, which binds it once.
            const inHead = occurrences(e.lines[at]!, name) > 1;
            if (!inHead && !e.reads(name, at + 1)) e.replace(at, p.pattern(name), operand(p.present, CMP));
          }
          if (st.alternate) {
            e.close(" else {");
            statements(s, e, branch(st.alternate));
          }
          e.close();
          continue;
        }
      }
      const compound =
        (st.test.type === "LogicalExpression" && st.test.operator !== "??") ||
        (st.test.type === "UnaryExpression" && st.test.operator === "!");
      const t: Val = compound ? boolOf(cond(s, st.test)) : expr(s, st.test);
      const k = known(t);
      if (k !== undefined) {
        const taken = k ? st.consequent : st.alternate;
        if (taken) statements(s, e, branch(taken));
        continue;
      }
      /* An optional value tested for presence is narrowed inside the branch, as TypeScript narrows
       * it: bound by `if let`, so `user.name` under `v-if="user"` reads the bound value. A negated
       * test — `!user`, `user === undefined` — narrows the `v-else` instead, written first. */
      const p = presence(s, st.test);
      if (p && (!p.negated || st.alternate)) {
        const name = `n${++ctx.narrowCount}`;
        e.open(`if ${p.pattern(name)}`);
        const at = e.lines.length - 1;
        const [present, absent] = p.negated ? [st.alternate, st.consequent] : [st.consequent, st.alternate];
        statements(narrowTo(s, p, name), e, branch(present));
        if (!e.reads(name, at + 1)) e.replace(at, p.pattern(name), condition(p.present));
        if (absent) {
          e.close(" else {");
          statements(s, e, branch(absent));
        }
        e.close();
        continue;
      } else {
        e.open(`if ${condition(cond(s, st.test))}`);
        statements(s, e, branch(st.consequent));
      }
      if (st.alternate) {
        e.close(" else {");
        statements(s, e, branch(st.alternate));
      }
      e.close();
      continue;
    }
    fail(s.comp, `\`${st.type}\` in the compiled template`, st);
  }
}

export function list(s: Scope, e: Emitter, c: N): void {
  const fn = c.arguments[1];
  if (fn.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected `ssrRenderList` callback", c);
  }
  // `([key, value], i) in Object.entries(r)`, which walks the record as `(value, key, i) in r` does.
  if (isObjectCall(c.arguments[0], "entries")) {
    const [pair, index] = fn.params as N[];
    const r = c.arguments[0].arguments.length === 1 ? expr(s, c.arguments[0].arguments[0]) : null;
    if (r?.ty.k !== "record") return fail(s.comp, "`Object.entries()` takes a `Record<string, T>`", c.arguments[0]);
    if (pair?.type !== "ArrayPattern" || pair.elements.length > 2 || pair.elements.some((x: N) => x?.type !== "Identifier")) {
      return fail(s.comp, "a `v-for` over `Object.entries()` names its items `[key, value]`", pair ?? c);
    }
    recordLoop(s, e, r, fn, pair.elements[1], pair.elements[0], index);
    return;
  }
  const src = expr(s, c.arguments[0]);
  if (src.ty.k === "record") {
    const [value, key, index] = fn.params as N[];
    recordLoop(s, e, src, fn, value, key, index);
    return;
  }
  const [item, index] = fn.params as N[];
  const idx = index ? snake(index.name) : null;
  // The item's name in Rust: its own when it is a plain name, a placeholder when it is destructured.
  const itemName = item.type === "Identifier" ? snake(item.name) : `fv_item${++ctx.narrowCount}`;
  const inner = new Map(s.locals);
  let of: Ty;
  // What the loop walks, and what its head binds each item to.
  let walk: string;
  let bound: string;
  let itemLet = -1;
  const loop = (it: string, i: string | null) => (i ? `for (${i}, ${it}) in ${atom(walk)}.enumerate()` : `for ${it} in ${walk}`);
  if (src.ty.k === "list" && src.iter !== undefined) {
    // A computed list: its items come as they are — a string as a `Cow`, read as a `&str`.
    of = src.ty.of;
    walk = src.iter;
    bound = of.k === "str" ? `${itemName}_cow` : itemName;
    e.open(loop(bound, idx));
    if (of.k === "str") {
      e.stmt(`let ${itemName}: &str = &${bound};`);
      itemLet = e.lines.length - 1;
    }
  } else if (src.ty.k === "int") {
    // `v-for="n in 5"`: 1 to 5, as `renderList` counts a number.
    of = INT;
    walk = `1..=${operand(src.code, OR)}`;
    bound = itemName;
    e.open(loop(bound, idx));
  } else if (src.ty.k === "list") {
    of = src.ty.of;
    if (of.k === "undef") fail(s.comp, "`v-for` over an empty array literal", c);
    const itemCode = `${itemName}_ref`;
    walk = `${atom(src.code)}.iter()`;
    bound = itemCode;
    e.open(loop(bound, idx));
    if (of.k === "str") e.stmt(`let ${itemName}: &str = ${itemCode};`);
    // An object — a struct, or another component's props — is borrowed; only a scalar is copied.
    else if (of.k === "struct" || of.k === "child") e.stmt(`let ${itemName} = ${itemCode};`);
    else e.stmt(`let ${itemName} = *${itemName}_ref;`);
    itemLet = e.lines.length - 1;
  } else {
    return fail(s.comp, "`v-for` walks an array, or counts to a number", c);
  }
  let idxLet = -1;
  if (idx) {
    e.stmt(`let ${idx} = ${idx} as i64;`);
    idxLet = e.lines.length - 1;
  }
  const bodyFrom = e.lines.length;
  if (item.type === "Identifier") inner.set(item.name, { code: itemName, ty: of, ...(src.lone ? { lone: true } : {}) });
  else if (item.type === "ObjectPattern") {
    // `v-for="{ name, id: key } in items"`: each name is that field of the item.
    for (const p of item.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "a destructured `v-for` item binds plain names, without defaults", p);
      }
      inner.set(p.value.name, fieldVal(s.comp, itemName, of, p.key.name ?? p.key.value, p));
    }
  } else fail(s.comp, "a `v-for` item is a name or an object pattern", item);
  if (index) inner.set(index.name, { code: idx!, ty: INT });
  const before = e.literalBytes;
  const fromProps = src.ty.k === "list" && src.iter === undefined && /^\(?props\./.test(src.code);
  statements({ ...s, locals: inner, loop: fromProps ? { item: itemName, over: src.code } : undefined }, e, fn.body.body);
  // An item or index the body never reads is not bound, and an index never counted: the loop only
  // counts.
  const unusedItem = !e.reads(itemName, bodyFrom);
  const unusedIdx = idx !== null && !e.reads(idx, bodyFrom);
  const head = bodyFrom - 1 - (idx ? 1 : 0) - (itemLet >= 0 ? 1 : 0);
  e.replace(head, loop(bound, idx), loop(unusedItem ? "_" : bound, unusedIdx ? null : idx));
  // Removed from the last line up, so the earlier indices stay right.
  if (unusedIdx) e.lines.splice(idxLet, 1);
  if (unusedItem && itemLet >= 0) e.lines.splice(itemLet, 1);
  e.close();
  // The body's markup is written once per item, not once.
  const body = e.literalBytes - before;
  e.literalBytes = before;
  // Counted up front only when the list is reachable from there: a list of the props, or a list in
  // each item of one, counted over all of them. One a `v-if` narrowed, or a loop deeper down, exists
  // only inside its block, and the reservation is an estimate either way.
  if (body > 0 && fromProps) e.perItem.push(`${body} * ${atom(src.code)}.len()`);
  else if (body > 0 && src.ty.k === "list" && s.loop && src.code.startsWith(`${s.loop.item}.`)) {
    const outer = s.loop;
    e.perItem.push(`${body} * ${atom(outer.over)}.iter().map(|${outer.item}| ${src.code}.len()).sum::<usize>()`);
  }
}

/** `v-for="(value, key, index) in r"` over a record: its entries in JavaScript's order of keys,
 * which is the order `renderList` walks `Object.keys`. */
function recordLoop(s: Scope, e: Emitter, r: Val, fn: N, value: N | undefined, key: N | undefined, index: N | undefined): void {
  if (r.ty.k !== "record") return;
  const of = r.ty.of;
  for (const p of [key, index]) if (p && p.type !== "Identifier") fail(s.comp, "a record's key and index in `v-for` are plain names", p);
  const n = ++ctx.narrowCount;
  const v = value?.type === "Identifier" ? snake(value.name) : `fv_value${n}`;
  const k = key ? snake(key.name) : `fv_key${n}`;
  const i = index ? snake(index.name) : `fv_index${n}`;
  e.open(`for (${i}, (${k}, ${v}_ref)) in ${atom(r.code)}.iter().enumerate()`);
  const head = e.lines.length - 1;
  const indent = /^ */.exec(e.lines[head]!)![0];
  const inner = new Map(s.locals);
  // A value is read as a list item is: a string as a `&str`, a number copied, an object borrowed.
  e.stmt(of.k === "str" ? `let ${v}: &str = ${v}_ref;` : of.k === "int" || of.k === "float" || of.k === "bool" ? `let ${v} = *${v}_ref;` : `let ${v} = ${v}_ref;`);
  e.stmt(`let ${i} = ${i} as i64;`);
  const bodyFrom = e.lines.length;
  if (value?.type === "Identifier") inner.set(value.name, { code: v, ty: of });
  else if (value?.type === "ObjectPattern" && (of.k === "struct" || of.k === "child")) {
    for (const p of value.properties) {
      if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
        fail(s.comp, "a destructured `v-for` item binds plain names, without defaults", p);
      }
      inner.set(p.value.name, fieldVal(s.comp, v, of, p.key.name ?? p.key.value, p));
    }
  } else if (value) fail(s.comp, "a `v-for` item is a name, or an object pattern of an object", value);
  if (key) inner.set(key.name, { code: k, ty: STR });
  if (index) inner.set(index.name, { code: i, ty: INT });
  const before = e.literalBytes;
  statements({ ...s, locals: inner }, e, fn.body.body);
  // Whatever the body never reads is not bound, from the last line up.
  const reads = (name: string) => e.reads(name, bodyFrom);
  const [readsV, readsK, readsI] = [reads(v), reads(k), reads(i)];
  if (!readsI) e.lines.splice(head + 2, 1);
  if (!readsV) e.lines.splice(head + 1, 1);
  const pair = `(${readsK ? k : "_"}, ${readsV ? `${v}_ref` : "_"})`;
  e.lines[head] = `${indent}for ${readsI ? `(${i}, ${pair}) in ${atom(r.code)}.iter().enumerate()` : `${pair} in ${atom(r.code)}.iter()`} {`;
  e.close();
  const body = e.literalBytes - before;
  e.literalBytes = before;
  if (body > 0 && /^\(?props\./.test(r.code)) e.perItem.push(`${body} * ${atom(r.code)}.len()`);
}
