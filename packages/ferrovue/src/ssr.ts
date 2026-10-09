import { readFileSync } from "node:fs";
import { compileScript, compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import { getEscapedCssVarName } from "@vue/shared";
import * as vue from "vue";
import type { Component } from "vue";
import * as serverRenderer from "vue/server-renderer";

const KEY = /(?:^|[{,])\s*"((?:[^"\\]|\\.)*)"\s*:/g;

function cssVarNames(file: string, component: Component, count: number): string[] {
  const text = ["setup", "ssrRender"]
    .map((k) => (component as Record<string, unknown>)[k])
    .map((f) => (typeof f === "function" ? f.toString() : ""))
    .join("\n");
  const keys = (start: RegExp): string[] => {
    const at = start.exec(text);
    return at ? [...text.slice(at.index + at[0].length - 1).matchAll(KEY)].slice(0, count).map((m) => m[1]!) : [];
  };
  const server = keys(/_cssVars = \{\s*style:\s*\{/);
  if (server.length === count && server.every((n) => n.startsWith(":--"))) return server.map((n) => n.slice(3));
  const client = keys(/useCssVars\)?\(\s*\(?_ctx\)?\s*=>\s*\(\{/);
  if (client.length !== count) {
    throw new Error(`${file}: \`v-bind()\` in \`<style>\`: the component holds none of the variables \`@vitejs/plugin-vue\` names; load it through the plugin`);
  }
  return client.map((k) => getEscapedCssVarName(JSON.parse(`"${k}"`) as string, true));
}

/** Give a component compiled for the browser the `ssrRender` its SSR build would have. */
export function attachSsrRender(file: string, name: string, component: Component): void {
  const { descriptor } = parseSfc(readFileSync(file, "utf8"), { filename: file });
  const script = descriptor.script || descriptor.scriptSetup ? compileScript(descriptor, { id: name }) : null;
  const scopeId = (component as { __scopeId?: string }).__scopeId;
  if (!scopeId && descriptor.styles.some((st) => st.scoped)) {
    throw new Error(`${file}: a \`<style scoped>\` component without \`__scopeId\`: load it through \`@vitejs/plugin-vue\``);
  }
  const varNames = descriptor.cssVars.length ? cssVarNames(file, component, descriptor.cssVars.length) : [];
  let named = 0;
  const code = compileTemplate({
    source: descriptor.template!.content,
    filename: file,
    id: scopeId ?? name,
    scoped: !!scopeId,
    slotted: descriptor.slotted,
    ssr: true,
    ssrCssVars: descriptor.cssVars,
    isProd: true,
    compilerOptions: script?.bindings ? { bindingMetadata: script.bindings } : {},
  }).code.replace(/^(\s*)":--[^"]*":/gm, (_, indent: string) => `${indent}":--${varNames[named++]!}":`);
  const body = code
    .replace(/import \{([^}]*)\} from "vue"/g, (_, names: string) => `const {${names.replace(/ as /g, ": ")}} = __vue;`)
    .replace(
      /import \{([^}]*)\} from "vue\/server-renderer"/g,
      (_, names: string) => `const {${names.replace(/ as /g, ": ")}} = __sr;`,
    )
    .replace("export function ssrRender", "return function ssrRender");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  (component as { ssrRender?: unknown }).ssrRender = new Function("__vue", "__sr", body)(vue, serverRenderer);
  const declared = /\n {2}const _cssVars = (\{ style: \{[^]*?\n\}\})\n/.exec(code)?.[1];
  if (declared !== undefined) exposeCssVars(component as CssVarsComponent, body.slice(0, body.indexOf("return function ssrRender")), declared);
}

type Vars = Record<string, unknown>;

interface CssVarsComponent {
  setup?: (props: object, ctx: object) => unknown;
}

function exposeCssVars(component: CssVarsComponent, imports: string, declared: string): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const vars = new Function("__vue", "__sr", `${imports}return (_ctx, $props, $setup) => (${declared}).style;`)(vue, serverRenderer) as (ctx: unknown, props: unknown, setup: unknown) => Vars;
  const setup = component.setup;
  component.setup = (props, ctx) => {
    const instance = vue.getCurrentInstance() as { proxy: unknown; props: unknown; setupState: unknown; getCssVars?: () => Vars } | null;
    if (instance && !instance.getCssVars) {
      instance.getCssVars = () => Object.fromEntries(Object.entries(vars(instance.proxy, instance.props, instance.setupState)).map(([k, v]) => [k.slice(3).replace(/\\(.)/g, "$1"), v]));
    }
    return setup?.(props, ctx);
  };
}
