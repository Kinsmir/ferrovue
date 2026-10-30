import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSSRApp, defineComponent, h, inject, type App, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { RouterLink, routerKey, useRoute, type RouteLocationRaw, type Router } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkRouter } from "../src/link-router.ts";
import { linkRoutes, type LinkRoutesOptions } from "../src/link-routes.ts";
import { type RouteEntry } from "../src/route-records.ts";
import { attachSsrRender } from "../src/ssr.ts";
import { fixtureApp } from "../src/testing-browser.ts";
import { hydrationBody, renderFixture } from "../src/conformance.ts";
import { cases, fixtureOf, OPTIONS, ROOT, ROUTES } from "./conformance-cases.ts";

type Navigate = LinkRoutesOptions["navigate"];

const NESTED: RouteEntry[] = ["/", { path: "/users/:name", name: "user" }, { path: "/account", name: "account", children: [{ path: "orders", name: "orders" }] }];

const Nav = defineComponent({
  setup() {
    const route = useRoute();
    return () =>
      h("nav", [
        h(RouterLink, { to: "/" }, () => "home"),
        h(RouterLink, { to: { name: "user", params: { name: "ada" } } }, () => "ada"),
        h(RouterLink, { to: "/account" }, () => "account"),
        h(RouterLink, { to: "/account/orders" }, () => "orders"),
        h("p", route.fullPath),
      ]);
  },
});

const routerOf = (app: App): Router => app.runWithContext(() => inject(routerKey)!);

const setUrl = (url: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);

const warnings: unknown[][] = [];
beforeEach(() => {
  warnings.length = 0;
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(args));
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("hands every navigation to navigate with the href and the route, and stays on the page", async () => {
  const navigate = vi.fn<Navigate>();
  const links = linkRoutes(NESTED, { navigate, location: "/users/ada" });
  expect(links.route.fullPath).toBe("/users/ada");
  expect(links.route.params).toEqual({ name: "ada" });
  expect(Object.keys(links.route).toSorted()).toEqual(["fullPath", "hash", "matched", "meta", "name", "params", "path", "query", "redirectedFrom"]);
  const app = createSSRApp(Nav).use(links);
  expect(app.config.globalProperties.$route).toMatchObject({ fullPath: "/users/ada", href: "/users/ada" });
  const router = routerOf(app);
  await router.push("/account/orders?page=2#top");
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate.mock.calls[0]![0]).toBe("/account/orders?page=2#top");
  expect(navigate.mock.calls[0]![1].name).toBe("orders");
  await router.replace({ name: "user", params: { name: "grace" } });
  expect(navigate.mock.calls[1]![0]).toBe("/users/grace");
  await router.push("/users/ada");
  expect(navigate.mock.calls[2]![0]).toBe("/users/ada");
  expect(links.route.fullPath).toBe("/users/ada");
});

it("renders the active links and the route on the server", async () => {
  const links = linkRoutes(NESTED, { navigate: () => {}, location: "/account/orders" });
  const html = await renderToString(createSSRApp(Nav).use(links));
  expect(html).toBe(
    '<nav><a href="/" class="">home</a><a href="/users/ada" class="">ada</a><a href="/account" class="router-link-active">account</a>' +
      '<a aria-current="page" href="/account/orders" class="router-link-active router-link-exact-active">orders</a><p>/account/orders</p></nav>',
  );
});

it("starts from the page's location without the base, and hands navigate the href with it", () => {
  setUrl("http://link-routes.test/app/users/ada?tab=posts#latest");
  const navigate = vi.fn<Navigate>();
  const links = linkRoutes(NESTED, { navigate, base: "/app/" });
  expect(links.route.fullPath).toBe("/users/ada?tab=posts#latest");
  expect(links.route.query).toEqual({ tab: "posts" });
  expect(links.resolve("/account").href).toBe("/app/account");
  const given = linkRoutes(NESTED, { navigate, base: "/APP", location: "/app/account/orders#top" });
  expect(given.route.name).toBe("orders");
  expect(given.route.hash).toBe("#top");
  expect(navigate).not.toHaveBeenCalled();
});

