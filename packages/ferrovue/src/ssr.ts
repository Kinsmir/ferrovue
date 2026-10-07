import { readFileSync } from "node:fs";
import { compileScript, compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import * as vue from "vue";
import type { Component } from "vue";
import * as serverRenderer from "vue/server-renderer";

/** Give a component compiled for the browser the `ssrRender` its SSR build would have. */
export function attachSsrRender(file: string, name: string, component: Component): void {
  const { descriptor } = parseSfc(readFileSync(file, "utf8"), { filename: file });
  const script = descriptor.script || descriptor.scriptSetup ? compileScript(descriptor, { id: name }) : null;
  const scopeId = (component as { __scopeId?: string }).__scopeId;
  if (!scopeId && descriptor.styles.some((st) => st.scoped)) {
    throw new Error(`${file}: a \`<style scoped>\` component without \`__scopeId\`: load it through \`@vitejs/plugin-vue\``);
  }
  const { code } = compileTemplate({
    source: descriptor.template!.content,
    filename: file,
    id: scopeId ?? name,
    scoped: !!scopeId,
    slotted: descriptor.slotted,
    ssr: true,
    ssrCssVars: [],
    compilerOptions: script?.bindings ? { bindingMetadata: script.bindings } : {},
  });
  const body = code
    .replace(/import \{([^}]*)\} from "vue"/g, (_, names: string) => `const {${names.replace(/ as /g, ": ")}} = __vue;`)
    .replace(
      /import \{([^}]*)\} from "vue\/server-renderer"/g,
      (_, names: string) => `const {${names.replace(/ as /g, ": ")}} = __sr;`,
    )
    .replace("export function ssrRender", "return function ssrRender");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  (component as { ssrRender?: unknown }).ssrRender = new Function("__vue", "__sr", body)(vue, serverRenderer);
}
