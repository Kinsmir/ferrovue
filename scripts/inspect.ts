import { createHash } from "node:crypto";
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
const scopeId = descriptor.styles.some((st) => st.scoped)
  ? `data-v-${createHash("sha256").update(`c/${name}.vue${source}`).digest("hex").slice(0, 8)}`
  : undefined;
const { code } = compileTemplate({
  source: descriptor.template!.content,
  filename: file,
  id: scopeId ?? name,
  scoped: !!scopeId,
  slotted: descriptor.slotted,
  ssr: true,
  ssrCssVars: [],
  compilerOptions: { bindingMetadata: script.bindings },
});
console.log("── Vue SSR compilation ──\n" + code);

const runnable = join(import.meta.dirname, `.inspect-${process.pid}.ts`);
try {
  writeFileSync(runnable, script.content);
  const component = ((await import(runnable)) as { default: Component }).default;
  if (scopeId) (component as { __scopeId?: string }).__scopeId = scopeId;
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