it("marks the active links of a hydrated page and leaves a click to navigate", async () => {
  const html = await renderToString(createSSRApp(Nav).use(linkRoutes(NESTED, { navigate: () => {}, location: "/account/orders" })));
  setUrl("http://link-routes.test/account/orders");
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const clicks: boolean[] = [];
  document.addEventListener("click", (e) => clicks.push(e.defaultPrevented));
  const navigate = vi.fn<Navigate>();
  const app = createSSRApp(Nav).use(linkRoutes(NESTED, { navigate }));
  app.mount("#app");

  const [home, ada, account, orders] = Array.from(document.querySelectorAll("a"));
  expect(orders!.className).toBe("router-link-active router-link-exact-active");
  expect(orders!.getAttribute("aria-current")).toBe("page");
  expect(account!.className).toBe("router-link-active");
  expect(account!.hasAttribute("aria-current")).toBe(false);
  expect(home!.className).toBe("");
  expect(ada!.getAttribute("href")).toBe("/users/ada");

  ada!.click();
  expect(navigate).toHaveBeenCalledWith("/users/ada", expect.objectContaining({ name: "user", params: { name: "ada" } }));
  orders!.click();
  expect(navigate).toHaveBeenLastCalledWith("/account/orders", expect.objectContaining({ name: "orders" }));
  expect(clicks).toEqual([true, true]);
  expect(window.location.pathname).toBe("/account/orders");
  expect(orders!.className).toBe("router-link-active router-link-exact-active");
  expect(warnings.filter((w) => String(w[0]).includes("Hydration"))).toEqual([]);
  app.unmount();
});

it("rejects a push to a name no route has, without calling navigate", async () => {
  const navigate = vi.fn<Navigate>();
  const links = linkRoutes(NESTED, { navigate, location: "/" });
  const router = routerOf(createSSRApp({ render: () => null }).use(links));
  await expect(router.push({ name: "nowhere" })).rejects.toThrow("No match");
  expect(navigate).not.toHaveBeenCalled();
});

const DIR = join(import.meta.dirname, "../../../crates/ferrovue-router/tests/vectors");
interface Expected {
  routes: string[];
  names: Record<string, string>;
  links: Array<[string, string]>;
  objects: Array<[string, Record<string, unknown> & { query?: Array<[string, string]> }]>;
  locations: string[];
  bases: Array<[string, string, string]>;
  nested: Nested;
  files: Nested;
  expected: Array<[string, boolean]>;
  expectedObjects: Array<[string, boolean]>;
  expectedLocations: Array<{ path: string; hash: string; name: string | null; params: Record<string, string>; fullPath: string; query: Array<[string, unknown]> }>;
  expectedBases: Array<[string, boolean]>;
  expectedNested: NestedExpected;
  expectedFiles: NestedExpected;
}
interface Nested {
  routes: RouteEntry[];
  links: Array<[string, string]>;
  named: Array<[string, RouteLocationRaw]>;
  locations: string[];
}
interface NestedExpected {
  links: Array<[string, boolean, boolean]>;
  named: Array<[string, boolean, boolean]>;
  locations: Array<{ path: string; name: string | null; params: Record<string, string> }>;
}

const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

async function rendered(routes: RouteEntry[], at: string, to: RouteLocationRaw, base?: string): Promise<[string, boolean, boolean]> {
  const app = createSSRApp({ render: () => h(RouterLink, { to }, () => "x") }).use(linkRoutes(routes, { navigate: () => {}, location: at, ...(base !== undefined ? { base } : {}) }));
  const html = await renderToString(app);
  const href = /href="([^"]*)"/.exec(html);
  expect(href, html).not.toBeNull();
  return [unescape(href![1]!), /class="[^"]*\brouter-link-active\b/.test(html), html.includes('aria-current="page"')];
}

