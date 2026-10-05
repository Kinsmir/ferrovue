/* vue-router: `<RouterLink>` and its locations, `<RouterView>`, `useRoute()` and `$route`, and the
 * routes file. */

import { escapeHtml } from "@vue/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Component, type N, type Scope, type Val, BOOL, camelize, fail, GenError, opt, rustStr, STR } from "../model.ts";
import { CONFIG_FILE } from "../context.ts";
import { boolOf, expr, lonely, pathOf } from "../expr.ts";
import { atom, bare, condition, not, strArg } from "../parens.ts";
import { Emitter } from "../emitter.ts";
import { attrOf, classItems, dollarAttrs, IGNORED_PROPS, isAttrs, mergedParts, mergeProps, renderDynamicAttr, renderStyle } from "../attrs.ts";
import { slotBody, statements } from "../template.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";
import { header } from "../rust.ts";

declare module "../model.ts" {
  interface PluginTys {
    /** `useRoute()` or `$route`: the reader's location, as vue-router resolved it. */
    route: { k: "route" };
    /** `route.params`. */
    params: { k: "params" };
    /** `route.query`, and one of its values: a string, \`null\`, an array of those, or absent. */
    queryobj: { k: "queryobj" };
    query: { k: "query" };
  }
}

/** A route as the routes file lists it: a vue-router path, and the name it may have. */
export interface RouteDef {
  /** The path as written: relative to the parent's unless it starts with \`/\`. */
  path: string;
  name?: string;
  /** The routes nested in it. */
  children?: RouteDef[];
  /** The path with its ancestors', as vue-router normalises it. */
  fullPath: string;
}

/** Every route, nested ones included, parents first. */
export function allRoutes(routes: RouteDef[]): RouteDef[] {
  return routes.flatMap((r) => [r, ...allRoutes(r.children ?? [])]);
}

/** The configured router, read once per run. */
interface RouterRun {
  /** The routes, and the file they are read from, when there are any. */
  routes: RouteDef[] | null;
  file: string | null;
  /** The history's base, and the class names active links take. */
  base: string;
  linkActive: string;
  linkExactActive: string;
  /** The components that read the route: \`useRoute()\`, \`$route\`, or a \`<RouterLink>\`, which
   * resolves against it. */
  readers: Set<Component>;
  /** The components that hold \`<RouterView>\`: the page, which the server supplies. */
  views: Set<Component>;
}

/** What one setup scope named vue-router's own by: \`useRoute\`, and \`RouterLink\` and \`RouterView\`,
 * imported or resolved by the compiled template. */
interface RouterScope {
  useRoute: string | null;
  components: Map<string, "RouterLink" | "RouterView">;
}

export const ROUTER_LINK_PROPS = new Set(["to", "class", "activeClass", "exactActiveClass", "ariaCurrentValue"]);

/** `<RouterLink>` props that change only what a click does, which the server does not render. */
export const ROUTER_LINK_INERT = new Set(["replace", "viewTransition"]);

/** `typeof x === "string"` or `typeof x !== "string"`: the `x` tested, and whether the test is
 * negated. */
function typeofString(n: N): { target: N; negated: boolean } | null {
  if (n.type !== "BinaryExpression" || (n.operator !== "===" && n.operator !== "!==")) return null;
  const isTypeof = (m: N) => m.type === "UnaryExpression" && m.operator === "typeof";
  const isString = (m: N) => m.type === "StringLiteral" && m.value === "string";
  const target = isTypeof(n.left) && isString(n.right) ? n.left.argument : isTypeof(n.right) && isString(n.left) ? n.right.argument : null;
  return target ? { target, negated: n.operator === "!==" } : null;
}

/** The reader's route, which the component then takes. */
function theRoute(s: Scope, n: N): Val {
  if (!runOf(router).routes) fail(s.comp, `reading the route needs \`routes\` in ${CONFIG_FILE}`, n);
  runOf(router).readers.add(s.comp);
  return { code: "fv_route", ty: { k: "route" } };
}

