/* vue-router: `useRoute()` and `$route`, `<RouterView>`, and the routes file, with `<RouterLink>`
 * (`router-link.ts`) beside it. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Component, type N, type Scope, type Val, BOOL, fail, GenError, opt, rustStr, STR } from "../model.ts";
import { CONFIG_FILE } from "../context.ts";
import { expr } from "../expr.ts";
import { boolOf, pathOf } from "../narrowing.ts";
import { atom, bare, not, strArg } from "../parens.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";
import { header } from "../rust.ts";
import { scopeIdOf } from "./scoped.ts";
import { routerLink } from "./router-link.ts";

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
      if (scopeIdOf(s.comp) !== null) fail(s.comp, "`<RouterView>` in a component with `<style scoped>` gives the page this component's id, which the server's page does not carry", n);
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
