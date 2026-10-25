import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const SITE_URL = "https://kinsmir.github.io/ferrovue/";
export const REPOSITORY = "https://github.com/Kinsmir/ferrovue";
export const DOCS_RS = "https://docs.rs/ferrovue/latest/ferrovue/";

const GUIDE_DIR = "crates/ferrovue/docs/guide";
const GUIDE_RS = "crates/ferrovue/src/guide.rs";
const CRATE_MD = "crates/ferrovue/docs/crate.md";
const GROUP_LABELS = ["Guide", "Porting and support", "Upgrading"];
const TITLES: Record<string, string> = {
  i18n: "vue-i18n",
  head: "Page head",
  provide_inject: "Provide and inject",
};
const RUST_ATTRIBUTES = new Set(["rust", "ignore", "no_run", "compile_fail", "should_panic", "test_harness", "standalone_crate"]);

/** A page of the site generated from a Markdown file of the repository. */
export interface Page {
  name: string;
  slug: string;
  title: string;
  source: string;
}

/** A group of guide pages in the order guide.rs lists them. */
export interface Group {
  label: string;
  pages: Page[];
}

type Scope = "crate" | "guide";

/** The rustdoc heading id of a heading's text. */
export function slugify(text: string): string {
  let id = "";
  for (const c of text) {
    if (/^[\p{L}\p{N}_-]$/u.test(c)) id += c.codePointAt(0)! < 128 ? c.toLowerCase() : c;
    else if (/^\s$/.test(c) && c.codePointAt(0)! < 128) id += "-";
  }
  return id;
}

export function pageSlug(name: string): string {
  return name.replaceAll("_", "-");
}

export function pageTitle(name: string): string {
  const upgrade = /^upgrading_to_(\d+)_(\d+)$/.exec(name);
  if (upgrade) return `Upgrading to ${upgrade[1]}.${upgrade[2]}`;
  const words = TITLES[name] ?? name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function docLines(guideRs: string): string[] {
  const lines: string[] = [];
  for (const line of guideRs.split("\n")) {
    const inner = /^\/\/!\s?(.*)$/.exec(line);
    const attribute = /^\s*doc = "(.*)"\s*$/.exec(line);
    if (inner) lines.push(inner[1]!);
    else if (attribute) lines.push(attribute[1]!.replaceAll('\\"', '"'));
  }
  return lines;
}

/** The guide's pages, grouped and ordered as the module documentation of guide.rs lists them. */
export function guideGroups(guideRs: string): Group[] {
  const groups: Group[] = [];
  for (const text of docLines(guideRs)) {
    const item = /^(?:\d+\.|-)\s+\[`(\w+)`\]/.exec(text);
    if (item) {
      const name = item[1]!;
      const group = groups.at(-1);
      if (!group) throw new Error(`${GUIDE_RS} lists ${name} before any group`);
      group.pages.push({ name, slug: pageSlug(name), title: pageTitle(name), source: `${GUIDE_DIR}/${name}.md` });
    } else if (text.trimEnd().endsWith(":") && !/^\s/.test(text)) {
      const label = GROUP_LABELS[groups.length];
      if (!label) throw new Error(`${GUIDE_RS} has more groups of pages than the site names`);
      groups.push({ label, pages: [] });
    }
  }
  if (groups.length !== GROUP_LABELS.length) throw new Error(`${GUIDE_RS} has ${groups.length} groups of pages, the site names ${GROUP_LABELS.length}`);
  return groups;
}

/** The guide's groups read from the repository, checked against the guide's directory. */
export function readGuide(root = ROOT): Group[] {
  const groups = guideGroups(readFileSync(join(root, GUIDE_RS), "utf8"));
  const listed = new Set(groups.flatMap((g) => g.pages.map((p) => p.name)));
  const files = readdirSync(join(root, GUIDE_DIR)).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
  for (const f of files) if (!listed.has(f)) throw new Error(`${GUIDE_DIR}/${f}.md is not listed in ${GUIDE_RS}`);
  for (const name of listed) if (!files.includes(name)) throw new Error(`${GUIDE_RS} lists ${name}, which has no file in ${GUIDE_DIR}`);
  return groups;
}

/** The sidebar of the guide's pages. */
export function sidebar(groups: Group[]) {
  return [
    { text: "Introduction", items: [{ text: "Overview", link: "/guide/overview" }, { text: "Reading order", link: "/guide/" }] },
    ...groups.map((g) => ({ text: g.label, items: g.pages.map((p) => ({ text: p.title, link: `/guide/${p.slug}` })) })),
  ];
}

type Kind = "struct" | "enum" | "trait" | "fn" | "type" | "constant" | "static" | "macro" | "mod";

/** Where each item of the crate's API is documented on docs.rs, by path from the crate root. */
export class Items {
  readonly #kinds = new Map<string, Kind>();
  readonly #required = new Set<string>();

  static read(root = ROOT): Items {
    const items = new Items();
    for (const [crate, prefix] of [["ferrovue", ""], ["ferrovue-core", "core::"], ["ferrovue-router", "router::"], ["ferrovue-i18n", "i18n::"]] as const) {
      const src = join(root, "crates", crate, "src");
      const lib = readFileSync(join(src, "lib.rs"), "utf8");
      const modules = new Set([...lib.matchAll(/^pub mod (\w+);/gm)].map((m) => m[1]!));
      for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".rs")) continue;
        const source = readFileSync(join(src, file), "utf8");
        const module = file.replace(/\\/g, "/").replace(/(\/mod)?\.rs$/, "");
        if (module === "lib") items.scan(source, prefix);
        else if (modules.has(module)) items.scan(source, `${prefix}${module}::`);
      }
    }
    return items;
  }

  scan(source: string, prefix = ""): void {
    const order: Kind[] = ["mod", "macro", "struct", "enum", "trait", "type", "constant", "static", "fn"];
    const add = (name: string, kind: Kind) => {
      const key = kind === "macro" ? name : prefix + name;
      const known = this.#kinds.get(key);
      if (!known || order.indexOf(kind) < order.indexOf(known)) this.#kinds.set(key, kind);
    };
    let trait: string | null = null;
    for (const line of source.split("\n")) {
      const declared = /^\s*pub(?:\([^)]*\))?\s+(?:const\s+|async\s+|unsafe\s+)*(struct|enum|trait|fn|type|const|static|mod)\s+(\w+)/.exec(line);
      if (declared) {
        const kind = declared[1] === "const" ? "constant" : (declared[1] as Kind);
        add(declared[2]!, kind);
        if (kind === "trait") trait = declared[2]!;
      }
      const exported = /^\s*macro_rules!\s+(\w+)/.exec(line);
      if (exported) add(`${exported[1]}!`, "macro");
      const alias = /^\s*pub use \w+ as (\w+);/.exec(line);
      if (alias) add(alias[1]!, "mod");
      const method = /^\s*fn\s+(\w+)[^{]*;\s*$/.exec(line);
      if (trait && method) this.#required.add(`${prefix}${trait}::${method[1]}`);
      if (line.startsWith("}")) trait = null;
    }
  }

  /** The docs.rs URL of `path`, such as `Html::render_to` or `i18n::Args`. */
  url(path: string): string | null {
    const segments = path.replace(/\(\)$/, "").split("::");
    let dir = "";
    while (segments.length > 1 && this.#kinds.get(dir.replaceAll("/", "::") + segments[0]) === "mod") {
      dir += `${segments.shift()}/`;
    }
    const scope = dir.replaceAll("/", "::");
    const [name, member] = segments;
    if (!name || segments.length > 2) return null;
    const macro = name.endsWith("!");
    const kind = this.#kinds.get(scope + name);
    if (!kind) return null;
    if (kind === "mod") return `${DOCS_RS}${dir}${name}/index.html`;
    const page = `${DOCS_RS}${dir}${kind}.${macro ? name.slice(0, -1) : name}.html`;
    if (!member) return page;
    const anchor = /^[A-Z][A-Z0-9_]*$/.test(member) ? "associatedconstant" : this.#required.has(`${scope}${name}::${member}`) ? "tymethod" : "method";
    return `${page}#${anchor}.${member}`;
  }
}