describe("the router vectors recorded from vue-router", () => {
  const v = JSON.parse(readFileSync(join(DIR, "router.expected.json"), "utf8")) as Expected;
  const flat: RouteEntry[] = v.routes.map((path) => (v.names[path] ? { path, name: v.names[path] } : path));

  it("gives each link's href and aria-current", async () => {
    const got: Array<[string, boolean]> = [];
    for (const [at, to] of v.links) {
      const [href, , exact] = await rendered(flat, at, to);
      got.push([href, exact]);
    }
    expect(got).toEqual(v.expected);
    const objects: Array<[string, boolean]> = [];
    for (const [at, to] of v.objects) {
      const raw = (to.query ? { ...to, query: Object.fromEntries(to.query) } : to) as RouteLocationRaw;
      const [href, , exact] = await rendered(flat, at, raw);
      objects.push([href, exact]);
    }
    expect(objects).toEqual(v.expectedObjects);
  });

  it("gives each location's route", () => {
    const got = v.locations.map((at) => {
      const r = linkRoutes(flat, { navigate: () => {}, location: at }).route;
      return { path: r.path, hash: r.hash, name: typeof r.name === "string" ? r.name : null, params: r.params, fullPath: r.fullPath, query: Object.entries(r.query) };
    });
    expect(got).toEqual(v.expectedLocations);
  });

  it("gives each link under a base", async () => {
    const got: Array<[string, boolean]> = [];
    for (const [base, at, to] of v.bases) {
      const prefix = base.replace(/\/$/, "");
      const [href, , exact] = await rendered(flat, (prefix.startsWith("/") ? prefix : "/" + prefix) + at, to, base);
      got.push([href, exact]);
    }
    expect(got).toEqual(v.expectedBases);
  });

  for (const key of ["nested", "files"] as const) {
    it(`gives the ${key} routes' links and locations`, async () => {
      const set = v[key];
      const expected = key === "nested" ? v.expectedNested : v.expectedFiles;
      const links: Array<[string, boolean, boolean]> = [];
      for (const [at, to] of set.links) links.push(await rendered(set.routes, at, to));
      expect(links).toEqual(expected.links);
      const named: Array<[string, boolean, boolean]> = [];
      for (const [at, to] of set.named) named.push(await rendered(set.routes, at, to));
      expect(named).toEqual(expected.named);
      const locations = set.locations.map((at) => {
        const r = linkRoutes(set.routes, { navigate: () => {}, location: at }).route;
        return { path: r.path, name: typeof r.name === "string" ? r.name : null, params: r.params };
      });
      expect(locations).toEqual(expected.locations);
    });
  }
});

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = Number(process.env.FERROVUE_LINK_ROUTES_SEED ?? 0x252);
const SETS = Number(process.env.FERROVUE_LINK_ROUTES_SETS ?? 60);
const WORDS = ["a", "b", "users", "blog", "x-y", "v1.2", "_u", "7"];
const PARAMS = ["id", "slug", "tab", "a", "x", "p"];
const PIECES = ["x", "u", "e", "a-1", "12", "b", "b1", "a", "b", "users", "USERS", "Blog", "x-y", "v1.2", "v1x2", "_u", "7", "%20", "%2F", "%zz", "%", "%E9", "%C3%A9", "é", "a b", "+", ".", "..", "", "a%2Fb", "?", "#"];
const VALUES: unknown[] = ["x", "7", "a/b", "a b", "%", "%41", "?", "#", "é", "", 5, 0, null, undefined, ["a", "b"], ["", null, undefined], "+", "[|]{^}`&="];

interface Gen {
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
  int(n: number): number;
}

function gen(next: () => number): Gen {
  return {
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    chance: (p) => next() < p,
    int: (n) => Math.floor(next() * n),
  };
}

