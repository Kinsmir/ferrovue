import { readFileSync } from "node:fs";
import { compileScript, compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import * as vue from "vue";
import type { Component } from "vue";
import * as serverRenderer from "vue/server-renderer";

function cssVarsNaming(file: string, component: Component, scopeId: string | undefined, first: string): { id: string; isProd: boolean } {
  const own = (component as { setup?: unknown }).setup;
  const setup = typeof own === "function" ? own.toString() : "";
  const key = /useCssVars\)?\(\s*\(?_ctx\)?\s*=>\s*\(\{\s*("(?:[^"\\]|\\.)*")/.exec(setup)?.[1];
  const name = key === undefined ? null : (JSON.parse(key) as string);
  const id = scopeId?.replace(/^data-v-/, "") ?? (name?.endsWith(`-${first}`) ? name.slice(0, -first.length - 1) : null);
  if (id === null || name === null) {
    throw new Error(`${file}: \`v-bind()\` in \`<style>\` needs the component as \`@vitejs/plugin-vue\` compiles it for development, or \`<style scoped>\``);
  }
  return { id, isProd: name !== `${id}-${first}` };
}

/** Give a component compiled for the browser the `ssrRender` its SSR build would have. */
export function attachSsrRender(file: string, name: string, component: Component): void {
  const { descriptor } = parseSfc(readFileSync(file, "utf8"), { filename: file });
  const script = descriptor.script || descriptor.scriptSetup ? compileScript(descriptor, { id: name }) : null;
  const scopeId = (component as { __scopeId?: string }).__scopeId;
  if (!scopeId && descriptor.styles.some((st) => st.scoped)) {
    throw new Error(`${file}: a \`<style scoped>\` component without \`__scopeId\`: load it through \`@vitejs/plugin-vue\``);
  }
  const vars = descriptor.cssVars.length ? cssVarsNaming(file, component, scopeId, descriptor.cssVars[0]!) : null;
  const { code } = compileTemplate({
    source: descriptor.template!.content,
    filename: file,
    id: scopeId ?? vars?.id ?? name,
    scoped: !!scopeId,
    slotted: descriptor.slotted,
    ssr: true,
    ssrCssVars: descriptor.cssVars,
    isProd: vars?.isProd ?? false,
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
