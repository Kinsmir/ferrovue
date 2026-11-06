interface TemplateNode {
  type: number;
  tag?: string;
  tagType?: number;
  content?: unknown;
  props?: { type: number; name: string; value?: { content: string } }[];
  children?: TemplateNode[];
  loc: { source: string };
}

const ROOT = 0;
const ELEMENT = 1;
const TEXT = 2;
const PLAIN = 0;
const COMPONENT = 1;
const TEMPLATE = 3;
const LEADING = /^[ \t\n\f\r]+/;
const TRAILING = /[ \t\n\f\r]+$/;
const KEPT_TAGS = new Set(["pre", "textarea"]);
const PRE_STYLE = /(?:^|;)\s*white-space\s*:\s*(?:pre|pre-wrap|pre-line|break-spaces)\s*(?:!important\s*)?(?:;|$)/i;
const OPEN_TAG = /^<[^\s/>]+(?:[^"'>]|"[^"]*"|'[^']*')*/;
const QUOTED = /"[^"]*"|'[^']*'/g;
const V_PRE = /\sv-pre(?=[\s/=]|$)/;

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

function trimChildren(el: TemplateNode): void {
  const children = el.children!;
  const first = children[0];
  if (first?.type === TEXT) first.content = (first.content as string).replace(LEADING, "");
  const last = children.at(-1);
  if (last?.type === TEXT) last.content = (last.content as string).replace(TRAILING, "");
  el.children = children.filter((c) => c.type !== TEXT || c.content !== "");
}

function walk(node: TemplateNode): void {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT || keeps(child)) continue;
    if (trims(child)) trimChildren(child);
    walk(child);
  }
}

/** A node transform for `@vitejs/plugin-vue`'s `template.compilerOptions.nodeTransforms` that
 * trims the whitespace at the start and end of an element's text, where it meets the element's
 * tags, as `"whitespace": "trim-edges"` makes ferrovue's Rust render it. It trims the content of
 * elements, components and `<template v-slot>`, and leaves `<pre>`, `<textarea>`, `v-pre` and an
 * element whose `style` sets `white-space: pre`, `pre-wrap`, `pre-line` or `break-spaces` as they
 * are, with everything inside them. */
export function trimEdges(node: object): void {
  const n = node as TemplateNode;
  if (n.type === ROOT) walk(n);
}

Object.defineProperty(trimEdges, MARK, { value: "trim-edges" });
