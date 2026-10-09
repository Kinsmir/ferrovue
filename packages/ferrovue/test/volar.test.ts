import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@vue/language-core";
import * as service from "@vue/language-service";
import ts from "typescript-js";
import { URI } from "vscode-uri";
import { afterAll, expect, it } from "vitest";
import plugin from "../src/volar.ts";

const PLUGIN = join(import.meta.dirname, "../src/volar.ts");
const DOCS = "https://docs.rs/ferrovue/latest/ferrovue/guide/error_codes/index.html";
const CLEAN = `<script setup lang="ts">
defineProps<{ n: number }>();
</script>

<template>
  <p>{{ n }}</p>
</template>
`;
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function editor(options: Record<string, unknown> = {}, files: Record<string, string> = {}): (text: string) => Promise<service.Diagnostic[]> {
  const root = mkdtempSync(join(tmpdir(), "ferrovue-volar-"));
  roots.push(root);
  mkdirSync(join(root, "components"));
  writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ components: "components", out: "src/generated" }));
  for (const [name, text] of Object.entries({ "Card.vue": CLEAN, ...files })) writeFileSync(join(root, "components", name), text);
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ include: ["components"], vueCompilerOptions: { plugins: [{ name: PLUGIN, ...options }] } }));
  const typescript = ts as unknown as Parameters<typeof core.createParsedCommandLine>[0];
  const commandLine = core.createParsedCommandLine(typescript, ts.sys, join(root, "tsconfig.json"));
  expect(commandLine.vueOptions.plugins).toHaveLength(1);
  const uri = URI.file(join(root, "components", "Card.vue"));
  const language = service.createLanguage<URI>(
    [core.createVueLanguagePlugin(typescript, commandLine.options, commandLine.vueOptions, (u) => u.fsPath.replaceAll("\\", "/"))],
    service.createUriMap(),
    () => {},
  );
  const ls = service.createLanguageService(language, service.createVueLanguageServicePlugins(typescript), { workspaceFolders: [URI.file(root)] }, {});
  return async (text) => {
    language.scripts.set(uri, ts.ScriptSnapshot.fromString(text), "vue");
    const found = await ls.getDiagnostics(uri);
    expect(readFileSync(uri.fsPath, "utf8")).toBe(files["Card.vue"] ?? CLEAN);
    return found;
  };
}

function at(text: string, needle: string): { line: number; character: number } {
  const before = text.slice(0, text.indexOf(needle));
  return { line: before.split("\n").length - 1, character: before.length - before.lastIndexOf("\n") - 1 };
}

const shown = (found: service.Diagnostic[]) => found.map(({ range, code, message }) => ({ range, code, message }));

it("reports nothing for a component ferrovue accepts", async () => {
  expect(await editor()(CLEAN)).toEqual([]);
});

it("reports a refusal in the editor's unsaved template on the construct, with its code linked to the docs", async () => {
  const text = CLEAN.replace("{{ n }}", "{{ n.toPrecision(2) }}");
  const start = at(text, "n.toPrecision");
  expect(await editor()(text)).toEqual([
    {
      range: { start, end: start },
      severity: 1,
      source: "vue",
      code: { value: "FV0602", target: `${DOCS}#fv0602` },
      message: "ferrovue: `.toPrecision()` is not supported",
      data: expect.anything() as unknown,
    },
  ]);
});

it("follows the text as it is edited, showing each refusal once and none once it is fixed", async () => {
  const check = editor();
  const first = CLEAN.replace("{{ n }}", "{{ n.toPrecision(2) }}");
  const second = CLEAN.replace("defineProps<{ n: number }>();", "defineProps<{ n: number; when: Date }>();");
  expect((await check(first)).map((d) => d.range.start)).toEqual([at(first, "n.toPrecision")]);
  expect(shown(await check(first + "\n"))).toHaveLength(1);
  expect(shown(await check(second)).map((d) => d.code)).toEqual([{ value: "FV0315", target: `${DOCS}#fv0315` }]);
  expect(await check(CLEAN)).toEqual([]);
});

it("reports a refusal in <script setup> on its tag, where the editor can place it, naming the line and column", async () => {
  const text = CLEAN.replace("n: number", "when: Date").replace("{{ n }}", "{{ when }}");
  expect(shown(await editor()(text))).toEqual([
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: '<script setup lang="ts">'.length } },
      code: { value: "FV0315", target: `${DOCS}#fv0315` },
      message: "ferrovue: unsupported prop type `Date`: declare it as an interface in the component, or import it from a `.ts` file (at 2:21)",
    },
  ]);
});

it("reports a refusal of the whole component at its start", async () => {
  const text = `<script setup lang="ts">\ndefineProps<{ n: number }>();\n</script>\n`;
  expect(shown(await editor()(text))).toEqual([
    {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      code: { value: "FV0004", target: `${DOCS}#fv0004` },
      message: "ferrovue: a component needs a `<template>`: a render function is not translated",
    },
  ]);
});

it("leaves a refusal in another component to that component", async () => {
  const check = editor({}, { "Above.vue": CLEAN.replace("{{ n }}", "{{ n.toPrecision(2) }}") });
  expect(await check(CLEAN.replace("{{ n }}", "{{ n.toPrecision(3) }}"))).toEqual([]);
});

it("gives the code as plain text and the link in the message with codeLinks off", async () => {
  const text = CLEAN.replace("{{ n }}", "{{ n.toPrecision(3) }}");
  const [found] = await editor({ codeLinks: false })(text);
  expect(found?.code).toBe("FV0602");
  expect(found?.message).toBe(`ferrovue: \`.toPrecision()\` is not supported\n${DOCS}#fv0602`);
});

it("does nothing in TypeScript's server or vue-tsc, which do not show these errors", () => {
  const argv = process.argv[1];
  try {
    for (const host of ["/project/node_modules/typescript/lib/tsserver.js", "/project/node_modules/vue-tsc/bin/vue-tsc.js"]) {
      process.argv[1] = host;
      expect(plugin({} as Parameters<typeof plugin>[0])).toEqual([]);
    }
  } finally {
    process.argv[1] = argv!;
  }
});
