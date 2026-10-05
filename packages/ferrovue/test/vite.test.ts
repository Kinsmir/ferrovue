import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vuePlugin from "@vitejs/plugin-vue";
import { afterEach, beforeEach, expect, it } from "vitest";
import { build, type Rolldown, type ViteDevServer } from "vite";
import ferrovue, { affects } from "../src/vite.ts";

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
  expect(() => buildStart(ferrovue({ root }))).toThrow(/components\/Hello\.vue:4:24: `\/` is supported between two numbers that are present: the other is a string/);
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
  expect(JSON.stringify(sent[0])).toContain("Hello.vue:4:24");

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

it("ignores the output, dependencies, and files of other kinds", () => {
  expect(affects(root, join(root, "components", "Hello.vue"))).toBe(true);
  expect(affects(root, join(root, "stores", "prefs.ts"))).toBe(true);
  expect(affects(root, join(root, "gen", "hello.rs"))).toBe(false);
  expect(affects(root, join(root, "gen", "types.json"))).toBe(false);
  expect(affects(root, join(root, "node_modules", "vue", "index.ts"))).toBe(false);
  expect(affects(root, join(root, "styles", "app.css"))).toBe(false);
  expect(affects(root, join(root, "..", "elsewhere.vue"))).toBe(false);
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

it("says what is missing when `ferrovue/islands` is imported without the plugin", async () => {
  await expect(import("../src/islands.ts")).rejects.toThrow(/written by the Vite plugin: add `ferrovue\(\)` from `ferrovue\/vite`/);
});