const RANKING: RouteEntry[][] = [
  ["/:a?", "/:b", "/:c*", "/:d+", "/:e(.*)", "/:f(\\d+)", "/:g(\\d+)?"],
  ["/a-:x", "/a", "/a/:y?", "/a/:z(.*)", "/a/:w+", "/b:x?", "/b"],
  ["/:p(.*)", "/x", "/x/:t(.*)*", "/x/:q(.*)"],
  ["/y/:r?", "/y/:s*", "/y"],
  [{ path: "/u/:id?", name: "u", children: [{ path: "", name: "u-home" }, { path: "e", name: "u-e" }] }, { path: "/u/:x*", name: "ux" }],
];

const RANKED_AT = ["/b", "/x/", "/a/1/2", "/u/7/e", "/x", "/y"];

function namesOf(routes: RouteEntry[]): string[] {
  return routes.flatMap((r) => (typeof r === "string" ? [] : [...(r.name ? [r.name] : []), ...namesOf(r.children ?? [])]));
}

function routeSet(g: Gen): { routes: RouteEntry[]; names: string[] } {
  const names: string[] = [];
  let count = 0;
  const path = (taken: string[], child: boolean): string => {
    if (child && g.chance(0.2)) return "";
    const segments: string[] = [];
    const length = g.int(3) + (child ? 1 : 0);
    for (let i = 0; i < length; i++) {
      const free = PARAMS.filter((p) => !taken.includes(p) && !segments.some((s) => s.startsWith(`:${p}`)));
      if (free.length && g.chance(0.4)) {
        const p = g.pick(free);
        if (i === length - 1 && g.chance(0.2)) segments.push(`:${p}(.*)`);
        else if (g.chance(0.15)) segments.push(g.pick([`:${p}+`, `:${p}*`, `:${p}(\\d+)`, `:${p}(\\d+)?`, `v-:${p}`, `:${p}.x`, `\\:${p}`]));
        else segments.push(g.chance(0.3) ? `:${p}?` : `:${p}`);
      } else segments.push(g.pick(WORDS));
    }
    const joined = segments.join("/") + (segments.length && g.chance(0.1) ? "/" : "");
    return child && !g.chance(0.15) ? joined : "/" + joined;
  };
  const entries = (depth: number, taken: string[]): RouteEntry[] => {
    const list: RouteEntry[] = [];
    const n = g.int(depth ? 3 : 6) + 1;
    for (let i = 0; i < n; i++) {
      const p = path(taken, depth > 0);
      const keys = [...taken, ...[...p.matchAll(/:(\w+)/g)].map((m) => m[1]!)];
      const named = g.chance(0.7);
      const name = named ? `r${count++}` : undefined;
      if (name) names.push(name);
      const children = depth < 2 && g.chance(0.3) ? entries(depth + 1, keys) : undefined;
      if (!name && !children && g.chance(0.3)) list.push(p);
      else list.push({ path: p, ...(name ? { name } : {}), ...(children ? { children } : {}), ...(children && g.chance(0.3) ? { view: false } : {}) });
    }
    return list;
  };
  const routes = entries(0, []);
  if (g.chance(0.6)) routes.unshift(g.chance(0.5) ? "/" : { path: "/", name: "home" });
  if (routes.some((r) => typeof r !== "string" && r.name === "home")) names.push("home");
  return { routes, names };
}

function location(g: Gen, relative: boolean): string {
  const parts: string[] = [];
  for (let i = g.int(4); i > 0; i--) parts.push(g.pick(PIECES));
  let path = parts.join(g.chance(0.1) ? "//" : "/");
  if (!relative || g.chance(0.6)) path = (g.chance(0.1) ? "//" : "/") + path;
  if (g.chance(0.15)) path += "/";
  if (g.chance(0.3)) path += "?" + [...Array(g.int(3) + 1)].map(() => g.pick(["a=1", "a=2", "b", "c=%zz", "d=+x", "e=", "=f", "g=a%26b", "h=é"])).join("&");
  if (g.chance(0.25)) path += g.pick(["#h", "#%41", "#a b", "#", "#%zz", "#é"]);
  return path;
}

