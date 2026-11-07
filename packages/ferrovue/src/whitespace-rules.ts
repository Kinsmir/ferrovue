import { SPACELESS_TAGS } from "./tags.ts";

interface Position {
  offset: number;
  line: number;
  column: number;
}

/** A node of Vue's template AST, as far as the whitespace rules read it. */
export interface TemplateNode {
  type: number;
  ns?: number;
  tag?: string;
  tagType?: number;
  content?: unknown;
  props?: { type: number; name: string; value?: { content: string }; arg?: { content?: string }; exp?: { content?: string; loc?: { source: string } } }[];
  children?: TemplateNode[];
  source?: string;
  loc: { source: string; start: Position; end: Position };
}

export const ROOT = 0;
export const ELEMENT = 1;
const TEXT = 2;
const COMMENT = 3;
const PLAIN = 0;
const COMPONENT = 1;
const SLOT = 2;
const TEMPLATE = 3;
const LEADING = /^[ \t\n\f\r]+/;
const TRAILING = /[ \t\n\f\r]+$/;
const LINE_BREAK = /[\n\r]/;
const BLANK = /^[ \t\n\f\r]+$/;
export const HTML = 0;
const INLINE_BLOCK_TAGS = new Set(["audio", "button", "meter", "object", "progress", "select", "video"]);
const COMMENTS = /<!--[\s\S]*?(?:-->|$)/g;
const KEPT_TAGS = new Set(["pre", "textarea"]);
const PRE_STYLE = /(?:^|;)\s*white-space\s*:\s*(?:pre|pre-wrap|pre-line|break-spaces)\s*(?:!important\s*)?(?:;|$)/i;
const OPEN_TAG = /^<[^\s/>]+(?:[^"'>]|"[^"]*"|'[^']*')*/;
const QUOTED = /"[^"]*"|'[^']*'/g;
const V_PRE = /\sv-pre(?=[\s/=]|$)/;

const PLACELESS_COMPONENTS = new Set(["teleport", "keepalive", "suspense", "transition", "transitiongroup", "clientonly"]);

const CLASS_TOKENS = /[^\s"'`,{}()[\]?+!&|=<>;]+/g;

/** Whether `el`'s static `class`, or a string or key of its `:class`, names one of `classes`. */
export function names(el: TemplateNode, classes: ReadonlySet<string>): boolean {
  if (classes.size === 0) return false;
  return el.props!.some((p) => {
    if (p.type === 6) return p.name === "class" && p.value !== undefined && p.value.content.split(/\s+/).some((c) => classes.has(c));
    if (p.type !== 7 || p.name !== "bind" || p.arg?.content !== "class") return false;
    const source = p.exp?.loc?.source ?? p.exp?.content ?? "";
    return (source.match(CLASS_TOKENS) ?? []).some((t) => classes.has(t) || classes.has(t.replace(/:$/, "")));
  });
}

/** Whether `trim-edges` leaves `el` and everything inside it as Vue spaces them. */
export function keeps(el: TemplateNode, classes: ReadonlySet<string>): boolean {
  if (KEPT_TAGS.has(el.tag!.toLowerCase())) return true;
  if (names(el, classes)) return true;
  if (el.props!.some((p) => p.type === 6 && p.name === "style" && p.value !== undefined && PRE_STYLE.test(p.value.content))) return true;
  const open = OPEN_TAG.exec(el.loc.source)?.[0] ?? "";
  return V_PRE.test(open.replace(QUOTED, '""'));
}

/** Whether `trim-edges` trims a line-break edge of `el`'s content. */
export function trims(el: TemplateNode): boolean {
  if (el.tagType === PLAIN) {
    const tag = el.tag!.toLowerCase();
    return el.ns !== HTML || SPACELESS_TAGS.has(tag) || INLINE_BLOCK_TAGS.has(tag);
  }
  if (el.tagType === COMPONENT) return true;
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

/** Whether a line break between `node` and an inline sibling renders as a space. */
export function inline(node: TemplateNode): boolean {
  if (node.type !== ELEMENT) return false;
  if (node.tagType === COMPONENT) return !PLACELESS_COMPONENTS.has(node.tag!.replaceAll("-", "").toLowerCase());
  if (node.tagType === SLOT) return true;
  if (node.tagType === TEMPLATE) return !node.props!.some((p) => p.type === 7 && p.name === "slot");
  if (node.tagType !== PLAIN) return false;
  const tag = node.tag!.toLowerCase();
  return (node.ns === HTML || tag === "svg" || tag === "math") && !SPACELESS_TAGS.has(tag);
}

/** Where a line break between two inline siblings of `node` renders as a space: each pair, with
 * the index in `node.children` of the sibling after which the space goes. `source` holds `node`'s
 * children at their offsets less `start`. */
export function gaps(node: TemplateNode, source: string, start: number): { prev: TemplateNode; next: TemplateNode; after: number }[] {
  const found: { prev: TemplateNode; next: TemplateNode; after: number }[] = [];
  let prev: TemplateNode | undefined;
  let after = -1;
  node.children!.forEach((child, i) => {
    if (child.type === COMMENT) return;
    if (prev !== undefined && inline(prev) && inline(child)) {
      const gap = source.slice(prev.loc.end.offset - start, child.loc.start.offset - start).replace(COMMENTS, "");
      if (BLANK.test(gap) && LINE_BREAK.test(gap)) found.push({ prev, next: child, after });
    }
    prev = child;
    after = i;
  });
  return found;
}

/** The text of the template `root` was parsed from, and the offset of its first character. */
export function rootSource(root: TemplateNode): [string, number] {
  return root.source === undefined ? [root.loc.source, root.loc.start.offset] : [root.source, 0];
}

function spaceInline(node: TemplateNode, source: string, start: number): void {
  const found = gaps(node, source, start);
  if (!found.length) return;
  const spaced = [...node.children!];
  for (const { prev, next, after } of found.toReversed()) spaced.splice(after + 1, 0, { type: TEXT, content: " ", loc: { source: " ", start: prev.loc.end, end: next.loc.start } });
  node.children = spaced;
}

/** Apply `trim-edges` to the template whose root node is `root`. */
export function applyTrimEdges(root: TemplateNode, classes: ReadonlySet<string>): void {
  const [source, start] = rootSource(root);
  spaceInline(root, source, start);
  walk(root, classes);
}

function walk(node: TemplateNode, classes: ReadonlySet<string>): void {
  for (const child of node.children ?? []) {
    if (child.type !== ELEMENT || keeps(child, classes)) continue;
    if (trims(child)) trimChildren(child);
    if (child.ns === HTML) spaceInline(child, child.loc.source, child.loc.start.offset);
    walk(child, classes);
  }
}

