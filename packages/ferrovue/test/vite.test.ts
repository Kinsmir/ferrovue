/* The Vite plugin, driven as Vite drives it: `buildStart` with a plugin context, and a dev server's
 * watcher, logger and error channel. */
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
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

/** Call a hook as Vite does, with `this` a plugin context whose `error` throws. */
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
  /** The plugin, configured as Vite resolves it beside plugin-vue with these options. */
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
  // plugin-vue's defaults: the source too in a build, which is ferrovue's default.
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
