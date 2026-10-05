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
  nested: {
    routes: NestedRoute[];
    links: Array<[string, string]>;
    named: Array<[string, RouteLocationRaw]>;
    locations: string[];
  };
}

interface NestedRoute {
  path: string;
  name?: string;
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

function makeNestedRouter(): Router {
  const View = defineComponent({ render: () => null });
  const records = (routes: NestedRoute[]): RouteRecordRaw[] =>
    routes.map((r) => ({ path: r.path, component: View, ...(r.name ? { name: r.name } : {}), ...(r.children ? { children: records(r.children) } : {}) }));
  return createRouter({ history: createMemoryHistory(), routes: records(vectors.nested.routes) });
}

async function nestedLink(at: string, to: RouteLocationRaw): Promise<[string, boolean, boolean]> {
  const router = makeNestedRouter();
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
    const nested = { links: [] as Array<[string, boolean, boolean]>, named: [] as Array<[string, boolean, boolean]>, locations: [] as Array<{ path: string; name: string | null; params: Record<string, string> }> };
    for (const [at, to] of vectors.nested.links) nested.links.push(await nestedLink(at, to));
    for (const [at, to] of vectors.nested.named) nested.named.push(await nestedLink(at, to));
    for (const at of vectors.nested.locations) {
      const router = makeNestedRouter();
      await router.push(at);
      const r = router.currentRoute.value;
      nested.locations.push({ path: r.path, name: typeof r.name === "string" ? r.name : null, params: r.params as Record<string, string> });
    }
    const recorded = { ...vectors, expected, expectedObjects: objects, expectedLocations: locations, expectedBases: bases, expectedNested: nested };
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeFileSync(EXPECTED, JSON.stringify(recorded, null, 2) + "\n");
      return;
    }
    expect(JSON.parse(readFileSync(EXPECTED, "utf8"))).toEqual(recorded);
  } finally {
    console.warn = warn;
  }
});
