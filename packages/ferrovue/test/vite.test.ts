import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vuePlugin from "@vitejs/plugin-vue";
import { afterEach, beforeEach, expect, it } from "vitest";
import { build, type Rolldown, type ViteDevServer } from "vite";
import { loadConfig, write } from "../src/compiler.ts";
import { affects, inputsOf } from "../src/inputs.ts";
import ferrovue from "../src/vite.ts";

let root = "";
const good = `<script setup lang="ts">
defineProps<{ name: string }>();
</script>
<template><p>Hello, {{ name }}</p></template>`;
const bad = good.replace("{{ name }}", "{{ name / 2 }}");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ferrovue-vite-"));
  mkdirSync(join(root, "components"));
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "gen" }));
  writeFileSync(join(root, "components", "Hello.vue"), good);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function buildStart(plugin: ReturnType<typeof ferrovue>): void {
  const hook = plugin.buildStart as (this: { error(m: string): never }) => void;
  hook.call({
    error(m: string): never {
      throw new Error(m);
    },
  });
}

it("regenerates when a build starts", () => {
  buildStart(ferrovue({ root }));
  expect(readFileSync(join(root, "gen", "hello.rs"), "utf8")).toContain("Hello, ");
});

it("fails a build on a refused construct, naming the line in the .vue file", () => {
  writeFileSync(join(root, "components", "Hello.vue"), bad);
  expect(() => buildStart(ferrovue({ root }))).toThrow(/^error\[FV0609\]: components\/Hello\.vue:4:24: `\/` is supported between two numbers that are present: the other is a string[\s\S]*\n = docs: https:\/\/docs\.rs\/ferrovue\/latest\/ferrovue\/guide\/error_codes\/index\.html#fv0609$/);
});

it("regenerates on the dev server's changes, and shows a refusal in the error overlay", () => {
  const watcher = Object.assign(new EventEmitter(), { add: () => {} });
  const sent: unknown[] = [];
  const logged: string[] = [];
  const server = {
    watcher,
    ws: { send: (payload: unknown) => sent.push(payload) },
    config: { logger: { info: (m: string) => logged.push(m), error: (m: string) => logged.push(m) } },
    moduleGraph: { getModuleById: () => undefined },
  } as unknown as ViteDevServer;
  (ferrovue({ root }).configureServer as (s: ViteDevServer) => void)(server);

  writeFileSync(join(root, "components", "Hello.vue"), bad);
  watcher.emit("change", join(root, "components", "Hello.vue"));
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0])).toContain("error[FV0609]: components/Hello.vue:4:24");
  expect(logged.at(-1)).toContain("#fv0609");

  writeFileSync(join(root, "components", "Hello.vue"), good.replace("Hello", "Bye"));
  watcher.emit("change", join(root, "components", "Hello.vue"));
  expect(readFileSync(join(root, "gen", "hello.rs"), "utf8")).toContain("Bye, ");
  expect(logged.at(-1)).toContain("2 changed");
});

it("fails a build whose `<style scoped>` ids plugin-vue computes otherwise, and warns the dev server", () => {
  writeFileSync(join(root, "components", "Hello.vue"), `${good}\n<style scoped>p { color: red }</style>`);
  const configured = (command: "build" | "serve", features: Record<string, unknown> = {}) => {
    const plugin = ferrovue({ root });
    const vue = { name: "vite:vue", api: { options: { features } } };
    (plugin.configResolved as (c: unknown) => void)({ plugins: [vue], root, isProduction: command === "build", command });
    return plugin;
  };
  const warned: string[] = [];
  const start = (plugin: ReturnType<typeof ferrovue>): void => {
    const hook = plugin.buildStart as (this: { error(m: string): never; warn(m: string): void }) => void;
    hook.call({
      error(m: string): never {
        throw new Error(m);
      },
      warn: (m: string) => void warned.push(m),
    });
  };
  start(configured("build"));
  expect(() => start(configured("build", { componentIdGenerator: "filepath" }))).toThrow(/plugin-vue hashes "filepath" from .*, ferrovue\.config\.json "filepath-source"/);
  start(configured("serve"));
  expect(warned).toHaveLength(1);
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "gen", scopeId: "filepath" }));
  start(configured("build", { componentIdGenerator: "filepath" }));
  expect(warned).toHaveLength(1);
});

