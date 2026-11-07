interface Position {
  offset: number;
  line: number;
  column: number;
}

interface TemplateNode {
  type: number;
  ns?: number;
  tag?: string;
  tagType?: number;
  content?: unknown;
  props?: { type: number; name: string; value?: { content: string } }[];
  children?: TemplateNode[];
  loc: { source: string; start: Position; end: Position };
}

const ROOT = 0;
const ELEMENT = 1;
const TEXT = 2;
const PLAIN = 0;
const COMPONENT = 1;
const TEMPLATE = 3;
const LEADING = /^[ \t\n\f\r]+/;
const TRAILING = /[ \t\n\f\r]+$/;
const LINE_BREAK = /[\n\r]/;
const BLANK = /^[ \t\n\f\r]+$/;
const HTML = 0;
const SPACELESS_TAGS = new Set(
  [
    "address article aside blockquote body br caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form",
    "h1 h2 h3 h4 h5 h6 head header hgroup hr html legend li link listing main menu meta nav noscript ol optgroup option p param plaintext pre",
    "script search section source style summary table tbody td template tfoot th thead title tr track ul xmp area base basefont datalist noembed noframes rp",
  ]
    .join(" ")
    .split(" "),
);
const KEPT_TAGS = new Set(["pre", "textarea"]);
const PRE_STYLE = /(?:^|;)\s*white-space\s*:\s*(?:pre|pre-wrap|pre-line|break-spaces)\s*(?:!important\s*)?(?:;|$)/i;
const OPEN_TAG = /^<[^\s/>]+(?:[^"'>]|"[^"]*"|'[^']*')*/;
const QUOTED = /"[^"]*"|'[^']*'/g;
const V_PRE = /\sv-pre(?=[\s/=]|$)/;

const PLACELESS_COMPONENTS = new Set(["teleport", "keepalive", "suspense", "transition", "transitiongroup", "clientonly"]);

const MARK = Symbol.for("ferrovue.whitespace");

function keeps(el: TemplateNode): boolean {
  if (KEPT_TAGS.has(el.tag!.toLowerCase())) return true;
  if (el.props!.some((p) => p.type === 6 && p.name === "style" && p.value !== undefined && PRE_STYLE.test(p.value.content))) return true;
  const open = OPEN_TAG.exec(el.loc.source)?.[0] ?? "";
  return V_PRE.test(open.replace(QUOTED, '""'));
}

function trims(el: TemplateNode): boolean {
  if (el.tagType === PLAIN || el.tagType === COMPONENT) return true;
  return el.tagType === TEMPLATE && el.props!.some((p) => p.type === 7 && p.name === "slot");
}

function breaks(text: TemplateNode, edge: RegExp): boolean {
  return LINE_BREAK.test(edge.exec(text.loc.source)?.[0] ?? "");
}

function trimChildren(el: TemplateNode): void {
  const children = el.children!;
  const first = children[0];
  if (first?.type === TEXT && breaks(first, LEADING)) first.content = (first.content as string).replace(LEADING, "");
  const last = children.at(-1);
  if (last?.type === TEXT && breaks(last, TRAILING)) last.content = (last.content as string).replace(TRAILING, "");
  el.children = children.filter((c) => c.type !== TEXT || c.content !== "");
}

function inline(node: TemplateNode): boolean {
  if (node.type !== ELEMENT) return false;
  if (node.tagType === COMPONENT) return !PLACELESS_COMPONENTS.has(node.tag!.replaceAll("-", "").toLowerCase());
  if (node.tagType !== PLAIN) return false;
  const tag = node.tag!.toLowerCase();
  return (node.ns === HTML || tag === "svg" || tag === "math") && !SPACELESS_TAGS.has(tag);
}

function spaceInline(el: TemplateNode): void {
  if (el.ns !== HTML) return;
  const children = el.children!;
  const spaced: TemplateNode[] = [];
  children.forEach((child, i) => {
    const prev = children[i - 1];
    if (prev !== undefined && inline(prev) && inline(child)) {
      const start = el.loc.start.offset;
      const gap = el.loc.source.slice(prev.loc.end.offset - start, child.loc.start.offset - start);
      if (BLANK.test(gap) && LINE_BREAK.test(gap)) spaced.push({ type: TEXT, content: " ", loc: { source: gap, start: prev.loc.end, end: child.loc.start } });
    }
    spaced.push(child);
  });
  el.children = spaced;
}

function walk(node: TemplateNode): void {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT || keeps(child)) continue;
    if (trims(child)) trimChildren(child);
    spaceInline(child);
    walk(child);
  }
}

/** A node transform for `@vitejs/plugin-vue`'s `template.compilerOptions.nodeTransforms` that
 * trims the whitespace at the start and end of an element's text, where it meets the element's
 * tags, when that whitespace holds a line break, as `"whitespace": "trim-edges"` makes ferrovue's
 * Rust render it. A space typed on the same line as the tag stays. A line break between two
 * inline elements or components, such as `<span>` and `<a>`, renders as one space, as a formatter
 * reads it.
 * It trims the content of elements, components and `<template v-slot>`, and leaves `<pre>`, `<textarea>`, `v-pre` and an
 * element whose `style` sets `white-space: pre`, `pre-wrap`, `pre-line` or `break-spaces` as they
 * are, with everything inside them. */
export function trimEdges(node: object): void {
  const n = node as TemplateNode;
  if (n.type === ROOT) walk(n);
}

Object.defineProperty(trimEdges, MARK, { value: "trim-edges" });
