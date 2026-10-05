/* Slots: the content a parent gives a child's slot, and the `<slot>` outlets that render it, with
 * the props a scoped slot passes. */

import { type Component, type Field, type N, type Scope, type Struct, type Ty, type Val, fail, GenError, rustStr, snake } from "./model.ts";
import { expr } from "./expr.ts";
import { atom, bare, operand, strArg, UNARY } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { rustTy } from "./rust.ts";
import { fieldInit } from "./children.ts";
import { pushesContent, statements } from "./template.ts";

/** A borrow of an object or a list a template reads. A variable already holds a borrow: a loop's
 * item, a narrowed value, a setup binding, a scoped slot's prop. */
function borrowed(code: string): string {
  return code.startsWith("&") || /^\w+$/.test(code) || /^fv_sp\d+\.\w+$/.test(code) ? code : `&${operand(code, UNARY)}`;
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