it("regenerates on the configuration, components, stores, messages, pages, routes and the type files read, and nothing else", () => {
  mkdirSync(join(root, "stores"));
  mkdirSync(join(root, "locales"));
  mkdirSync(join(root, "pages", "books"), { recursive: true });
  const config = { components: "./components/", out: "./gen", stores: "stores", i18n: { messages: "locales" }, routes: { pages: "pages" } };
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify(config));
  writeFileSync(join(root, "types.ts"), "export interface Item { name: string }\n");
  writeFileSync(join(root, "components", "Hello.vue"), `<script setup lang="ts">\nimport type { Item } from "../types";\ndefineProps<{ item: Item }>();\n</script>\n<template><p>{{ item.name }}</p></template>`);
  write(root, loadConfig(root));
  const inputs = inputsOf(root, "ferrovue.config.json", loadConfig(root));
  const at = (...path: string[]) => affects(inputs, join(root, ...path));
  for (const path of [["ferrovue.config.json"], ["components", "Hello.vue"], ["components", "Card.vue"], ["components"], ["types.ts"], ["stores", "prefs.ts"], ["locales", "en.json"], ["pages", "books", "[id].vue"]]) {
    expect(at(...path), path.join("/")).toBe(true);
  }
  for (const path of [["gen", "hello.rs"], ["gen", "types.json"], ["vite.config.ts"], ["package.json"], ["tsconfig.json"], ["helpers.ts"], ["components", "Hello.test.ts"], ["components", "nested", "Deep.vue"], ["stores", "prefs.json"], ["node_modules", "vue", "index.ts"], ["styles", "app.css"], ["..", "elsewhere.vue"]]) {
    expect(at(...path), path.join("/")).toBe(false);
  }
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ ...config, routes: "routes.json" }));
  expect(affects(inputsOf(root, "ferrovue.config.json", loadConfig(root)), join(root, "routes.json"))).toBe(true);
  expect(affects(inputsOf(root, "custom.json", null), join(root, "custom.json"))).toBe(true);
  expect(affects(inputsOf(root, "custom.json", null), join(root, "components", "Hello.vue"))).toBe(false);
});

it("does not regenerate on the dev server's change to a file that is not an input", () => {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "./components", out: "./gen" }));
  const watcher = Object.assign(new EventEmitter(), { add: () => {} });
  const logged: string[] = [];
  const server = {
    watcher,
    ws: { send: () => {} },
    config: { logger: { info: (m: string) => logged.push(m), error: (m: string) => logged.push(m) } },
    moduleGraph: { getModuleById: () => undefined },
  } as unknown as ViteDevServer;
  const plugin = ferrovue({ root });
  (plugin.configureServer as (s: ViteDevServer) => void)(server);
  buildStart(plugin);
  rmSync(join(root, "gen"), { recursive: true });
  for (const file of ["vite.config.ts", "package.json", "tsconfig.json", "src/main.ts"]) watcher.emit("change", join(root, file));
  expect(existsSync(join(root, "gen"))).toBe(false);
  expect(logged).toEqual([]);
  watcher.emit("change", join(root, "components", "Hello.vue"));
  expect(existsSync(join(root, "gen", "hello.rs"))).toBe(true);
});

