import { ELEMENT, gaps, HTML, keeps, names, rootSource, type TemplateNode } from "./whitespace-rules.ts";

const PRESERVING_UTILITY = /^(?:[^\s:]+:)*whitespace-(?:pre|pre-wrap|pre-line|break-spaces)$/;

/** A place `"trim-edges"` renders as a formatter reads it, where the page may still show something
 * the template's author did not mean. */
export interface WhitespaceWarning {
  code: "FV0427" | "FV0428" | "FV0429";
  message: string;
  node: TemplateNode;
}

/** What the warnings read from `ferrovue.config.json`. */
export interface WhitespaceWarningOptions {
  /** `preserveWhitespace.classes`. */
  classes: ReadonlySet<string>;
  /** `inlineBlockClasses`. */
  inlineBlock: ReadonlySet<string>;
}

const directive = (node: TemplateNode, name: string): boolean => node.type === ELEMENT && node.props!.some((p) => p.type === 7 && p.name === name);
const label = (node: TemplateNode): string => `\`<${node.tag}>\``;

function staticClasses(node: TemplateNode): string[] {
  return node.props!.flatMap((p) => (p.type === 6 && p.name === "class" && p.value ? p.value.content.split(/\s+/).filter(Boolean) : []));
}

function chainsWithNoElse(node: TemplateNode): { first: TemplateNode; last: TemplateNode }[] {
  const chains: { first: TemplateNode; last: TemplateNode }[] = [];
  const children = node.children!.filter((c) => c.type === ELEMENT);
  for (let i = 0; i < children.length; i++) {
    if (!directive(children[i]!, "if")) continue;
    let j = i;
    while (j + 1 < children.length && (directive(children[j + 1]!, "else-if") || directive(children[j + 1]!, "else"))) j++;
    if (!directive(children[j]!, "else")) chains.push({ first: children[i]!, last: children[j]! });
    i = j;
  }
  return chains;
}

function visit(node: TemplateNode, source: string, start: number, options: WhitespaceWarningOptions, out: WhitespaceWarning[]): void {
  const found = gaps(node, source, start);
  for (const { prev, next } of found) {
    const boxed = [prev, next].find((n) => n.type === ELEMENT && names(n, options.inlineBlock));
    if (boxed) {
      out.push({
        code: "FV0427",
        message: `the line break between ${label(prev)} and ${label(next)} renders as a space, which shows as a gap beside ${label(boxed)}, whose class makes it \`inline-block\`: hug the tags, \`</${prev.tag}\\n><${next.tag}>\`, where no space is meant`,
        node: next,
      });
    }
  }
  for (const { first, last } of chainsWithNoElse(node)) {
    const before = found.find((g) => g.next === first);
    if (before && found.some((g) => g.prev === last)) {
      out.push({
        code: "FV0429",
        message: `the line breaks before and after this \`v-if\` both render as a space, so the text holds two spaces when no branch renders: hug the tags on one side, \`</${before.prev.tag}\\n><${first.tag} v-if>\`, to render one`,
        node: first,
      });
    }
  }
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT || keeps(child, options.classes)) continue;
    const unlisted = staticClasses(child).find((c) => PRESERVING_UTILITY.test(c) && !options.classes.has(c));
    if (unlisted !== undefined) {
      out.push({
        code: "FV0428",
        message: `\`${unlisted}\` sets a preserving \`white-space\` in Tailwind, and \`trim-edges\` trims the text of ${label(child)} all the same: list it in \`preserveWhitespace.classes\` in ferrovue.config.json`,
        node: child,
      });
    }
    if (child.ns === HTML) visit(child, child.loc.source, child.loc.start.offset, options, out);
  }
}

/** Where `"trim-edges"` renders the template whose root node is `root` as a formatter reads it,
 * and the page may still show what its author did not mean. */
export function whitespaceWarnings(root: TemplateNode, options: WhitespaceWarningOptions): WhitespaceWarning[] {
  const out: WhitespaceWarning[] = [];
  const [source, start] = rootSource(root);
  visit(root, source, start, options, out);
  return out;
}
