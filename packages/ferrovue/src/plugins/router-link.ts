/* `<RouterLink>` as vue-router renders it: its location resolved from the reader's route, the
 * active classes and `aria-current`, and the attributes and scope ids its `<a>` takes. */

import { escapeHtml } from "@vue/shared";
import { type N, type Scope, type Val, camelize, fail, rustStr } from "../model.ts";
import { CONFIG_FILE } from "../context.ts";
import { expr } from "../expr.ts";
import { lonely } from "../strings.ts";
import { bare, condition, strArg } from "../parens.ts";
import { Emitter } from "../emitter.ts";
import { attrOf, dollarAttrs, IGNORED_PROPS, isAttrs, mergedParts, mergeProps, renderDynamicAttr } from "../attrs.ts";
import { renderStyle } from "../styles.ts";
import { classItems } from "../classes.ts";
import { statements } from "../template.ts";
import { slotBody } from "../slots.ts";
import { runOf } from "../plugin.ts";
import { scopeIdOf } from "./scoped.ts";
import { allRoutes, router } from "./router.ts";

export const ROUTER_LINK_PROPS = new Set(["to", "class", "activeClass", "exactActiveClass", "ariaCurrentValue"]);

/** `<RouterLink>` props that change only what a click does, which the server does not render. */
export const ROUTER_LINK_INERT = new Set(["replace", "viewTransition"]);

/** The parameter names of a route path, in order. */
export function routeParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
}

/** A string written into a link, which vue-router percent-encodes: half of a surrogate pair makes
 * `encodeURI` throw, so Vue renders no page at all. */
function noHalves(s: Scope, v: Val, n: N): void {
  if (v.lone) fail(s.comp, lonely("a `<RouterLink>` location"), n);
}

/** A value written into a URL — a parameter or a query value — as the `&str` vue-router stringifies. */
export function urlText(s: Scope, v: Val, n: N): string {
  noHalves(s, v, n);
  if (v.ty.k === "str") return v.code;
  if (v.ty.k === "int" || v.ty.k === "float") return `&*fv::Js(${bare(v.code)}).to_string()`;
  if (v.ty.k === "bool") return `if ${condition(v.code)} { "true" } else { "false" }`;
  return fail(s.comp, "a route parameter is a string or a number that is present", n);
}

