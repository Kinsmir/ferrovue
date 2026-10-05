import { isSSRSafeAttrName, propsToAttrMap } from "@vue/shared";
import { type Component, type Field, type N, type Scope, type Ty, type Val, camelize, declares, fail, nothing, rustStr, sameTy, snake, takesAttrs } from "./model.ts";
import { ctx } from "./context.ts";
import { markHome } from "./typescript.ts";
import { expr, fieldVal, holdsNothing } from "./expr.ts";
import { asF64 } from "./numbers.ts";
import { atom, bare } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { attrOf, dollarAttrs, IGNORED_PROPS, isAttrs, mergedParts } from "./attrs.ts";
import { passedKey } from "./fallthrough.ts";
import { claim, paramsOf, slotContextOf, slotFieldsOf } from "./plugin.ts";
import { statements } from "./template.ts";
import { slotContent, slotFieldBorrows, staticallyFilled } from "./slots.ts";

/** A component the project renders with a Rust function of its own, in place of a compiled one. */
export interface TwinCall {
  comp: Component;
  init(s: Scope, f: Field, node: N | undefined, n: N): string;
  call(s: Scope, e: Emitter, inits: string[], slots: N, attrs: string): void;
}

export function renderChild(s: Scope, e: Emitter, n: N, twin?: TwinCall): void {
  const [target, rawProps, slots, , slotScopeId] = n.arguments;
  let local: string | null = null;
  if (target.type === "MemberExpression" && target.object.name === "$setup") {
    local = target.computed ? target.property.value : target.property.name;
  }
  const isSelf = target.type === "Identifier" && target.name === s.selfAlias.name;
  const childName = isSelf ? s.comp.name : local ? s.children.get(local) : undefined;
  const child = twin?.comp ?? (childName ? s.components.get(childName) : undefined);
  if (!child) fail(s.comp, "FV0501", `a child component must be imported from a \`.vue\` file among the components compiled, in ${ctx.componentsDir.replace(/\/$/, "")}`, n);
  for (const p of ctx.plugins) p.child?.(s, child, n);
  const parts: N[] = !rawProps || rawProps.type === "NullLiteral" ? [] : mergedParts(rawProps);
  const merges = parts.length > 0 && parts[0] !== rawProps;
  const passesAttrs = parts.some(isAttrs);
  const passed = (p: N): boolean => s.fallthrough !== null && ((isAttrs(p) && s.comp.inheritAttrs) || dollarAttrs(s, p));
  const marker = (p: N): boolean =>
    p.type === "ObjectExpression" && p.properties.length > 0 && p.properties.every((q: N) => q.type === "ObjectProperty" && IGNORED_PROPS.has(q.key.name ?? q.key.value));
  const objects = parts.filter((p) => !isAttrs(p) && !dollarAttrs(s, p) && !marker(p));
  if (parts.some(passed)) {
    for (const name of s.comp.attrNames) {
      if (declares(child, name)) {
        fail(s.comp, "FV0502", `\`${name}\`, an attribute ${s.comp.name} may be passed, would reach ${child.name} as its prop \`${camelize(name)}\`, which an attribute has no type for`, n);
      }
    }
  }
  const ids = claim((p) => p.childIds?.(s, child, passesAttrs, !!slotScopeId, n)) ?? null;
  if (objects.length === 1 && objects[0].type !== "ObjectExpression") {
    if (twin) fail(s.comp, "FV1501", `the props of ${child.name}, a Rust twin, are attributes or an object literal`, objects[0]);
    const v = expr(s, objects[0]);
    const own = child.name === s.comp.name && v.ty.k === "struct" && v.ty.name === "Props";
    if (own || (v.ty.k === "child" && v.ty.name === child.name)) {
      callChild(s, e, child, v.code, slots, childAttrsArg(s, child, parts, merges, null, ids, n));
      return;
    }
    fail(s.comp, "FV0503", `child props must be an object literal, or \`v-bind\` of ${child.name}'s own \`Props\``, n);
  }
  for (const p of objects) {
    if (p.type !== "ObjectExpression") fail(s.comp, "FV0503", `child props must be an object literal, or \`v-bind\` of ${child.name}'s own \`Props\``, p);
  }

  const given = new Map<string, N>();
  const fallthrough = new Set<N>();
  for (const obj of objects) {
    for (const p of obj.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "FV0504", "child props hold plain keys", p);
      const key: string = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
      if (!passedKey(child, key)) continue;
      const field = child.props.fields.find((f) => camelize(f.js) === camelize(key));
      if (field) {
        given.set(field.js, p.value);
        continue;
      }
      if (array(key)) fail(s.comp, "FV0505", `an attribute named \`${key}\`, which JavaScript would put before the others`, p);
      const name = propsToAttrMap[key] ?? key.toLowerCase();
      if (key !== "class" && key !== "style" && !isSSRSafeAttrName(name)) fail(s.comp, "FV0404", `unsafe attribute name \`${name}\``, p);
      fallthrough.add(p);
    }
  }
  if (twin) {
    const inits = child.props.fields.map((f) => twin.init(s, f, given.get(f.js), n));
    twin.call(s, e, inits, slots, childAttrsArg(s, child, parts, merges, fallthrough, ids, n)!);
    return;
  }
  const inits = child.props.fields.map((f) => {
    const node = given.get(f.js);
    if (!node) {
      if (f.ty.k !== "opt") fail(s.comp, "FV0506", `${child.name} requires \`${f.js}\``, n);
      if (f.ty.none !== undefined) fail(s.comp, "FV0507", `${child.name} requires \`${f.js}\`, which is \`T | null\`: Vue would hand it \`undefined\`; pass \`null\` for none`, n);
      return `${f.rust}: None`;
    }
    const v = expr(s, node);
    return fieldInit(f.rust, ownInto(s.comp, { ...v, ty: markHome(v.ty, s.comp.name) }, markHome(f.ty, child.name), node));
  });
  callChild(s, e, child, `&super::${child.module}::Props { ${inits.join(", ")} }`, slots, childAttrsArg(s, child, parts, merges, fallthrough, ids, n));
}

