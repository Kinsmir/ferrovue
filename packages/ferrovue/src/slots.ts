import { type Component, type Field, type N, type Scope, type Struct, type Ty, type Val, fail, nothing, GenError, rustStr, snake } from "./model.ts";
import { expr } from "./expr.ts";
import { atom, bare, operand, strArg, UNARY } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { rustTy } from "./rust.ts";
import { fieldInit } from "./children.ts";
import { pushesContent, statements } from "./template.ts";
import { slotContextOf } from "./plugin.ts";

function borrowed(code: string): string {
  return code.startsWith("&") || /^\w+$/.test(code) || /^fv_sp\d+\.\w+$/.test(code) ? code : `&${operand(code, UNARY)}`;
}

export function slotBody(s: Scope, value: N): N[] {
  return slotContent(s, value).body;
}

export function slotContent(s: Scope, value: N): { body: N[]; param: N } {
  const fn =
    value.type === "CallExpression" && value.callee.type === "Identifier" && value.callee.name === "_withCtx"
      ? value.arguments[0]
      : null;
  if (fn?.type !== "ArrowFunctionExpression" || fn.body.type !== "BlockStatement") {
    fail(s.comp, "FV0006", "unexpected slot content", value);
  }
  const branch = fn.body.body.length === 1 ? fn.body.body[0] : null;
  if (branch?.type !== "IfStatement" || branch.test.type !== "Identifier" || branch.test.name !== "_push") {
    fail(s.comp, "FV0006", "unexpected slot content", fn);
  }
  const body = branch.consequent.type === "BlockStatement" ? branch.consequent.body : [branch.consequent];
  return { body, param: fn.params[0] };
}

export function staticallyFilled(body: N[]): boolean {
  return body.some(
    (st) =>
      st.type === "ExpressionStatement" && st.expression.type === "CallExpression" &&
      st.expression.callee.type === "Identifier" && st.expression.callee.name === "_push" &&
      pushesContent(st.expression.arguments[0]) === true,
  );
}

export function slotTypeName(slotName: string, suffix: string): string {
  return slotName.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") + suffix;
}

export function slotFieldBorrows(ty: Ty): boolean {
  const copied = (t: Ty) => t.k === "int" || t.k === "float" || t.k === "bool";
  return !(copied(ty) || (ty.k === "opt" && copied(ty.of)));
}

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
      throw new GenError("FV0908", `no Rust type for a slot prop of type ${JSON.stringify(ty)}`);
  }
}

export function slotFieldValue(s: Scope, v: Val, n: N): string {
  switch (v.ty.k) {
    case "str":
      return strArg(v.code);
    case "int":
    case "float":
    case "bool":
      return bare(v.code);
    case "list":
      if (v.code.startsWith("[")) fail(s.comp, "FV0909", "a slot prop is not an array literal: pass a list the component holds", n);
      if (v.iter !== undefined) fail(s.comp, "FV0910", "a slot prop is not a computed list: pass a list the component holds", n);
      return borrowed(v.code);
    case "struct":
    case "child":
    case "html":
      return borrowed(v.code);
    case "opt":
      if (v.ty.of.k === "list") return `${atom(v.code)}.map(|v| &v[..])`;
      if (v.ty.of.k === "opt" || nothing(v.ty.of)) break;
      return v.code;
  }
  return fail(s.comp, "FV0911", "a slot prop is a string, a number, a boolean, an object or a list", n);
}