/** A field of the route: what `useRoute()` gives that the server knows as vue-router does. */
function routeField(s: Scope, base: Val, prop: string, n: N): Val {
  if (base.ty.k === "params") {
    // Every parameter is a string; absent when the route has none of that name.
    return { code: `fv_route.param(${rustStr(prop)})`, ty: opt(STR) };
  }
  if (base.ty.k === "queryobj") return { code: `fv_route.query(${rustStr(prop)})`, ty: { k: "query" } };
  switch (prop) {
    case "path":
      return { code: "fv_route.path()", ty: STR };
    case "hash":
      return { code: "fv_route.hash()", ty: STR };
    case "name":
      return { code: "fv_route.name()", ty: opt(STR) };
    case "params":
      return { code: "fv_route", ty: { k: "params" } };
    case "query":
      return { code: "fv_route", ty: { k: "queryobj" } };
    case "fullPath":
      return { code: "fv_route.full_path()", ty: STR };
  }
  return fail(s.comp, `\`route.${prop}\` is not available on the server: \`path\`, \`fullPath\`, \`hash\`, \`name\`, \`params\` and \`query\` are`, n);
}

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
  const scopeId = s.comp.scopeId;
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

/** The routes file: vue-router paths, each a string or `{ "path", "name" }`. */
export function readRoutes(root: string, file: string): RouteDef[] {
  const raw = JSON.parse(readFileSync(join(root, file), "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new GenError(`${file} lists the routes in an array`);
  const read = (list: unknown[], parent: string | null): RouteDef[] =>
    list.map((r: unknown): RouteDef => {
      const o = (typeof r === "string" ? { path: r } : r) as { path?: unknown; name?: unknown; children?: unknown };
      if (typeof o?.path !== "string" || (o.name !== undefined && typeof o.name !== "string") || (o.children !== undefined && !Array.isArray(o.children))) {
        throw new GenError(`${file}: a route is a path, or \`{ "path": "…", "name": "…", "children": [ … ] }\``);
      }
      // A child's path joins its parent's unless it starts with `/`; an empty one is the parent's.
      const fullPath =
        parent === null || o.path.startsWith("/") ? o.path : `${parent}${parent.endsWith("/") || o.path === "" ? "" : "/"}${o.path}`;
      const def: RouteDef = { path: o.path, fullPath };
      if (o.name !== undefined) def.name = o.name;
      if (o.children) def.children = read(o.children as unknown[], fullPath);
      return def;
    });
  return read(raw, null);
}

/** Route definitions as \`ferrovue::RouteDef\` literals, children nested. */
function routeDefs(routes: RouteDef[], depth: number): string {
  const pad = "    ".repeat(depth);
  return routes
    .map((r) => {
      const name = r.name === undefined ? "None" : `Some(${rustStr(r.name)})`;
      const children = r.children?.length ? `&[\n${routeDefs(r.children, depth + 1)}\n${pad}]` : "&[]";
      return `${pad}ferrovue::RouteDef { path: ${rustStr(r.path)}, name: ${name}, children: ${children} },`;
    })
    .join("\n");
}

export function routesSource(routes: RouteDef[], file: string): string {
  return `${header(file, "the routes file")}
//! The app's routes: what \`<RouterLink>\` resolves against and \`useRoute()\` reads.

/// Each route: its vue-router path, its name if it has one, and the routes nested in it.
pub const ROUTES: &[ferrovue::RouteDef<'static>] = &[
${routeDefs(routes, 1)}
];

/// Every route's full path, nested ones included.
pub const PATHS: &[&str] = &[
${allRoutes(routes).map((r) => `    ${rustStr(r.fullPath)},`).join("\n")}
];

/// The history's base, which every link's \`href\` starts with.
pub const BASE: &str = ${rustStr(runOf(router).base)};

/// The router these routes make: build it once, and resolve each request's location with
/// [\`ferrovue::Router::at\`].
pub fn router() -> ferrovue::Router {
    ferrovue::Router::tree(ROUTES).with_base(BASE)
}
`;
}

/** vue-router: \`<RouterLink>\`, \`<RouterView>\`, \`useRoute()\` and \`$route\`, and the routes file. */
export const router: Plugin<RouterRun, RouterScope> = {
  name: "router",
  configure(config, root) {
    const r = config.router ?? (config.routes ? { routes: config.routes } : null);
    return {
      routes: r ? readRoutes(root, r.routes) : null,
      file: r?.routes ?? null,
      base: r?.base ?? "",
      linkActive: r?.linkActiveClass ?? "router-link-active",
      linkExactActive: r?.linkExactActiveClass ?? "router-link-exact-active",
      readers: new Set(),
      views: new Set(),
    };
  },
  compiled(comp, code, script) {
    // Resolved by name, as globally registered components are, or imported from `vue-router`.
    const imported = (exported: string) =>
      script.some(
        (st) => st.type === "ImportDeclaration" && st.source.value === "vue-router" &&
          st.specifiers.some((sp: N) => sp.type === "ImportSpecifier" && (sp.imported.name ?? sp.imported.value) === exported),
      );
    const run = runOf(router);
    if (code.includes('_resolveComponent("RouterLink")') || imported("RouterLink") || code.includes("_ctx.$route")) run.readers.add(comp);
    if (code.includes('_resolveComponent("RouterView")') || imported("RouterView")) run.views.add(comp);
  },
  scope: () => ({ useRoute: null, components: new Map() }),
  scriptImport(s, st, from) {
    if (from !== "vue-router") return false;
    const own = scopeOf(router, s);
    for (const sp of st.specifiers) {
      const name = sp.type === "ImportSpecifier" ? (sp.imported.name ?? sp.imported.value) : null;
      if (name === "useRoute") own.useRoute = sp.local.name;
      else if (name === "RouterLink" || name === "RouterView") own.components.set(sp.local.name, name);
      else s.clientOnly.set(sp.local.name, `\`${name}\` from vue-router does not run on the server`);
    }
    return true;
  },
  scriptBinding(s, d) {
    // `const route = useRoute()`: the reader's location.
    const { useRoute } = scopeOf(router, s);
    const init = d.init;
    if (useRoute === null || d.id.type !== "Identifier" || init?.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== useRoute) return false;
    s.setup.set(d.id.name, theRoute(s, d));
    return true;
  },
  global: (s, name, n) => (name === "$route" ? theRoute(s, n) : null),
  member(s, base, prop, n, computed) {
    // `route.query["q"]` and `route.params["id"]`, but not `route["path"]`.
    if (base.ty.k === "params" || base.ty.k === "queryobj" || (base.ty.k === "route" && !computed)) return routeField(s, base, prop, n);
    return null;
  },
  equality(s, n) {
    // `typeof route.query.q === "string"`: a single value, not `null`, absent or repeated.
    const tested = typeofString(n);
    if (!tested) return null;
    const v = expr(s, tested.target);
    if (v.ty.k !== "query") fail(s.comp, '`typeof` tests a query value only, as `typeof route.query.q === "string"`', n);
    const one = `${atom(v.code)}.attr_value().is_some()`;
    return boolOf(tested.negated ? not(one) : one);
  },
  presence(s, n) {
    // A query value narrowed to a single string, which an attribute can then be bound to.
    const t = typeofString(n);
    if (!t) return undefined;
    const path = pathOf(t.target);
    const v = expr(s, t.target);
    if (path === null || v.ty.k !== "query") return null;
    const option = `${atom(v.code)}.attr_value()`;
    return { path, of: STR, negated: t.negated, truthy: false, option, present: `${option}.is_some()`, pattern: (name) => `let Some(${name}) = ${option}` };
  },
  values: {
    describe: (ty) => (ty.k === "query" ? "a query value" : undefined),
    truthy: (v) => (v.ty.k === "query" ? `${atom(v.code)}.truthy()` : undefined),
    interpolate(e, v) {
      // `toDisplayString` of a query value: a string, nothing for `null`, an array as JSON.
      if (v.ty.k !== "query") return false;
      e.stmt(`${atom(v.code)}.write_display(out);`);
      return true;
    },
    unbindable: (ty) =>
      ty.k === "query"
        ? { what: "a query value, which is an array when its key is repeated", fix: 'narrow it to one string, as `typeof route.query.q === "string" ? route.query.q : ""`' }
        : undefined,
    nullish(s, a, b, n) {
      // A query value falls back for `undefined` and `null`, and stays a query value: an array
      // given more than once stays an array.
      if (a.ty.k !== "query") return undefined;
      if (b.ty.k !== "str") fail(s.comp, "`??` after a query value takes a string", n);
      return { code: `${atom(a.code)}.or(${bare(b.code)})`, ty: a.ty };
    },
    equals(a, b) {
      // A query value equals a string only when it is that single value.
      if (a.ty.k === "query" && b.ty.k === "str") return `${atom(a.code)}.is(${strArg(b.code)})`;
      if (b.ty.k === "query" && a.ty.k === "str") return `${atom(b.code)}.is(${strArg(a.code)})`;
      if (a.ty.k === "query" && b.ty.k === "undef") return `${atom(a.code)}.is_undefined()`;
      if (b.ty.k === "query" && a.ty.k === "undef") return `${atom(b.code)}.is_undefined()`;
      return undefined;
    },
    isArray: (v) => (v.ty.k === "query" ? { code: `${atom(v.code)}.is_array()`, ty: BOOL } : undefined),
  },
  resolveComponent(s, local, name) {
    if (name !== "RouterLink" && name !== "RouterView") return false;
    scopeOf(router, s).components.set(local, name);
    return true;
  },
  component(s, e, n) {
    const target = n.arguments[0];
    const { components } = scopeOf(router, s);
    const routed =
      target.type === "Identifier"
        ? components.get(target.name)
        : target.type === "MemberExpression" && target.object.name === "$setup"
          ? components.get(target.computed ? target.property.value : target.property.name)
          : undefined;
    if (routed === "RouterLink") routerLink(s, e, n);
    else if (routed === "RouterView") {
      // vue-router renders the page as its own root, which takes this component's id.
      if (s.comp.scopeId !== null) fail(s.comp, "`<RouterView>` in a component with `<style scoped>` gives the page this component's id, which the server's page does not carry", n);
      e.stmt("fv_slots.router_view.render_to(out);");
    } else return false;
    return true;
  },
  child(s, child, n) {
    if (runOf(router).views.has(child)) {
      fail(s.comp, `${child.name} holds \`<RouterView>\`: the server renders it at the top, never as a child`, n);
    }
  },
  slotFields: (comp) => (runOf(router).views.has(comp) ? [{ js: "routerView", rust: "router_view", doc: "The page `<RouterView>` shows." }] : []),
  params: [
    {
      name: "fv_route",
      ty: "&fv::Route<'_>",
      pageTy: "&'p fv::Route<'p>",
      reads: (c) => runOf(router).readers.has(c),
      test: { lines: ["let router = route_table::router();", "let route = router.at(&fixture.route);"], arg: "&route", fixture: true },
      fixtureField: '    #[serde(rename = "$route", default = "Fixture::root")]\n    route: String,',
      fixtureDefault: '    fn root() -> String {\n        "/".to_owned()\n    }',
    },
  ],
  modules() {
    const { routes, file } = runOf(router);
    return routes ? [["route_table.rs", routesSource(routes, file!)]] : [];
  },
};
