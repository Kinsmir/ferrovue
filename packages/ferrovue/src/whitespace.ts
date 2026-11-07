import { applyTrimEdges, ROOT, type TemplateNode } from "./whitespace-rules.ts";

const MARK = Symbol.for("ferrovue.whitespace");
const CLASSES = Symbol.for("ferrovue.whitespace.classes");

/** What `trimEdges` takes besides a template's nodes. */
export interface TrimEdgesOptions {
  /** The classes a stylesheet gives a preserving `white-space`, as `preserveWhitespace.classes`
   * in `ferrovue.config.json`: an element whose static `class`, or whose `:class` expression,
   * names one keeps its text and everything inside it. */
  classes?: readonly string[];
}

function transform(classes: ReadonlySet<string>): (node: object) => void {
  const run = (node: object): void => {
    const n = node as TemplateNode;
    if (n.type === ROOT) applyTrimEdges(n, classes);
  };
  Object.defineProperty(run, MARK, { value: "trim-edges" });
  Object.defineProperty(run, CLASSES, { value: [...classes].toSorted() });
  return run;
}

const plain = transform(new Set());

/** A node transform for `@vitejs/plugin-vue`'s `template.compilerOptions.nodeTransforms` that
 * trims the whitespace at the start and end of a block or inline-block element's text, where it
 * meets the element's tags, when that whitespace holds a line break, as `"whitespace": "trim-edges"`
 * makes ferrovue's Rust render it. An inline element's edges keep Vue's one space, and a space
 * typed on the same line as the tag stays. A line break between two inline elements, components,
 * `<slot>`s or `<template>`s, such as `<span>` and `<a>`, renders as one space, as a formatter
 * reads it, also at the template's root and across a comment.
 * It trims the content of block and inline-block elements, components and `<template v-slot>`, and
 * leaves `<pre>`, `<textarea>`, `v-pre` and an element whose `style` sets `white-space: pre`,
 * `pre-wrap`, `pre-line` or `break-spaces` as they are, with everything inside them.
 * Called with `{ classes }`, as `preserveWhitespace` in `ferrovue.config.json` names them, it
 * returns the transform that also leaves an element whose `class` or `:class` names one. */
export function trimEdges(options: TrimEdgesOptions): (node: object) => void;
export function trimEdges(node: object): void;
export function trimEdges(arg: object): ((node: object) => void) | undefined {
  if (typeof (arg as { type?: unknown }).type === "number") {
    plain(arg);
    return undefined;
  }
  return transform(new Set((arg as TrimEdgesOptions).classes ?? []));
}

Object.defineProperty(trimEdges, MARK, { value: "trim-edges" });
Object.defineProperty(trimEdges, CLASSES, { value: [] });
