/* What a conformance suite needs from Vue: a component's real server render, and an app that
 * renders one fixture (`fixture.ts`, which describes a fixture's keys). */
import { readFileSync } from "node:fs";
import { compileScript, compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import * as vue from "vue";
import type { Component } from "vue";
import * as serverRenderer from "vue/server-renderer";

export { fixtureApp, readFixture, routeRecords, type Fixture, type RouteEntry, type RouterOptions } from "./fixture.ts";

/* A bundler compiles a `.vue` file for the browser, and `renderToString` on a component without
 * `ssrRender` falls back to rendering its virtual DOM — a different path with different output
 * (attribute order, `v-model` state, comment markers). So each component is given the `ssrRender`
 * its SSR build would have, which is also what the generator translates. */
export function attachSsrRender(file: string, name: string, component: Component): void {
  const { descriptor } = parseSfc(readFileSync(file, "utf8"), { filename: file });
  const script = compileScript(descriptor, { id: name });
  // A `<style scoped>` component's id is the one `@vitejs/plugin-vue` gave it, which its client
  // build carries and which ferrovue computes the same way.
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
    compilerOptions: { bindingMetadata: script.bindings },
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