it("reads the configuration file the `config` option names", () => {
  rmSync(join(root, "ferrovue.config.json"));
  writeFileSync(join(root, "ssr.json"), JSON.stringify({ components: "components", out: "ssr" }));
  const watcher = Object.assign(new EventEmitter(), { add: () => {} });
  const server = {
    watcher,
    ws: { send: () => {} },
    config: { logger: { info: () => {}, error: () => {} } },
    moduleGraph: { getModuleById: () => undefined },
  } as unknown as ViteDevServer;
  const plugin = ferrovue({ root, config: "ssr.json" });
  (plugin.configureServer as (s: ViteDevServer) => void)(server);
  buildStart(plugin);
  expect(readFileSync(join(root, "ssr", "hello.rs"), "utf8")).toContain("Hello, ");
  writeFileSync(join(root, "ssr.json"), JSON.stringify({ components: "components", out: "ssr2" }));
  watcher.emit("change", join(root, "ssr.json"));
  expect(existsSync(join(root, "ssr2", "hello.rs"))).toBe(true);
  expect(() => buildStart(ferrovue({ root }))).toThrow(/error\[FV1102\]: cannot find `ferrovue\.config\.json`/);
  expect(() => buildStart(ferrovue({ root, config: "missing.json" }))).toThrow(/cannot find `missing\.json`/);
});

