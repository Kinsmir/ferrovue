/* The compiled template's statements: pushes, conditions, lists, child components and slots. */

import { type Component, type Field, type N, type Scope, type Struct, type Ty, type Val, fail, GenError, INT, sameTy, snake } from "./model.ts";
import { ctx } from "./context.ts";
import { markHome } from "./typescript.ts";
import { asF64, boolOf, cond, expr, fieldVal, known, narrowTo, type Presence, presence, truthy } from "./expr.ts";
import { atom, bare, CMP, condition, occurrences, operand, OR, strArg, UNARY } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { IGNORED_PROPS, interpolate, renderAttr, renderAttrs, renderClass, renderDynamicAttr, renderStyle } from "./attrs.ts";
import { routerLink } from "./router.ts";
import { rustTy } from "./rust.ts";

/** One `${...}` inside a pushed template literal. */
export function slot(s: Scope, e: Emitter, n: N): void {
  // A slot's scope id, for scoped styles, which an island never has.
  if (n.type === "Identifier" && n.name === "_scopeId") return;
  if (n.type === "CallExpression" && n.callee.type === "Identifier") {
    const a: N[] = n.arguments;
    switch (n.callee.name) {
      case "_ssrInterpolate":
        interpolate(e, expr(s, a[0]));
        return;
      case "_ssrRenderAttr":
        if (a[0].type !== "StringLiteral") fail(s.comp, "attribute names are literal", n);
        renderAttr(e, a[0].value, expr(s, a[1]));
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

/** Whether a `_push` argument is content to `ssrRenderSlot`, rather than only comments. */
export function pushesContent(s: Scope, n: N): boolean {
  if (n.type === "StringLiteral") return !isComment(n.value);
  if (n.type === "TemplateLiteral") {
    if (n.expressions.length === 0) return !isComment(n.quasis[0].value.cooked);
    if (n.quasis[0].value.cooked.startsWith("<!--")) {
      fail(s.comp, "slot content that starts with a comment holding an interpolation", n);
    }
    return true;
  }
  // A component's render is a buffer, never a comment.
  return true;
}

export function push(s: Scope, e: Emitter, n: N): void {
  if (s.fill && pushesContent(s, n)) e.stmt("filled = true;");
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
    const target = n.arguments[0];
    const routed =
      target.type === "Identifier"
        ? s.router.get(target.name)
        : target.type === "MemberExpression" && target.object.name === "$setup"
          ? s.router.get(target.computed ? target.property.value : target.property.name)
          : undefined;
    if (routed === "RouterLink") routerLink(s, e, n);
    else if (routed === "RouterView") e.stmt("fv_slots.router_view.render_to(out);");
    else renderChild(s, e, n);
    return;
  }
  fail(s.comp, "this cannot be pushed", n);
}

export function renderChild(s: Scope, e: Emitter, n: N): void {
  const [target, rawProps, slots] = n.arguments;
  let local: string | null = null;
  if (target.type === "MemberExpression" && target.object.name === "$setup") {
    local = target.computed ? target.property.value : target.property.name;
  }
  const isSelf = target.type === "Identifier" && target.name === s.selfAlias.name;
  const childName = isSelf ? s.comp.name : local ? s.children.get(local) : undefined;
  const child = childName ? s.components.get(childName) : undefined;
  // Inside a `v-for`, Vue merges a `{ ref_for: true }` marker into the props; it renders nothing.
  let props = rawProps;
  if (
    props?.type === "CallExpression" && props.callee.type === "Identifier" && props.callee.name === "_mergeProps" &&
    props.arguments.length === 2 && props.arguments[0].type === "ObjectExpression" &&
    props.arguments[0].properties.every((p: N) => p.type === "ObjectProperty" && IGNORED_PROPS.has(p.key.name ?? p.key.value))
  ) {
    props = props.arguments[1];
  }
  // A component at the root of the template is handed the fallthrough attributes, which an island
  // never has.
  if (
    props?.type === "CallExpression" && props.callee.type === "Identifier" && props.callee.name === "_mergeProps" &&
    props.arguments.length === 2 && props.arguments[1].type === "Identifier" && props.arguments[1].name === "_attrs"
  ) {
    props = props.arguments[0];
  }
  // A child given no props at all: Vue passes `null`, or the empty fallthrough attributes.
  if ((props?.type === "Identifier" && props.name === "_attrs") || props?.type === "NullLiteral" || !props) {
    props = { type: "ObjectExpression", properties: [] };
  }
  if (!child) fail(s.comp, "a child component must be an imported island", n);
  if (child.routerView) {
    fail(s.comp, `${child.name} holds \`<RouterView>\`: the server renders it at the top, never as a child`, n);
  }
  // `v-bind="x"`, where `x` is exactly the child's own `Props`: handed over as it is.
  if (props.type !== "ObjectExpression") {
    const v = expr(s, props);
    // The component itself, however the template reached it: its own `Props` struct is the type.
    const own = child.name === s.comp.name && v.ty.k === "struct" && v.ty.name === "Props";
    if (own || (v.ty.k === "child" && v.ty.name === child.name)) {
      callChild(s, e, child, v.code, slots, n);
      return;
    }
    fail(s.comp, `child props must be an object literal, or \`v-bind\` of ${child.name}'s own \`Props\``, n);
  }

  const given = new Map<string, N>();
  for (const p of props.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "child props hold plain keys", p);
    const key: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    // Listeners, `v-model`'s `onUpdate:…` among them, run on the client alone; a model's modifiers
    // change only what an update writes.
    if (IGNORED_PROPS.has(key) || /^on[^a-z]/.test(key)) continue;
    if (key.endsWith("Modifiers") && child.props.fields.some((f) => f.js === (key === "modelModifiers" ? "modelValue" : key.slice(0, -"Modifiers".length)))) continue;
    if (!child.props.fields.some((f) => f.js === key)) {
      // A key the child does not declare would fall through onto its root element as an
      // attribute, which the generated child does not render.
      fail(s.comp, `\`${key}\` is not a prop of ${child.name}`, p);
    }
    given.set(key, p.value);
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
  callChild(s, e, child, `&super::${child.module}::Props { ${inits.join(", ")} }`, slots, n);
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
  return c.slotNames.length > 0 || c.routerView;
}

/** The arguments after `props` that a component's `render` takes. */
export function extraParams(c: Component): string {
  return (
    (takesSlots(c) ? ", fv_slots: Slots<'_>" : "") +
    (c.usesRoute ? ", fv_route: &fv::Route<'_>" : "") +
    (c.usesStores ? ", fv_stores: &super::stores::Stores<'_>" : "") +
    (c.usesI18n ? ", fv_i18n: &fv::I18n" : "") +
    (c.usesTeleports ? ", fv_teleports: &fv::Teleports" : "")
  );
}

/** `render(out, props[, slots][, route])` for a child, with the slot content this template gives
 * it as closures. */
export function callChild(s: Scope, e: Emitter, child: Component, propsCode: string, slots: N, _n: N): void {
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
  const route =
    (child.usesRoute ? ", fv_route" : "") + (child.usesStores ? ", fv_stores" : "") + (child.usesI18n ? ", fv_i18n" : "") + (child.usesTeleports ? ", fv_teleports" : "");
  if (!takesSlots(child)) {
    e.stmt(`${m}::render(out, ${propsCode}${route});`);
    return;
  }
  e.open(`${m}::render(out, ${propsCode}, ${m}::Slots`);
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
      e.open(`${field}: Some(&|out: &mut String, ${sp}: &${m}::${shape.name}${life}| -> bool`);
      const opened = e.lines.length - 1;
      const inner = { ...s, locals };
      if (staticallyFilled(inner, body)) {
        statements({ ...inner, fill: false }, e, body);
        e.stmt("true");
      } else {
        e.stmt("let mut filled = false;");
        statements({ ...inner, fill: true }, e, body);
        e.stmt("filled");
      }
      if (!e.reads(sp, opened + 1)) e.replace(opened, `${sp}:`, `_${sp}:`);
      e.close("),");
      continue;
    }
    if (!takesNone) fail(s.comp, `\`<slot${name === "default" ? "" : ` name="${name}"`}>\` in ${child.name} passes no props`, param);
    if (staticallyFilled(s, body)) {
      e.open(`${field}: Some(fv::Slot::new(&|out: &mut String|`);
      statements({ ...s, fill: false }, e, body);
      e.close(")),");
    } else {
      e.open(`${field}: Some(fv::Slot::markup(&|out: &mut String| -> bool`);
      e.stmt("let mut filled = false;");
      statements({ ...s, fill: true }, e, body);
      e.stmt("filled");
      e.close(")),");
    }
  }
  e.close(`${route});`);
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
export function staticallyFilled(s: Scope, body: N[]): boolean {
  return body.some(
    (st) =>
      st.type === "ExpressionStatement" && st.expression.type === "CallExpression" &&
      st.expression.callee.type === "Identifier" && st.expression.callee.name === "_push" &&
      pushesContent(s, st.expression.arguments[0]),
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
      // An array literal is a Rust array of `&str`, not the list a slot prop borrows.
      if (v.code.startsWith("[")) fail(s.comp, "a slot prop is not an array literal: pass a list the component holds", n);
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
  // An object, a list of objects, or an optional one, of the type the child declares: cloned, which
  // copies its strings only where they are owned.
  const objecty = (t: Ty): boolean => t.k === "struct" || t.k === "child" || ((t.k === "list" || t.k === "opt") && objecty(t.of));
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
      // `<Teleport>`: markers here, the content in its target's buffer, which the page writes.
      if (callee === "_ssrRenderTeleport") {
        const [, content, target, disabled] = c.arguments;
        if (s.fill) fail(s.comp, "a `<Teleport>` in slot content whose emptiness is decided at run time", st);
        const to = expr(s, target);
        if (to.ty.k !== "str") fail(s.comp, "a `<Teleport>`'s `to` is a string", target);
        const off = disabled ? bare(cond(s, disabled)) : "false";
        if (content?.type !== "ArrowFunctionExpression" || content.body.type !== "BlockStatement") fail(s.comp, "unexpected `<Teleport>` content", st);
        e.open(`fv::teleport_into(out, fv_teleports, ${strArg(to.code)}, ${off}, &|out: &mut String|`);
        statements(s, e, content.body.body);
        e.close(");");
        continue;
      }
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
      const routed = init?.type === "CallExpression" && init.callee.type === "Identifier" &&
        init.callee.name === "_resolveComponent" && init.arguments.length === 1 &&
        init.arguments[0]?.type === "StringLiteral" ? init.arguments[0].value : null;
      if (routed === "RouterLink" || routed === "RouterView") {
        s.router.set(d.id.name, routed);
        continue;
      }
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
  const src = expr(s, c.arguments[0]);
  const fn = c.arguments[1];
  if (fn.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "unexpected `ssrRenderList` callback", c);
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
  if (src.ty.k === "int") {
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
  if (item.type === "Identifier") inner.set(item.name, { code: itemName, ty: of });
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
  statements({ ...s, locals: inner }, e, fn.body.body);
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
  // Counted up front only when the list is reachable from there: one a `v-if` narrowed, or a loop
  // variable, exists only inside its block, and the reservation is an estimate either way.
  if (body > 0 && src.ty.k === "list" && /^\(?props\./.test(src.code)) e.perItem.push(`${body} * ${atom(src.code)}.len()`);
}
