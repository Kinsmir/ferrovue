import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { failIn, GenError } from "./model.ts";
import type { RouteEntry } from "./routes.ts";

/** A route as vue-router's file-based routing builds it from a folder of pages. */
export interface FileRoute {
  /** The path, relative to the parent's unless it starts with `/`. */
  path: string;
  /** The route's name, absent on a folder and on a `_parent.vue`. */
  name?: string;
  /** The page's `.vue` file, relative to the project root; absent on a folder, which only groups
   * the routes in it. */
  file?: string;
  /** The page's component name, from its file's path: `books/[id].vue` is `BooksId`. */
  component?: string;
  /** The routes nested in it. */
  children?: FileRoute[];
}

interface Node {
  raw: string;
  segment: string;
  parent: Node | null;
  children: Map<string, Node>;
  file: string | null;
  unnamed: boolean;
}

const STATIC = /^[A-Za-z0-9_-]+$/;
const PARAM = /^:\w+(?:\?|\(\.\*\))?$/;

function node(raw: string, segment: string, parent: Node | null): Node {
  return { raw, segment, parent, children: new Map(), file: null, unnamed: false };
}

function pageFiles(root: string, dir: string, under = ""): string[] {
  let entries;
  try {
    entries = readdirSync(join(root, dir, under), { withFileTypes: true });
  } catch {
    throw new GenError("FV1239", `cannot read the pages folder \`${dir}\``, { file: dir });
  }
  return entries
    .filter((e) => !e.name.startsWith("."))
    .flatMap((e) => {
      const rel = under ? `${under}/${e.name}` : e.name;
      if (e.isDirectory()) return pageFiles(root, dir, rel);
      return e.isFile() && e.name.endsWith(".vue") ? [rel] : [];
    })
    .toSorted();
}

function fileSegment(segment: string, file: string): string {
  let buffer = "";
  let state = 0;
  let path = "";
  let param = { name: "", optional: false, splat: false, repeatable: false };
  const unsupported = (why: string): never => failIn(file, "FV1240", `\`${segment}\` in the file's path: ${why}`);
  const consume = (): void => {
    if (state === 0) path += buffer;
    else if (state === 4) {
      if (param.repeatable) unsupported("a repeatable parameter (`+`) is not supported");
      if (param.optional && param.splat) unsupported("an optional catch-all (`[[...name]]`) is not supported");
      path += `:${buffer}${param.splat ? "(.*)" : ""}${param.optional ? "?" : ""}`;
      param = { name: "", optional: false, splat: false, repeatable: false };
    }
    buffer = "";
  };
  for (let pos = 0; pos < segment.length; pos++) {
    const c = segment[pos]!;
    if (state === 0) {
      if (c === "[") {
        if (buffer) consume();
        state = 1;
      } else buffer += c === "." ? "/" : c;
    } else if (state === 1) {
      if (c === "[") param.optional = true;
      else if (c === ".") {
        param.splat = true;
        pos += 2;
      } else buffer += c;
      state = 2;
    } else if (state === 2) {
      if (c === "]") {
        if (param.optional) pos++;
        state = 4;
      } else if (c === ".") {
        param.splat = true;
        pos += 2;
      } else if (c === "=") unsupported("a parameter parser (`[name=parser]`) is not supported");
      else if (c === "+" && buffer === "x" && !param.splat && !param.optional) unsupported("a character code (`[x+2E]`) is not supported");
      else buffer += c;
    } else {
      if (c === "+") param.repeatable = true;
      else pos--;
      consume();
      state = 0;
    }
  }
  if (state !== 0 && state !== 4) unsupported("a `[` is never closed");
  if (buffer) consume();
  const pieces = path.split("/");
  pieces.forEach((piece, i) => {
    if (!STATIC.test(piece) && !PARAM.test(piece)) {
      unsupported("each part of a route's path is letters, digits, `-` and `_`, or one whole parameter (`[id]`, `[[id]]`, `[...path]`)");
    }
    if (piece.endsWith("(.*)") && i < pieces.length - 1) unsupported("a catch-all (`[...name]`) is the last part of a path");
  });
  return path;
}

function segmentOf(raw: string, file: string): string {
  if (raw === "" || raw === "index") return "";
  if (/^\([^()]*\)$/.test(raw)) return "";
  return fileSegment(raw, file);
}

function insert(at: Node, parts: string[], file: string, isRoot: boolean): void {
  const [head, ...tail] = parts as [string, ...string[]];
  const view = head.indexOf("@");
  if (view > 0) failIn(file, "FV1241", "a named view (`name@view.vue`) is not supported: `<RouterView>` on the server shows the default view");
  if (head === "_parent" && !tail.length) {
    if (isRoot) failIn(file, "FV1244", "`_parent.vue` in the pages folder itself is not supported: put the layout in a folder beside the pages it holds");
    at.file = file;
    at.unnamed = true;
    return;
  }
  let child = at.children.get(head);
  if (!child) {
    child = node(head, segmentOf(head, file), at);
    at.children.set(head, child);
  }
  if (tail.length) insert(child, tail, file, false);
  else child.file = file;
}