export function array(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1;
}

function childAttrsArg(s: Scope, child: Component, parts: N[], merges: boolean, fallthrough: Set<N> | null, ids: string | null, n: N): string | null {
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
    if (sources.length) fail(s.comp, "FV0508", `${child.name} is passed attributes it does not take`, n);
    return ids;
  }
  if (!sources.length) return ids === null ? "&fv::Attrs::NONE" : `&fv::Attrs::scoped(${ids})`;
  if (sources.length === 1 && !merges) return `&fv::Attrs::new(${sources[0]}, ${ids ?? '""'})`;
  return `&fv::Attrs::merged(&[${sources.join(", ")}], ${ids ?? '""'})`;
}

export function fieldInit(name: string, value: string): string {
  return value === name ? name : `${name}: ${bare(value)}`;
}

export function takesSlots(c: Component): boolean {
  return c.slotNames.length > 0 || slotFieldsOf(c).length > 0;
}

export function extraParams(c: Component, unread: (name: string) => boolean = () => false): string {
  return (takesSlots(c) ? ", fv_slots: Slots<'_>" : "") + paramsOf(c).map((p) => `, ${unread(p.name) ? "_" : ""}${p.name}: ${p.ty}`).join("");
}

export function callChild(s: Scope, e: Emitter, child: Component, propsCode: string, slots: N, attrs: string | null): void {
  const m = `super::${child.module}`;
  const scoped = child.inherits || takesAttrs(child);
  const trailing = paramsOf(child).map((p) => `, ${p.name}`).join("") + (scoped ? `, ${attrs ?? (takesAttrs(child) ? "&fv::Attrs::NONE" : '""')}` : "");
  const render = scoped ? "render_scoped" : "render";
  callWith(s, e, child, m, `${m}::${render}(out, ${propsCode}`, `${m}::Slots`, trailing, slots);
}