function params(g: Gen, names: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of names) if (g.chance(0.5)) out[name] = g.pick(VALUES);
  return out;
}

function target(g: Gen, names: string[], keys: string[]): RouteLocationRaw {
  const choice = g.int(7);
  if (choice < 3) return location(g, g.chance(0.3));
  const to: Record<string, unknown> = {};
  if (choice === 3) to.path = location(g, g.chance(0.3)).replace(/[?#].*$/, "");
  else if (choice === 4 || choice === 5) to.name = g.chance(0.05) ? "nope" : g.pick(names.length ? names : ["nope"]);
  if (choice !== 3 && g.chance(0.6)) to.params = params(g, keys);
  if (g.chance(0.3)) to.query = { a: g.pick(VALUES), ...(g.chance(0.5) ? { [g.pick(["b c", "k=v", "#&+", "é", "[|]{^}`"])]: g.pick(VALUES) } : {}) };
  if (g.chance(0.3)) to.hash = g.pick(["#h", "#a b", "#%41", "#é", "x", ""]);
  return to;
}

type Shaped = Record<string, unknown> & { matched: unknown[] };

function shaped(r: Record<string, unknown> & { matched: Array<{ path: string; name?: unknown; meta: unknown; aliasOf?: unknown }> }): Shaped {
  return {
    fullPath: r.fullPath,
    path: r.path,
    query: r.query,
    hash: r.hash,
    name: r.name,
    params: r.params,
    meta: r.meta,
    redirectedFrom: r.redirectedFrom,
    href: r.href,
    keys: Object.keys(r).toSorted(),
    matched: r.matched.map((m) => ({ path: m.path, name: m.name, meta: m.meta, aliasOf: m.aliasOf })),
  };
}

type Outcome = { threw: true } | { threw: false; route: Shaped; same: boolean[][] };

function outcome(resolve: () => Record<string, unknown> & { matched: Array<{ path: string; meta: unknown }> }, current: { matched: unknown[] }): Outcome {
  let r;
  try {
    r = resolve();
  } catch {
    return { threw: true };
  }
  return { threw: false, route: shaped(r), same: r.matched.map((m) => current.matched.map((c) => c === m)) };
}

const Links = (tos: RouteLocationRaw[]): Component =>
  defineComponent({
    setup() {
      const route = useRoute();
      return () =>
        h("main", [
          ...tos.map((to) => h(RouterLink, { to }, () => "x")),
          h(RouterLink, { to: tos[0] ?? "/", activeClass: "on", exactActiveClass: "here", ariaCurrentValue: "location" }, () => "y"),
          h("pre", JSON.stringify({ ...route, matched: route.matched.map((m) => m.path) })),
        ]);
    },
  });

describe("against vue-router", () => {
  it(`resolves, renders and navigates as linkRouter does, for ${SETS} random route sets`, async () => {
    const g = gen(random(SEED));
    let compared = 0;
    let threw = 0;
    let navigations = 0;
    for (let s = 0; s < SETS; s++) {
      const { routes, names } = s < RANKING.length ? { routes: RANKING[s]!, names: namesOf(RANKING[s]!) } : routeSet(g);
      const base = g.pick([undefined, "/app", "/app/", "app", "/A pp", "#", "/x#/"]);
      const classes = g.pick([{}, { linkActiveClass: "on" }, { linkExactActiveClass: "here" }, { linkActiveClass: "", linkExactActiveClass: "" }]);
      for (let l = 0; l < 6; l++) {
        warnings.length = 0;
        vi.mocked(console.warn).mockClear();
        const at = s < RANKING.length ? RANKED_AT[l]! : location(g, false);
        const prefix = base === undefined ? "" : base.startsWith("#") ? "" : base.replace(/\/$/, "");
        const href = (prefix && !prefix.startsWith("/") ? "/" + prefix : prefix) + (g.chance(0.1) ? at.toUpperCase() : at);
        const reference: string[] = [];
        const ours: string[] = [];
        const options = { ...classes, location: href, ...(base !== undefined ? { base } : {}) };
        const router = linkRouter(routes, { ...options, navigate: (to, route) => void reference.push(JSON.stringify([to, shaped(route as never)])) });
        const failure = await router.push(router.options.history.location);
        expect(failure, `${JSON.stringify(routes)} at ${href}`).toBeUndefined();
        const links = linkRoutes(routes, { ...options, navigate: (to, route) => void ours.push(JSON.stringify([to, shaped(route as never)])) });
        const current = router.currentRoute.value;
        const where = `${JSON.stringify(routes)} base ${String(base)} at ${href}`;
        const { href: _href, ...route } = current as typeof current & { href: string };
        expect(shaped(links.route as never), where).toEqual(shaped(route as never));
        expect(shaped(createSSRApp({ render: () => null }).use(links).config.globalProperties.$route as never), where).toEqual(shaped(current as never));

        const tos: RouteLocationRaw[] = [];
        for (let t = 0; t < 30; t++) {
          const to = target(g, names, PARAMS);
          const expected = outcome(() => router.resolve(to) as never, current);
          const got = outcome(() => links.resolve(to) as never, links.route);
          expect(got, `${where} to ${JSON.stringify(to)}`).toEqual(expected);
          compared++;
          if (expected.threw) threw++;
          else tos.push(to);
        }
        for (const to of tos.slice(0, 6)) {
          await router.push(to);
          await router.replace(to);
          navigations += 2;
        }
        const pushed = routerOf(createSSRApp({ render: () => null }).use(links));
        for (const to of tos.slice(0, 6)) {
          await pushed.push(to);
          await pushed.replace(to);
        }
        expect(ours, where).toEqual(reference);

        const View = Links(tos);
        const server = createSSRApp(View).use(router);
        const light = createSSRApp(View).use(linkRoutes(routes, { ...options, navigate: () => {} }));
        expect(await renderToString(light), where).toBe(await renderToString(server));
      }
    }
    expect(compared).toBe(SETS * 6 * 30);
    expect(threw / compared).toBeLessThan(0.3);
    expect(navigations).toBeGreaterThan(SETS * 6);
  }, 120_000);
});

const modules = import.meta.glob<{ default: Component }>("../../../crates/ferrovue/tests/conformance/components/*.vue", { eager: true });
const components = new Map(Object.entries(modules).map(([path, m]) => [path.replace(/^.*\/(\w+)\.vue$/, "$1"), m.default]));
const ROUTED = cases.filter((c) => "$route" in c.json && components.get(c.component) && !readFileSync(join(ROOT, "components", `${c.component}.vue`), "utf8").includes("RouterView"));

async function lightApp(c: (typeof cases)[number], hydrate: boolean): Promise<App> {
  const fixture = fixtureOf(c);
  const app = await fixtureApp(components.get(c.component)!, fixture, null, { ...OPTIONS, hydrate });
  return app.use(linkRoutes(ROUTES, { navigate: () => {}, location: fixture.route }));
}

describe("the conformance fixtures that read the route", () => {
  for (const [name, component] of components) attachSsrRender(join(ROOT, "components", `${name}.vue`), name, component);
  it("covers every routed component but the one with a RouterView", () => {
    expect(ROUTED.length).toBeGreaterThanOrEqual(40);
  });
  for (const c of ROUTED) {
    it(`${c.component}/${c.name} renders as recorded and hydrates without a mismatch`, async () => {
      expect(await renderFixture(await lightApp(c, false))).toBe(c.html);
      document.body.innerHTML = hydrationBody(c.html);
      const before = document.body.innerHTML;
      const app = await lightApp(c, true);
      app.mount(document.getElementById("root")!);
      expect(document.body.innerHTML).toBe(before);
      expect(warnings).toEqual([]);
      app.unmount();
    });
  }
});
