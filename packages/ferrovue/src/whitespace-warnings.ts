import { ELEMENT, gaps, HTML, keeps, names, rootSource, trimsInside, type TemplateNode } from "./whitespace-rules.ts";

const PRESERVING_UTILITY = /^(?:[^\s:]+:)*whitespace-(?:pre|pre-wrap|pre-line|break-spaces)$/;

/** A place `"trim-edges"` renders as a formatter reads it, where the page may still show something
 * the template's author did not mean, or a `ferrovue-ignore` comment that silences nothing. */
export interface WhitespaceWarning {
  code: "FV0427" | "FV0428" | "FV0430";
  message: string;
  at: { line: number; column: number };
}

/** The template block's content, where its `ferrovue-ignore` comments are read. */
export interface TemplateText {
  source: string;
  start: { offset: number; line: number; column: number };
}

/** The codes a `ferrovue-ignore` comment can silence. */
const SILENCED = new Set(["FV0427"]);
const MARKER = /<!--\s*ferrovue-ignore(?=\s|-->)([\s\S]*?)-->/g;

/** A `ferrovue-ignore` comment: where it starts in the file, the codes it names, and those it has
 * silenced. */
interface Marker {
  offset: number;
  at: { line: number; column: number };
  codes: string[];
  used: Set<string>;
}

function markers(template: TemplateText): Marker[] {
  return [...template.source.matchAll(MARKER)].map((m) => {
    const before = template.source.slice(0, m.index);
    const lines = before.split("\n");
    const line = template.start.line + lines.length - 1;
    const column = lines.length === 1 ? template.start.column + before.length : lines.at(-1)!.length + 1;
    return { offset: template.start.offset + m.index, at: { line, column }, codes: m[1]!.trim().split(/\s+/).filter(Boolean), used: new Set<string>() };
  });
}

/** The marker between `prev` and `next` that names `code`, which then counts as used. */
function silenced(found: Marker[], prev: TemplateNode, next: TemplateNode, code: string): boolean {
  const marker = found.find((m) => m.offset >= prev.loc.end.offset && m.offset < next.loc.start.offset && m.codes.includes(code));
  marker?.used.add(code);
  return marker !== undefined;
}

function stale(found: Marker[], out: WhitespaceWarning[]): void {
  for (const m of found) {
    const fail = (message: string) => out.push({ code: "FV0430", message, at: m.at });
    if (m.codes.length === 0) fail("`ferrovue-ignore` names no warning: name the one it silences, as `<!-- ferrovue-ignore FV0427 -->`");
    for (const code of new Set(m.codes)) {
      if (!SILENCED.has(code)) fail(`\`ferrovue-ignore\` names \`${code}\`, which it does not silence: it silences ${[...SILENCED].join(", ")}`);
      else if (!m.used.has(code)) fail(`\`ferrovue-ignore ${code}\` stands before no line break that ${code} warns of: remove it, or move it between the two elements`);
    }
  }
}

/** What the warnings read from `ferrovue.config.json`. */
export interface WhitespaceWarningOptions {
  /** `preserveWhitespace.classes`. */
  classes: ReadonlySet<string>;
  /** `inlineBlockClasses`. */
  inlineBlock: ReadonlySet<string>;
}

const label = (node: TemplateNode): string => `\`<${node.tag}>\``;

function staticClasses(node: TemplateNode): string[] {
  return node.props!.flatMap((p) => (p.type === 6 && p.name === "class" && p.value ? p.value.content.split(/\s+/).filter(Boolean) : []));
}

function visit(node: TemplateNode, source: string, start: number, options: WhitespaceWarningOptions, marks: Marker[], out: WhitespaceWarning[]): void {
  const found = gaps(node, source, start);
  for (const { prev, next } of found) {
    const boxed = [prev, next].find((n) => n.type === ELEMENT && names(n, options.inlineBlock));
    if (boxed && !silenced(marks, prev, next, "FV0427")) {
      out.push({
        code: "FV0427",
        message: `the line break between ${label(prev)} and ${label(next)} renders as a space, which shows as a gap beside ${label(boxed)}, whose class makes it \`inline-block\`: hug the tags, \`</${prev.tag}\\n><${next.tag}>\`, where no space is meant, or write \`<!-- ferrovue-ignore FV0427 -->\` before ${label(next)} where it is`,
        at: next.loc.start,
      });
    }
  }
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT || keeps(child, options.classes)) continue;
    const unlisted = staticClasses(child).find((c) => PRESERVING_UTILITY.test(c) && !options.classes.has(c));
    if (unlisted !== undefined && trimsInside(child, options.classes)) {
      out.push({
        code: "FV0428",
        message: `\`${unlisted}\` sets a preserving \`white-space\` in Tailwind, and \`trim-edges\` trims the text of ${label(child)} all the same: list it in \`preserveWhitespace.classes\` in ferrovue.config.json`,
        at: child.loc.start,
      });
    }
    if (child.ns === HTML) visit(child, child.loc.source, child.loc.start.offset, options, marks, out);
  }
}

/** Where `"trim-edges"` renders the template whose root node is `root` as a formatter reads it,
 * and the page may still show what its author did not mean, less what a `ferrovue-ignore` comment
 * in `template` marks as meant; and each such comment that silences nothing. */
export function whitespaceWarnings(root: TemplateNode, template: TemplateText, options: WhitespaceWarningOptions): WhitespaceWarning[] {
  const out: WhitespaceWarning[] = [];
  const marks = markers(template);
  const [source, start] = rootSource(root);
  visit(root, source, start, options, marks, out);
  stale(marks, out);
  return out;
}