function link(target: string, items: Items, from: string, guide: Set<string>): string {
  const [path, anchor] = target.split("#") as [string, string | undefined];
  const hash = anchor ? `#${anchor}` : "";
  const local = path.replace(/^(?:crate|ferrovue)(?:::|$)/, "");
  if (local === "") return `./overview.md${hash}`;
  if (local === "guide") return `./index.md${hash}`;
  const page = /^guide::(\w+)$/.exec(local);
  if (page) {
    if (!guide.has(page[1]!)) throw new Error(`${from}: no guide page ${page[1]} for the link to ${target}`);
    return `./${pageSlug(page[1]!)}.md${hash}`;
  }
  const url = items.url(local);
  if (!url) throw new Error(`${from}: no item of the crate for the link to ${target}`);
  return url + (anchor && !url.includes("#") ? hash : "");
}

function rewriteLinks(line: string, items: Items, from: string, guide: Set<string>, scope: Scope): string {
  const explicit = line
    .replace(/\]\(https:\/\/docs\.rs\/ferrovue\/latest\/ferrovue\/guide\/(\w+)\/index\.html(#[^)\s]*)?\)/g, (whole, name: string, hash?: string) =>
      guide.has(name) ? `](./${pageSlug(name)}.md${hash ?? ""})` : whole,
    )
    .replace(/\]\(((?:crate|ferrovue)(?:::[^)\s#]+)?(?:#[^)\s]*)?)\)/g, (_, target: string) => `](${link(target, items, from, guide)})`);
  return explicit.replace(/\[`([\w:]+!?)`\](?![([:])/g, (whole, name: string) => {
    if (scope === "guide" && guide.has(name)) return `[\`${name}\`](./${pageSlug(name)}.md)`;
    if (scope === "guide") return whole;
    const url = items.url(name);
    if (!url) throw new Error(`${from}: no item of the crate for the link [\`${name}\`]`);
    return `[\`${name}\`](${url})`;
  });
}

/** Rustdoc Markdown as VitePress reads it: hidden doctest lines removed, fences named, links rewritten, headings one level down. */
export function transform(markdown: string, options: { items: Items; from: string; guide: Set<string>; scope?: Scope; demote?: boolean }): string {
  const { items, from, guide, scope = "guide", demote = true } = options;
  const out: string[] = [];
  let fence: { indent: string; marker: string; rust: boolean } | null = null;
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const opening = /^(\s*)(`{3,}|~{3,})\s*([^`]*)$/.exec(line);
    if (!fence && opening) {
      const tokens = opening[3]!.split(",").map((t) => t.trim()).filter(Boolean);
      const rust = tokens.every((t) => RUST_ATTRIBUTES.has(t) || /^edition\d+$/.test(t));
      fence = { indent: opening[1]!, marker: opening[2]!, rust };
      out.push(`${opening[1]}${opening[2]}${rust ? "rust" : tokens[0]}`);
      continue;
    }
    if (fence) {
      const trimmed = line.trim();
      if (trimmed.startsWith(fence.marker) && /^(`+|~+)$/.test(trimmed) && trimmed[0] === fence.marker[0]) {
        out.push(line);
        fence = null;
      } else if (fence.rust && (trimmed === "#" || trimmed.startsWith("# "))) {
        continue;
      } else if (fence.rust && trimmed.startsWith("##")) {
        out.push(line.replace("##", "#"));
      } else {
        out.push(line);
      }
      continue;
    }
    const heading = /^(#{1,5}) /.exec(line);
    const prose = rewriteLinks(line, items, from, guide, scope);
    out.push(heading && demote ? `#${prose}` : prose);
  }
  if (fence) throw new Error(`${from}: a code block is never closed`);
  return out.join("\n");
}

/** The first paragraph of rustdoc Markdown as plain text, for a page's description. */
export function description(markdown: string): string {
  const paragraph = markdown.replaceAll("\r\n", "\n").trim().split(/\n\s*\n/)[0] ?? "";
  const text = paragraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 200) return text;
  const sentence = /^.*?[.:](?=\s)/.exec(text)?.[0];
  return (sentence ?? text.slice(0, 200)).replace(/:$/, ".");
}

/** A generated page: frontmatter, a heading, and the body kept out of Vue's template compiler. */
export function pageFile(options: { title: string; description: string; source: string; body: string; heading?: boolean }): string {
  const { title, source, body, heading = true } = options;
  const frontmatter = [`title: ${JSON.stringify(title)}`, `description: ${JSON.stringify(options.description)}`, `source: ${JSON.stringify(source)}`];
  return `---\n${frontmatter.join("\n")}\n---\n\n${heading ? `# ${title}\n\n` : ""}::: v-pre\n${body.trim()}\n:::\n`;
}

/** The pages the build writes, by their path in the site's source directory. */
export function generate(root = ROOT): Map<string, string> {
  const groups = readGuide(root);
  const items = Items.read(root);
  const guide = new Set(groups.flatMap((g) => g.pages.map((p) => p.name)));
  const files = new Map<string, string>();
  for (const p of groups.flatMap((g) => g.pages)) {
    const source = readFileSync(join(root, p.source), "utf8");
    files.set(`guide/${p.slug}.md`, pageFile({ title: p.title, description: description(source), source: p.source, body: transform(source, { items, from: p.source, guide }) }));
  }
  const crate = readFileSync(join(root, CRATE_MD), "utf8");
  files.set("guide/overview.md", pageFile({ title: "Overview", description: description(crate), source: CRATE_MD, body: transform(crate, { items, from: CRATE_MD, guide, scope: "crate" }) }));
  const order = docLines(readFileSync(join(root, GUIDE_RS), "utf8")).join("\n");
  files.set("guide/index.md", pageFile({ title: "Reading order", description: description(order), source: GUIDE_RS, body: transform(order, { items, from: GUIDE_RS, guide }) }));
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const intro = changelog.replace(/^# .*\n/, "");
  files.set("changelog.md", pageFile({ title: "Changelog", description: description(intro), source: "CHANGELOG.md", body: changelog, heading: false }));
  files.set(".generated/benchmarks.md", benchmarks(readFileSync(join(root, "README.md"), "utf8")));
  return files;
}

/** The benchmark table of the README's Performance section. */
export function benchmarks(readme: string): string {
  const section = /^## Performance\n([\s\S]*?)(?=^## )/m.exec(readme)?.[1];
  const table = section?.split("\n").filter((l) => l.startsWith("|"));
  if (!table?.length) throw new Error("README.md has no table under ## Performance");
  return `::: v-pre\n${table.join("\n")}\n:::\n`;
}
