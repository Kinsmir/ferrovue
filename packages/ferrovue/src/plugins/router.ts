import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Component, type N, type Scope, type Val, BOOL, fail, failIn, GenError, opt, rustStr, STR } from "../model.ts";
import { type Config, CONFIG_FILE } from "../context.ts";
import { expr } from "../expr.ts";
import { boolOf, pathOf } from "../narrowing.ts";
import { atom, bare, not, strArg } from "../parens.ts";
import { type Plugin, runOf, scopeOf } from "../plugin.ts";
import { header } from "../rust.ts";
import { readJsonFile } from "../files.ts";
import { allPages, type FileRoute, fileRoutes } from "../file-routes.ts";
import { scopeIdOf } from "./scoped.ts";
import { routerLink } from "./router-link.ts";

declare module "../model.ts" {
  interface PluginTys {
    route: { k: "route" };
    params: { k: "params" };
    queryobj: { k: "queryobj" };
    query: { k: "query" };
  }
}

export interface RouteDef {
  path: string;
  name?: string;
  view?: boolean;
  children?: RouteDef[];
  fullPath: string;
}

export function allRoutes(routes: RouteDef[]): RouteDef[] {
  return routes.flatMap((r) => [r, ...allRoutes(r.children ?? [])]);
}

interface RouterRun {
  routes: RouteDef[] | null;
  file: string | null;
  pages: FileRoute[] | null;
  base: string;
  linkActive: string;
  linkExactActive: string;
  readers: Set<Component>;
  views: Set<Component>;
}

interface RouterScope {
  useRoute: string | null;
  components: Map<string, "RouterLink" | "RouterView">;
}

function typeofString(n: N): { target: N; negated: boolean } | null {
  if (n.type !== "BinaryExpression" || (n.operator !== "===" && n.operator !== "!==")) return null;
  const isTypeof = (m: N) => m.type === "UnaryExpression" && m.operator === "typeof";
  const isString = (m: N) => m.type === "StringLiteral" && m.value === "string";
  const target = isTypeof(n.left) && isString(n.right) ? n.left.argument : isTypeof(n.right) && isString(n.left) ? n.right.argument : null;
  return target ? { target, negated: n.operator === "!==" } : null;
}

function theRoute(s: Scope, n: N): Val {
  if (!runOf(router).routes) fail(s.comp, "FV1230", `reading the route needs \`routes\` in ${CONFIG_FILE}`, n);
  runOf(router).readers.add(s.comp);
  return { code: "fv_route", ty: { k: "route" } };
}

