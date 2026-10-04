/* Show what each stage makes of one component: Vue's SSR compilation, Vue's render of it, and the
 * Rust ferrovue generates — the three things to compare when adding support for a construct.
 *
 *   node scripts/inspect.ts path/to/X.vue ['{"prop":"value"}']
 *
 * The component is compiled alone, in a temporary project, so it may import nothing but `vue`. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { type Component, createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { generate } from "../packages/ferrovue/src/compiler.ts";
import { attachSsrRender } from "../packages/ferrovue/src/testing.ts";

const file = resolve(process.argv[2] ?? "");
const props = JSON.parse(process.argv[3] ?? "{}") as Record<string, unknown>;
const name = basename(file, ".vue");
const source = readFileSync(file, "utf8");

const { descriptor } = parse(source, { filename: file });
const script = compileScript(descriptor, { id: name });
const { code } = compileTemplate({
  source: descriptor.template!.content,
  filename: file,
  id: name,
  ssr: true,
  ssrCssVars: [],
  compilerOptions: { bindingMetadata: script.bindings },
});
console.log("── Vue SSR compilation ──\n" + code);

// The script setup, compiled to a module Node runs: written beside this script so that `vue`
// resolves, and as TypeScript, which Node strips.
const runnable = join(import.meta.dirname, `.inspect-${process.pid}.ts`);
try {
  writeFileSync(runnable, script.content);
  const component = ((await import(runnable)) as { default: Component }).default;
  attachSsrRender(file, name, component);
  console.log("── Vue render ──\n" + (await renderToString(createSSRApp({ render: () => h(component, props) }))));
} catch (e) {
  console.log(`── Vue render ──\n(not rendered here: ${(e as Error).message})`);
} finally {
  rmSync(runnable, { force: true });
}

const root = mkdtempSync(join(tmpdir(), "ferrovue-inspect-"));
try {
  mkdirSync(join(root, "c"));
  writeFileSync(join(root, "c", `${name}.vue`), source);
  const out = generate(root, { components: "c", out: "out" });
  console.log("── ferrovue ──\n" + out.get(`${name.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).replace(/^_/, "")}.rs`));
} catch (e) {
  console.log(`── ferrovue ──\n${(e as Error).message}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
