/* The compiled template's statements: pushes, the values written into them, and conditions, with
 * lists (`loops.ts`), child components (`children.ts`) and slots (`slots.ts`) beside it. */

import { type N, type Scope, type Val, fail } from "./model.ts";
import { ctx } from "./context.ts";
import { expr } from "./expr.ts";
import { type Presence, boolOf, cond, known, narrowTo, presence, truthy } from "./narrowing.ts";
import { CMP, condition, occurrences, operand } from "./parens.ts";
import { Emitter } from "./emitter.ts";
import { interpolate, renderAttr, renderAttrs, renderDynamicAttr } from "./attrs.ts";
import { renderStyle } from "./styles.ts";
import { renderClass } from "./classes.ts";
import { renderChild } from "./children.ts";
import { slotOutlet } from "./slots.ts";
import { list } from "./loops.ts";

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
