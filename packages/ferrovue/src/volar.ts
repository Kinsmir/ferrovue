import type { IR, SFCParseResult, VueLanguagePlugin, VueLanguagePluginReturn } from "@vue/language-core";
import { type Located, refusalsIn } from "./editor.ts";

/** What the plugin takes beside its name in `vueCompilerOptions.plugins`. */
export interface VolarOptions {
  /** The configuration file's path from the project root, `ferrovue.config.json` by default. */
  config?: string;
  /** `false` gives each error its code as plain text, with the docs link in the message, for an
   * editor that cannot follow a code's link. */
  codeLinks?: boolean;
}

type Block = { loc: { start: { offset: number }; end: { offset: number } }; type: string };
type Descriptor = SFCParseResult["descriptor"];
type Errors = SFCParseResult["errors"];

const SYNTAX = new Set(["FV0001", "FV0002"]);
const ours = new WeakSet<object>();

function inTypeScriptHost(): boolean {
  return /tsserver|vue-tsc/.test(process.argv[1] ?? "");
}

function htmlTemplate(d: Descriptor): Block | null {
  const t = d.template as Block & { lang?: string } | null;
  return t && (t.lang ?? "html") === "html" ? t : null;
}

function inside(offset: number, block: Block): boolean {
  return offset >= block.loc.start.offset && offset <= block.loc.end.offset;
}

function errorFor(r: Located, start: number, end: number, links: boolean, where = ""): Errors[number] {
  const text = `ferrovue: ${r.message}${where}${links ? "" : `\n${r.docs}`}`;
  const error = Object.assign(new SyntaxError(text), {
    code: links ? { value: r.code, target: r.docs } : r.code,
    loc: { start: { offset: start, line: 0, column: 0 }, end: { offset: end, line: 0, column: 0 }, source: "" },
  });
  ours.add(error);
  return error;
}

function outsideTemplate(d: Descriptor, source: string, r: Located, links: boolean): Errors[number] {
  const blocks = [d.template, d.script, d.scriptSetup, ...d.styles, ...d.customBlocks].filter((b): b is NonNullable<typeof b> => !!b) as Block[];
  const block = blocks.find((b) => inside(r.start, b));
  if (!block) return errorFor(r, r.start, r.end ?? r.start, links);
  const tagStart = source.lastIndexOf(`<${block.type}`, block.loc.start.offset);
  return errorFor(r, tagStart, block.loc.start.offset, links, ` (at ${r.line}:${r.column})`);
}

function refusals(fileName: string, text: string, options: VolarOptions): Located[] {
  return fileName.endsWith(".vue") ? refusalsIn(fileName, text, options).filter((r) => !SYNTAX.has(r.code)) : [];
}

/** A Vue language tools plugin that reports what ferrovue refuses in a component where the editor
 * shows Vue's own template errors: as an error on the construct, with its code linked to the docs.
 * Name it in `vueCompilerOptions.plugins` in `tsconfig.json`. */
const plugin: VueLanguagePlugin<VolarOptions> = (context) => {
  if (inTypeScriptHost()) return [];
  const options = context.config;
  const links = options.codeLinks !== false;
  const builtIn = context.modules["@vue/language-core"]
    .createPlugins({ ...context, vueCompilerOptions: { ...context.vueCompilerOptions, plugins: [] }, config: {} });
  const parsed = (fileName: string, languageId: string, content: string): SFCParseResult | undefined => {
    for (const p of builtIn) {
      const sfc = p.parseSFC2?.(fileName, languageId, content);
      if (sfc) return sfc;
    }
    return undefined;
  };
  const result: VueLanguagePluginReturn = {
    version: 2.2,
    name: "ferrovue",
    order: -1,
    parseSFC2(fileName, languageId, content) {
      if (languageId !== "vue") return undefined;
      const sfc = parsed(fileName, languageId, content);
      if (!sfc) return undefined;
      const template = htmlTemplate(sfc.descriptor);
      for (const r of refusals(fileName, content, options)) {
        if (!template || !inside(r.start, template)) sfc.errors.push(outsideTemplate(sfc.descriptor, content, r, links));
      }
      return sfc;
    },
    resolveEmbeddedCode(fileName, ir: IR, code) {
      if (code.id !== "template" || !ir.template) return;
      const { errors, startTagEnd, endTagStart } = ir.template;
      for (let i = errors.length - 1; i >= 0; i--) if (ours.has(errors[i]!)) errors.splice(i, 1);
      for (const r of refusals(fileName, ir.content, options)) {
        if (r.start < startTagEnd || r.start > endTagStart) continue;
        const start = r.start - startTagEnd;
        errors.push(errorFor(r, start, (r.end ?? r.start) - startTagEnd, links) as (typeof errors)[number]);
      }
    },
  };
  return result;
};

export default plugin;
export { plugin as "module.exports" };
