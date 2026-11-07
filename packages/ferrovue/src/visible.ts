import { SPACELESS_TAGS } from "./tags.ts";

const TOKENS = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][^\s/>]*)(?:[^"'>]|"[^"]*"|'[^']*')*>|[^<]+|</g;
const HIDDEN = new Set(["script", "style", "template", "head", "title", "noscript"]);
const KEPT = new Set(["pre", "textarea", "listing", "plaintext", "xmp"]);
const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const BREAK = "\u0000";
const KEPT_SPACE = "\u0001";

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** The text a browser shows for `html`, read from tag names alone: each block, list, table and
 * head element and each `<br>` starts a line, runs of whitespace show as one space, whitespace at
 * the start and end of a line does not show, and `<pre>` and `<textarea>` keep theirs. Comments,
 * scripts, styles and `<template>` show nothing. A stylesheet is not read, so an element it makes
 * block, flex or grid counts as inline. */
export function visibleText(html: string): string {
  let out = "";
  let hidden = 0;
  let kept = 0;
  for (const m of html.matchAll(TOKENS)) {
    const token = m[0];
    if (token.startsWith("<!--")) continue;
    const tag = m[2]?.toLowerCase();
    if (tag !== undefined) {
      const closing = m[1] === "/";
      if (HIDDEN.has(tag)) hidden += closing ? (hidden > 0 ? -1 : 0) : token.endsWith("/>") ? 0 : 1;
      if (KEPT.has(tag)) kept += closing ? (kept > 0 ? -1 : 0) : 1;
      if (SPACELESS_TAGS.has(tag) && !HIDDEN.has(tag) && hidden === 0) out += BREAK;
      continue;
    }
    if (hidden > 0) continue;
    const text = decode(token);
    out += kept > 0 ? text.replace(/ /g, KEPT_SPACE).replace(/\r?\n/g, BREAK) : text.replace(/[ \t\n\f\r]+/g, " ");
  }
  return out
    .split(BREAK)
    .map((line) => line.replace(/^ +| +$/g, ""))
    .filter((line) => line !== "")
    .join("\n")
    .replaceAll(KEPT_SPACE, " ");
}