const frame = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><section><h2>{{ title }}</h2><slot /></section></template>`;

it("writes `ferrovue/islands`: a loader for each component that has an `island()`", () => {
  writeFileSync(join(root, "components", "Frame.vue"), frame);
  const plugin = ferrovue({ root });
  expect(plugin.enforce).toBe("pre");
  const resolveId = plugin.resolveId as (id: string) => string | null;
  const load = plugin.load as (this: unknown, id: string) => string | null;
  const id = resolveId("ferrovue/islands")!;
  expect(resolveId("ferrovue/client")).toBeNull();
  expect(load.call({}, "elsewhere")).toBeNull();
  expect(load.call({}, id)).toBe(`export default {\n  "Hello": () => import(${JSON.stringify(join(root, "components", "Hello.vue"))}),\n};\n`);
  expect(readFileSync(join(root, "gen", "hello.rs"), "utf8")).toContain("pub fn island");
});

it("reloads the dev server's page when the islands change, and only then", () => {
  const watcher = Object.assign(new EventEmitter(), { add: () => {} });
  const sent: unknown[] = [];
  const invalidated: unknown[] = [];
  const islandsModule = { id: "ferrovue/islands" };
  const server = {
    watcher,
    ws: { send: (payload: unknown) => sent.push(payload) },
    config: { logger: { info: () => {}, error: () => {} } },
    moduleGraph: { getModuleById: (id: string) => (id === "\0ferrovue/islands" ? islandsModule : undefined), invalidateModule: (m: unknown) => invalidated.push(m) },
  } as unknown as ViteDevServer;
  const plugin = ferrovue({ root });
  (plugin.configureServer as (s: ViteDevServer) => void)(server);
  buildStart(plugin);

  writeFileSync(join(root, "components", "Hello.vue"), good.replace("Hello", "Bye"));
  watcher.emit("change", join(root, "components", "Hello.vue"));
  expect(sent).toEqual([]);

  writeFileSync(join(root, "components", "Card.vue"), good);
  watcher.emit("add", join(root, "components", "Card.vue"));
  expect(invalidated).toEqual([islandsModule]);
  expect(sent).toEqual([{ type: "full-reload" }]);

  writeFileSync(join(root, "components", "Frame.vue"), frame);
  watcher.emit("add", join(root, "components", "Frame.vue"));
  expect(sent).toHaveLength(1);
});

it("splits each island into a chunk of its own in a build", async () => {
  writeFileSync(join(root, "components", "Frame.vue"), frame);
  writeFileSync(join(root, "components", "Card.vue"), good.replace("<p>", '<p class="card">'));
  writeFileSync(join(root, "main.ts"), 'import islands from "ferrovue/islands";\nObject.assign(globalThis, { islands });\n');
  const out = (await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [vuePlugin(), ferrovue({ root })],
    build: { write: false, rolldownOptions: { input: join(root, "main.ts"), external: ["vue"] } },
  })) as Rolldown.RolldownOutput;
  const chunks = out.output.filter((o): o is Rolldown.OutputChunk => o.type === "chunk");
  const islands = chunks.flatMap((c) => (c.facadeModuleId?.endsWith(".vue") ? [c.facadeModuleId.slice(root.length)] : []));
  expect(islands.toSorted()).toEqual(["/components/Card.vue", "/components/Hello.vue"]);
  const entry = chunks.find((c) => c.isEntry)!;
  expect(entry.dynamicImports).toHaveLength(2);
  expect(entry.code).not.toContain("Hello, ");
});

function withPages(): void {
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "gen", routes: { pages: "pages" } }));
  mkdirSync(join(root, "pages", "books"), { recursive: true });
  writeFileSync(join(root, "pages", "index.vue"), "<template><p>home</p></template>");
  writeFileSync(join(root, "pages", "books", "[id].vue"), "<template><p>book</p></template>");
}

it("writes `ferrovue/routes`: the pages' routes, as vue-router's records and as a routes file lists them", async () => {
  withPages();
  const plugin = ferrovue({ root });
  const resolveId = plugin.resolveId as (id: string) => string | null;
  const load = plugin.load as (this: unknown, id: string) => string | null;
  const code = load.call({}, resolveId("ferrovue/routes")!)!;
  expect(code).toContain(`component: () => import(${JSON.stringify(join(root, "pages", "books", "[id].vue"))}),`);
  const module = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as { routes: Array<Record<string, unknown>>; default: unknown };
  expect(module.default).toEqual([
    { path: "/", name: "/" },
    { path: "/books", view: false, children: [{ path: ":id", name: "/books/[id]" }] },
  ]);
  expect(module.routes.map((r) => Object.keys(r))).toEqual([["path", "name", "component"], ["path", "children"]]);
  expect(typeof module.routes[0]!.component).toBe("function");
});

it("refuses `ferrovue/routes` without a folder of pages", () => {
  const plugin = ferrovue({ root });
  const load = plugin.load as (this: unknown, id: string) => string | null;
  expect(() => load.call({}, (plugin.resolveId as (id: string) => string)("ferrovue/routes"))).toThrow(/`ferrovue\/routes` is written from a folder of pages/);
});

it("reloads the dev server's page when a page is added", () => {
  withPages();
  const watcher = Object.assign(new EventEmitter(), { add: () => {} });
  const sent: unknown[] = [];
  const routesModule = { id: "ferrovue/routes" };
  const server = {
    watcher,
    ws: { send: (payload: unknown) => sent.push(payload) },
    config: { logger: { info: () => {}, error: () => {} } },
    moduleGraph: { getModuleById: (id: string) => (id === "\0ferrovue/routes" ? routesModule : undefined), invalidateModule: () => {} },
  } as unknown as ViteDevServer;
  const plugin = ferrovue({ root });
  (plugin.configureServer as (s: ViteDevServer) => void)(server);
  (plugin.load as (this: unknown, id: string) => string | null).call({}, "\0ferrovue/routes");

  writeFileSync(join(root, "pages", "index.vue"), "<template><p>home!</p></template>");
  watcher.emit("change", join(root, "pages", "index.vue"));
  expect(sent).toEqual([]);

  writeFileSync(join(root, "pages", "about.vue"), "<template><p>about</p></template>");
  watcher.emit("add", join(root, "pages", "about.vue"));
  expect(sent).toEqual([{ type: "full-reload" }]);
  expect(readFileSync(join(root, "gen", "about.rs"), "utf8")).toContain("about");
});

it("says what is missing when `ferrovue/routes` is imported without the plugin", async () => {
  await expect(import("../src/page-routes.ts")).rejects.toThrow(/written by the Vite plugin from a folder of pages/);
});

it("says what is missing when `ferrovue/islands` is imported without the plugin", async () => {
  await expect(import("../src/islands.ts")).rejects.toThrow(/written by the Vite plugin: add `ferrovue\(\)` from `ferrovue\/vite`/);
});