/** \`let fv_link = …;\`: a \`<RouterLink>\`'s \`to\` resolved from the reader's route. */
export function resolveLink(s: Scope, e: Emitter, to: N): void {
  if (to.type !== "ObjectExpression") {
    const target = expr(s, to);
    if (target.ty.k !== "str") fail(s.comp, "`<RouterLink>`'s `to` is a string or an object literal", to);
    noHalves(s, target, to);
    e.stmt(`let fv_link = fv_route.link(${strArg(target.code)});`);
    return;
  }
  const parts = new Map<string, N>();
  for (const p of to.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "a `to` object holds plain keys", p);
    const key: string = p.key.name ?? p.key.value;
    if (["replace", "force", "state"].includes(key)) continue;
    if (!["name", "path", "params", "query", "hash"].includes(key)) fail(s.comp, `\`${key}\` in a \`to\` object`, p);
    parts.set(key, p.value);
  }
  e.open("let fv_link =");
  const query = parts.get("query");
  // The query, built only when the location has one.
  const search = query ? "&fv_search" : '""';
  if (query) {
    e.stmt("let mut fv_search = String::new();");
    if (query.type !== "ObjectExpression") fail(s.comp, "a `to`'s `query` is an object literal", query);
    for (const p of query.properties) {
      if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "a query holds plain keys", p);
      const key = String(p.key.name ?? p.key.value);
      const v = expr(s, p.value);
      // An absent value leaves its key out, as `undefined` does.
      if (v.ty.k === "undef") continue;
      if (v.ty.k === "opt") {
        e.open(`if let Some(v) = ${v.code}`);
        e.stmt(`fv::query_into(&mut fv_search, ${rustStr(key)}, ${strArg(urlText(s, { code: "v", ty: v.ty.of }, p.value))});`);
        e.close();
      } else e.stmt(`fv::query_into(&mut fv_search, ${rustStr(key)}, ${strArg(urlText(s, v, p.value))});`);
    }
  }
  let hash = '""';
  const h = parts.get("hash");
  if (h) {
    const v = expr(s, h);
    if (v.ty.k !== "str") fail(s.comp, "a `to`'s `hash` is a string", h);
    noHalves(s, v, h);
    hash = strArg(v.code);
  }
  const name = parts.get("name");
  const path = parts.get("path");
  if (name) {
    if (name.type !== "StringLiteral") fail(s.comp, "a `to`'s `name` is a string literal, checked against the routes", name);
    const route = allRoutes(runOf(router).routes!).find((r) => r.name === name.value);
    if (!route) fail(s.comp, `no route is called \`${name.value}\``, name);
    const wanted = routeParams(route.fullPath);
    const given = new Map<string, N>();
    const params = parts.get("params");
    if (params) {
      if (params.type !== "ObjectExpression") fail(s.comp, "a `to`'s `params` is an object literal", params);
      for (const p of params.properties) {
        if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "params hold plain keys", p);
        const key = String(p.key.name ?? p.key.value);
        if (!wanted.includes(key)) fail(s.comp, `route \`${name.value}\` has no parameter \`${key}\``, p);
        given.set(key, p.value);
      }
    }
    const missing = wanted.filter((w) => !given.has(w));
    if (missing.length) fail(s.comp, `route \`${name.value}\` needs \`${missing.join("`, `")}\`: give every parameter`, to);
    const list = wanted.map((w) => `(${rustStr(w)}, ${urlText(s, expr(s, given.get(w)), given.get(w))})`);
    e.stmt(`fv_route.link_named(${rustStr(name.value)}, &[${list.join(", ")}], ${search}, ${hash})`);
  } else if (path) {
    if (parts.has("params")) fail(s.comp, "a `to` with a `path` takes no `params`, which vue-router ignores", path);
    const v = expr(s, path);
    if (v.ty.k !== "str") fail(s.comp, "a `to`'s `path` is a string", path);
    noHalves(s, v, path);
    e.stmt(`fv_route.link_path(${strArg(v.code)}, ${search}, ${hash})`);
  } else fail(s.comp, "a `to` object has a `name` or a `path`", to);
  e.close(";");
}

/** \`<RouterLink to="...">\` as vue-router renders it: \`aria-current\` and the active classes when it
 * points where the reader is, then \`href\`, then the link's own class and attributes. */
