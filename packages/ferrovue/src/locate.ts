import { parse as parseJs } from "@babel/parser";
import { type ErrorCode, type SourceLocation, GenError } from "./errors.ts";
import { type Component, type N } from "./model.ts";

/** Refuse something in a file that has no source to quote, as a locale or routes file. */
export function failIn(file: string, code: ErrorCode, what: string, help: string | null = null): never {
  throw new GenError(code, `${file}: ${what}`, { file }, what, help);
}

export type Origin = "source" | "template";

export function tagAst(node: N, origin: Origin, seen: WeakSet<object> = new WeakSet()): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) tagAst(n, origin, seen);
    return;
  }
  if (typeof node.type === "string") node.__fv = origin;
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "__fv") continue;
    const v = node[key];
    if (v && typeof v === "object") tagAst(v, origin, seen);
  }
}

/** Vue's compiled template, parsed and tagged, with `$props['x']`, which Vue writes for a renamed
 * destructured prop, read as `$props.x`. */
export function templateAst(ssr: string): N {
  const program = parseJs(ssr, { sourceType: "module" }).program;
  tagAst(program, "template");
  propsByName(program);
  return program;
}

function propsByName(node: N): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) propsByName(n);
    return;
  }
  const { object, property } = node.type === "MemberExpression" && node.computed ? node : {};
  if (object?.type === "Identifier" && object.name === "$props" && property.type === "StringLiteral") {
    node.computed = false;
    node.property = { type: "Identifier", name: property.value, start: property.start, end: property.end, loc: property.loc, __fv: property.__fv };
  }
  for (const key of Object.keys(node)) if (key !== "loc") propsByName(node[key]);
}

function locate(comp: Component, node: N): { line: number; column: number } | null {
  const start = node?.loc?.start;
  if (!start) return null;
  if (node.__fv === "source") return { line: start.line, column: start.column };
  if (node.__fv === "template" && comp.templateMap && comp.templateStart) {
    const o = comp.templateMap.originalPositionFor({ line: start.line, column: start.column });
    if (o.line == null || o.column == null) return locateWithin(comp, node) ?? locate(comp, written(comp, node));
    const t = comp.templateStart;
    return o.line === 1 ? { line: t.line, column: t.column - 1 + o.column } : { line: t.line + o.line - 1, column: o.column };
  }
  return null;
}

/** The local of a render that holds its refusals, a `fv::render::Refusals`. */
export const REFUSALS = "fv_refusals";

/** Where `node` starts in the component's file, as `fv::render::Refusals::keep` takes it: `line, column`,
 * from 1, or `0, 0` where it is not known. */
export function refusalAt(comp: Component, node: N | undefined): string {
  const at = node ? locate(comp, node) : null;
  return at ? `${at.line}, ${at.column + 1}` : "0, 0";
}

/** `call`, a runtime call that returns a `Result` with a `fv::render::Refused`, as a value: the render
 * holds the refusal and goes on with a placeholder, and returns it once it is done. */
export function kept(call: string, at: string): string {
  return `${REFUSALS}.keep(${call}, ${at})`;
}

function locateWithin(comp: Component, node: N): { line: number; column: number } | null {
  const start = node.loc.start;
  const inner = Object.entries(node)
    .filter(([k, v]) => k !== "loc" && v && typeof v === "object")
    .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
    .filter((c: N) => c?.loc?.start)
    .toSorted((a: N, b: N) => a.start - b.start);
  for (const child of inner) {
    const at = locate(comp, child);
    if (!at) continue;
    const c = child.loc.start;
    const back = c.line === start.line ? c.column - start.column : 0;
    return { line: at.line, column: Math.max(0, at.column - back) };
  }
  return null;
}

export function sourceAt(source: string, offset: number): N {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  return { type: "VueSource", loc: { start: { line, column: offset - before.lastIndexOf("\n") - 1 } }, __fv: "source" };
}

const plain = (name: string): string => name.replace(/[-_]/g, "").toLowerCase();

function assetName(n: N, prefix: RegExp): string | null {
  if (n?.type === "Identifier") return n.name.replace(prefix, "");
  if (n?.type === "MemberExpression") return n.computed ? n.property.value : n.property.name;
  return null;
}