export function callWith(s: Scope, e: Emitter, child: Component, m: string, head: string, slotsTy: string, trailing: string, slots: N, vnode = false): void {
  const given = new Map<string, N>();
  if (slots && slots.type !== "NullLiteral") {
    if (slots.type !== "ObjectExpression") fail(s.comp, "FV0901", "slots must be an object literal", slots);
    for (const p of slots.properties) {
      const key: string = p.key?.type === "Identifier" ? p.key.name : p.key?.value;
      if (key === "_") continue;
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "FV0902", "slots hold plain keys", p);
      if (!child.slotNames.includes(key)) fail(s.comp, "FV0903", `${child.name} has no slot \`${key}\``, p);
      given.set(key, p.value);
    }
  }
  if (!takesSlots(child)) {
    e.stmt(`${head}${trailing});`);
    return;
  }
  e.open(`${head}, ${slotsTy}`);
  const context = slotContextOf(child);
  const contextParams = context.map((p) => `, ${p.name}: ${p.ty}`).join("");
  const opaque = vnode ? child.name : s.opaque;
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
    const sid = child.passesSlotIds ? `fv_sid${++ctx.narrowCount}` : null;
    const sidParam = sid === null ? "" : `, ${sid}: &str`;
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
    const unread = (opened: number, binding: string | null): void => {
      if (binding !== null && !e.reads(binding, opened + 1)) e.replace(opened, `${binding}:`, `_${binding}:`);
    };
    if (shape) {
      const sp = `fv_sp${++ctx.narrowCount}`;
      const ty: Ty = { k: "struct", name: shape.name, home: child.name };
      const locals = new Map(s.locals);
      if (param?.type === "ObjectPattern") {
        for (const p of param.properties) {
          if (p.type !== "ObjectProperty" || p.computed || p.value.type !== "Identifier") {
            fail(s.comp, "FV0904", "slot props are destructured into plain names, without defaults", p);
          }
          locals.set(p.value.name, fieldVal(s.comp, sp, ty, p.key.name ?? p.key.value, p));
        }
      } else if (param?.type === "Identifier" && !takesNone) {
        locals.set(param.name, { code: sp, ty });
      } else if (!takesNone) fail(s.comp, "FV0905", "slot props are a name or an object pattern", param);
      const life = shape.fields.some((f) => slotFieldBorrows(f.ty)) ? "<'_>" : "";
      e.open(`${field}: Some(&|out: &mut String, ${sp}: &${m}::${shape.name}${life}${sidParam}${contextParams}| -> bool`);
      const opened = e.lines.length - 1;
      content({ ...s, locals, sid, vnode, opaque });
      unread(opened, sp);
      unread(opened, sid);
      for (const p of context) unread(opened, p.name);
      e.close("),");
      continue;
    }
    if (!takesNone) fail(s.comp, "FV0906", `\`<slot${name === "default" ? "" : ` name="${name}"`}>\` in ${child.name} passes no props`, param);
    const inner: Scope = { ...s, sid, vnode, opaque };
    if (context.length) {
      e.open(`${field}: Some(&|out: &mut String${sidParam}${contextParams}| -> bool`);
      const opened = e.lines.length - 1;
      content(inner);
      unread(opened, sid);
      for (const p of context) unread(opened, p.name);
      e.close("),");
    } else if (sid !== null) {
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

export function ownInto(comp: Component, v: Val, want: Ty, node: N): string {
  holdsNothing(comp, v, want, node, "the prop");
  if (want.k === "opt" && nothing(v.ty)) return "None";
  if (want.k === "str") {
    if (v.ty.k !== "str") fail(comp, "FV0509", "a string prop needs a string", node);
    return `std::borrow::Cow::Borrowed(${bare(v.code)})`;
  }
  if (want.k === "opt" && want.of.k === "str") {
    if (v.ty.k === "str") return `Some(std::borrow::Cow::Borrowed(${bare(v.code)}))`;
    if (v.ty.k === "opt" && v.ty.of.k === "str") return `${atom(v.code)}.map(std::borrow::Cow::Borrowed)`;
  }
  if (sameTy(v.ty, want) && (want.k === "int" || want.k === "float" || want.k === "bool")) return v.code;
  if (want.k === "opt" && sameTy(v.ty, want.of) && (v.ty.k === "int" || v.ty.k === "float" || v.ty.k === "bool")) return `Some(${bare(v.code)})`;
  if (want.k === "float" && v.ty.k === "int") return asF64(v);
  if (want.k === "opt" && want.of.k === "float" && v.ty.k === "int") return `Some(${asF64(v)})`;
  if (v.iter !== undefined && v.ty.k === "list" && want.k === "list" && sameTy(v.ty.of, want.of)) {
    return want.of.k === "struct" || want.of.k === "child" ? `${v.iter}.cloned().collect()` : `${v.iter}.collect()`;
  }
  const objecty = (t: Ty): boolean => t.k === "struct" || t.k === "child" || t.k === "record" || ((t.k === "list" || t.k === "opt") && objecty(t.of));
  if (objecty(want) && sameTy(v.ty, want)) return `${atom(v.code)}.${v.ty.k === "opt" ? "cloned" : "to_owned"}()`;
  if (want.k === "opt" && objecty(want.of) && sameTy(v.ty, want.of)) return `Some(${atom(v.code)}.to_owned())`;
  if (objecty(want) && v.ty.k === want.k && JSON.stringify(v.ty).includes('"struct"')) {
    fail(comp, "FV0510", `a ${JSON.stringify(v.ty)} where the child takes a ${JSON.stringify(want)}: two components share a type only when both import it from one \`.ts\` file`, node);
  }
  if (want.k === "list" && v.ty.k === "list" && v.ty.of.k === "undef") return "Vec::new()";
  if (want.k === "opt" && want.of.k === "list" && v.ty.k === "list") return `Some(${ownInto(comp, v, want.of, node)})`;
  if (want.k === "list" && v.ty.k === "list" && sameTy(v.ty.of, want.of)) {
    if (want.of.k === "str") return `${atom(v.code)}.iter().map(|v| std::borrow::Cow::Borrowed(&**v)).collect()`;
    if (want.of.k === "int" || want.of.k === "float" || want.of.k === "bool") return `${atom(v.code)}.to_vec()`;
  }
  return fail(comp, "FV0511", `a ${JSON.stringify(v.ty)} into a ${JSON.stringify(want)} prop`, node);
}
