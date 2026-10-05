import { type Component, type N, fail, vHtmlElement } from "./model.ts";

const ELEMENT = 0;
const SLOT = 2;
const TEMPLATE = 3;
const HTML_NS = 0;
const SVG_NS = 1;
const MATHML_NS = 2;

const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr", "colgroup"]);
const SELECT_PARTS = new Set(["select", "optgroup"]);
const SVG_HOLDS_HTML = new Set(["foreignObject", "desc", "title"]);
const MATHML_HOLDS_HTML = new Set(["mi", "mo", "mn", "ms", "mtext"]);
const HTML_ENCODINGS = new Set(["text/html", "application/xhtml+xml"]);
const BUTTON_SCOPE = new Set(["applet", "button", "caption", "html", "marquee", "object", "table", "td", "th", "template"]);

function mathHoldsHtml(el: N): boolean {
  if (el.tag !== "annotation-xml") return MATHML_HOLDS_HTML.has(el.tag);
  const encoding: string | undefined = el.props.find((p: N) => p.type === 6 && p.name === "encoding")?.value?.content;
  return encoding !== undefined && HTML_ENCODINGS.has(encoding.toLowerCase());
}

function rebuilt(el: N): string | null {
  if (el.ns === HTML_NS && TABLE_PARTS.has(el.tag)) {
    return `the browser moves markup written in a \`<${el.tag}>\` out of the table; put \`v-html\` on a \`<td>\`, \`<th>\` or \`<caption>\``;
  }
  if (el.ns === HTML_NS && SELECT_PARTS.has(el.tag)) {
    return `the browser drops the tags written in a \`<${el.tag}>\`; write the \`<option>\`s in the template`;
  }
  if (el.ns === SVG_NS && !SVG_HOLDS_HTML.has(el.tag)) {
    return `an HTML tag written in an SVG \`<${el.tag}>\` ends the SVG where the browser reads it; put \`v-html\` on an HTML element inside a \`<foreignObject>\``;
  }
  if (el.ns === MATHML_NS && !mathHoldsHtml(el)) {
    return `an HTML tag written in a MathML \`<${el.tag}>\` ends the MathML where the browser reads it; put \`v-html\` on an \`<mtext>\``;
  }
  return null;
}

function paragraphAround(el: N, around: N[]): N | null {
  for (const p of [el, ...around]) {
    if (p.type !== 1 || p.tagType === TEMPLATE || p.tagType === SLOT) continue;
    if (p.tagType !== ELEMENT || p.ns !== HTML_NS) return null;
    if (p.tag === "p") return p;
    if (BUTTON_SCOPE.has(p.tag)) return null;
  }
  return null;
}

/** Refuse a `v-html` the browser would read differently from how the server wrote it: on an element
 * whose markup the HTML parser moves or drops, or inside a `<p>` with HTML that is not `InlineHtml`. */
export function checkVHtmlPlacement(comp: Component, node: N, inline: boolean): void {
  const found = vHtmlElement(comp, node);
  if (!found || found.el.tagType !== ELEMENT) return;
  const why = rebuilt(found.el);
  if (why !== null) fail(comp, "FV1512", `\`v-html\` on \`<${found.el.tag}>\`, whose HTML the browser does not keep as the server writes it: ${why}`, node);
  if (inline) return;
  const p = paragraphAround(found.el, found.around);
  if (p !== null) {
    fail(
      comp,
      "FV1513",
      `\`v-html\` ${p === found.el ? "on" : "inside"} a \`<p>\` of HTML that may hold a block (\`<p>\`, \`<ul>\`, \`<div>\`), which ends the \`<p>\` where the browser reads it: type the prop \`InlineHtml\` from \`ferrovue/types\` (\`ferrovue::InlineHtml\` on the server, which keeps inline tags only), or use a \`<div>\``,
      node,
    );
  }
}