export function routerLink(s: Scope, e: Emitter, n: N): void {
  const [, rawProps, slots, , slotScopeId] = n.arguments;
  let props = rawProps;
  if (props?.type === "CallExpression" && props.callee.type === "Identifier" && props.callee.name === "_mergeProps") {
    props = mergeProps(s, props);
  }
  if (props?.type !== "ObjectExpression") fail(s.comp, "`<RouterLink>` takes literal attributes", n);
  const fields = new Map<string, N>();
  const attrs: N[] = [];
  for (const p of props.properties) {
    if (p.type !== "ObjectProperty" || p.computed) fail(s.comp, "`<RouterLink>` attributes hold plain keys", p);
    const raw: string = p.key.type === "Identifier" ? p.key.name : p.key.value;
    const key = raw.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    if (ROUTER_LINK_PROPS.has(key)) fields.set(key, p.value);
    else if (/^on[^a-z]/.test(raw) || IGNORED_PROPS.has(raw) || ROUTER_LINK_INERT.has(key)) continue;
    else if (key === "custom") fail(s.comp, "`custom` on `<RouterLink>` renders a scoped slot, which is not supported", p);
    else if (key === "href" || key === "ariaCurrent") fail(s.comp, `\`${raw}\` on \`<RouterLink>\` is its own`, p);
    else attrs.push({ ...p, key: { type: "StringLiteral", value: raw } });
  }
  const to = fields.get("to");
  if (!to) fail(s.comp, "`<RouterLink>` needs `to`", n);
  /* vue-router renders the link from virtual nodes (`renderElementVNode`). The `<a>` takes the ids
   * of a component's root after its attributes: what the parent passes on when the link is its
   * root, the id of the component that wrote it, and the slot scope ids around it — as
   * `scope_attrs` gathers them. Its content takes that component's id, which the compiled template
   * spells out, and the slot scope ids again, each once: unlike the raw `_scopeId` the compiled
   * elements would write, so an element there is refused when there are some. */
  const passed = (rawProps?.type === "Identifier" && rawProps.name === "_attrs") || rawProps?.arguments?.some((a: N) => a.type === "Identifier" && a.name === "_attrs");
  const base = passed ? s.attrs : null;
  const slotted = slotScopeId ? s.sid : null;
  const scopeId = scopeIdOf(s.comp);
  const content = slots?.type === "ObjectExpression" ? slots.properties.filter((p: N) => (p.key?.name ?? p.key?.value) !== "_").map((p: N) => p.value) : [];
  /** Whether the link's content holds a node that `is` picks out. */
  const holds = (is: (x: N) => boolean): boolean => {
    const within = (x: N): boolean => !!x && typeof x === "object" && (is(x) || Object.values(x).some(within));
    return content.some((c: N) => slotBody(s, c).some(within));
  };
  const writesScopeId = (x: N): boolean => x.type === "TemplateLiteral" && x.expressions.some((y: N) => y.type === "Identifier" && y.name === "_scopeId");
  if (slotted !== null && holds(writesScopeId)) {
    fail(s.comp, "an element inside a `<RouterLink>` in slot content given a slot scope id: vue-router writes those ids by rules of its own", to);
  }
  // A `<slot>` there is rendered as a virtual node too, which passes its own slot scope ids.
  if ((scopeId !== null || slotted !== null || base !== null) && holds((x) => x.type === "CallExpression" && x.callee.name === "_ssrRenderSlot")) {
    fail(s.comp, "a `<slot>` inside a `<RouterLink>` that takes scope ids: vue-router renders it by rules of its own", to);
  }
  if (!runOf(router).routes) fail(s.comp, `\`<RouterLink>\` needs \`routes\` in ${CONFIG_FILE}: the paths it resolves against`, n);
  /** A literal-string prop, which the class names and `aria-current` must be. */
  const literal = (key: string, fallback: string): string => {
    const v = fields.get(key);
    if (!v) return fallback;
    if (v.type !== "StringLiteral") fail(s.comp, `\`${key}\` on \`<RouterLink>\` is a string literal`, v);
    return v.value;
  };
  const activeClass = literal("activeClass", runOf(router).linkActive);
  const exactClass = literal("exactActiveClass", runOf(router).linkExactActive);
  const ariaCurrent = literal("ariaCurrentValue", "page");
  e.open("");
  resolveLink(s, e, to);
  e.lit("<a");
  /* Attributes this component is passed fall through to the link: merged into its virtual node's
   * props with the template's, then onto the `<a>` vue-router renders. */
  const parts = mergedParts(rawProps);
  const passedOn = (p: N): boolean => s.fallthrough !== null && ((isAttrs(p) && s.comp.inheritAttrs) || dollarAttrs(s, p));
  const fallsThrough = parts.some(passedOn);
  if (fallsThrough) {
    for (const name of s.comp.attrNames) {
      const key = camelize(name);
      if ((ROUTER_LINK_PROPS.has(key) && key !== "class") || ROUTER_LINK_INERT.has(key) || key === "custom" || key === "viewTransition") {
        fail(s.comp, `\`${name}\`, an attribute ${s.comp.name} may be passed, would reach its \`<RouterLink>\` as a prop`, n);
      }
      if (key === "href" || key === "ariaCurrent") fail(s.comp, `\`${name}\`, an attribute ${s.comp.name} may be passed, would replace its \`<RouterLink>\`'s own`, n);
    }
    e.open(`if ${s.fallthrough}.is_empty()`);
  }
  e.open("if fv_link.exact");
  e.lit(` aria-current="${escapeHtml(ariaCurrent)}"`);
  e.close();
  e.lit(' href="');
  e.stmt("fv::escape_into(out, &fv_link.href);");
  e.lit('" class="');
  // `{ [activeClass]: isActive, [exactActiveClass]: isExactActive }`. When the two are one class,
  // the later key wins: the class goes with `isExactActive`.
  const linkItems =
    activeClass === exactClass
      ? [`if fv_link.exact { ${rustStr(exactClass)} } else { "" }`]
      : [`if fv_link.active { ${rustStr(activeClass)} } else { "" }`, `if fv_link.exact { ${rustStr(exactClass)} } else { "" }`];
  const cls = fields.get("class");
  const own = cls ? classItems(s, cls).map((it) => ("lit" in it ? rustStr(it.lit) : it.code)) : [];
  e.stmt(`fv::class_into(out, false, &[${[...linkItems, ...own].join(", ")}]);`);
  e.lit('"');
  for (const p of attrs) {
    const key: string = p.key.value;
    if (key === "style") {
      e.lit(` style="`);
      renderStyle(s, e, p.value);
      e.lit(`"`);
      continue;
    }
    renderDynamicAttr(s, e, key, expr(s, p.value), p);
  }
  if (base === null && slotted === null) {
    if (scopeId !== null) e.lit(` ${scopeId}`);
  } else e.stmt(`out.push_str(&fv::scope_attrs(${base ?? '""'}, ${scopeId === null ? '""' : rustStr(scopeId)}, ${slotted ?? '""'}));`);
  if (fallsThrough) {
    e.close(" else {");
    // The template's attributes for the link, merged in their order with those passed on.
    const sources: string[] = [];
    for (const p of parts) {
      if (passedOn(p)) sources.push(`${s.fallthrough}.list()`);
      else if (p.type === "ObjectExpression") {
        const entries = p.properties
          .filter((q: N) => {
            const raw: string = q.key?.type === "Identifier" ? q.key.name : String(q.key?.value);
            const key = camelize(raw);
            return key === "class" || (!ROUTER_LINK_PROPS.has(key) && !ROUTER_LINK_INERT.has(key) && !/^on[^a-z]/.test(raw) && !IGNORED_PROPS.has(raw));
          })
          .map((q: N) => {
            const raw: string = q.key.type === "Identifier" ? q.key.name : String(q.key.value);
            return `(${rustStr(raw)}, ${attrOf(s, raw, q.value, "vnode")})`;
          });
        if (entries.length) sources.push(`&[${entries.join(", ")}]`);
      }
    }
    const ids =
      base === null && slotted === null
        ? rustStr(scopeId === null ? "" : ` ${scopeId}`)
        : `&fv::scope_attrs(${base ?? '""'}, ${scopeId === null ? '""' : rustStr(scopeId)}, ${slotted ?? '""'})`;
    // vue-router's own: `aria-current` (`null` when the link is not exact), `href`, its classes.
    const linkOwn = [
      `("aria-current", if fv_link.exact { fv::Attr::str(${rustStr(ariaCurrent)}) } else { fv::Attr::Undefined })`,
      '("href", fv::Attr::str(&fv_link.href))',
      `("class", fv::Attr::from(fv::class_names(&[${linkItems.join(", ")}])))`,
    ];
    e.stmt(`fv::attrs_into(out, &[&[${linkOwn.join(", ")}], &fv::merge_props(&[${sources.join(", ")}])], 1, ${ids});`);
    e.close();
  }
  e.lit(">");
  if (slots && slots.type !== "NullLiteral") {
    if (slots.type !== "ObjectExpression") fail(s.comp, "slots must be an object literal", slots);
    for (const p of slots.properties) {
      const key: string = p.key?.type === "Identifier" ? p.key.name : p.key?.value;
      if (key === "_") continue;
      if (key !== "default") fail(s.comp, "`<RouterLink>` has only its default slot", p);
      statements({ ...s, fill: false, vnode: true }, e, slotBody(s, p.value));
    }
  }
  e.lit("</a>");
  e.close();
}
