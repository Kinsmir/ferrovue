import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter, RouterLink, type RouteLocationRaw, type RouteRecordRaw, type Router } from "vue-router";

const DIR = join(import.meta.dirname, "../../../crates/ferrovue-router/tests/vectors");
interface Vectors {
  routes: string[];
  names: Record<string, string>;
  links: Array<[string, string]>;
  objects: Array<[string, Record<string, unknown> & { query?: Array<[string, string]> }]>;
  locations: string[];
  bases: Array<[string, string, string]>;
  nested: NestedVectors;
  files: NestedVectors;
}

interface NestedVectors {
  routes: NestedRoute[];
  links: Array<[string, string]>;
  named: Array<[string, RouteLocationRaw]>;
  locations: string[];
}

interface NestedRoute {
  path: string;
  name?: string;
  view?: boolean;
  children?: NestedRoute[];
}
const vectors = JSON.parse(readFileSync(join(DIR, "router.json"), "utf8")) as Vectors;
const EXPECTED = join(DIR, "router.expected.json");

const unescape = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function makeRouter(base?: string): Router {
  const View = defineComponent({ render: () => null });
  return createRouter({
    history: createMemoryHistory(base),
    routes: vectors.routes.map((path) => ({ path, component: View, ...(vectors.names[path] ? { name: vectors.names[path] } : {}) })),
  });
}

function makeNestedRouter(routes: NestedRoute[]): Router {
  const View = defineComponent({ render: () => null });
  const records = (list: NestedRoute[]): RouteRecordRaw[] =>
    list.map((r) => ({
      path: r.path,
      ...(r.view === false ? {} : { component: View }),
      ...(r.name ? { name: r.name } : {}),
      ...(r.children ? { children: records(r.children) } : {}),
    }));
  return createRouter({ history: createMemoryHistory(), routes: records(routes) });
}

async function nestedLink(routes: NestedRoute[], at: string, to: RouteLocationRaw): Promise<[string, boolean, boolean]> {
  const router = makeNestedRouter(routes);
  const app = createSSRApp({ render: () => h(RouterLink, { to }, () => "x") });
  app.use(router);
  await router.push(at);
  await router.isReady();
  const html = await renderToString(app);
  const href = /href="([^"]*)"/.exec(html);
  expect(href, html).not.toBeNull();
  return [unescape(href![1]!), /class="[^"]*\brouter-link-active\b/.test(html), html.includes('aria-current="page"')];
}

async function link(at: string, to: RouteLocationRaw, base?: string): Promise<[string, boolean]> {
  const router = makeRouter(base);
  const app = createSSRApp({ render: () => h(RouterLink, { to }, () => "x") });
  app.use(router);
  await router.push(at);
  await router.isReady();
  const html = await renderToString(app);
  const href = /href="([^"]*)"/.exec(html);
  expect(href, html).not.toBeNull();
  return [unescape(href![1]!), html.includes('aria-current="page"')];
}

async function location(at: string): Promise<{
  path: string;
  hash: string;
  name: string | null;
  params: Record<string, string>;
  fullPath: string;
  query: Array<[string, string | null | Array<string | null>]>;
}> {
  const router = makeRouter();
  await router.push(at);
  const r = router.currentRoute.value;
  return {
    path: r.path,
    hash: r.hash,
    name: typeof r.name === "string" ? r.name : null,
    params: r.params as Record<string, string>,
    fullPath: r.fullPath,
    query: Object.entries(r.query),
  };
}

async function recordNested(v: NestedVectors): Promise<{
  links: Array<[string, boolean, boolean]>;
  named: Array<[string, boolean, boolean]>;
  locations: Array<{ path: string; name: string | null; params: Record<string, string> }>;
}> {
  const recorded = { links: [] as Array<[string, boolean, boolean]>, named: [] as Array<[string, boolean, boolean]>, locations: [] as Array<{ path: string; name: string | null; params: Record<string, string> }> };
  for (const [at, to] of v.links) recorded.links.push(await nestedLink(v.routes, at, to));
  for (const [at, to] of v.named) recorded.named.push(await nestedLink(v.routes, at, to));
  for (const at of v.locations) {
    const router = makeNestedRouter(v.routes);
    await router.push(at);
    const r = router.currentRoute.value;
    recorded.locations.push({ path: r.path, name: typeof r.name === "string" ? r.name : null, params: r.params as Record<string, string> });
  }
  return recorded;
}

it("holds every router vector it was written with", () => {
  const sizes = (v: NestedVectors): number[] => [v.links.length, v.named.length, v.locations.length];
  const floor = (got: number[], least: number[]): number[] => got.map((n, i) => Math.min(n, least[i]!));
  expect(floor([vectors.links.length, vectors.objects.length, vectors.locations.length, vectors.bases.length], [51, 22, 18, 6])).toEqual([51, 22, 18, 6]);
  expect(floor(sizes(vectors.nested), [23, 6, 9])).toEqual([23, 6, 9]);
  expect(floor(sizes(vectors.files), [32, 22, 22])).toEqual([32, 22, 22]);
});

it("records what RouterLink and useRoute() give for each vector", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const expected: Array<[string, boolean]> = [];
    for (const [at, to] of vectors.links) expected.push(await link(at, to));
    const objects: Array<[string, boolean]> = [];
    for (const [at, to] of vectors.objects) {
      const raw = (to.query ? { ...to, query: Object.fromEntries(to.query) } : to) as RouteLocationRaw;
      objects.push(await link(at, raw));
    }
    const locations = [];
    for (const at of vectors.locations) locations.push(await location(at));
    const bases: Array<[string, boolean]> = [];
    for (const [base, at, to] of vectors.bases) bases.push(await link(at, to, base));
    const recorded = {
      ...vectors,
      expected,
      expectedObjects: objects,
      expectedLocations: locations,
      expectedBases: bases,
      expectedNested: await recordNested(vectors.nested),
      expectedFiles: await recordNested(vectors.files),
    };
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeFileSync(EXPECTED, JSON.stringify(recorded, null, 2) + "\n");
      return;
    }
    expect(JSON.parse(readFileSync(EXPECTED, "utf8"))).toEqual(recorded);
  } finally {
    console.warn = warn;
  }
});