function routeField(s: Scope, base: Val, prop: string, n: N): Val {
  if (base.ty.k === "params") {
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
  return fail(s.comp, "FV1231", `\`route.${prop}\` is not available on the server: \`path\`, \`fullPath\`, \`hash\`, \`name\`, \`params\` and \`query\` are`, n);
}

function joinPath(parent: string | null, path: string): string {
  return parent === null || path.startsWith("/") ? path : `${parent}${parent.endsWith("/") || path === "" ? "" : "/"}${path}`;
}

function pageDefs(routes: FileRoute[], parent: string | null): RouteDef[] {
  return routes.map((r) => {
    const fullPath = joinPath(parent, r.path);
    const def: RouteDef = { path: r.path, fullPath };
    if (r.name !== undefined) def.name = r.name;
    if (!r.file) def.view = false;
    if (r.children) def.children = pageDefs(r.children, fullPath);
    return def;
  });
}

function readPages(root: string, config: Config, pages: string): FileRoute[] {
  const routes = fileRoutes(root, pages);
  let components: string[] = [];
  try {
    components = readdirSync(join(root, config.components)).filter((f) => f.endsWith(".vue")).map((f) => f.slice(0, -".vue".length));
  } catch {
  }
  const named = new Map<string, string>();
  for (const page of allPages(routes)) {
    const name = page.component!;
    if (!/^[A-Za-z]/.test(name)) failIn(page.file!, "FV1245", `the page's component would be called \`${name}\`, which is not a Rust name: start the file's name with a letter`);
    const taken = named.get(name) ?? (components.includes(name) ? `${config.components.replace(/\/+$/, "")}/${name}.vue` : undefined);
    if (taken) failIn(page.file!, "FV1245", `the page's component would be called \`${name}\`, as ${taken} is: rename one of them`);
    named.set(name, page.file!);
  }
  return routes;
}

export function readRoutes(root: string, file: string): RouteDef[] {
  const raw = readJsonFile(root, file, { missing: "FV1246", invalid: "FV1247" });
  if (!Array.isArray(raw)) throw new GenError("FV1232", `${file} lists the routes in an array`, { file });
  const read = (list: unknown[], parent: string | null): RouteDef[] =>
    list.map((r: unknown): RouteDef => {
      const o = (typeof r === "string" ? { path: r } : r) as { path?: unknown; name?: unknown; children?: unknown };
      if (typeof o?.path !== "string" || (o.name !== undefined && typeof o.name !== "string") || (o.children !== undefined && !Array.isArray(o.children))) {
        failIn(file, "FV1233", `a route is a path, or \`{ "path": "…", "name": "…", "children": [ … ] }\``);
      }
      const fullPath = joinPath(parent, o.path);
      const def: RouteDef = { path: o.path, fullPath };
      if (o.name !== undefined) def.name = o.name;
      if (o.children) def.children = read(o.children as unknown[], fullPath);
      return def;
    });
  return read(raw, null);
}

function routeDefs(routes: RouteDef[], depth: number): string {
  const pad = "    ".repeat(depth);
  return routes
    .map((r) => {
      const name = r.name === undefined ? "None" : `Some(${rustStr(r.name)})`;
      const children = r.children?.length ? `&[\n${routeDefs(r.children, depth + 1)}\n${pad}]` : "&[]";
      return `${pad}ferrovue::RouteDef { path: ${rustStr(r.path)}, name: ${name}, view: ${r.view !== false}, children: ${children} },`;
    })
    .join("\n");
}

export function routesSource(routes: RouteDef[], file: string, pages: boolean): string {
  return `${header(file, pages ? "the pages" : "the routes file")}
//! The app's routes: what \`<RouterLink>\` resolves against and \`useRoute()\` reads.

/// Each route: its vue-router path, its name if it has one, whether it shows a component, and the
/// routes nested in it.
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

export const router: Plugin<RouterRun, RouterScope> = {
  name: "router",
  configure(config, root) {
    const r = config.router ?? (config.routes ? { routes: config.routes } : null);
    const source: unknown = r?.routes;
    const folder = typeof source === "object" && source !== null && typeof (source as { pages?: unknown }).pages === "string" ? (source as { pages: string }).pages : null;
    if (r && typeof source !== "string" && folder === null) {
      throw new GenError("FV1238", `\`routes\` in ${CONFIG_FILE} is a JSON file of routes, or \`{ "pages": "…" }\`: the folder of pages vue-router's file-based routing reads`, { file: CONFIG_FILE });
    }
    const pages = folder === null ? null : readPages(root, config, folder);
    return {
      routes: pages ? pageDefs(pages, null) : typeof source === "string" ? readRoutes(root, source) : null,
      file: folder ?? (typeof source === "string" ? source : null),
      pages,
      base: r?.base ?? "",
      linkActive: r?.linkActiveClass ?? "router-link-active",
      linkExactActive: r?.linkExactActiveClass ?? "router-link-exact-active",
      readers: new Set(),
      views: new Set(),
    };
  },
  compiled(comp, code, script) {
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
    const { useRoute } = scopeOf(router, s);
    const init = d.init;
    if (useRoute === null || d.id.type !== "Identifier" || init?.type !== "CallExpression" || init.callee.type !== "Identifier" || init.callee.name !== useRoute) return false;
    s.setup.set(d.id.name, theRoute(s, d));
    return true;
  },
  global: (s, name, n) => (name === "$route" ? theRoute(s, n) : null),
  member(s, base, prop, n, computed) {
    if (base.ty.k === "params" || base.ty.k === "queryobj" || (base.ty.k === "route" && !computed)) return routeField(s, base, prop, n);
    return null;
  },
  equality(s, n) {
    const tested = typeofString(n);
    if (!tested) return null;
    const v = expr(s, tested.target);
    if (v.ty.k !== "query") fail(s.comp, "FV1234", '`typeof` tests a query value only, as `typeof route.query.q === "string"`', n);
    const one = `${atom(v.code)}.attr_value().is_some()`;
    return boolOf(tested.negated ? not(one) : one);
  },
  presence(s, n) {
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
      if (v.ty.k !== "query") return false;
      e.stmt(`${atom(v.code)}.write_display(out);`);
      return true;
    },
    unbindable: (ty) =>
      ty.k === "query"
        ? { what: "a query value, which is an array when its key is repeated", fix: 'narrow it to one string, as `typeof route.query.q === "string" ? route.query.q : ""`' }
        : undefined,
    nullish(s, a, b, n) {
      if (a.ty.k !== "query") return undefined;
      if (b.ty.k !== "str") fail(s.comp, "FV1235", "`??` after a query value takes a string", n);
      return { code: `${atom(a.code)}.or(${bare(b.code)})`, ty: a.ty };
    },
    equals(a, b) {
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
      if (scopeIdOf(s.comp) !== null) fail(s.comp, "FV1236", "`<RouterView>` in a component with `<style scoped>` gives the page this component's id, which the server's page does not carry", n);
      e.stmt("fv_slots.router_view.render_to(out);");
    } else return false;
    return true;
  },
  child(s, child, n) {
    if (runOf(router).views.has(child)) {
      fail(s.comp, "FV1237", `${child.name} holds \`<RouterView>\`: the server renders it at the top, never as a child`, n);
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
  components: () => allPages(runOf(router).pages ?? []).map((p) => ({ file: p.file!, name: p.component! })),
  modules() {
    const { routes, file, pages } = runOf(router);
    return routes ? [["route_table.rs", routesSource(routes, file!, pages !== null)]] : [];
  },
};