export function slotOutlet(s: Scope, e: Emitter, c: N): void {
  const [, nameNode, slotProps, fallback] = c.arguments;
  if (nameNode?.type !== "StringLiteral") fail(s.comp, "FV0912", "a slot's name is literal", c);
  if (slotProps?.type !== "ObjectExpression") fail(s.comp, "FV0913", "a slot's props are attributes or a `v-bind` object literal", c);
  const slotName: string = nameNode.value;
  const field = `fv_slots.${snake(slotName)}`;
  const outlet = `\`<slot${slotName === "default" ? "" : ` name="${slotName}"`}>\``;
  let fn = "fv::slot_into";
  let args = field;
  let passed = "&()";
  if (slotProps.properties.length) {
    const fields: Field[] = [];
    const values: string[] = [];
    for (const p of slotProps.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "FV0914", "slot props hold plain names", p);
      const key: string = p.key.name ?? p.key.value;
      if (!/^[A-Za-z_$][\w$]*$/.test(key)) fail(s.comp, "FV0915", `slot prop \`${key}\` is not a plain name; write it in camelCase`, p);
      const v = expr(s, p.value);
      fields.push({ js: key, rust: snake(key), ty: v.ty });
      values.push(fieldInit(snake(key), slotFieldValue(s, v, p.value)));
    }
    const name = slotTypeName(slotName, "SlotProps");
    const shape: Struct = { name, fields, slot: true };
    const had = s.comp.slotShapes.get(slotName);
    if (had && JSON.stringify(had.fields) !== JSON.stringify(fields)) {
      fail(s.comp, "FV0916", `every ${outlet} passes the same props, of the same types`, c);
    }
    if (!had) {
      if (s.comp.structs.has(name) && !s.comp.structs.get(name)!.slot) fail(s.comp, "FV0917", `\`${name}\` names this slot's props; rename the interface`, c);
      s.comp.slotShapes.set(slotName, shape);
      s.comp.structs.set(name, shape);
    }
    fn = "fv::scoped_slot_into";
    passed = `&${name} { ${values.join(", ")} }`;
    args = `${field}, ${passed}`;
  } else if (s.comp.slotShapes.has(slotName)) {
    fail(s.comp, "FV0916", `every ${outlet} passes the same props, of the same types`, c);
  }
  const id = c.arguments[6];
  let slotted: string | null = null;
  if (id?.type === "StringLiteral") slotted = rustStr(id.value);
  else if (id?.type === "BinaryExpression" && id.operator === "+" && id.left.type === "StringLiteral" && id.right.type === "Identifier" && id.right.name === "_scopeId") {
    slotted = s.sid === null ? rustStr(id.left.value) : `&[${rustStr(id.left.value)}, ${s.sid}].concat()`;
  } else if (id?.type === "Identifier" && id.name === "_scopeId") slotted = s.sid;
  else if (id && id.type !== "NullLiteral") fail(s.comp, "FV0006", "unexpected slot scope id", id);
  const context = slotContextOf(s.comp);
  if (context.length) {
    const shape = s.comp.slotShapes.get(slotName);
    const sp = shape ? `fv_sp: &${shape.name}${shape.fields.some((f) => slotFieldBorrows(f.ty)) ? "<'_>" : ""}` : "_: &()";
    const sid = s.comp.passesSlotIds ? ", fv_sid: &str" : "";
    const content = `${field}.map(|f| move |out: &mut String, ${sp}${sid}| f(out${shape ? ", fv_sp" : ""}${sid ? ", fv_sid" : ""}${context.map((p) => `, ${p.name}`).join("")})).as_ref()`;
    fn = "fv::scoped_slot_into";
    args = `${content}, ${passed}`;
  }
  if (s.comp.passesSlotIds) {
    fn = fn === "fv::slot_into" ? "fv::slot_into_slotted" : "fv::scoped_slot_into_slotted";
    args += `, ${slotted ?? '""'}`;
  } else if (slotted !== null) fail(s.comp, "FV0918", "a slot scope id passed to content that does not take one", c);
  const call = (rest: string) => (s.fill ? `if ${fn}(out, ${args}, ${rest}) { filled = true; }` : `${fn}(out, ${args}, ${rest});`);
  if (fallback?.type === "NullLiteral" || !fallback) {
    e.stmt(call("None"));
    return;
  }
  if (fallback.type !== "ArrowFunctionExpression" || fallback.body.type !== "BlockStatement") {
    fail(s.comp, "FV0006", "unexpected slot fallback", fallback);
  }
  e.open(`${s.fill ? "if " : ""}${fn}(out, ${args}, Some(&mut |out: &mut String|`);
  statements(s, e, fallback.body.body);
  e.close(s.fill ? ")) { filled = true; }" : "));");
}
