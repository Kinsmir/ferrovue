import { type N, type Scope, type Val, enumOf, fail, literalsOf, namesSelf, nodeName } from "./model.ts";
import { optionBinder, variantBinder } from "./enums.ts";
import { GenError } from "./errors.ts";
import { ctx } from "./context.ts";
import { expr, shown } from "./expr.ts";
import { type Presence, boolOf, cond, known, literalNarrowing, narrowedVal, narrowTo, presence, truthTested, truthy } from "./narrowing.ts";
import { CMP, condition, occurrences, operand, scrutinee } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { attrShown, interpolate, isAttrs, keepsAttrCase, mergedParts, renderAttr, renderAttrs, renderDynamicAttr } from "./attrs.ts";
import { renderStyle } from "./styles.ts";
import { renderClass, vnodeClass } from "./classes.ts";
import { renderChild } from "./children.ts";
import { slotOutlet } from "./slots.ts";
import { list } from "./loops.ts";
import { checkVHtmlPlacement } from "./vhtml.ts";
import { dynamicComponent } from "./dynamic.ts";
import { fresh, jsHint } from "./names.ts";

const FROM_VNODES = "in content Vue renders from virtual nodes (in an element `<component :is>` chooses, a `<RouterLink>` or a twin's slot, or in slot content they render)";

function hidesByVShow(n: N): boolean {
  if (n?.type === "ArrayExpression") return n.elements.some(hidesByVShow);
  return (
    n?.type === "ConditionalExpression" && n.consequent.type === "NullLiteral" && n.alternate.type === "ObjectExpression" &&
    n.alternate.properties.length === 1 && (n.alternate.properties[0].key?.name ?? n.alternate.properties[0].key?.value) === "display" &&
    n.alternate.properties[0].value?.value === "none"
  );
}

const CONTENT_KEYS = new Set(["textContent", "innerHTML"]);

function isDirectiveProps(p: N): boolean {
  return p.type === "CallExpression" && p.callee.name === "_ssrGetDirectiveProps";
}

function heldContent(p: N): N {
  if (isDirectiveProps(p)) return null;
  if (p.type !== "ObjectExpression") return p;
  return p.properties.find((q: N) => q.type !== "ObjectProperty" || q.computed || CONTENT_KEYS.has(q.key.name ?? q.key.value)) ?? null;
}

function directedContent(s: Scope, n: N): void {
  s.temps.add(n.left.name);
  const parts = mergedParts(n.right);
  const held = parts.map(heldContent).find((p) => p !== null);
  if (held === undefined) return;
  const what = "an element with no content given a custom directive renders as its content a `textContent` or `innerHTML`";
  if (isAttrs(held)) {
    fail(s.comp, "FV0425", `${what} among the attributes passed to the component, when it is the root: wrap it in an element, such as a \`<div>\`, which then takes those attributes`, parts.find(isDirectiveProps));
  }
  fail(s.comp, "FV0425", `${what} among the attributes it merges: bind each attribute by its name, and write the content inside the element`, held);
}

function selectsByModel(n: N): boolean {
  if (n?.type === "CallExpression" && n.callee.type === "Identifier" && /^_ssrLoose(?:Equal|Contain)$/.test(n.callee.name)) return true;
  if (n?.type === "CallExpression") return n.arguments.some(selectsByModel);
  return n?.type === "ConditionalExpression" && [n.test, n.consequent, n.alternate].some(selectsByModel);
}

