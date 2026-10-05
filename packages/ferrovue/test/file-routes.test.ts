import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createRoutesContext, resolveOptions } from "vue-router/unplugin";
import { fileRoutes, type FileRoute } from "../src/file-routes.ts";

const TREES = join(import.meta.dirname, "file-routes.json");
const EXPECTED = join(import.meta.dirname, "file-routes.expected.json");
const trees = JSON.parse(readFileSync(TREES, "utf8")) as Record<string, string[]>;

interface Recorded {
  path: string;
  name?: string;
  file?: string;
  children?: Recorded[];
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ferrovue-pages-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, "pages", file)), { recursive: true });
    writeFileSync(join(root, "pages", file), text);
  }
  return root;
}

const page = "<template><p>page</p></template>\n";

async function vueRouterRoutes(root: string): Promise<Recorded[]> {
  const context = createRoutesContext(resolveOptions({ root, routesFolder: "pages", dts: false, watch: false, logs: false }));
  await context.scanPages(false);
  const code = context.generateRoutes();
  const list = code.slice(code.indexOf("export const routes = ") + "export const routes = ".length, code.indexOf("\nexport function handleHotUpdate"));
  const literal = list.replace(/\(\) => import\('([^']*)'\)/g, (_, file: string) => JSON.stringify(relative(root, file)));
  const raw = ((await import(`data:text/javascript,${encodeURIComponent(`export default ${literal}`)}`)) as { default: Array<Recorded & { component?: string }> }).default;
  const shape = (routes: Array<Recorded & { component?: string }>): Recorded[] =>
    routes.map((r) => ({
      path: r.path,
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.component !== undefined ? { file: r.component } : {}),
      ...(r.children ? { children: shape(r.children) } : {}),
    }));
  return shape(raw);
}

function withoutComponents(routes: FileRoute[]): Recorded[] {
  return routes.map(({ component: _, children, ...r }) => ({ ...r, ...(children ? { children: withoutComponents(children) } : {}) }));
}

it("records the routes vue-router builds from each folder of pages", async () => {
  expect(Object.keys(trees).length).toBeGreaterThanOrEqual(9);
  const recorded: Record<string, Recorded[]> = {};
  for (const [name, files] of Object.entries(trees)) {
    recorded[name] = await vueRouterRoutes(project(Object.fromEntries(files.map((f) => [f, page]))));
  }
  if (process.env.FERROVUE_VECTORS_WRITE === "1") {
    writeFileSync(EXPECTED, JSON.stringify(recorded, null, 2) + "\n");
    return;
  }
  expect(JSON.parse(readFileSync(EXPECTED, "utf8"))).toEqual(recorded);
});

it("builds the routes vue-router builds from each folder of pages", () => {
  const expected = JSON.parse(readFileSync(EXPECTED, "utf8")) as Record<string, Recorded[]>;
  expect(Object.keys(expected)).toEqual(Object.keys(trees));
  for (const [name, files] of Object.entries(trees)) {
    const root = project(Object.fromEntries(files.map((f) => [f, page])));
    expect(withoutComponents(fileRoutes(root, "pages")), name).toEqual(expected[name]);
  }
});

it("names each page's component after its path", () => {
  const root = project(Object.fromEntries(["index.vue", "books/[id].vue", "[...path].vue", "(shop)/cart.vue", "admin/_parent.vue", "admin/user-list.vue"].map((f) => [f, page])));
  const names: string[] = [];
  const walk = (routes: FileRoute[]): void => {
    for (const r of routes) {
      if (r.component) names.push(`${r.file} ${r.component}`);
      walk(r.children ?? []);
    }
  };
  walk(fileRoutes(root, "pages"));
  expect(names.toSorted()).toEqual([
    "pages/(shop)/cart.vue ShopCart",
    "pages/[...path].vue Path",
    "pages/admin/_parent.vue AdminParent",
    "pages/admin/user-list.vue AdminUserList",
    "pages/books/[id].vue BooksId",
    "pages/index.vue Index",
  ]);
});

it.each([
  ["[id]+.vue", "FV1240", "a repeatable parameter"],
  ["[[...all]].vue", "FV1240", "an optional catch-all"],
  ["prefix-[id].vue", "FV1240", "one whole parameter"],
  ["[id=int].vue", "FV1240", "a parameter parser"],
  ["[x+2E].vue", "FV1240", "a character code"],
  ["caf é.vue", "FV1240", "letters, digits"],
  ["[...all]/x.vue", "FV1240", "the last part of a path"],
  ["[id.vue", "FV1240", "never closed"],
  ["index@aside.vue", "FV1241", "a named view"],
  ["_parent.vue", "FV1244", "in the pages folder itself"],
  ["admin/_parent.vue", "FV1244", "this folder has none"],
])("refuses %s", (file, code, message) => {
  const root = project({ [file]: page });
  let thrown: unknown;
  try {
    fileRoutes(root, "pages");
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toMatchObject({ code });
  expect((thrown as Error).message).toContain(message);
});

it("refuses definePage() and a <route> block, at the line that holds them", () => {
  const defined = project({ "index.vue": `<script setup lang="ts">\ndefinePage({ name: "home" });\n</script>\n${page}` });
  expect(() => fileRoutes(defined, "pages")).toThrow(expect.objectContaining({ code: "FV1242", at: { file: "pages/index.vue", line: 2, column: 1 } }));
  const block = project({ "index.vue": `${page}<route lang="json">{ "name": "home" }</route>\n` });
  expect(() => fileRoutes(block, "pages")).toThrow(expect.objectContaining({ code: "FV1243", at: expect.objectContaining({ file: "pages/index.vue", line: 2 }) }));
});

it("refuses a pages folder that does not exist", () => {
  const root = project({});
  expect(() => fileRoutes(root, "nowhere")).toThrow(expect.objectContaining({ code: "FV1239" }));
});