function written(comp: Component, node: N): N {
  const call = node.type === "VariableDeclaration" ? node.declarations[0]?.init : node.type === "ExpressionStatement" ? node.expression : node;
  const callee = call?.type === "CallExpression" && call.callee.type === "Identifier" ? (call.callee.name as string) : null;
  const tagged = (name: string | null): N => name && templateNode(comp, (el) => (plain(el.tag) === plain(name) ? el : null));
  const directive = (name: string | null): N => name && templateNode(comp, (el) => el.props.find((p: N) => p.type === 7 && plain(p.name) === plain(name)));
  switch (callee) {
    case "_ssrRenderComponent": {
      const name = assetName(call.arguments[0], /^_component_/);
      return tagged(name) ?? (name === null ? null : isAttribute(comp, (value) => value.startsWith("vue:") && plain(value.slice(4)) === plain(name), true));
    }
    case "_resolveComponent":
      return tagged(call.arguments[0]?.value ?? null);
    case "_resolveDirective":
      return directive(call.arguments[0]?.value ?? null);
    case "_ssrGetDirectiveProps":
      return directive(assetName(call.arguments[1], /^_directive_/)?.replace(/^v(?=[A-Z])/, "") ?? null);
    case "_ssrRenderSlot": {
      const name = call.arguments[1]?.value;
      return templateNode(comp, (el) => (el.tag === "slot" && (el.props.find((p: N) => p.type === 6 && p.name === "name")?.value?.content ?? "default") === name ? el : null));
    }
    default:
      return null;
  }
}

function covering(comp: Component, node: N): ((loc: N) => boolean) | null {
  const at = locate(comp, node);
  if (!at) return null;
  const pos = [at.line, at.column + 1];
  const before = (a: number[], b: number[]): boolean => a[0]! < b[0]! || (a[0] === b[0] && a[1]! <= b[1]!);
  return (loc: N): boolean => before([loc.start.line, loc.start.column], pos) && before(pos, [loc.end.line, loc.end.column]);
}

/** The element of the template whose `v-html` compiled to `node`, with the nodes around it, the nearest first. */
export function vHtmlElement(comp: Component, node: N): { el: N; around: N[] } | null {
  const within = covering(comp, node);
  if (!within || !comp.templateAst) return null;
  const visit = (n: N, around: N[]): { el: N; around: N[] } | null => {
    if (n.type === 1 && n.props.some((p: N) => p.type === 7 && p.name === "html" && within(p.loc))) return { el: n, around };
    for (const c of n.children ?? []) {
      const found = visit(c, [n, ...around]);
      if (found) return found;
    }
    return null;
  };
  return visit(comp.templateAst, []);
}

/** The template element holding the directive the compiled `node` came from. */
export function directiveOwner(comp: Component, node: N): N {
  const within = covering(comp, node);
  if (!within || !comp.templateAst) return null;
  const visit = (n: N): N => {
    if (n.type === 1 && n.props.some((p: N) => p.type === 7 && within(p.loc))) return n;
    for (const c of n.children ?? []) {
      const found = visit(c);
      if (found) return found;
    }
    return null;
  };
  return visit(comp.templateAst);
}

/** Where the template's first static `is` attribute whose value `test` takes is written, or where
 * its element starts with `element`. */
export function isAttribute(comp: Component, test: (value: string) => boolean, element = false): N {
  const found = templateNode(comp, (el) => {
    const is = el.props.find((p: N) => p.type === 6 && p.name === "is" && p.value !== undefined && test(p.value.content));
    return is === undefined ? null : element ? el : is;
  });
  return found;
}

function templateNode(comp: Component, test: (el: N) => N): N {
  const visit = (n: N): N => {
    const found = n.type === 1 ? test(n) : null;
    if (found) return found;
    for (const c of n.children ?? []) {
      const inner = visit(c);
      if (inner) return inner;
    }
    return null;
  };
  const found = comp.templateAst ? visit(comp.templateAst) : null;
  return found && { type: "VueTemplate", loc: { start: { line: found.loc.start.line, column: found.loc.start.column - 1 } }, __fv: "source" };
}

function snippet(comp: Component, at: { line: number; column: number }): string {
  const text = comp.source?.split("\n")[at.line - 1];
  if (text === undefined) return "";
  const n = String(at.line);
  const lead = text.slice(0, at.column).replace(/[^\t]/g, " ");
  return `\n ${n} | ${text}\n ${" ".repeat(n.length)} | ${lead}^`;
}

function locateEnd(node: N): { endLine: number; endColumn: number } | null {
  const end = node?.__fv === "source" ? node.loc?.end : null;
  return end ? { endLine: end.line, endColumn: end.column + 1 } : null;
}

/** Where `node` is in the component. */
export function placeOf(comp: Component, node: N): SourceLocation {
  const at = locate(comp, node);
  return at ? { file: comp.file, line: at.line, column: at.column + 1 } : { file: comp.file };
}

export function fail(comp: Component, code: ErrorCode, what: string, node?: N, help: string | null = null): never {
  const at = locate(comp, node);
  if (!at) throw new GenError(code, `${comp.file}: ${what}`, { file: comp.file }, what, help);
  const where = { file: comp.file, line: at.line, column: at.column + 1, ...locateEnd(node) };
  throw new GenError(code, `${comp.file}:${at.line}:${at.column + 1}: ${what}${snippet(comp, at)}`, where, what, help);
}