export function slot(s: Scope, e: Emitter, n: N): void {
  if (n.type === "Identifier" && n.name === "_scopeId") {
    if (s.sid !== null) e.stmt(s.vnode ? `out.push_str(&fv::attrs::scope_attrs("", "", ${s.sid}));` : `out.push_str(${s.sid});`);
    return;
  }
  if (n.type === "CallExpression" && n.callee.type === "Identifier") {
    const a: N[] = n.arguments;
    switch (n.callee.name) {
      case "_ssrInterpolate":
        interpolate(s, e, shown(s, a[0], "text"), a[0]);
        return;
      case "_ssrRenderAttr":
        if (a[0].type !== "StringLiteral") fail(s.comp, "FV0417", "attribute names are literal", n);
        if (s.vnode) renderDynamicAttr(s, e, a[0].value, attrShown(s, a[0].value, a[1], ctx.vnodeTag), a[1], ctx.vnodeTag);
        else renderAttr(s, e, a[0].value, shown(s, a[1], "attr"), a[1]);
        return;
      case "_ssrRenderDynamicAttr":
        if (a[0].type !== "StringLiteral") fail(s.comp, "FV0417", "attribute names are literal", n);
        renderDynamicAttr(s, e, a[0].value, attrShown(s, a[0].value, a[1]), n);
        return;
      case "_ssrRenderAttrs":
        if (a.length > 1) fail(s.comp, "FV0006", "`ssrRenderAttrs` with a tag argument", n);
        if (a[0].type === "AssignmentExpression") {
          directedContent(s, a[0]);
          renderAttrs(s, e, a[0].right);
          return;
        }
        renderAttrs(s, e, a[0]);
        return;
      case "_ssrRenderClass":
        renderClass(s, e, s.vnode ? vnodeClass(s, a[0]) : a[0]);
        return;
      case "_ssrRenderStyle":
        if (s.vnode && hidesByVShow(a[0])) fail(s.comp, "FV0423", `\`v-show\` ${FROM_VNODES}, where Vue writes no \`style\` while it shows: bind \`:style\` or use \`v-if\``, n);
        renderStyle(s, e, a[0]);
        return;
    }
  }
  if (n.type === "LogicalExpression" && n.operator === "??" && n.right.type === "StringLiteral" && n.right.value === "") {
    const v = expr(s, n.left);
    const html = v.ty.k === "opt" ? v.ty.of : v.ty;
    if (html.k === "html") checkVHtmlPlacement(s.comp, n, html.inline === true);
    if (v.ty.k === "html") {
      e.stmt(`fv::html::trusted_into(out, ${v.code});`);
      return;
    }
    if (v.ty.k === "opt" && v.ty.of.k === "html") {
      e.open(`if let Some(html) = ${scrutinee(v.code)}`);
      e.stmt("fv::html::trusted_into(out, html);");
      e.close();
      return;
    }
    fail(s.comp, "FV1502", "`v-html` renders only a `TrustedHtml` prop (from `ferrovue/types`)", n);
  }
  if (n.type === "ConditionalExpression" && s.temps.has(n.test.right?.name)) return;
  if (n.type === "ConditionalExpression" && n.consequent.type === "StringLiteral" && n.alternate.type === "StringLiteral") {
    if (s.vnode && n.consequent.value === " selected" && selectsByModel(n.test)) fail(s.comp, "FV0423", `\`v-model\` on a \`<select>\` ${FROM_VNODES}, where Vue marks no option \`selected\`: bind \`:selected\` on the options`, n);
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
  fail(s.comp, "FV0006", "this expression cannot be rendered on the server", n);
}

export function isComment(text: string): boolean {
  if (!/^<!--[\s\S]*-->$/.test(text)) return false;
  return text.length <= 8 || !text.replace(/<!--[^]*?-->/gm, "").trim();
}

export function pushesContent(n: N): boolean | "run" {
  if (n.type === "StringLiteral") return !isComment(n.value);
  if (n.type === "TemplateLiteral") {
    const quasis: string[] = n.quasis.map((q: N) => q.value.cooked);
    if (n.expressions.length === 0) return !isComment(quasis[0]!);
    const first = quasis[0]!;
    const last = quasis.at(-1)!;
    if (!"<!--".startsWith(first) && !first.startsWith("<!--")) return true;
    if (!"-->".endsWith(last) && !last.endsWith("-->")) return true;
    const raw = n.expressions.some((x: N) => x.type !== "CallExpression" && !(x.type === "Identifier" && x.name === "_scopeId"));
    const split = quasis.some((q, i) => (i > 0 && /^(?:-|--|!--|->|>)/.test(q)) || (i < quasis.length - 1 && /(?:<|<!|<!-|-|--)$/.test(q)));
    if (!raw && !split && /\S/.test(quasis.join("\0").replace(/<!--[^]*?-->/g, "").replaceAll("\0", ""))) return true;
    return "run";
  }
  return true;
}

function pushesVnodes(n: N): boolean {
  const outside = (text: string): boolean => text.replace(/<!--[^]*?-->/g, "") !== "";
  if (n.type === "StringLiteral") return outside(n.value);
  if (n.type === "TemplateLiteral") {
    return n.expressions.some((x: N) => !(x.type === "Identifier" && x.name === "_scopeId")) || outside(n.quasis.map((q: N) => q.value.cooked).join(""));
  }
  return true;
}

export function push(s: Scope, e: Emitter, n: N): void {
  const content = !s.fill ? false : s.vnode ? pushesVnodes(n) : pushesContent(n);
  if (content === true) e.stmt("filled = true;");
  if (content !== "run") {
    pushed(s, e, n);
    return;
  }
  e.stmt("let fv_chunk = out.len();");
  pushed(s, e, n);
  e.stmt("filled |= !fv::render::is_comment(&out[fv_chunk..]);");
}

const START_TAG = /^<([A-Za-z][^\s/>]*)/;
const ATTRIBUTE = /^(\s+)([^\s"'<>/=]+)(?:="([^"]*)")?/;

function asVnodes(text: string): string {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const tag = ctx.vnodeTag;
    if (tag === null) {
      const lt = text.indexOf("<", at);
      if (lt < 0) {
        out += text.slice(at);
        break;
      }
      out += text.slice(at, lt);
      if (text.startsWith("<!--", lt)) {
        const end = text.indexOf("-->", lt + 4);
        at = end < 0 ? text.length : end + 3;
        out += text.slice(lt, at);
        continue;
      }
      const start = START_TAG.exec(text.slice(lt));
      if (start) ctx.vnodeTag = start[1]!;
      const taken = start?.[0] ?? "<";
      out += taken;
      at = lt + taken.length;
      continue;
    }
    const attr = ATTRIBUTE.exec(text.slice(at));
    if (attr) {
      const [all, space, written, value] = attr as unknown as [string, string, string, string | undefined];
      const name = keepsAttrCase(tag) ? written : written.toLowerCase();
      out += value === "" && name !== "class" && name !== "style" ? `${space}${name}` : `${space}${name}${all.slice(space.length + written.length)}`;
      at += all.length;
      continue;
    }
    if (text[at] === ">") ctx.vnodeTag = null;
    out += text[at];
    at++;
  }
  return out;
}

function pushed(s: Scope, e: Emitter, n: N): void {
  const text = n.type === "StringLiteral" ? n.value : n.type === "TemplateLiteral" && !n.expressions.length ? n.quasis[0].value.cooked : null;
  if (s.vnode && text === "<!---->") {
    e.lit("<!--v-if-->");
    return;
  }
  const literal = (t: string): string => (s.vnode ? asVnodes(t) : t);
  if (n.type === "StringLiteral") {
    e.lit(literal(n.value));
    return;
  }
  if (n.type === "TemplateLiteral") {
    n.quasis.forEach((q: N, i: number) => {
      e.lit(literal(q.value.cooked));
      if (i < n.expressions.length) recover(s, e, () => slot(s, e, n.expressions[i]));
    });
    return;
  }
  if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "_ssrRenderComponent") {
    if (!ctx.plugins.some((p) => p.component?.(s, e, n))) renderChild(s, e, n);
    return;
  }
  fail(s.comp, "FV0006", "this cannot be pushed", n);
}

export function statements(s: Scope, e: Emitter, body: N[]): void {
  for (const st of body) recover(s, e, () => statement(s, e, st));
}

function recover(s: Scope, e: Emitter, f: () => void): void {
  if (!ctx.recovered || ctx.trying) return f();
  const locals = [...s.locals];
  const narrowed = [...s.narrowed];
  const rewind = e.mark();
  try {
    f();
  } catch (err) {
    if (!(err instanceof GenError)) throw err;
    ctx.recovered.push(err);
    restore(s.locals, locals);
    restore(s.narrowed, narrowed);
    rewind();
  }
}

function restore<K, V>(map: Map<K, V>, entries: [K, V][]): void {
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
}

function statement(s: Scope, e: Emitter, st: N): void {
  if (st.type === "ExpressionStatement" && st.expression.type === "CallExpression") {
    const c = st.expression;
    const callee = c.callee.type === "Identifier" ? c.callee.name : null;
    if (callee === "_push") {
      push(s, e, c.arguments[0]);
      return;
    }
    if (callee === "_ssrRenderList") {
      list(s, e, c);
      return;
    }
    if (callee === "_ssrRenderSlot") {
      slotOutlet(s, e, c);
      return;
    }
    if (callee === "_ssrRenderSuspense") {
      const def = c.arguments[1]?.properties?.find((p: N) => (p.key?.name ?? p.key?.value) === "default");
      if (!def) e.lit("<!---->");
      else if (def.value.type === "ArrowFunctionExpression" && def.value.body.type === "BlockStatement") statements(s, e, def.value.body.body);
      else fail(s.comp, "FV0006", "unexpected `<Suspense>` content", c);
      return;
    }
    if (ctx.plugins.some((p) => p.statement?.(s, e, c, st))) return;
    if (dynamicComponent(s, e, st)) return;
    if (callee === "_ssrRenderVNode") fail(s.comp, "FV0418", "`<component :is>` renders a closed set of choices", st);
  }
  if (st.type === "VariableDeclaration" && st.declarations.every((d: N) => d.init === null)) return;
  if (st.type === "VariableDeclaration" && st.declarations.length === 1) {
    const d = st.declarations[0];
    const init = d.init;
    if (
      init?.type === "CallExpression" && init.callee.type === "Identifier" &&
      init.callee.name === "_resolveComponent" && init.arguments[0]?.type === "StringLiteral" &&
      namesSelf(s.comp, init.arguments[0].value) && init.arguments[1]?.type === "BooleanLiteral"
    ) {
      s.selfAliases.add(d.id.name);
      return;
    }
    const named = init?.type === "CallExpression" && init.callee.type === "Identifier" &&
      init.callee.name === "_resolveComponent" && init.arguments.length === 1 &&
      init.arguments[0]?.type === "StringLiteral" ? init.arguments[0].value : null;
    if (named !== null && ctx.plugins.some((p) => p.resolveComponent?.(s, d.id.name, named))) return;
    if (init?.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === "_resolveDirective" && init.arguments[0]?.type === "StringLiteral") {
      s.directives.set(d.id.name, init.arguments[0].value);
      return;
    }
    fail(s.comp, "FV0513", `${named !== null ? `\`<${named}>\` is ` : ""}a component the template resolves by name, which must be imported, or be this one`, st);
  }
  if (st.type === "IfStatement") {
    const branch = (b: N): N[] => (b.type === "BlockStatement" ? b.body : [b]);
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
      const binders: { part: string; test: () => string | null }[] = [];
      let at = -1;
      const parts: string[] = [];
      let narrowedLiterals = false;
      for (const op of operands) {
        const inner = { ...s, narrowed };
        const p = presence(inner, op);
        if (p && !p.negated) {
          const name = fresh("n", jsHint(p.path));
          parts.push(p.pattern(name));
          narrowed.set(p.path, narrowedVal(p, name));
          bound.set(name, p);
        } else {
          parts.push(operand(cond(inner, op), CMP));
          const literals = literalNarrowing(inner, op);
          if (literals !== null) {
            const made = binding(inner, literals.yes, literals, (name) => e.reads(name, at));
            binders.push({ part: parts.at(-1)!, test: made.test });
            for (const [path, v] of made.scope.narrowed) narrowed.set(path, v);
            narrowedLiterals = true;
          }
        }
      }
      if (parts.includes("false")) {
        if (st.alternate) statements(s, e, branch(st.alternate));
        return;
      }
      if (parts.includes("true")) parts.splice(0, parts.length, ...parts.filter((p) => p !== "true"));
      if (narrowed.size > s.narrowed.size || narrowedLiterals) {
        e.open(`if ${parts.join(" && ")}`);
        at = e.lines.length - 1;
        statements({ ...s, narrowed }, e, branch(st.consequent));
        for (const { part, test } of binders.toReversed()) {
          const binds = test();
          if (binds !== null) e.replace(at, part, binds);
        }
        for (const [name, p] of bound) {
          const inHead = occurrences(e.lines[at]!, name) > 1;
          if (!inHead && !e.reads(name, at + 1)) e.replace(at, p.pattern(name), operand(p.present, CMP));
        }
        if (st.alternate) {
          e.close(" else {");
          statements(s, e, branch(st.alternate));
        }
        e.close();
        return;
      }
    }
    const compound =
      (st.test.type === "LogicalExpression" && st.test.operator !== "??") ||
      (st.test.type === "UnaryExpression" && st.test.operator === "!");
    const t: Val = compound ? boolOf(cond(s, st.test)) : truthTested(s, st.test);
    const k = known(t);
    if (k !== undefined) {
      const taken = k ? st.consequent : st.alternate;
      if (taken) statements(s, e, branch(taken));
      return;
    }
    const p = presence(s, st.test);
    if (p && (!p.negated || st.alternate)) {
      const name = fresh("n", jsHint(p.path));
      e.open(`if ${p.pattern(name)}`);
      const at = e.lines.length - 1;
      const [present, absent] = p.negated ? [st.alternate, st.consequent] : [st.consequent, st.alternate];
      const over = p.source === undefined ? null : optionBinder(s.comp, p.source.code, p.source.def, p.of, name, jsHint(p.path), (n) => e.reads(n, at + 1));
      statements(over === null ? narrowTo(s, p, name) : { ...s, narrowed: new Map(s.narrowed).set(p.path, over.val) }, e, branch(present));
      const binds = over?.test() ?? null;
      if (binds !== null) e.replace(at, p.pattern(name), binds);
      else if (!e.reads(name, at + 1)) e.replace(at, p.pattern(name), condition(p.present));
      if (absent) {
        e.close(" else {");
        statements(s, e, branch(absent));
      }
      e.close();
      return;
    }
    const literals = literalNarrowing(s, st.test);
    const test = condition(cond(s, st.test));
    e.open(`if ${test}`);
    const at = e.lines.length - 1;
    const yes = binding(s, literals?.yes ?? s, literals, (name) => e.reads(name, at + 1));
    statements(yes.scope, e, branch(st.consequent));
    const binds = yes.test();
    if (binds !== null) e.replace(at, test, binds);
    if (st.alternate) {
      e.close(" else {");
      const otherwise = e.lines.length - 1;
      const no = binding(s, literals?.no ?? s, literals, (name) => e.reads(name, otherwise + 1));
      statements(no.scope, e, branch(st.alternate));
      const elseBinds = no.test();
      if (elseBinds !== null) e.replace(otherwise, "} else {", `} else if ${elseBinds} {`);
    }
    e.close();
    return;
  }
  fail(s.comp, "FV0006", `${nodeName(st)} in the compiled template`, st);
}

function binding(s: Scope, narrowed: Scope, literals: ReturnType<typeof literalNarrowing>, reads: (name: string) => boolean): { scope: Scope; test: () => string | null } {
  const v = literals === null || narrowed === s ? undefined : narrowed.narrowed.get(literals.path);
  const kept = v === undefined ? undefined : literalsOf(v.ty);
  if (literals === null || v === undefined || kept === undefined || v.variant === undefined || v.ty.k === "opt" || enumOf(v.ty) === undefined) return { scope: narrowed, test: () => null };
  const made = variantBinder(s.comp, v, kept as readonly string[], jsHint(literals.path), reads);
  return { scope: { ...narrowed, narrowed: new Map(narrowed.narrowed).set(literals.path, made.val) }, test: made.test };
}