function routePath(n: Node): string {
  return (n.parent?.parent === null ? "/" : "") + n.segment;
}

function routeName(n: Node): string {
  return n.parent ? `${routeName(n.parent)}/${n.raw === "index" ? "" : n.raw}` : "";
}

function sorted(n: Node): Node[] {
  return [...n.children.values()].toSorted((a, b) => routePath(a).localeCompare(routePath(b), "en") || a.raw.localeCompare(b.raw, "en"));
}

/** The name ferrovue gives a page's component: the PascalCase of its path in the pages folder. */
export function pageComponentName(rel: string): string {
  return rel
    .replace(/\.vue$/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

function checkSource(root: string, file: string): void {
  const source = readFileSync(join(root, file), "utf8");
  const { descriptor } = parseSfc(source, { filename: file });
  const block = descriptor.customBlocks.find((b) => b.type === "route");
  if (block) {
    const { line, column } = block.loc.start;
    throw new GenError("FV1243", `${file}:${line}:${column}: a \`<route>\` block changes the route vue-router builds from the page, which ferrovue builds from the file's path alone`, { file, line, column }, "a `<route>` block changes the route vue-router builds from the page, which ferrovue builds from the file's path alone");
  }
  for (const script of [descriptor.script, descriptor.scriptSetup]) {
    const found = script ? /\bdefinePage\s*\(/.exec(script.content) : null;
    if (!script || !found) continue;
    const offset = script.loc.start.offset + found.index;
    const before = source.slice(0, offset);
    const line = before.split("\n").length;
    const column = offset - before.lastIndexOf("\n");
    const what = "`definePage()` changes the route vue-router builds from the page, which ferrovue builds from the file's path alone";
    throw new GenError("FV1242", `${file}:${line}:${column}: ${what}`, { file, line, column }, what);
  }
}

/** The routes vue-router's file-based routing builds from the `.vue` files in `pages`, a folder
 * relative to `root`: `index.vue`, `[id].vue`, `[[id]].vue`, `[...path].vue`, `(group)` folders,
 * and a `name.vue` beside a `name/` folder as the layout of the routes in it. */
export function fileRoutes(root: string, pages: string): FileRoute[] {
  const dir = pages.replace(/\/+$/, "");
  const tree = node("", "", null);
  for (const rel of pageFiles(root, dir)) {
    const file = `${dir}/${rel}`;
    checkSource(root, file);
    insert(tree, rel.slice(0, -".vue".length).split("/"), file, true);
  }
  const record = (n: Node): FileRoute => {
    if (n.file && n.unnamed && !n.children.size) failIn(n.file, "FV1244", "`_parent.vue` is the layout of the pages beside it, and this folder has none");
    if (n.segment.endsWith("(.*)") && n.children.size) failIn(n.file ?? `${dir}/${routeName(n).slice(1)}`, "FV1240", "a catch-all (`[...name]`) is the last part of a path: it cannot hold other pages");
    const r: FileRoute = { path: routePath(n) };
    if (n.file && !n.unnamed) r.name = routeName(n);
    if (n.file) {
      r.file = n.file;
      r.component = pageComponentName(n.file.slice(dir.length + 1));
    }
    if (n.children.size) r.children = sorted(n).map(record);
    return r;
  };
  return sorted(tree).map(record);
}

/** The pages folder `ferrovue.config.json` names, as `routes: { "pages": "…" }`, at the top or in
 * `router`; `null` when the routes come from a file or there are none. */
export function pagesFolder(config: { routes?: unknown; router?: { routes?: unknown } }): string | null {
  const routes = config.router?.routes ?? config.routes;
  const pages = typeof routes === "object" && routes !== null ? (routes as { pages?: unknown }).pages : undefined;
  return typeof pages === "string" ? pages : null;
}

/** Every page in the routes, layouts and nested pages included. */
export function allPages(routes: FileRoute[]): FileRoute[] {
  return routes.flatMap((r) => [...(r.file ? [r] : []), ...allPages(r.children ?? [])]);
}

/** The routes as a routes file lists them, a folder marked as showing no view. */
export function routeEntries(routes: FileRoute[]): RouteEntry[] {
  return routes.map((r) => ({
    path: r.path,
    ...(r.name !== undefined ? { name: r.name } : {}),
    ...(r.file ? {} : { view: false }),
    ...(r.children ? { children: routeEntries(r.children) } : {}),
  }));
}
