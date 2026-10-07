import type { Config } from "../src/compiler.ts";

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  constructor(...seeds: number[]) {
    let h = 0x9e3779b9;
    const mix = (): number => {
      h = (h + 0x9e3779b9) | 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    for (const s of seeds) h = (h ^ Math.imul(s | 0, 0x27d4eb2d) ^ Math.floor(s / 2 ** 32)) | 0;
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
    for (let i = 0; i < 12; i++) this.next();
  }
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    if (!xs.length) throw new Error("pick from nothing");
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  weighted<T>(options: readonly (readonly [number, T])[]): T {
    const total = options.reduce((s, [w]) => s + w, 0);
    let r = this.next() * total;
    for (const [w, v] of options) {
      if ((r -= w) < 0) return v;
    }
    return options[options.length - 1]![1];
  }
}

export type Ty = "str" | "int" | "float" | "bool" | "html";

export interface Expr {
  ty: Ty;
  bound: number;
  kids: Expr[];
  fmt: (kids: string[]) => string;
  atom: boolean;
  fixed?: boolean;
  ref?: string;
  and?: boolean;
  lone?: boolean;
  scoped?: boolean;
}

export type Spec =
  | { k: "str" }
  | { k: "int"; wide: boolean }
  | { k: "count" }
  | { k: "float" }
  | { k: "bool" }
  | { k: "opt"; of: Spec }
  | { k: "nul"; of: Spec }
  | { k: "list"; of: Spec }
  | { k: "obj"; iface: string }
  | { k: "record"; of: Spec; dict: boolean }
  | { k: "enum"; values: string[] }
  | { k: "html"; inline: boolean };

export interface Iface {
  name: string;
  fields: { name: string; spec: Spec }[];
}

export type ClassBind =
  | { k: "expr"; e: Expr }
  | { k: "arr"; items: Expr[] }
  | { k: "obj"; entries: { key: string | Expr; cond: Expr }[] };

export type Attr =
  | { k: "static"; name: string; value: string | null }
  | { k: "bind"; name: string; e: Expr }
  | { k: "class"; v: ClassBind }
  | { k: "style"; entries: { key: string; e: Expr }[] };

export type Node =
  | { k: "el"; tag: string; attrs: Attr[]; kids: Node[]; void?: boolean; html?: Expr }
  | { k: "text"; s: string }
  | { k: "interp"; e: Expr }
  | { k: "if"; branches: { cond: Expr | null; node: Node & { k: "el" } }[] }
  | { k: "for"; head: string; node: Node & { k: "el" } }
  | { k: "child"; name: HelperName; attrs: Attr[]; kids: Node[]; is?: { test: Expr; other: HelperName | InlineTag } }
  | { k: "client"; kids: Node[]; fallback: Node[] | null }
  | { k: "teleport"; to: string; disabled: Expr | null; kids: Node[] }
  | { k: "link"; to: LinkTo; attrs: Attr[]; kids: Node[]; active: string | null; exact: string | null }
  | { k: "read"; text: string };

export type LinkTo =
  | { k: "lit"; path: string }
  | { k: "str"; e: Expr }
  | { k: "obj"; name: string | null; path: string | null; params: { key: string; e: Expr }[]; query: { key: string; e: Expr }[]; hash: string | null };

type InlineTag = "span" | "b" | "em";

export type HelperName =
  | "FzLeaf"
  | "FzBox"
  | "FzFwd"
  | "FzPair"
  | "FzRoot"
  | "FzOwn"
  | "FzBind"
  | "FzUse"
  | "FzPlain"
  | "FzBare"
  | "FzInj"
  | "FzProv"
  | "FzHead"
  | "FzSlots";

const HELPERS: Record<HelperName, { template: string; imports: HelperName[]; slot: boolean; script?: string[] }> = {
  FzLeaf: { template: `<b class="leaf">leaf</b>`, imports: [], slot: false },
  FzBox: { template: `<div class="box"><slot>box <i>fallback</i></slot></div>`, imports: [], slot: true },
  FzFwd: { template: `<FzBox><slot /></FzBox>`, imports: ["FzBox"], slot: true },
  FzPair: { template: `<i>one</i><i>two</i>`, imports: [], slot: false },
  FzRoot: { template: `<FzLeaf />`, imports: ["FzLeaf"], slot: false },
  FzOwn: { template: `<em id="own" class="own" title="own" style="color: blue; margin: 0" data-own="1" :hidden="false">own</em>`, imports: [], slot: false },
  FzBind: {
    template: `<p class="bind"><span v-bind="$attrs" id="in" class="in">bind</span><i title="t" class="i" style="margin: 0" v-bind="$attrs" /></p>`,
    imports: [],
    slot: false,
    script: ["defineOptions({ inheritAttrs: false });"],
  },
  FzUse: { template: `<s class="use" v-bind="attrs">use <u v-bind="attrs">u</u></s>`, imports: [], slot: false, script: ['import { useAttrs } from "vue";', "const attrs = useAttrs();"] },
  FzPlain: { template: `<u>plain</u>`, imports: [], slot: false },
  FzBare: { template: `<FzPlain />`, imports: ["FzPlain"], slot: false },
  FzInj: {
    template: `<i class="inj">{{ s }}/{{ n }}/{{ live }}</i>`,
    imports: [],
    slot: false,
    script: [
      'import { computed, inject } from "vue";',
      'import { FzLive, FzNum } from "./fz-keys";',
      'const s = inject("fz-s", "none");',
      "const n = inject(FzNum, -1);",
      'const live = inject(FzLive, computed(() => "idle"));',
    ],
  },
  FzProv: {
    template: `<div class="prov"><slot /><FzInj /></div>`,
    imports: ["FzInj"],
    slot: true,
    script: ['import { provide } from "vue";', 'import { FzNum } from "./fz-keys";', 'provide("fz-s", "in & <out>");', "provide(FzNum, 7);"],
  },
  FzHead: {
    template: `<b class="head">head</b>`,
    imports: [],
    slot: false,
    script: [
      'import { useHead, useSeoMeta } from "@unhead/vue";',
      'useHead({ title: "child", meta: [{ name: "description", content: "child <&> \\"q\\"" }], link: [{ rel: "canonical", href: "/child" }] });',
      'useSeoMeta({ ogTitle: "child og" });',
    ],
  },
  FzSlots: {
    template: `<div class="slots"><p v-if="slots.default"><slot /></p><i v-else>none</i></div>`,
    imports: [],
    slot: true,
    script: ['import { useSlots } from "vue";', "const slots = useSlots();"],
  },
};

const KEYS_FILE = `import type { InjectionKey, Ref } from "vue";

export const FzNum: InjectionKey<number> = Symbol("fz-num");
export const FzLive: InjectionKey<Ref<string>> = Symbol("fz-live");
`;

export interface Consts {
  label: string;
  limit: number;
  ratio: number;
  shown: boolean;
  words: string[];
  nums: number[];
  labels: [string, string][];
  rows: { title: string; qty: number; memo: string | null }[];
  tone: [string, string][];
  rank: number;
}

export interface Binding {
  name: string;
  kind: "computed" | "const" | "ref";
  e: Expr;
}

export interface HeadValue {
  e: Expr;
  getter: boolean;
}

export interface HeadCall {
  kind: "useHead" | "useSeoMeta";
  entries: { at: string; v: HeadValue }[];
}

export interface Provide {
  key: "str" | "num" | "live";
  e: Expr;
}

export interface RouteNode {
  path: string;
  name: string | null;
  children: RouteNode[];
}

export interface AppRouter {
  routes: RouteNode[];
  base: string | null;
  active: string | null;
  exact: string | null;
}

export interface StoreDef {
  id: string;
  hook: string;
  local: string;
  setup: boolean;
  fields: { name: string; spec: Spec }[];
  getters: { name: string; e: Expr }[];
  refs: string[];
}

export interface Messages {
  locales: Record<string, Record<string, string>>;
}

export interface Component {
  name: string;
  ifaces: Iface[];
  props: { name: string; spec: Spec }[];
  template: Node[];
  scoped: boolean;
  helpers: Record<HelperName, { scoped: boolean; slotted: boolean }>;
  propsVar: boolean;
  bindings: Binding[];
  provides: Provide[];
  head: HeadCall[];
  consts: Consts | null;
  localEnums: boolean;
  asyncHelpers: HelperName[];
  generic: string | null;
  router: AppRouter | null;
  stores: StoreDef[];
  i18n: Messages | null;
}

export interface Case {
  component: Component;
  fixtures: Record<string, unknown>[];
}

export function printExpr(e: Expr): string {
  return e.fmt(e.kids.map((k) => (k.atom ? printExpr(k) : `(${printExpr(k)})`)));
}

function tsType(spec: Spec): string {
  switch (spec.k) {
    case "str":
      return "string";
    case "int":
    case "count":
      return "number";
    case "float":
      return "Float";
    case "bool":
      return "boolean";
    case "opt":
      return tsType(spec.of);
    case "nul":
      return `${tsType(spec.of)} | null`;
    case "list":
      return `${tsType(spec.of)}[]`;
    case "obj":
      return spec.iface;
    case "record":
      return spec.dict ? `{ [key: string]: ${tsType(spec.of)} }` : `Record<string, ${tsType(spec.of)}>`;
    case "enum":
      return "Tone";
    case "html":
      return spec.inline ? "InlineHtml" : "TrustedHtml";
  }
}

const usesHtml = (spec: Spec, inline: boolean): boolean => (spec.k === "html" && spec.inline === inline) || (spec.k === "opt" && usesHtml(spec.of, inline));
const usesEnum = (spec: Spec): boolean => spec.k === "enum" || (spec.k === "opt" && usesEnum(spec.of));

const usesFloat = (spec: Spec): boolean =>
  spec.k === "float" || ((spec.k === "opt" || spec.k === "nul" || spec.k === "list" || spec.k === "record") && usesFloat(spec.of));

function printAttr(a: Attr): string {
  switch (a.k) {
    case "static":
      return a.value === null ? a.name : `${a.name}="${a.value}"`;
    case "bind":
      return `:${a.name}="${printExpr(a.e)}"`;
    case "class": {
      const v = a.v;
      if (v.k === "expr") return `:class="${printExpr(v.e)}"`;
      if (v.k === "arr") return `:class="[${v.items.map(printExpr).join(", ")}]"`;
      const entries = v.entries.map(
        (en) => `${typeof en.key === "string" ? en.key : `[${printExpr(en.key)}]`}: ${printExpr(en.cond)}`,
      );
      return `:class="{ ${entries.join(", ")} }"`;
    }
    case "style":
      return `:style="{ ${a.entries.map((en) => `${en.key}: ${printExpr(en.e)}`).join(", ")} }"`;
  }
}

function printTo(to: LinkTo): string {
  if (to.k === "lit") return to.path;
  if (to.k === "str") return printExpr(to.e);
  const entries = (xs: { key: string; e: Expr }[]): string => `{ ${xs.map((x) => `${x.key}: ${printExpr(x.e)}`).join(", ")} }`;
  const parts = [
    ...(to.name !== null ? [`name: '${to.name}'`] : []),
    ...(to.path !== null ? [`path: '${to.path}'`] : []),
    ...(to.params.length ? [`params: ${entries(to.params)}`] : []),
    ...(to.query.length ? [`query: ${entries(to.query)}`] : []),
    ...(to.hash !== null ? [`hash: '${to.hash}'`] : []),
  ];
  return `{ ${parts.join(", ")} }`;
}

function printNode(n: Node, indent: string, extra: string[] = []): string {
  switch (n.k) {
    case "text":
      return n.s;
    case "interp":
      return `{{ ${printExpr(n.e)} }}`;
    case "if":
      return n.branches
        .map((b, i) =>
          printNode(b.node, indent, [b.cond === null ? "v-else" : `${i ? "v-else-if" : "v-if"}="${printExpr(b.cond)}"`]),
        )
        .join(`\n${indent}`);
    case "for":
      return printNode(n.node, indent, [`v-for="${n.head}"`]);
    case "child": {
      const other = n.is && (n.is.other in HELPERS ? n.is.other : `'${n.is.other}'`);
      const tag = n.is ? "component" : n.name;
      const test = n.is && (n.is.test.atom ? printExpr(n.is.test) : `(${printExpr(n.is.test)})`);
      const is = n.is ? [`:is="${test} ? ${n.name} : ${other}"`] : [];
      const open = `<${tag}${[...is, ...n.attrs.map(printAttr)].map((a) => " " + a).join("")}`;
      return n.kids.length ? `${open}>${n.kids.map((k) => printNode(k, indent + "  ")).join("")}</${tag}>` : `${open} />`;
    }
    case "read":
      return `{{ ${n.text} }}`;
    case "link": {
      const attrs = [`${n.to.k === "lit" ? "to" : ":to"}="${printTo(n.to)}"`, ...(n.active ? [`active-class="${n.active}"`] : []), ...(n.exact ? [`exact-active-class="${n.exact}"`] : []), ...n.attrs.map(printAttr)];
      return `<RouterLink ${attrs.join(" ")}>${n.kids.map((k) => printNode(k, indent + "  ")).join("")}</RouterLink>`;
    }
    case "teleport": {
      const disabled = n.disabled ? ` :disabled="${printExpr(n.disabled)}"` : "";
      return `<Teleport to="${n.to}"${disabled}>${n.kids.map((k) => printNode(k, indent + "  ")).join("")}</Teleport>`;
    }
    case "client": {
      const fallback = n.fallback === null ? "" : `<template #fallback>${n.fallback.map((k) => printNode(k, indent + "  ")).join("")}</template>`;
      return `<ClientOnly>${n.kids.map((k) => printNode(k, indent + "  ")).join("")}${fallback}</ClientOnly>`;
    }
    case "el": {
      const attrs = [...extra, ...n.attrs.map(printAttr), ...(n.html ? [`v-html="${printExpr(n.html)}"`] : [])];
      const open = `<${n.tag}${attrs.map((a) => " " + a).join("")}`;
      if (n.void) return `${open} />`;
      const inner = n.kids.map((k) => printNode(k, indent + "  ")).join("");
      return `${open}>${inner}</${n.tag}>`;
    }
  }
}

const scopedStyle = (slotted: boolean): string[] => ["", "<style scoped>", slotted ? ":slotted(i) { color: red; }" : "b { color: red; }", "</style>"];

function rendered(template: Node[]): HelperName[] {
  const used = new Set<HelperName>();
  const walk = (ns: Node[]): void => {
    for (const n of ns) {
      if (n.k === "child") {
        used.add(n.name);
        if (n.is && n.is.other in HELPERS) used.add(n.is.other as HelperName);
        walk(n.kids);
      } else if (n.k === "el") walk(n.kids);
      else if (n.k === "if") walk(n.branches.map((b) => b.node));
      else if (n.k === "for") walk([n.node]);
      else if (n.k === "client") walk([...n.kids, ...(n.fallback ?? [])]);
      else if (n.k === "teleport" || n.k === "link") walk(n.kids);
    }
  };
  walk(template);
  return [...used].toSorted();
}

function helpersUsed(template: Node[]): HelperName[] {
  const used = new Set<HelperName>();
  const add = (name: HelperName): void => {
    used.add(name);
    HELPERS[name].imports.forEach(add);
  };
  rendered(template).forEach(add);
  return [...used].toSorted();
}

const CONST_NAMES = ["LABELS", "LABEL", "LIMIT", "RATIO", "SHOWN", "WORDS", "NUMS", "ROWS", "Tone", "Rank"] as const;

const numText = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));

function enumLines(k: Consts, exported: boolean): string[] {
  const e = exported ? "export " : "";
  const literal = (v: string): string => (exported ? JSON.stringify(v) : JSON.stringify(v).replaceAll("</", "<\\/"));
  return [`${e}enum Tone {`, ...k.tone.map(([m, v]) => `  ${m} = ${literal(v)},`), "}", "", `${e}enum Rank {`, "  Low,", `  Mid = ${k.rank},`, "  High,", "}"];
}

function constsFile(k: Consts): string {
  return [
    `export const LABEL = ${JSON.stringify(k.label)};`,
    `export const LIMIT = ${numText(k.limit)};`,
    `export const RATIO = ${numText(k.ratio)};`,
    `export const SHOWN = ${k.shown};`,
    `export const WORDS = [${k.words.map((w) => JSON.stringify(w)).join(", ")}];`,
    `export const NUMS = [${k.nums.map(numText).join(", ")}];`,
    `export const LABELS = { ${k.labels.map(([n, v]) => `${n}: ${JSON.stringify(v)}`).join(", ")} };`,
    "",
    "export interface FzRow {",
    "  title: string;",
    "  qty: number;",
    "  memo: string | null;",
    "}",
    "",
    "export const ROWS: FzRow[] = [",
    ...k.rows.map((r) => `  { title: ${JSON.stringify(r.title)}, qty: ${numText(r.qty)}, memo: ${r.memo === null ? "null" : JSON.stringify(r.memo)} },`),
    "];",
    "",
    ...enumLines(k, true),
    "",
  ].join("\n");
}

function headValue(v: HeadValue): string {
  return v.getter ? `() => ${printExpr(v.e)}` : printExpr(v.e);
}

function printHead(call: HeadCall): string {
  const entries = (prefix: string): { at: string; v: HeadValue }[] => call.entries.filter((en) => en.at.startsWith(prefix));
  if (call.kind === "useSeoMeta") return `useSeoMeta({ ${call.entries.map((en) => `${en.at}: ${headValue(en.v)}`).join(", ")} });`;
  const parts = call.entries.filter((en) => en.at === "title" || en.at === "titleTemplate").map((en) => `${en.at}: ${headValue(en.v)}`);
  for (const attrs of ["htmlAttrs", "bodyAttrs"]) {
    const of = entries(`${attrs}.`);
    if (of.length) parts.push(`${attrs}: { ${of.map((en) => `${JSON.stringify(en.at.slice(attrs.length + 1))}: ${headValue(en.v)}`).join(", ")} }`);
  }
  const meta = entries("meta.").map((en) => {
    const [, attr, name] = /^meta\.(name|property)\.(.*)$/.exec(en.at)!;
    return `{ ${attr}: ${JSON.stringify(name)}, content: ${headValue(en.v)} }`;
  });
  if (meta.length) parts.push(`meta: [${meta.join(", ")}]`);
  const link = entries("link.").map((en) => `{ rel: ${JSON.stringify(en.at.slice(5))}, href: ${headValue(en.v)} }`);
  if (link.length) parts.push(`link: [${link.join(", ")}]`);
  return `useHead({ ${parts.join(", ")} });`;
}

function scriptLines(c: Component): string[] {
  const lines: string[] = [];
  for (const b of c.bindings) {
    const e = printExpr(b.e);
    lines.push(b.kind === "computed" ? `const ${b.name} = computed(() => ${e});` : b.kind === "ref" ? `const ${b.name} = ref(${e});` : `const ${b.name} = ${e};`);
  }
  for (const p of c.provides) lines.push(`provide(${p.key === "str" ? '"fz-s"' : p.key === "num" ? "FzNum" : "FzLive"}, ${printExpr(p.e)});`);
  for (const h of c.head) lines.push(printHead(h));
  return lines;
}

const templateText = (c: Component): string => c.template.map((n) => printNode(n, "")).join("\n");

const mentions = (text: string, name: string): boolean => new RegExp(`(?<![\\w.$'])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(text);

function constsUsed(c: Component): string[] {
  if (!c.consts) return [];
  const text = `${templateText(c)}\n${scriptLines(c).join("\n")}`;
  const used: string[] = CONST_NAMES.filter((n) => mentions(text, n));
  if (c.props.some((p) => usesEnum(p.spec)) && !used.includes("Tone")) used.push("Tone");
  return used;
}

const FZ_ITEM: Iface = {
  name: "FzItem",
  fields: [
    { name: "sku", spec: { k: "str" } },
    { name: "qty", spec: { k: "int", wide: false } },
    { name: "tag", spec: { k: "opt", of: { k: "str" } } },
  ],
};

function routesJson(routes: RouteNode[]): unknown[] {
  return routes.map((r) => (r.name === null && !r.children.length ? r.path : { path: r.path, ...(r.name !== null ? { name: r.name } : {}), ...(r.children.length ? { children: routesJson(r.children) } : {}) }));
}

const storeUses = (f: { spec: Spec }, k: (s: Spec) => boolean): boolean => {
  const visit = (s: Spec): boolean => k(s) || ((s.k === "opt" || s.k === "nul" || s.k === "list") && visit(s.of));
  return visit(f.spec);
};

function storeFile(st: StoreDef): string {
  const float = st.fields.some((f) => storeUses(f, (s) => s.k === "float"));
  const items = st.fields.some((f) => storeUses(f, (s) => s.k === "obj"));
  const lines = ['import { defineStore } from "pinia";'];
  if (st.setup) lines.push(`import { ${st.getters.length ? "computed, " : ""}ref } from "vue";`);
  if (float) lines.push('import type { Float } from "ferrovue/types";');
  lines.push("");
  if (items) {
    lines.push(`export interface ${FZ_ITEM.name} {`, ...FZ_ITEM.fields.map((f) => `  ${f.name}${f.spec.k === "opt" ? "?" : ""}: ${tsType(f.spec)};`), "}", "");
  }
  if (!st.setup) {
    const state = `${st.hook.slice(3)}State`;
    lines.push(`export interface ${state} {`, ...st.fields.map((f) => `  ${f.name}${f.spec.k === "opt" ? "?" : ""}: ${tsType(f.spec)};`), "}", "");
    const initial = st.fields.filter((f) => f.spec.k !== "opt").map((f) => `${f.name}: ${initialOf(f.spec)}`);
    lines.push(`export const ${st.hook} = defineStore("${st.id}", {`, `  state: (): ${state} => ({ ${initial.join(", ")} }),`);
    if (st.getters.length) lines.push("  getters: {", ...st.getters.map((g) => `    ${g.name}: (state) => ${printExpr(g.e)},`), "  },");
    lines.push("});", "");
    return lines.join("\n");
  }
  lines.push(`export const ${st.hook} = defineStore("${st.id}", () => {`);
  for (const f of st.fields) {
    const typed = f.spec.k === "str" || f.spec.k === "int" || f.spec.k === "bool";
    lines.push(`  const ${f.name} = ref${typed ? "" : `<${tsType(f.spec)}>`}(${initialOf(f.spec)});`);
  }
  for (const g of st.getters) lines.push(`  const ${g.name} = computed(() => ${printExpr(g.e)});`);
  lines.push(`  return { ${[...st.fields.map((f) => f.name), ...st.getters.map((g) => g.name)].join(", ")} };`, "});", "");
  return lines.join("\n");
}

function initialOf(spec: Spec): string {
  switch (spec.k) {
    case "str":
      return '""';
    case "int":
      return "0";
    case "float":
      return "0.5";
    case "bool":
      return "false";
    case "nul":
      return "null";
    case "list":
      return "[]";
    default:
      return "undefined";
  }
}

function localeJson(messages: Record<string, string>): string {
  const tree: Record<string, unknown> = {};
  for (const [key, source] of Object.entries(messages)) {
    const path = key.split(".");
    let at = tree;
    for (const part of path.slice(0, -1)) at = (at[part] ??= {}) as Record<string, unknown>;
    at[path.at(-1)!] = source;
  }
  return JSON.stringify(tree, null, 2) + "\n";
}

const READS_ROUTE = /(?<![\w.$])route\./;
const CALLS_T = /(?<![\w.$])t\(/;

function contextText(c: Component): string {
  return `${templateText(c)}\n${scriptLines(c).join("\n")}`;
}

function storesUsed(c: Component, text = contextText(c)): { st: StoreDef; refs: string[]; local: boolean }[] {
  return c.stores
    .map((st) => {
      const refs = st.refs.filter((r) => mentions(text, r));
      return { st, refs, local: refs.length > 0 || new RegExp(`(?<![\\w.$])${st.local}\\.`).test(text) };
    })
    .filter((u) => u.local);
}

function contextLines(c: Component): { imports: string[]; lines: string[] } {
  const text = contextText(c);
  const imports: string[] = [];
  const lines: string[] = [];
  if (c.router && READS_ROUTE.test(text)) {
    imports.push('import { useRoute } from "vue-router";');
    lines.push("const route = useRoute();");
  }
  const used = storesUsed(c, text);
  if (used.some((u) => u.refs.length)) imports.push('import { storeToRefs } from "pinia";');
  for (const u of used) {
    imports.push(`import { ${u.st.hook} } from "../stores/${u.st.id}";`);
    lines.push(`const ${u.st.local} = ${u.st.hook}();`);
    if (u.refs.length) lines.push(`const { ${u.refs.join(", ")} } = storeToRefs(${u.st.local});`);
  }
  if (c.i18n) {
    const names = [...(CALLS_T.test(text) ? ["t"] : []), ...(mentions(text, "locale") ? ["locale"] : [])];
    if (names.length) {
      imports.push('import { useI18n } from "vue-i18n";');
      lines.push(`const { ${names.join(", ")} } = useI18n();`);
    }
  }
  return { imports, lines };
}

/** The `ferrovue.config.json` of a case: the routes, stores and locales it carries. */
export function configOf(c: Component, viteRoot: string): Config {
  const r = c.router;
  return {
    components: "components",
    out: "generated",
    scopeId: "filepath",
    viteRoot,
    trustedHtml: "ferrovue::BasicHtml",
    ...(r
      ? {
          router: {
            routes: "routes.json",
            ...(r.base !== null ? { base: r.base } : {}),
            ...(r.active !== null ? { linkActiveClass: r.active } : {}),
            ...(r.exact !== null ? { linkExactActiveClass: r.exact } : {}),
          },
        }
      : {}),
    ...(c.stores.length ? { stores: "stores" } : {}),
    ...(c.i18n ? { i18n: { messages: "locales", locale: "en", fallbackLocale: "en" } } : {}),
  };
}

export function helperFiles(c: Component): [string, string][] {
  const used = helpersUsed(c.template);
  const files = used.map((name): [string, string] => {
    const h = HELPERS[name];
    const flags = c.helpers[name];
    const lines = ['<script setup lang="ts">', ...h.imports.map((i) => `import ${i} from "./${i}.vue";`), ...(h.script ?? []), "defineProps<{}>();", "</script>", "", `<template>${h.template}</template>`];
    if (flags.scoped) lines.push(...scopedStyle(flags.slotted && h.slot));
    return [`${name}.vue`, lines.join("\n") + "\n"];
  });
  if (used.includes("FzInj") || c.provides.some((p) => p.key !== "str")) files.push(["fz-keys.ts", KEYS_FILE]);
  if (c.consts && constsUsed(c).length) files.push(["fz-consts.ts", constsFile(c.consts)]);
  if (c.router) files.push(["../routes.json", JSON.stringify(routesJson(c.router.routes), null, 2) + "\n"]);
  for (const st of c.stores) files.push([`../stores/${st.id}.ts`, storeFile(st)]);
  if (c.i18n) for (const [locale, messages] of Object.entries(c.i18n.locales)) files.push([`../locales/${locale}.json`, localeJson(messages)]);
  return files;
}

const genericOf = (c: Component): string | null =>
  c.generic !== null && c.props.some((p) => p.spec.k === "list" && p.spec.of.k === "obj" && p.spec.of.iface === c.generic) ? c.generic : null;

export function printComponent(c: Component): string {
  const float = c.props.some((p) => usesFloat(p.spec)) || c.ifaces.some((i) => i.fields.some((f) => usesFloat(f.spec)));
  const trusted = c.props.some((p) => usesHtml(p.spec, false));
  const inline = c.props.some((p) => usesHtml(p.spec, true));
  const tpl = templateText(c);
  const script = scriptLines(c);
  const helpers = rendered(c.template);
  const asyncs = helpers.filter((h) => c.asyncHelpers.includes(h));
  const vue = [
    ...(c.bindings.some((b) => b.kind === "computed") ? ["computed"] : []),
    ...(asyncs.length ? ["defineAsyncComponent"] : []),
    ...(c.provides.length ? ["provide"] : []),
    ...(c.bindings.some((b) => b.kind === "ref") ? ["ref"] : []),
  ];
  const generic = genericOf(c);
  const lines = [generic ? `<script setup lang="ts" generic="T extends ${generic}">` : '<script setup lang="ts">'];
  if (vue.length) lines.push(`import { ${vue.join(", ")} } from "vue";`);
  const unhead = [...new Set(c.head.map((h) => h.kind))].toSorted();
  if (unhead.length) lines.push(`import { ${unhead.join(", ")} } from "@unhead/vue";`);
  if (tpl.includes("<ClientOnly>")) lines.push('import { ClientOnly } from "ferrovue/client";');
  for (const name of helpers) if (!asyncs.includes(name)) lines.push(`import ${name} from "./${name}.vue";`);
  const local = (n: string): boolean => c.localEnums && (n === "Tone" || n === "Rank");
  const consts = constsUsed(c);
  if (consts.some((n) => !local(n))) lines.push(`import { ${consts.filter((n) => !local(n)).toSorted().join(", ")} } from "./fz-consts";`);
  const keys = [...new Set(c.provides.filter((p) => p.key !== "str").map((p) => (p.key === "num" ? "FzNum" : "FzLive")))].toSorted();
  if (keys.length) lines.push(`import { ${keys.join(", ")} } from "./fz-keys";`);
  const types = [...(float ? ["Float"] : []), ...(inline ? ["InlineHtml"] : []), ...(trusted ? ["TrustedHtml"] : [])];
  if (types.length) lines.push(`import type { ${types.join(", ")} } from "ferrovue/types";`);
  const context = contextLines(c);
  lines.push(...context.imports);
  lines.push("");
  for (const name of asyncs) lines.push(`const ${name} = defineAsyncComponent(() => import("./${name}.vue"));`);
  if (asyncs.length) lines.push("");
  if (c.consts && consts.some(local)) lines.push(...enumLines(c.consts, false), "");
  for (const i of c.ifaces) {
    lines.push(`interface ${i.name} {`);
    for (const f of i.fields) lines.push(`  ${f.name}${f.spec.k === "opt" ? "?" : ""}: ${tsType(f.spec)};`);
    lines.push("}", "");
  }
  const props = c.props.map((p) => {
    const ty = generic && p.spec.k === "list" && p.spec.of.k === "obj" && p.spec.of.iface === generic ? "T[]" : tsType(p.spec);
    return `${p.name}${p.spec.k === "opt" ? "?" : ""}: ${ty}`;
  });
  const define = props.length ? `defineProps<{ ${props.join("; ")} }>();` : "defineProps<{}>();";
  lines.push(c.propsVar || /(?<![\w.$])props\./.test(`${tpl}\n${script.join("\n")}`) ? `const props = ${define}` : define);
  lines.push(...context.lines);
  lines.push(...script);
  lines.push("</script>", "", "<template>");
  for (const n of c.template) lines.push("  " + printNode(n, "  "));
  lines.push("</template>");
  if (c.scoped) lines.push(...scopedStyle(false));
  lines.push("");
  return lines.join("\n");
}

const ENTRIES = "\u0000entries";

export function fixtureJson(fixture: Record<string, unknown>): string {
  const write = (v: unknown, pad: string): string => {
    const inner = pad + "  ";
    if (Object.is(v, -0)) return "-0.0";
    if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => inner + write(x, inner)).join(",\n")}\n${pad}]` : "[]";
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const pairs = ENTRIES in o ? (o[ENTRIES] as [string, unknown][]) : Object.entries(o).filter(([, x]) => x !== undefined);
      return pairs.length ? `{\n${pairs.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${write(x, inner)}`).join(",\n")}\n${pad}}` : "{}";
    }
    return JSON.stringify(v);
  };
  return write(fixture, "") + "\n";
}

const HOSTILE = [
  "",
  " ",
  "a",
  "hello world",
  "<b>bold</b>",
  "a & b",
  "&amp; &lt;",
  '"double"',
  "'single'",
  "`tick`",
  "</script><script>alert(1)</script>",
  "<!-- x -->",
  "]]>",
  "{{ x }}",
  "${x}",
  "  padded  ",
  " nbsp ",
  "﻿bom﻿",
  "　ideo　",
  "\u0085next",
  "\t\ttab\n",
  "é",
  "Z͑͢͠a̕l͜go",
  "🦀",
  "👨‍👩‍👧‍👦",
  "🇳🇱",
  "שלום עולם",
  "مرحبا",
  "‮evil‬",
  "ß",
  "ﬁ",
  "İstanbul",
  "ΟΔΟΣ",
  "Σ",
  "ǅ",
  "ŉ",
  "İi̇",
  "x".repeat(40),
  "42",
  " 3.5e2px",
  "0x1F",
  "-0",
  "1e21",
  "Infinity",
  ".5",
  "a,b,,c",
  "\\back\\slash",
  "a\u0000b",
  "\ud800",
];

const CHARS = [..."abcXYZ09 _-.,!?<>&\"'`/=;:#%{}()[]", "é", "ß", " ", "́", "🦀", "ש", "​", " ", "﻿", "\n", "\t"];

function randomString(r: Rng, hostile: boolean): string {
  if (hostile || r.chance(0.5)) {
    const s = r.pick(HOSTILE);
    return s === "\ud800" || s === "a\u0000b" ? "<&>" : s;
  }
  let s = "";
  for (let n = r.int(0, 12); n > 0; n--) s += r.pick(CHARS);
  return s;
}

const MAX = 2 ** 53 - 1;
const FLOATS = [0, -0, 0.1, 0.2, 0.30000000000000004, 0.5, 1.5, 2.5, -2.5, 1.005, 1.45, 123.456, 1e-7, 1.5e-7, 1e-6, 0.000001234, 1e21, 1.5e21, 1e20, 1.2345678901234568e20, -1e21, 1e300, 5e-324, 1.7976931348623157e308, 3, -7, 2 ** 53, 0.1 + 0.7];

function randomValue(r: Rng, spec: Spec, ifaces: Map<string, Iface>, hostile: boolean): unknown {
  switch (spec.k) {
    case "str":
      return randomString(r, hostile);
    case "int":
      if (spec.wide && r.chance(0.5)) return r.pick([MAX, -MAX, 2 ** 52 + 1, -(2 ** 40) - 3, r.int(-MAX, MAX)]);
      return r.weighted([
        [3, r.pick([0, 1, -1, 2, 10, 100])],
        [3, r.int(-20, 20)],
        [2, r.int(-999, 999)],
      ]);
    case "count":
      return r.int(-1, 5);
    case "float":
      return r.weighted([
        [4, r.pick(FLOATS)],
        [2, (r.next() - 0.5) * 10 ** r.int(-8, 8)],
        [1, Math.round((r.next() - 0.5) * 2000) / 8],
      ]);
    case "bool":
      return r.chance(0.5);
    case "opt":
      return r.chance(0.35) ? undefined : randomValue(r, spec.of, ifaces, hostile);
    case "nul":
      return r.chance(0.35) ? null : randomValue(r, spec.of, ifaces, hostile);
    case "list": {
      const out: unknown[] = [];
      for (let n = r.weighted([[1, 0], [2, 1], [4, r.int(2, 4)]]); n > 0; n--) out.push(randomValue(r, spec.of, ifaces, hostile));
      return out;
    }
    case "obj": {
      const o: Record<string, unknown> = {};
      for (const f of ifaces.get(spec.iface)!.fields) {
        const v = randomValue(r, f.spec, ifaces, hostile);
        if (v !== undefined) o[f.name] = v;
      }
      return o;
    }
    case "record": {
      const pairs: [string, unknown][] = [];
      for (let n = r.weighted([[1, 0], [2, 1], [4, r.int(2, 5)]]); n > 0; n--) {
        const key = r.chance(0.15) && pairs.length ? r.pick(pairs)[0] : r.chance(0.4) ? r.pick(RECORD_KEYS) : randomString(r, hostile);
        pairs.push([key, randomValue(r, spec.of, ifaces, hostile)]);
      }
      return { [ENTRIES]: pairs };
    }
    case "enum":
      return r.pick(spec.values);
    case "html":
      return basicHtml(r, hostile, 0, spec.inline ? "inline" : "flow");
  }
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const HTML_REFS = ["&amp;", "&eacute;", "&#60;", "&#x1F980;", "&nbsp;", "&amp;lt;", "&#39;"];

function basicHtml(r: Rng, hostile: boolean, depth: number, ctx: "flow" | "inline"): string {
  let out = "";
  for (let n = depth > 4 ? r.int(0, 1) : r.int(depth ? 0 : 1, 3); n > 0; n--) {
    out += r.weighted<() => string>([
      [4, () => (r.chance(0.2) ? r.pick(HTML_REFS) : escapeHtml(randomString(r, hostile)))],
      [1, () => "<br>"],
      [depth < 6 ? 3 : 0, () => {
        const tag = r.pick(["b", "i", "em", "strong", "code"]);
        return `<${tag}>${basicHtml(r, hostile, depth + 1, "inline")}</${tag}>`;
      }],
      [ctx === "flow" && depth < 6 ? 2 : 0, () => `<p>${basicHtml(r, hostile, depth + 1, "inline")}</p>`],
      [ctx === "flow" && depth < 5 ? 1 : 0, () => {
        const tag = r.pick(["ul", "ol"]);
        let items = "";
        for (let i = r.int(1, 3); i > 0; i--) items += `<li>${basicHtml(r, hostile, depth + 2, "flow")}</li>`;
        return `<${tag}>${items}</${tag}>`;
      }],
    ])();
  }
  return out;
}

function randomConsts(r: Rng): Consts {
  const text = (): string => randomString(r, false);
  const distinct = (n: number): string[] => {
    const out: string[] = [];
    while (out.length < n) {
      const s = text();
      if (!out.includes(s)) out.push(s);
    }
    return out;
  };
  const tone = distinct(3);
  return {
    label: text(),
    limit: r.int(-20, 20),
    ratio: r.pick(FLOATS),
    shown: r.chance(0.5),
    words: Array.from({ length: r.int(1, 4) }, text),
    nums: Array.from({ length: r.int(1, 4) }, () => r.int(-50, 50)),
    labels: [["save", text()], ["none", r.chance(0.5) ? "" : text()], ["emoji", r.pick(["🦀", "é", "<b>", "&amp;"])]],
    rows: Array.from({ length: r.int(1, 3) }, () => ({ title: text(), qty: r.int(-5, 50), memo: r.chance(0.4) ? null : text() })),
    tone: [["Loud", tone[0]!], ["Quiet", tone[1]!], ["Plain", tone[2]!]],
    rank: r.int(1, 9),
  };
}

const RECORD_KEYS = ["0", "1", "2", "10", "01", "-1", "1.5", "4294967294", "4294967295", "9007199254740993", "a", "b", "<b>", "&", "🦀", "", " "];

export function randomFixture(r: Rng, c: Component, hostile: boolean): Record<string, unknown> {
  const ifaces = new Map([...c.ifaces, FZ_ITEM].map((i) => [i.name, i]));
  const out: Record<string, unknown> = {};
  for (const p of c.props) {
    const v = randomValue(r, p.spec, ifaces, hostile);
    if (v !== undefined) out[p.name] = v;
  }
  if (c.router) out.$route = randomLocation(r, c.router);
  if (c.stores.length) {
    out.$stores = Object.fromEntries(
      c.stores.map((st) => {
        const state: Record<string, unknown> = {};
        for (const f of st.fields) {
          const v = randomValue(r, f.spec, ifaces, hostile);
          if (v !== undefined) state[f.name] = v;
        }
        return [st.id, state];
      }),
    );
  }
  if (c.i18n && r.chance(0.7)) out.$locale = r.pick(["en", "nl", "fr"]);
  return out;
}

const LIMIT = 2 ** 53;
const BOUND_SMALL = 1000;

const recv = (a: string | undefined): string => (/^[\d.]+$/.test(a ?? "") ? `(${a})` : (a ?? ""));
const atom = (ty: Ty, text: string, bound = 0): Expr => ({ ty, bound, kids: [], fmt: () => text, atom: true });
const node = (ty: Ty, kids: Expr[], fmt: (k: string[]) => string, bound = 0, isAtom = false): Expr => ({
  ty,
  bound,
  kids,
  fmt,
  atom: isAtom,
});

const STR_LITS = ["", "a", "x y", "<i>", "a&b", "&amp;", "→", "é", "🦀", " pad ", "px", "-", ", ", "Σ", "ß"];
const strLit = (s: string): Expr => atom("str", `'${s}'`);
const TPL_TEXT = ["", " ", "n=", " & ", "<", "é", "/", "px", "🦀"];

function numLit(x: number, ty: Ty): Expr {
  const text = String(x);
  return { ...atom(ty, text, Math.abs(x) + 1), atom: x >= 0 && !Object.is(x, -0) };
}

interface Var {
  name: string;
  ty: Ty;
  opt: boolean;
  nul?: boolean;
  bound: number;
  lone?: boolean;
  inline?: boolean;
}
interface ListVar {
  name: string;
  of: Spec;
}
interface RecordVar {
  name: string;
  of: Spec;
}
interface Scope {
  vars: Var[];
  lists: ListVar[];
  records: RecordVar[];
  htmls: Var[];
}

interface ListExpr {
  of: Spec;
  kids: Expr[];
  fmt: (kids: string[], at: number) => string;
  lone: boolean;
}

const REPLACEMENTS = ["", "-", "$&", "$$", "$`", "$'", "$1", "$<x>", "[$&]", "🦀", "$"];
const quoted = (s: string): string => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const LOW_LITS = ["", "a", "x y", "<i>", "a&b", "→", "é", "Σ", "ß", "-"];

const specTy = (s: Spec): Ty | null =>
  s.k === "str" || s.k === "enum" ? "str" : s.k === "int" || s.k === "count" ? "int" : s.k === "float" ? "float" : s.k === "bool" ? "bool" : null;
const specBound = (s: Spec): number => (s.k === "int" ? (s.wide ? LIMIT : BOUND_SMALL) : s.k === "count" ? 10 : 0);

class Gen {
  scope: Scope = { vars: [], lists: [], records: [], htmls: [] };
  favour: HelperName[] = [];
  vnode = false;
  para = false;
  routes: FlatRoute[] = [];
  reads: string[] = [];
  tKeys: TKey[] = [];
  tNames: string[] = [];
  inLink = false;
  slotted = false;
  loopDepth = 0;
  nodes = 0;
  arrows = 0;
  hollow = false;
  readonly r: Rng;
  readonly ifaces: Map<string, Iface>;
  constructor(r: Rng, ifaces: Map<string, Iface>) {
    this.r = r;
    this.ifaces = ifaces;
  }

  bind(name: string, spec: Spec, prop = false, lone = false): void {
    if (spec.k === "html" || (spec.k === "opt" && spec.of.k === "html")) {
      const html = spec.k === "opt" ? spec.of : spec;
      this.scope.htmls.push({ name, ty: "html", opt: spec.k === "opt", bound: 0, ...(html.k === "html" && html.inline ? { inline: true } : {}) });
    }
    else if (spec.k === "list") this.scope.lists.push({ name, of: spec.of });
    else if (spec.k === "record") this.scope.records.push({ name, of: spec.of });
    else if (spec.k === "obj") for (const f of this.ifaces.get(spec.iface)!.fields) this.bind(`${name}.${f.name}`, f.spec);
    else if (spec.k === "opt") {
      const ty = specTy(spec.of);
      if (ty) this.scope.vars.push({ name, ty, opt: !(prop && ty === "bool"), bound: specBound(spec.of) });
    } else if (spec.k === "nul") {
      const ty = specTy(spec.of);
      if (ty) this.scope.vars.push({ name, ty, opt: true, nul: true, bound: specBound(spec.of) });
    } else {
      const ty = specTy(spec)!;
      this.scope.vars.push({ name, ty, opt: false, bound: specBound(spec), ...(lone && ty === "str" ? { lone } : {}) });
    }
  }

  withScope<T>(f: () => T): T {
    const saved = { vars: [...this.scope.vars], lists: [...this.scope.lists], records: [...this.scope.records], htmls: [...this.scope.htmls] };
    try {
      return f();
    } finally {
      this.scope = saved;
    }
  }

  vars(ty: Ty, maxBound = Infinity, opt = false): Var[] {
    return this.scope.vars.filter((v) => v.ty === ty && v.opt === opt && (ty !== "int" || v.bound <= maxBound));
  }

  varRef(v: Var): Expr {
    return { ...atom(v.ty, v.name, v.bound), ref: v.name, ...(v.lone ? { lone: true } : {}) };
  }

  arrow(of: Spec, lone: boolean, body: () => Expr): { params: string; body: Expr } {
    const n = this.arrows++;
    const p = `a${n}`;
    const withIndex = this.r.chance(0.25);
    const e = this.withScope(() => {
      this.bind(p, of, false, lone);
      if (withIndex) this.scope.vars.push({ name: `j${n}`, ty: "int", opt: false, bound: 100 });
      return body();
    });
    return { params: withIndex ? `(${p}, j${n})` : `(${p})`, body: { ...e, scoped: true } };
  }

  listExpr(d: number): ListExpr | null {
    const r = this.r;
    const lists = this.scope.lists.filter((l) => l.of.k === "str" || l.of.k === "int" || l.of.k === "obj");
    const records = this.scope.records.filter((x) => x.of.k === "str" || x.of.k === "int");
    let l: ListExpr = r.weighted<() => ListExpr>([
      [lists.length ? 5 : 0, () => { const v = r.pick(lists); return { of: v.of, kids: [], fmt: () => v.name, lone: false }; }],
      [records.length ? 2 : 0, () => {
        const v = r.pick(records);
        return r.chance(0.5) ? { of: { k: "str" }, kids: [], fmt: () => `Object.keys(${v.name})`, lone: false } : { of: v.of, kids: [], fmt: () => `Object.values(${v.name})`, lone: false };
      }],
      [2, () => {
        const s = this.str(d - 1);
        const sep = r.pick([",", " ", "", "a", "🦀", ", "]);
        return { of: { k: "str" }, kids: [s], fmt: (k, at) => `${recv(k[at])}.split(${quoted(sep)})`, lone: !!s.lone || sep === "" };
      }],
    ])();
    for (let ops = r.weighted([[3, 0], [4, 1], [2, 2]]); ops > 0; ops--) {
      const prev = l;
      const width = prev.kids.length;
      l = r.weighted<() => ListExpr>([
        [4, () => {
          const fn = this.arrow(prev.of, prev.lone, () => this.test(d - 1));
          return { ...prev, kids: [...prev.kids, fn.body], fmt: (k, at) => `${prev.fmt(k, at)}.filter(${fn.params} => ${k[at + width]})` };
        }],
        [3, () => {
          let out: Expr | undefined;
          const fn = this.arrow(prev.of, prev.lone, () => (out = r.chance(0.6) ? this.str(d - 1) : this.int(d - 1, BOUND_SMALL)));
          const of: Spec = out!.ty === "str" ? { k: "str" } : { k: "int", wide: false };
          return { of, kids: [...prev.kids, fn.body], fmt: (k, at) => `${prev.fmt(k, at)}.map(${fn.params} => ${k[at + width]})`, lone: !!out!.lone };
        }],
        [2, () => {
          const a = this.small();
          const b = r.chance(0.5) ? this.small() : null;
          const kids = b ? [a, b] : [a];
          return { ...prev, kids: [...prev.kids, ...kids], fmt: (k, at) => `${prev.fmt(k, at)}.slice(${k[at + width]}${b ? `, ${k[at + width + 1]}` : ""})` };
        }],
      ])();
    }
    return l;
  }

  small(): Expr {
    const r = this.r;
    return r.weighted<() => Expr>([
      [4, () => numLit(r.int(-6, 6), "int")],
      [2, () => this.int(1)],
      [1, () => this.float(0)],
    ])();
  }

  fromList(d: number): Expr | null {
    const r = this.r;
    const l = this.listExpr(d);
    if (!l || l.of.k === "obj") return l && l.of.k === "obj" ? this.objListLength(l) : null;
    const str = l.of.k === "str";
    return r.weighted<() => Expr>([
      [4, () => {
        const sep = r.pick(str && l.lone ? ["', '", "'-'", "' & '"] : [null, "', '", "'-'", "''", "' & '"]);
        return { ty: "str", bound: 0, kids: l.kids, atom: true, fmt: (k) => `${l.fmt(k, 0)}.join(${sep ?? ""})`, ...(str && l.lone ? { lone: true } : {}) };
      }],
      [l.lone ? 0 : 1, () => ({ ty: "str", bound: 0, kids: l.kids, atom: true, fmt: (k) => `JSON.stringify(${l.fmt(k, 0)})` })],
      [str ? 2 : 0, () => {
        const fn = this.arrow(l.of, l.lone, () => this.test(d - 1));
        const fallback = r.pick(STR_LITS);
        return { ty: "str", bound: 0, kids: [...l.kids, fn.body], atom: false, fmt: (k) => `${l.fmt(k, 0)}.find(${fn.params} => ${k[l.kids.length]}) ?? '${fallback}'`, ...(l.lone ? { lone: true } : {}) };
      }],
    ])();
  }

  objListLength(l: ListExpr): Expr {
    return { ty: "str", bound: 0, kids: l.kids, atom: true, fmt: (k) => `String(${l.fmt(k, 0)}.length)` };
  }

  intFromList(d: number): Expr | null {
    const r = this.r;
    const l = this.listExpr(d);
    if (!l) return null;
    return r.weighted<() => Expr>([
      [3, () => ({ ty: "int", bound: 2 ** 31, kids: l.kids, atom: true, fmt: (k) => `${l.fmt(k, 0)}.length` })],
      [2, () => {
        const fn = this.arrow(l.of, l.lone, () => this.test(d - 1));
        return { ty: "int", bound: 2 ** 31, kids: [...l.kids, fn.body], atom: true, fmt: (k) => `${l.fmt(k, 0)}.findIndex(${fn.params} => ${k[l.kids.length]})` };
      }],
      [l.of.k === "int" ? 1 : 0, () => {
        const fn = this.arrow(l.of, l.lone, () => this.test(d - 1));
        return { ty: "int", bound: BOUND_SMALL, kids: [...l.kids, fn.body], atom: false, fmt: (k) => `${l.fmt(k, 0)}.find(${fn.params} => ${k[l.kids.length]}) ?? 0` };
      }],
    ])();
  }

  boolFromList(d: number): Expr | null {
    const r = this.r;
    const l = this.listExpr(d);
    if (!l) return null;
    return r.weighted<() => Expr>([
      [3, () => {
        const m = r.pick(["some", "every"]);
        const fn = this.arrow(l.of, l.lone, () => this.test(d - 1));
        return { ty: "bool", bound: 0, kids: [...l.kids, fn.body], atom: true, fmt: (k) => `${l.fmt(k, 0)}.${m}(${fn.params} => ${k[l.kids.length]})` };
      }],
      [l.of.k === "obj" ? 0 : 2, () => {
        const x = l.of.k === "str" ? `'${r.pick(STR_LITS)}'` : String(r.pick([0, 1, 2, -1, 7]));
        return { ty: "bool", bound: 0, kids: l.kids, atom: true, fmt: (k) => `${l.fmt(k, 0)}.includes(${x})` };
      }],
    ])();
  }

  str(d: number): Expr {
    const r = this.r;
    const leaf = (): Expr => {
      const vs = this.vars("str");
      const opts = this.vars("str", Infinity, true);
      return r.weighted<() => Expr>([
        [vs.length ? 6 : 0, () => this.varRef(r.pick(vs))],
        [2, () => strLit(r.pick(STR_LITS))],
        [opts.length ? 2 : 0, () => node("str", [this.varRef(r.pick(opts)), strLit(r.pick(STR_LITS))], ([a, b]) => `${a} ?? ${b}`)],
        [this.tKeys.length && this.tNames.length ? 2 : 0, () => this.translated(d)],
      ])();
    };
    if (d <= 0 || r.chance(0.3)) return leaf();
    const lists = this.scope.lists.filter((l) => l.of.k === "str" || l.of.k === "int");
    const opts = this.vars("str", Infinity, true);
    const str = (kids: Expr[], fmt: (k: string[]) => string, from: Expr[] = kids, isAtom = false): Expr => ({
      ...node("str", kids, fmt, 0, isAtom),
      ...(from.some((k) => k.lone) ? { lone: true } : {}),
    });
    const pair = (): [Expr, Expr] => {
      const a = this.str(d - 1);
      const b = this.str(d - 1);
      return [a, a.lone && b.lone ? strLit(r.pick(STR_LITS)) : b];
    };
    const options: [number, () => Expr][] = [
      [3, () => str(pair(), ([a, b]) => `${a} + ${b}`)],
      [2, () => str([this.str(d - 1), this.num(d - 1)], ([a, b]) => `${a} + ${b}`)],
      [1, () => str([this.num(d - 1), this.str(d - 1)], ([a, b]) => `${a} + ${b}`)],
      [3, () => this.template(d)],
      [2, () => { const t = this.test(d - 1); const [a, b] = [this.str(d - 1), this.str(d - 1)]; return str([t, a, b], ([c, x, y]) => `${c} ? ${x} : ${y}`, [a, b]); }],
      [1, () => str([this.str(d - 1), this.str(d - 1)], ([a, b]) => `${a} || ${b}`)],
      [opts.length ? 2 : 0, () => str([this.varRef(r.pick(opts)), this.str(d - 1)], ([a, b]) => `${a} ?? ${b}`)],
      [
        4,
        () => {
          const m = r.pick(["trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase"]);
          return str([this.str(d - 1)], ([a]) => `${recv(a)}.${m}()`, undefined, true);
        },
      ],
      [3, () => {
        const m = r.pick(["slice", "slice", "substring"]);
        const s = this.str(d - 1);
        const kids = r.chance(0.6) ? [s, this.small(), this.small()] : [s, this.small()];
        return { ...node("str", kids, ([a, i, j]) => `${recv(a)}.${m}(${i}${j === undefined ? "" : `, ${j}`})`, 0, true), lone: true };
      }],
      [2, () => {
        const s = this.str(d - 1);
        return r.chance(0.5)
          ? { ...node("str", [s, this.small()], ([a, i]) => `${recv(a)}.charAt(${i})`, 0, true), lone: true }
          : { ...node("str", [s, this.small()], ([a, i]) => `${recv(a)}.at(${i}) ?? '${r.pick(STR_LITS)}'`), lone: true };
      }],
      [2, () => {
        const m = r.pick(["replace", "replaceAll"]);
        const pattern = r.pick(["", "a", " ", "🦀", "<", "&", "ab"]);
        const repl = r.pick(REPLACEMENTS);
        const s = this.str(d - 1);
        const lone = !!s.lone || (m === "replaceAll" && pattern === "");
        return { ...node("str", [s], ([a]) => `${recv(a)}.${m}(${quoted(pattern)}, ${quoted(repl)})`, 0, true), ...(lone ? { lone } : {}) };
      }],
      [2, () => {
        const m = r.pick(["padStart", "padEnd"]);
        const s = this.str(d - 1);
        const fill = r.pick(s.lone ? [null, "", "0", "ab", "é", " "] : [null, "", "0", "ab", "🦀", "é", " "]);
        const counts = this.vars("int", 11).filter((v) => /^c\d/.test(v.name));
        const width: Expr = counts.length && r.chance(0.3) ? this.varRef(r.pick(counts)) : numLit(r.int(0, 10), "int");
        const lone = !!s.lone || fill === "🦀";
        return { ...node("str", [s, width], ([a, w]) => `${recv(a)}.${m}(${w}${fill === null ? "" : `, '${fill}'`})`, 0, true), ...(lone ? { lone } : {}) };
      }],
      [1, () => {
        const s = this.str(d - 1);
        if (s.lone) return leaf();
        return node("str", [s], ([a]) => `${recv(a)}.repeat(${r.int(0, 3)})`, 0, true);
      }],
      [1, () => {
        const v = r.weighted<() => Expr>([[3, () => this.str(d - 1)], [2, () => this.num(d - 1)], [1, () => this.bool(d - 1)]])();
        return v.lone ? leaf() : node("str", [v], ([a]) => `JSON.stringify(${a})`, 0, true);
      }],
      [3, () => this.fromList(d) ?? leaf()],
      [1, () => node("str", [this.num(d - 1)], ([a]) => `String(${a})`, 0, true)],
      [1, () => node("str", [this.num(d - 1)], ([a]) => `${recv(a)}.toString()`, 0, true)],
      [
        3,
        () => {
          const digits = r.pick([0, 0, 1, 2, 2, 3, 5, 10, 20]);
          return node("str", [this.num(d - 1)], ([a]) => `${recv(a)}.toFixed(${digits})`, 0, true);
        },
      ],
      [
        lists.length ? 2 : 0,
        () => {
          const l = r.pick(lists);
          const sep = r.pick([null, "', '", "'-'", "''", "' & '"]);
          return atom("str", `${l.name}.join(${sep ?? ""})`);
        },
      ],
    ];
    return r.weighted(options)();
  }

  translated(d: number): Expr {
    const r = this.r;
    const t = r.pick(this.tNames);
    if (r.chance(0.06)) return atom("str", `${t}('${r.pick(["missing", "menu.none", "no.such.key"])}')`);
    const k = r.pick(this.tKeys);
    const arg = (): Expr => (r.chance(0.6) ? this.str(d - 1) : this.int(d - 1, BOUND_SMALL));
    const call = (kids: Expr[], fmt: (ks: string[]) => string): Expr => ({ ...node("str", kids, fmt, 0, true), ...(kids.some((x) => x.lone) ? { lone: true } : {}) });
    switch (k.kind) {
      case "plain":
        return atom("str", `${t}('${k.key}')`);
      case "named": {
        const names = k.names.filter(() => r.chance(0.85));
        return call(names.map(arg), (ks) => `${t}('${k.key}', { ${names.map((n, i) => `${n}: ${ks[i]}`).join(", ")} })`);
      }
      case "list":
        return call([arg(), arg()], ([a, b]) => `${t}('${k.key}', [${a}, ${b}])`);
      case "plural": {
        const counts = this.vars("int", BOUND_SMALL).filter((v) => !/^[xa]\d/.test(v.name));
        const plural = (): Expr => (counts.length && r.chance(0.7) ? this.varRef(r.pick(counts)) : numLit(r.int(0, 12), "int"));
        const n = plural();
        const name = k.names[0]!;
        return r.weighted<() => Expr>([
          [3, () => call([n], ([a]) => `${t}('${k.key}', ${a})`)],
          [2, () => call([n], ([a]) => `${t}('${k.key}', { ${name}: ${a} })`)],
          [1, () => call([n, plural()], ([a, b]) => `${t}('${k.key}', { ${name}: ${a} }, ${b})`)],
        ])();
      }
    }
  }

  template(d: number): Expr {
    const r = this.r;
    const parts: Expr[] = [];
    for (let n = r.int(1, 3); n > 0; n--) {
      parts.push(r.weighted<() => Expr>([[4, () => this.str(d - 1)], [3, () => this.num(d - 1)], [1, () => this.bool(d - 1)]])());
    }
    const texts = [r.pick(TPL_TEXT), ...parts.map(() => r.pick(TPL_TEXT))];
    for (let i = 1; i < parts.length; i++) if (parts[i - 1]!.lone && parts[i]!.lone && !texts[i]) texts[i] = " ";
    return {
      ty: "str",
      bound: 0,
      kids: parts,
      atom: true,
      ...(parts.some((p) => p.lone) ? { lone: true } : {}),
      fmt: (k) => "`" + texts[0] + k.map((s, i) => "${" + s + "}" + texts[i + 1]).join("") + "`",
    };
  }

  int(d: number, max = LIMIT): Expr {
    const r = this.r;
    const leaf = (): Expr => {
      const vs = this.vars("int", max);
      const strs = this.vars("str");
      const opts = this.vars("int", max, true);
      return r.weighted<() => Expr>([
        [vs.length ? 6 : 0, () => this.varRef(r.pick(vs))],
        [2, () => numLit(r.pick([0, 1, 2, 3, 7, 10, 42, 100, -1, -5]), "int")],
        [strs.length && max > 2 ** 31 ? 2 : 0, () => node("int", [this.varRef(r.pick(strs))], ([a]) => `${a}.length`, 2 ** 31, true)],
        [this.scope.lists.length && max > 2 ** 31 ? 1 : 0, () => atom("int", `${r.pick(this.scope.lists).name}.length`, 2 ** 31)],
        [opts.length ? 2 : 0, () => { const v = r.pick(opts); return node("int", [this.varRef(v), numLit(r.int(0, 9), "int")], ([a, b]) => `${a} ?? ${b}`, Math.max(v.bound, 10)); }],
      ])();
    };
    if (d <= 0 || r.chance(0.3)) return leaf();
    const half = max / 2;
    const root = Math.sqrt(max);
    const options: [number, () => Expr][] = [
      [3, () => { const a = this.int(d - 1, half), b = this.int(d - 1, half); return node("int", [a, b], ([x, y]) => `${x} + ${y}`, a.bound + b.bound); }],
      [3, () => { const a = this.int(d - 1, half), b = this.int(d - 1, half); return node("int", [a, b], ([x, y]) => `${x} - ${y}`, a.bound + b.bound); }],
      [2, () => { const a = this.int(d - 1, root), b = this.int(d - 1, root); return node("int", [a, b], ([x, y]) => `${x} * ${y}`, a.bound * b.bound); }],
      [1, () => { const a = this.int(d - 1, max); return node("int", [a], ([x]) => `-${x}`, a.bound); }],
      [2, () => { const a = this.int(d - 1, max), m = r.pick([2, 3, 7, 10]); return node("int", [a, numLit(m, "int")], ([x, y]) => `${x} % ${y}`, a.bound); }],
      [2, () => { const a = this.int(d - 1, max), b = this.int(d - 1, max), f = r.pick(["max", "min"]); return node("int", [a, b], ([x, y]) => `Math.${f}(${x}, ${y})`, Math.max(a.bound, b.bound), true); }],
      [1, () => { const a = this.int(d - 1, max); return node("int", [a], ([x]) => `Math.abs(${x})`, a.bound, true); }],
      [2, () => { const a = this.int(d - 1, max), b = this.int(d - 1, max); return node("int", [this.test(d - 1), a, b], ([c, x, y]) => `${c} ? ${x} : ${y}`, Math.max(a.bound, b.bound)); }],
      [max > 2 ** 31 ? 2 : 0, () => { const m = r.pick(["indexOf", "lastIndexOf"]); const lit = r.pick(STR_LITS); return node("int", [this.str(d - 1)], ([a]) => `${recv(a)}.${m}('${lit}')`, 2 ** 31, true); }],
      [max > 2 ** 31 ? 2 : 0, () => this.intFromList(d) ?? leaf()],
    ];
    const e = r.weighted(options)();
    return e.bound < max ? e : leaf();
  }

  float(d: number): Expr {
    const r = this.r;
    const leaf = (): Expr => {
      const vs = this.vars("float");
      const opts = this.vars("float", Infinity, true);
      return r.weighted<() => Expr>([
        [vs.length ? 6 : 0, () => this.varRef(r.pick(vs))],
        [2, () => numLit(r.pick([0.5, 0.1, 1.5, 2.25, 1e-7, 0.3, 100.5, 3.14159, 1.005]), "float")],
        [opts.length ? 2 : 0, () => node("float", [this.varRef(r.pick(opts)), numLit(r.pick([0.5, 1.25, 0.1]), "float")], ([a, b]) => `${a} ?? ${b}`)],
        [opts.length ? 0.1 : 0, () => node("float", [this.varRef(r.pick(opts)), numLit(0, "float")], ([a, b]) => `${a} ?? ${b}`)],
        [vs.length ? 0 : 2, () => node("float", [this.int(0), this.int(0)], ([a, b]) => `${a} / ${b}`)],
      ])();
    };
    if (d <= 0 || r.chance(0.3)) return leaf();
    const options: [number, () => Expr][] = [
      [4, () => { const op = r.pick(["+", "-", "*"]); const [a, b] = r.chance(0.5) ? [this.float(d - 1), this.num(d - 1)] : [this.num(d - 1), this.float(d - 1)]; return node("float", [a, b], ([x, y]) => `${x} ${op} ${y}`); }],
      [3, () => node("float", [this.num(d - 1), this.num(d - 1)], ([x, y]) => `${x} / ${y}`)],
      [1, () => node("float", [this.float(d - 1), this.num(d - 1)], ([x, y]) => `${x} % ${y}`)],
      [this.vars("int").length ? 1 : 0, () => node("float", [this.int(d - 1), this.varRef(r.pick(this.vars("int")))], ([x, y]) => `${x} % ${y}`)],
      [1, () => node("float", [this.float(d - 1)], ([x]) => `-${x}`)],
      [2, () => { const f = r.pick(["round", "floor", "ceil", "trunc", "abs"]); return node("float", [this.float(d - 1)], ([x]) => `Math.${f}(${x})`, 0, true); }],
      [1, () => { const f = r.pick(["max", "min"]); return node("float", [this.float(d - 1), this.num(d - 1)], ([x, y]) => `Math.${f}(${x}, ${y})`, 0, true); }],
      [1, () => node("float", [this.test(d - 1), this.float(d - 1), this.float(d - 1)], ([c, x, y]) => `${c} ? ${x} : ${y}`)],
      [2, () => { const f = r.pick(["Number", "parseFloat", "parseInt", "parseInt", "parseInt"]); const radix = f === "parseInt" ? r.pick(["", ", 10", ", 16"]) : ""; return node("float", [this.str(d - 1)], ([s]) => `${f}(${s}${radix})`, 0, true); }],
    ];
    return r.weighted(options)();
  }

  num(d: number): Expr {
    return this.r.chance(0.5) ? this.int(d) : this.float(d);
  }

  bool(d: number): Expr {
    const r = this.r;
    const leaf = (): Expr => {
      const vs = this.vars("bool");
      return vs.length && r.chance(0.85) ? this.varRef(r.pick(vs)) : atom("bool", r.pick(["true", "false"]));
    };
    if (d <= 0 || r.chance(0.25)) return leaf();
    const strLists = this.scope.lists.filter((l) => l.of.k === "str");
    const options: [number, () => Expr][] = [
      [4, () => { const op = r.pick(["<", ">", "<=", ">=", "===", "!=="]); return node("bool", [this.num(d - 1), this.num(d - 1)], ([a, b]) => `${a} ${op} ${b}`); }],
      [3, () => {
        const op = r.pick(["===", "!=="]);
        const a = this.str(d - 1);
        const b = r.chance(0.6) ? strLit(r.pick(STR_LITS)) : this.str(d - 1);
        return node("bool", [a, a.lone && b.lone ? strLit(r.pick(STR_LITS)) : b], ([x, y]) => `${x} ${op} ${y}`);
      }],
      [2, () => {
        const op = r.pick(["<", ">", "<=", ">="]);
        const a = this.str(d - 1);
        const b = r.chance(0.4) ? strLit(r.pick(STR_LITS)) : this.str(d - 1);
        const low = (e: Expr) => e.kids.length === 0 && LOW_LITS.some((l) => e.fmt([]) === `'${l}'`);
        const fix = (x: Expr, other: Expr) => (other.lone && !low(x) ? strLit(r.pick(LOW_LITS)) : x);
        const [x, y] = [fix(a, b), fix(b, a)];
        return node("bool", [x.lone && y.lone ? strLit(r.pick(LOW_LITS)) : x, y], ([p, q]) => `${p} ${op} ${q}`);
      }],
      [1, () => {
        const m = r.pick(["includes", "startsWith", "endsWith"]);
        const needle = this.str(d - 1);
        return node("bool", [this.str(d - 1), needle.lone ? strLit(r.pick(STR_LITS)) : needle], ([a, b]) => `${recv(a)}.${m}(${b})`, 0, true);
      }],
      [2, () => this.boolFromList(d) ?? leaf()],
      [1, () => { const op = r.pick(["===", "!=="]); return node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} ${op} ${b}`); }],
      [2, () => node("bool", [this.bool(d - 1)], ([a]) => `!${a}`)],
      [2, () => node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} && ${b}`)],
      [2, () => node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} || ${b}`)],
      [2, () => { const m = r.pick(["includes", "startsWith", "endsWith"]); const lit = r.pick(STR_LITS); return node("bool", [this.str(d - 1)], ([a]) => `${recv(a)}.${m}('${lit}')`, 0, true); }],
      [strLists.length ? 1 : 0, () => atom("bool", `${r.pick(strLists).name}.includes('${r.pick(STR_LITS)}')`)],
    ];
    return r.weighted(options)();
  }

  test(d: number): Expr {
    const r = this.r;
    const optVars = this.scope.vars.filter((v) => v.opt);
    return r.weighted<() => Expr>([
      [5, () => this.bool(d)],
      [2, () => this.str(d - 1)],
      [2, () => this.int(d - 1)],
      [1, () => this.float(d - 1)],
      [optVars.length ? 2 : 0, () => this.varRef(r.pick(optVars))],
      [this.scope.lists.length ? 1 : 0, () => atom("int", `${r.pick(this.scope.lists).name}.length`, 2 ** 31)],
    ])();
  }

  cond(d: number): Expr {
    const r = this.r;
    const optVars = this.scope.vars.filter((v) => v.opt);
    if (optVars.length && r.chance(0.1)) {
      const v = r.pick(optVars);
      const op = r.pick(["===", "!==", "==", "!="]);
      const literal = op.length === 2 ? r.pick(["null", "undefined"]) : v.nul ? "null" : "undefined";
      const flipped = r.chance(0.2);
      return node("bool", [this.varRef(v)], ([a]) => (flipped ? `${literal} ${op} ${a}` : `${a} ${op} ${literal}`));
    }
    if (d <= 0 || r.chance(0.6)) return this.test(d);
    return r.weighted<() => Expr>([
      [2, () => node("bool", [this.cond(d - 1)], ([a]) => `!${a}`)],
      [2, () => { const a = this.cond(d - 1), b = this.cond(d - 1); return { ...node(a.ty === b.ty ? a.ty : "bool", [a, b], ([x, y]) => `${x} && ${y}`), and: true }; }],
      [2, () => { const a = this.cond(d - 1), b = this.cond(d - 1); return node(a.ty === b.ty ? a.ty : "bool", [a, b], ([x, y]) => `${x} || ${y}`); }],
    ])();
  }

  text(d: number): Expr {
    const r = this.r;
    const opts = this.scope.vars.filter((v) => v.opt);
    return r.weighted<() => Expr>([
      [5, () => this.str(d)],
      [3, () => this.int(d)],
      [3, () => this.float(d)],
      [2, () => this.bool(d)],
      [opts.length ? 2 : 0, () => this.varRef(r.pick(opts))],
      [0.1, () => atom("int", r.pick(["1e21", "1e20", "2e3", "9007199254740993"]), LIMIT)],
    ])();
  }

  classBind(): ClassBind {
    const r = this.r;
    const name = (): string => r.pick(["on", "big", "x-y", "'a b'", "'is-active'", "active", "'<b>'", "'&'"]);
    return r.weighted<() => ClassBind>([
      [2, () => ({ k: "expr", e: this.str(2) })],
      [
        2,
        () => ({
          k: "arr",
          items: Array.from({ length: r.int(1, 3) }, () => (r.chance(0.4) ? strLit(r.pick(STR_LITS)) : this.str(1))),
        }),
      ],
      [
        3,
        () => {
          const seen = new Set<string>();
          const entries: { key: string | Expr; cond: Expr }[] = [];
          for (let n = r.int(1, 3); n > 0; n--) {
            let key: string | Expr = r.chance(0.25) ? this.str(1) : name().replace(/^([\w]+)-([\w]+)$/, "'$1-$2'");
            if (typeof key !== "string" && key.lone && entries.some((en) => typeof en.key !== "string" && en.key.lone)) key = name().replace(/^([\w]+)-([\w]+)$/, "'$1-$2'");
            if (typeof key === "string" && seen.has(key)) continue;
            if (typeof key === "string") seen.add(key);
            entries.push({ key, cond: this.test(1) });
          }
          return { k: "obj", entries };
        },
      ],
    ])();
  }

  style(): { key: string; e: Expr }[] {
    const r = this.r;
    const entries: { key: string; e: Expr }[] = [];
    const used = new Set<string>();
    for (let n = r.int(1, 3); n > 0; n--) {
      const [key, e] = r.weighted<() => [string, Expr]>([
        [2, () => ["color", this.str(1)]],
        [2, () => ["fontSize", node("str", [this.num(1)], ([a]) => `${a} + 'px'`)]],
        [2, () => ["opacity", this.float(1)]],
        [1, () => ["lineHeight", this.num(1)]],
        [1, () => ["'--gap'", this.int(1)]],
        [1, () => ["zIndex", this.int(1)]],
        [1, () => ["'margin-top'", this.str(1)]],
        [1, () => ["display", strLit(r.pick(["flex", "", "block"]))]],
        [1, () => {
          const opts = this.scope.vars.filter((v) => v.opt && v.ty !== "bool");
          return ["width", opts.length ? this.varRef(r.pick(opts)) : this.str(0)];
        }],
      ])();
      if (used.has(key)) continue;
      used.add(key);
      entries.push({ key, e });
    }
    return entries;
  }

  attrs(tag: string): Attr[] {
    const r = this.r;
    const out: Attr[] = [];
    const names = new Set<string>();
    const add = (a: Attr, name: string): void => {
      if (names.has(name)) return;
      names.add(name);
      out.push(a);
    };
    for (let n = r.weighted([[3, 0], [3, 1], [2, 2], [1, 4]]); n > 0; n--) {
      r.weighted<() => void>([
        [2, () => { const name = r.pick(["title", "data-k", "id", "lang"]); add({ k: "static", name, value: r.pick(["x", "a &amp; b", "&lt;&gt;", "", "é 🦀", "'q'"]) }, name); }],
        [1, () => add({ k: "static", name: "class", value: r.pick(["card", "a  b", " pad "]) }, "class")],
        [1, () => add({ k: "static", name: "style", value: r.pick(["color: red", "margin: 0;", "display:none"]) }, "style")],
        [1, () => { const name = r.pick(["disabled", "hidden"]); add({ k: "static", name, value: null }, this.vnode ? name : "boolean"); }],
        [5, () => { const name = r.pick(["title", "data-x", "aria-label", "id", "data-n", "tabindex", "lang", "alt", "placeholder"]); add({ k: "bind", name, e: this.text(2) }, name); }],
        [2, () => { const name = r.pick(["disabled", "hidden", "readonly", "checked"]); add({ k: "bind", name, e: r.chance(0.8) ? this.bool(2) : this.test(1) }, name); }],
        [3, () => add({ k: "class", v: this.classBind() }, ":class")],
        [2, () => add({ k: "style", entries: this.style() }, ":style")],
      ])();
    }
    if (tag === "input" && r.chance(0.5)) add({ k: "bind", name: "value", e: this.text(1) }, "value");
    const sorted = out.sort((a, b) => (a.k === "static" ? 0 : 1) - (b.k === "static" ? 0 : 1));
    const own = sorted.findIndex((a) => a.k === "static" && a.name === "class");
    const bound = sorted.findIndex((a) => a.k === "class");
    if (own < 0 || bound < 0 || (!this.vnode && r.chance(0.5))) return sorted;
    const [cls] = sorted.splice(own, 1);
    sorted.splice(sorted.indexOf(sorted.find((a) => a.k === "class")!), 0, cls!);
    return sorted;
  }

  kids(depth: number, ctx: "block" | "inline" | "list"): Node[] {
    const r = this.r;
    const out: Node[] = [];
    if (this.hollow && ctx !== "list") {
      for (let i = depth > 5 || this.nodes > 30 ? 1 : r.int(1, 3); i > 0; i--) out.push(this.hollowNode(depth, ctx));
      return out;
    }
    const n = depth > 3 || this.nodes > 30 ? r.int(0, 1) : r.int(1, 4);
    for (let i = 0; i < n; i++) out.push(this.node(depth, ctx));
    return out;
  }

  element(depth: number, ctx: "block" | "inline" | "list", tag?: string): Node & { k: "el" } {
    const r = this.r;
    this.nodes++;
    tag ??=
      ctx === "list"
        ? "li"
        : ctx === "inline"
          ? r.weighted([[5, r.pick(this.inLink ? ["span", "b", "i", "em", "strong", "small", "code", "label"] : ["span", "b", "i", "em", "strong", "a", "small", "code", "label"])], [1, r.pick(["br", "img", "input"])]])
          : r.weighted([[4, r.pick(["div", "section", "article", "header", "footer"])], [2, "p"], [2, r.pick(["ul", "ol"])], [3, r.pick(["span", "b", "em"])], [1, r.pick(["br", "hr", "img", "input"])]]);
    const isVoid = ["br", "hr", "img", "input"].includes(tag);
    const attrs = this.attrs(tag);
    if (isVoid) return { k: "el", tag, attrs, kids: [], void: true };
    const para = this.para || tag === "p";
    const htmls = this.scope.htmls.filter((v) => !para || v.inline);
    if (htmls.length && ["div", "section", "article", "p", "span", "li", "em"].includes(tag) && r.chance(0.3)) {
      return { k: "el", tag, attrs, kids: [], html: { ...this.varRef(r.pick(htmls)), fixed: true } };
    }
    const inner = tag === "ul" || tag === "ol" ? "list" : ["div", "section", "article", "header", "footer", "li", "template"].includes(tag) ? (ctx === "inline" ? "inline" : "block") : "inline";
    const outer = this.para;
    this.para = para;
    try {
      return { k: "el", tag, attrs, kids: this.kids(depth + 1, inner) };
    } finally {
      this.para = outer;
    }
  }

  carrier(depth: number, ctx: "block" | "inline" | "list"): Node & { k: "el" } {
    if (ctx !== "list" && this.r.chance(this.hollow ? 0.6 : 0.2)) {
      this.nodes++;
      return { k: "el", tag: "template", attrs: [], kids: this.kids(depth + 1, ctx) };
    }
    return this.element(depth, ctx);
  }

  node(depth: number, ctx: "block" | "inline" | "list"): Node {
    const r = this.r;
    if (ctx === "list") {
      return r.weighted<() => Node>([
        [3, () => this.element(depth, ctx)],
        [2, () => this.ifNode(depth, ctx)],
        [3, () => this.forNode(depth, ctx)],
      ])();
    }
    return r.weighted<() => Node>([
      [3, () => ({ k: "text", s: r.pick(TEXTS) })],
      [5, () => ({ k: "interp", e: this.text(r.int(0, 3)) })],
      [depth < 5 ? 4 : 0, () => this.element(depth, ctx)],
      [depth < 5 ? 2 : 0, () => this.ifNode(depth, ctx)],
      [depth < 5 ? 2 : 0, () => this.forNode(depth, ctx)],
      [depth < 4 && ctx === "block" ? 3 : 0, () => this.child(depth)],
      [depth < 4 && ctx === "block" ? 0.6 : 0, () => this.clientOnly(depth)],
      [depth < 4 && ctx === "block" && !this.slotted ? 0.4 : 0, () => this.teleport(depth)],
      [depth < 5 && this.routes.length && !this.slotted ? 2 : 0, () => this.link(depth)],
      [this.reads.length ? 1 : 0, () => ({ k: "read", text: r.pick(this.reads) })],
    ])();
  }

  link(depth: number): Node {
    const r = this.r;
    this.nodes++;
    const route = r.pick(this.routes);
    const present = (p: string): Expr => node("str", [whole(this.str(1))], ([a]) => `${a} || '${p}'`);
    const query = (): { key: string; e: Expr }[] => (r.chance(0.4) ? ["q", "tab"].filter(() => r.chance(0.6)).map((key) => ({ key, e: whole(this.str(1)) })) : []);
    const hash = (): string | null => (r.chance(0.25) ? r.pick(["#top", "#a-b", "#é"]) : null);
    const last = route.params.at(-1);
    const prefix = last && !last.optional && !last.rest && route.full.endsWith(`:${last.name}`) ? route.full.slice(0, -last.name.length - 1) : null;
    const to = r.weighted<() => LinkTo>([
      [2, () => ({ k: "lit", path: literalPath(r, route) })],
      [prefix !== null ? 2 : 0, () => ({ k: "str", e: node("str", [whole(this.str(1))], ([a]) => `'${prefix}' + ${a}`) })],
      [route.name !== null ? 3 : 0, () => ({
        k: "obj",
        name: route.name,
        path: null,
        params: route.params.filter((p) => !p.optional || r.chance(0.5)).map((p) => ({ key: p.name, e: p.optional ? whole(this.str(1)) : present(p.name) })),
        query: query(),
        hash: hash(),
      })],
      [route.params.length === 0 ? 1 : 0, () => ({ k: "obj", name: null, path: route.full, params: [], query: query(), hash: hash() })],
    ])();
    const vnode = this.vnode;
    const inLink = this.inLink;
    this.vnode = true;
    this.inLink = true;
    try {
      const attrs = r.chance(0.3) ? this.attrs("a").filter((a) => a.k !== "static" || a.name !== "class") : [];
      return {
        k: "link",
        to,
        attrs,
        kids: this.kids(depth + 1, "inline"),
        active: r.chance(0.2) ? r.pick(["on", "is-here"]) : null,
        exact: r.chance(0.2) ? r.pick(["exact", "is-here"]) : null,
      };
    } finally {
      this.vnode = vnode;
      this.inLink = inLink;
    }
  }

  teleport(depth: number): Node {
    const r = this.r;
    this.nodes++;
    const to = r.pick(["body", "#modal", "#side"]);
    return { k: "teleport", to, disabled: r.chance(0.3) ? this.bool(1) : null, kids: this.kids(depth + 1, "block") };
  }

  clientOnly(depth: number): Node {
    const r = this.r;
    this.nodes++;
    const kids = this.kids(depth + 1, "block");
    if (r.chance(0.3)) kids.push({ k: "text", s: "{{ Math.random().toFixed(3) }}" });
    return { k: "client", kids, fallback: !this.vnode && r.chance(0.6) ? this.kids(depth + 1, "block") : null };
  }

  child(depth: number): Node {
    const r = this.r;
    this.nodes++;
    const names: HelperName[] = ["FzLeaf", "FzBox", "FzFwd", "FzPair", "FzRoot", "FzOwn", "FzBind", "FzUse", "FzPlain", "FzBare", "FzInj", "FzProv", "FzHead", "FzSlots"];
    const name = this.favour.length && r.chance(0.5) ? r.pick(this.favour) : r.pick(names);
    const attrs = r.chance(0.6) ? this.attrs("div") : [];
    const is = r.chance(0.2) ? { is: { test: this.cond(r.int(0, 2)), other: r.pick<HelperName | InlineTag>([...names, "span", "b", "em"]) } } : {};
    if (!HELPERS[name].slot || !r.chance(0.8)) return { k: "child", name, attrs, kids: [], ...is };
    const vnode = this.vnode;
    const hollow = this.hollow;
    const slotted = this.slotted;
    this.slotted = true;
    if (!this.hollow && r.chance(0.75)) this.hollow = true;
    if ("is" in is) this.vnode = true;
    try {
      return { k: "child", name, attrs, kids: this.kids(depth + 1, "block"), ...is };
    } finally {
      this.hollow = hollow;
      this.vnode = vnode;
      this.slotted = slotted;
    }
  }

  hollowNode(depth: number, ctx: "block" | "inline"): Node {
    const r = this.r;
    const opts = this.scope.vars.filter((v) => v.opt);
    const deep = depth > 5 || this.nodes > 30;
    return r.weighted<() => Node>([
      [opts.length ? 4 : 0, () => ({ k: "interp", e: this.varRef(r.pick(opts)) })],
      [2, () => ({ k: "interp", e: this.str(1) })],
      [1, () => ({ k: "text", s: r.pick([" ", "  ", "\n    "]) })],
      [deep ? 0 : 3, () => this.forNode(depth, ctx)],
      [deep ? 0 : 3, () => this.ifNode(depth, ctx)],
      [deep ? 0 : 1, () => this.element(depth, ctx)],
      [deep || ctx !== "block" ? 0 : 1, () => this.child(depth)],
    ])();
  }

  ifNode(depth: number, ctx: "block" | "inline" | "list"): Node {
    const r = this.r;
    const branches: { cond: Expr | null; node: Node & { k: "el" } }[] = [];
    const n = r.weighted([[4, 1], [3, 2], [1, 3]]);
    for (let i = 0; i < n; i++) {
      const narrowable = this.scope.vars.filter((v) => v.opt);
      if (narrowable.length && r.chance(0.3)) {
        const v = r.pick(narrowable);
        const test = r.chance(0.3) ? `!= ${r.pick(["null", "undefined"])}` : `!== ${v.nul ? "null" : "undefined"}`;
        const cond: Expr = { ...(r.chance(0.6) ? this.varRef(v) : node("bool", [this.varRef(v)], ([a]) => `${a} ${test}`)), fixed: true };
        const el = this.withScope(() => {
          this.scope.vars = this.scope.vars.map((x) => (x === v ? { ...x, opt: false } : x));
          return this.carrier(depth, ctx);
        });
        branches.push({ cond, node: el });
      } else {
        const cond = this.cond(r.int(1, 2));
        const narrowed = new Set<string>();
        const walk = (e: Expr): void => {
          if (e.and) e.kids.forEach(walk);
          else if (e.ref) narrowed.add(e.ref);
        };
        walk(cond);
        const el = this.withScope(() => {
          this.scope.vars = this.scope.vars.map((x) => (x.opt && narrowed.has(x.name) ? { ...x, opt: false } : x));
          return this.carrier(depth, ctx);
        });
        branches.push({ cond, node: el });
      }
    }
    if (r.chance(0.5)) branches.push({ cond: null, node: this.carrier(depth, ctx) });
    return { k: "if", branches };
  }

  forNode(depth: number, ctx: "block" | "inline" | "list"): Node {
    const r = this.r;
    return this.withScope(() => {
      const d = this.loopDepth++;
      try {
        const item = `x${d}`;
        const index = `i${d}`;
        const withIndex = r.chance(0.5);
        const counts = this.scope.vars.filter((v) => v.ty === "int" && !v.opt && v.bound <= 10 && /^c\d/.test(v.name));
        const records = this.scope.records;
        if (records.length && r.chance(0.3)) {
          const rec = r.pick(records);
          const key = `k${d}`;
          this.bind(item, rec.of);
          this.scope.vars.push({ name: key, ty: "str", opt: false, bound: 0 });
          if (withIndex) this.scope.vars.push({ name: index, ty: "int", opt: false, bound: 100 });
          const head = r.chance(0.5)
            ? `(${item}, ${key}${withIndex ? `, ${index}` : ""}) in ${rec.name}`
            : `([${key}, ${item}]${withIndex ? `, ${index}` : ""}) in Object.entries(${rec.name})`;
          return { k: "for", head, node: this.carrier(depth, ctx) };
        }
        const source = r.weighted<() => [string, Spec, boolean]>([
          [this.scope.lists.length ? 6 : 0, () => { const l = r.pick(this.scope.lists); return [l.name, l.of, false]; }],
          [1, () => [String(r.int(0, 4)), { k: "count" }, false]],
          [counts.length ? 2 : 0, () => [r.pick(counts).name, { k: "count" }, false]],
          [1, () => [`[${Array.from({ length: r.int(1, 3) }, () => printExpr(strLit(r.pick(STR_LITS)))).join(", ")}]`, { k: "str" }, false]],
          [3, () => {
            const l = this.listExpr(2);
            if (!l) return [String(r.int(0, 4)), { k: "count" }, false];
            return [l.fmt(l.kids.map((k) => (k.atom ? printExpr(k) : `(${printExpr(k)})`)), 0), l.of, l.lone];
          }],
        ])();
        const [src, of, lone] = source;
        let head: string;
        if (of.k === "obj" && d === 0 && r.chance(0.3) && this.ifaces.get(of.iface)!.fields.some((f) => !this.scope.vars.some((v) => v.name === f.name))) {
          const fields = this.ifaces.get(of.iface)!.fields.filter((f) => !this.scope.vars.some((v) => v.name === f.name));
          const take = fields.filter(() => r.chance(0.6));
          if (!take.length && fields.length) take.push(fields[0]!);
          for (const f of take) this.bind(f.name, f.spec);
          head = `({ ${take.map((f) => f.name).join(", ")} }${withIndex ? `, ${index}` : ""}) in ${src}`;
        } else {
          this.bind(item, of.k === "count" ? { k: "int", wide: false } : of, false, lone);
          if (of.k === "count") this.scope.vars[this.scope.vars.length - 1]!.bound = 100;
          head = withIndex ? `(${item}, ${index}) in ${src}` : `${item} in ${src}`;
        }
        if (withIndex) this.scope.vars.push({ name: index, ty: "int", opt: false, bound: 100 });
        return { k: "for", head, node: this.carrier(depth, ctx) };
      } finally {
        this.loopDepth--;
      }
    });
  }
}

const TEXTS = [
  "hello",
  " ",
  "  ",
  "\n    ",
  "a &amp; b",
  "&lt;tag&gt;",
  "&nbsp;",
  "&copy; 2026",
  "&#x1F980;",
  "&#39;",
  "&quot;q&quot;",
  "“curly”",
  "'apos'",
  '"dq"',
  ">",
  "multiple   spaces",
  " lead",
  "trail ",
  "é",
  "שלום",
  "|",
  "a\n  b",
];

function randomSpec(r: Rng, ifaces: Iface[], depth: number): Spec {
  return r.weighted<() => Spec>([
    [5, () => ({ k: "str" })],
    [3, () => ({ k: "int", wide: r.chance(0.3) })],
    [3, () => ({ k: "float" })],
    [3, () => ({ k: "bool" })],
    [depth === 0 ? 4 : 1, () => ({ k: "opt", of: r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }, { k: "float" }, { k: "bool" }]) })],
    [depth === 0 ? 3 : 1, () => ({ k: "nul", of: r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }, { k: "float" }, { k: "bool" }]) })],
    [depth === 0 ? 2 : 1, () => ({ k: "list", of: r.pick<Spec>([{ k: "str" }, { k: "str" }, { k: "int", wide: false }]) })],
    [depth === 0 && ifaces.length ? 2 : 0, () => ({ k: "list", of: { k: "obj", iface: r.pick(ifaces).name } })],
    [depth === 0 ? 1 : 0, () => ({ k: "record", of: r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }, { k: "bool" }]), dict: r.chance(0.3) })],
  ])();
}

const ROW_IFACE: Iface = {
  name: "FzRow",
  fields: [
    { name: "title", spec: { k: "str" } },
    { name: "qty", spec: { k: "int", wide: false } },
    { name: "memo", spec: { k: "nul", of: { k: "str" } } },
  ],
};

function bindConsts(g: Gen, k: Consts, p: number): void {
  const r = g.r;
  const vars: Var[] = [
    { name: "LABEL", ty: "str", opt: false, bound: 0 },
    { name: "LIMIT", ty: "int", opt: false, bound: Math.abs(k.limit) + 1 },
    { name: "RATIO", ty: "float", opt: false, bound: 0 },
    { name: "SHOWN", ty: "bool", opt: false, bound: 0 },
    ...k.labels.map(([n]): Var => ({ name: `LABELS.${n}`, ty: "str", opt: false, bound: 0 })),
    ...k.tone.map(([n]): Var => ({ name: `Tone.${n}`, ty: "str", opt: false, bound: 0 })),
    { name: "Rank.Low", ty: "int", opt: false, bound: 1 },
    { name: "Rank.Mid", ty: "int", opt: false, bound: k.rank + 1 },
    { name: "Rank.High", ty: "int", opt: false, bound: k.rank + 2 },
    { name: `Rank[${k.rank}]`, ty: "str", opt: false, bound: 0 },
  ];
  for (const v of vars) if (r.chance(p)) g.scope.vars.push(v);
  if (r.chance(p)) g.bind("WORDS", { k: "list", of: { k: "str" } });
  if (r.chance(p)) g.bind("NUMS", { k: "list", of: { k: "int", wide: false } });
  if (r.chance(p)) g.bind("ROWS", { k: "list", of: { k: "obj", iface: ROW_IFACE.name } });
}

function literalOf(r: Rng, ty: Ty): Expr {
  if (ty === "str") return strLit(r.pick(STR_LITS));
  if (ty === "int") return numLit(r.int(-9, 9), "int");
  if (ty === "float") return numLit(r.pick([0.5, 1.25, -2.5, 0.1]), "float");
  return atom("bool", r.pick(["true", "false"]));
}

function scriptExpr(g: Gen, ty: Ty, d: number): Expr {
  if (ty === "str") return g.str(d);
  if (ty === "int") return g.int(d, BOUND_SMALL);
  if (ty === "float") return g.float(d);
  return g.bool(d);
}

const bindingVar = (b: Binding): Var => ({ name: b.name, ty: b.e.ty, opt: false, bound: b.e.ty === "int" ? Math.max(b.e.bound, 1) : 0, ...(b.e.lone ? { lone: true } : {}) });

const whole = (e: Expr): Expr => (e.lone ? strLit("whole") : e);

function headCall(g: Gen, kind: HeadCall["kind"]): HeadCall {
  const r = g.r;
  const str = (): HeadValue => {
    const opts = g.vars("str", Infinity, true);
    return { e: opts.length && r.chance(0.2) ? g.varRef(r.pick(opts)) : whole(g.str(r.int(0, 2))), getter: r.chance(0.4) };
  };
  const num = (): HeadValue => ({ e: r.chance(0.6) ? g.int(r.int(0, 2), BOUND_SMALL) : g.float(r.int(0, 1)), getter: r.chance(0.3) });
  const slots: [string, () => HeadValue][] =
    kind === "useHead"
      ? [
          ["title", str],
          ["titleTemplate", () => ({ e: strLit(r.pick(["%s · site", "%s | <&>", "%s", "fixed"])), getter: false })],
          ["htmlAttrs.lang", str],
          ["bodyAttrs.data-n", num],
          ["meta.name.description", str],
          ["meta.property.og:title", str],
          ["meta.name.rating", num],
          ["link.canonical", str],
        ]
      : [
          ["description", str],
          ["ogTitle", str],
          ["ogDescription", str],
          ["twitterTitle", str],
        ];
  const chosen = slots.filter(() => r.chance(0.4));
  if (!chosen.length) chosen.push(r.pick(slots));
  return { kind, entries: chosen.map(([at, v]) => ({ at, v: v() })) };
}

interface FlatRoute {
  full: string;
  name: string | null;
  params: { name: string; optional: boolean; rest: boolean }[];
}

interface TKey {
  key: string;
  kind: "plain" | "named" | "list" | "plural";
  names: string[];
}

function flatRoutes(routes: RouteNode[], parent = ""): FlatRoute[] {
  return routes.flatMap((r) => {
    const full = r.path.startsWith("/") ? r.path : r.path === "" ? parent || "/" : `${parent === "/" ? "" : parent}/${r.path}`;
    const params = [...full.matchAll(/:(\w+)(\?|\(\.\*\))?/g)].map((m) => ({ name: m[1]!, optional: m[2] === "?", rest: m[2] === "(.*)" }));
    return [{ full, name: r.name, params }, ...flatRoutes(r.children, full)];
  });
}

const PARAM_VALUES = ["a", "x-y", "42", "hello world", "é", "🦀", "a+b", "%E2%9C%93", "Ab_C"];

function literalPath(r: Rng, route: FlatRoute): string {
  return route.full.replace(/\/:(\w+)(\?|\(\.\*\))?/g, (_: string, _name: string, mark?: string) => {
    if (mark === "?" && r.chance(0.5)) return "";
    if (mark === "(.*)") return `/${r.pick(["deep/er", "x", "a b/c"])}`;
    return `/${r.pick(["a", "x-y", "42", "é"])}`;
  }) || "/";
}

function randomRouter(r: Rng): AppRouter {
  const leaf = (path: string, name: string | null): RouteNode => ({ path, name, children: [] });
  const routes: RouteNode[] = [leaf("/", "home")];
  if (r.chance(0.7)) routes.push(leaf("/blog/:slug", "post"));
  if (r.chance(0.5)) routes.push(leaf("/blog/:slug/:tab", "post-tab"));
  if (r.chance(0.5)) routes.push(leaf("/users/:name", null));
  if (r.chance(0.4)) routes.push(leaf("/docs/:lang?/intro", "intro"));
  if (r.chance(0.6)) routes.push(leaf("/search", "search"));
  if (r.chance(0.5)) {
    routes.push({ path: "/account", name: "account", children: [leaf("", "account-home"), { path: "orders", name: "orders", children: [leaf(":order", "order")] }] });
  }
  if (r.chance(0.3)) routes.push(leaf("/:rest(.*)", "missing"));
  return {
    routes,
    base: r.chance(0.2) ? "/app/" : null,
    active: r.chance(0.2) ? "act" : null,
    exact: r.chance(0.2) ? "exact-act" : null,
  };
}

function randomLocation(r: Rng, router: AppRouter): string {
  const routes = flatRoutes(router.routes);
  const route = r.pick(routes);
  let path = route.full.replace(/\/:(\w+)(\?|\(\.\*\))?/g, (_: string, _name: string, mark?: string) => {
    if (mark === "?" && r.chance(0.4)) return "";
    if (mark === "(.*)") return `/${r.pick(["deep/er", "x", "nothing/here/at/all"])}`;
    return `/${r.pick(PARAM_VALUES)}`;
  }) || "/";
  if (r.chance(0.15)) path = r.pick(["/nowhere", "/blog", "/account/orders/7/x"]);
  if (r.chance(0.4)) path += r.pick(["?q=rust", "?q=a&q=b", "?tab=x&q=", "?flag", "?q=%3Cb%3E"]);
  if (r.chance(0.2)) path += r.pick(["#top", "#a-b"]);
  return path;
}

const MESSAGE_KEYS = ["greet", "apples", "pair", "note", "loud", "menu.title", "menu.sub.item", "menu.count"];

function messageText(r: Rng): string {
  const raw = randomString(r, false).replace(/[\n\t]/g, " ");
  return raw.replace(/[{}@|]/g, (c) => `{'${c}'}`);
}

function messageSource(r: Rng, k: TKey, earlier: TKey[]): string {
  const text = (): string => messageText(r);
  switch (k.kind) {
    case "plain": {
      const links = earlier.filter((e) => e.kind === "plain" || e.kind === "named");
      const link = links.length && r.chance(0.5) ? ` @${r.pick(["", ".upper", ".lower", ".capitalize"])}:${r.pick(links).key}` : "";
      return `${text()}${link}${r.chance(0.2) ? " {'{'}x{'}'}" : ""}`;
    }
    case "named":
      return k.names.map((n) => `${text()}{${n}}`).join("") + text();
    case "list":
      return `${text()}{0}${text()}{1}${text()}`;
    case "plural": {
      const cases = Array.from({ length: r.int(2, 3) }, (_, i) => `${text()}${i ? `{${k.names[0]}}` : ""}${text() || "x"}`.trim() || "x");
      return cases.join(" | ");
    }
  }
}

function randomMessages(r: Rng): { messages: Messages; keys: TKey[] } {
  const keys: TKey[] = [];
  for (const key of MESSAGE_KEYS) {
    if (!r.chance(0.5)) continue;
    const kind = r.pick<TKey["kind"]>(["plain", "plain", "named", "list", "plural"]);
    const names = kind === "named" ? ["name", "who"].filter((_, i) => i === 0 || r.chance(0.5)) : kind === "plural" ? [r.pick(["count", "n"])] : [];
    keys.push({ key, kind, names });
  }
  if (!keys.length) keys.push({ key: "greet", kind: "plain", names: [] });
  const en: Record<string, string> = {};
  const nl: Record<string, string> = {};
  keys.forEach((k, i) => {
    en[k.key] = messageSource(r, k, keys.slice(0, i));
    if (r.chance(0.6)) nl[k.key] = messageSource(r, k, keys.slice(0, i));
  });
  return { messages: { locales: { en, ...(Object.keys(nl).length ? { nl } : {}) } }, keys };
}

function randomStores(r: Rng, g: Gen): StoreDef[] {
  const stores: StoreDef[] = [];
  const option: { name: string; spec: Spec }[] = [
    { name: "title", spec: { k: "str" } },
    { name: "count", spec: { k: "int", wide: false } },
    { name: "ratio", spec: { k: "float" } },
    { name: "on", spec: { k: "bool" } },
    { name: "note", spec: { k: "opt", of: { k: "str" } } },
    { name: "tag", spec: { k: "nul", of: { k: "str" } } },
    { name: "tags", spec: { k: "list", of: { k: "str" } } },
    { name: "items", spec: { k: "list", of: { k: "obj", iface: FZ_ITEM.name } } },
  ];
  const setup: { name: string; spec: Spec }[] = [
    { name: "label", spec: { k: "str" } },
    { name: "n", spec: { k: "int", wide: false } },
    { name: "flag", spec: { k: "bool" } },
    { name: "owner", spec: { k: "nul", of: { k: "str" } } },
    { name: "picks", spec: { k: "list", of: { k: "int", wide: false } } },
    { name: "share", spec: { k: "float" } },
  ];
  const make = (id: string, hook: string, isSetup: boolean, all: { name: string; spec: Spec }[], getter: string, read: (f: string) => string): void => {
    const fields = all.filter(() => r.chance(0.6));
    if (!fields.length) fields.push(all[0]!);
    const saved = g.scope;
    g.scope = { vars: [], lists: [], records: [], htmls: [] };
    for (const f of fields) g.bind(read(f.name), f.spec);
    const getters: { name: string; e: Expr }[] = [];
    for (let i = r.weighted([[2, 0], [3, 1], [2, 2]]); i > 0; i--) {
      getters.push({ name: `${getter}${getters.length}`, e: scriptExpr(g, r.pick<Ty>(["str", "str", "int", "float", "bool"]), r.int(1, 2)) });
    }
    g.scope = saved;
    const refs = [...fields.map((f) => f.name), ...getters.map((x) => x.name)].filter(() => r.chance(0.25));
    stores.push({ id, hook, local: id, setup: isSetup, fields, getters, refs });
  };
  if (r.chance(0.7)) make("fz", "useFz", false, option, "og", (f) => `state.${f}`);
  if (r.chance(0.6)) make("fzs", "useFzs", true, setup, "sg", (f) => `${f}.value`);
  return stores;
}

function bindStores(g: Gen, stores: StoreDef[], withRefs: boolean): void {
  for (const st of stores) {
    for (const f of st.fields) g.bind(`${st.local}.${f.name}`, f.spec);
    for (const x of st.getters) g.scope.vars.push({ name: `${st.local}.${x.name}`, ty: x.e.ty, opt: false, bound: x.e.ty === "int" ? Math.max(x.e.bound, 1) : 0, ...(x.e.lone ? { lone: true } : {}) });
    if (!withRefs) continue;
    for (const ref of st.refs) {
      const f = st.fields.find((x) => x.name === ref);
      if (f) g.bind(ref, f.spec);
      const x = st.getters.find((y) => y.name === ref);
      if (x) g.scope.vars.push({ name: ref, ty: x.e.ty, opt: false, bound: x.e.ty === "int" ? Math.max(x.e.bound, 1) : 0, ...(x.e.lone ? { lone: true } : {}) });
    }
  }
}

function bindRoute(g: Gen, router: AppRouter, template: boolean): void {
  g.routes = template ? flatRoutes(router.routes) : [];
  const names = [...new Set(flatRoutes(router.routes).flatMap((x) => x.params.map((p) => p.name)))];
  for (const v of ["route.path", "route.fullPath", "route.hash", ...(template ? ["$route.path"] : [])]) g.scope.vars.push({ name: v, ty: "str", opt: false, bound: 0 });
  g.reads = template ? ["route.name", "route.query.q", "$route.query.tab", ...names.flatMap((n) => [`route.params.${n}`, `$route.params.${n}`])] : [];
}

export function generateCase(seed: number, index: number, fixtures = 4): Case {
  const r = new Rng(seed, index);
  const name = `C${String(index).padStart(4, "0")}`;
  const ifaces: Iface[] = [];
  for (let i = r.weighted([[3, 0], [2, 1], [1, 2]]); i > 0; i--) {
    const fields: { name: string; spec: Spec }[] = [];
    const n = r.int(1, 4);
    for (let j = 0; j < n; j++) fields.push({ name: `${["label", "n", "on", "tags", "note", "w", "f"][j % 7]}${ifaces.length}${j}`, spec: randomSpec(r, ifaces, 1) });
    ifaces.push({ name: `Row${ifaces.length}`, fields });
  }
  const props: { name: string; spec: Spec }[] = [];
  const prefix = (s: Spec): string =>
    s.k === "opt" ? "o" + prefix(s.of) : s.k === "nul" ? "z" + prefix(s.of) : s.k === "list" ? "l" : s.k === "record" ? "d" : { str: "s", int: "n", count: "c", float: "f", bool: "b", obj: "r", enum: "t", html: "h" }[s.k];
  for (let i = r.int(1, 7); i > 0; i--) {
    const spec = randomSpec(r, ifaces, 0);
    props.push({ name: `${prefix(spec)}${props.length}`, spec });
  }
  if (r.chance(0.3)) props.push({ name: `c${props.length}`, spec: { k: "count" } });
  const consts = r.chance(0.35) ? randomConsts(r) : null;
  if (consts && r.chance(0.4)) {
    const values = consts.tone.map(([, v]) => v);
    const spec: Spec = r.chance(0.75) ? { k: "enum", values } : { k: "opt", of: { k: "enum", values } };
    props.push({ name: `${prefix(spec)}${props.length}`, spec });
  }
  if (r.chance(0.12)) {
    const html: Spec = { k: "html", inline: r.chance(0.4) };
    const spec: Spec = r.chance(0.7) ? html : { k: "opt", of: html };
    props.push({ name: `${prefix(spec)}${props.length}`, spec });
  }

  const g = new Gen(r, new Map([...ifaces, ROW_IFACE, FZ_ITEM].map((i) => [i.name, i])));
  const fresh = (): Scope => ({ vars: [], lists: [], records: [], htmls: [] });
  const router = r.chance(0.3) ? randomRouter(r) : null;
  const stores = r.chance(0.3) ? randomStores(r, g) : [];
  const i18n = r.chance(0.3) ? randomMessages(r) : null;
  const useT = r.chance(0.5);
  const scoped = r.chance(0.35);
  const propsVar = r.chance(0.3);
  const bindings: Binding[] = [];
  const provides: Provide[] = [];
  const head: HeadCall[] = [];
  if (r.chance(0.45)) {
    g.scope = fresh();
    for (const p of props) g.bind(`props.${p.name}`, p.spec, true);
    if (consts) bindConsts(g, consts, 0.5);
    bindStores(g, stores, false);
    if (router) bindRoute(g, router, false);
    if (i18n && useT) {
      g.tKeys = i18n.keys;
      g.tNames = ["t"];
    }
    for (let n = r.weighted([[2, 0], [3, 1], [2, 2], [1, 3]]); n > 0; n--) {
      const kind = r.weighted<Binding["kind"]>([[3, "computed"], [2, "const"], [1, "ref"]]);
      const ty = r.pick<Ty>(["str", "str", "int", "float", "bool"]);
      const e = kind === "ref" ? literalOf(r, ty) : scriptExpr(g, ty, r.int(1, 2));
      const binding = { name: `${kind === "computed" ? "cmp" : kind === "const" ? "cst" : "ref"}${bindings.length}`, kind, e };
      bindings.push(binding);
      if (kind === "const") g.scope.vars.push(bindingVar(binding));
    }
    if (r.chance(0.35)) {
      if (r.chance(0.7)) provides.push({ key: "str", e: whole(g.str(r.int(0, 2))) });
      if (r.chance(0.5)) provides.push({ key: "num", e: g.int(r.int(0, 2), BOUND_SMALL) });
      const live = bindings.filter((b) => b.kind !== "const" && b.e.ty === "str");
      if (live.length && r.chance(0.6)) provides.push({ key: "live", e: { ...atom("str", r.pick(live).name), fixed: true } });
    }
    if (r.chance(0.3)) head.push(headCall(g, "useHead"));
    if (r.chance(0.15)) head.push(headCall(g, "useSeoMeta"));
  }

  g.scope = fresh();
  for (const p of props) g.bind(propsVar && r.chance(0.4) ? `props.${p.name}` : p.name, p.spec, true);
  if (consts) bindConsts(g, consts, 0.35);
  for (const b of bindings) g.scope.vars.push(bindingVar(b));
  if (provides.length) g.favour = ["FzInj", "FzProv"];
  bindStores(g, stores, true);
  if (router) bindRoute(g, router, true);
  if (i18n) {
    g.tKeys = i18n.keys;
    g.tNames = useT ? ["t", "$t"] : ["$t"];
    if (useT) g.scope.vars.push({ name: "locale", ty: "str", opt: false, bound: 0 });
  }
  const template: Node[] = [];
  for (let n = r.weighted([[6, 1], [1, 2], [1, 3]]); n > 0; n--) template.push(g.node(0, "block"));

  const helpers = Object.fromEntries(
    (Object.keys(HELPERS) as HelperName[]).map((h) => [h, { scoped: r.chance(0.5), slotted: r.chance(0.5) }]),
  ) as Component["helpers"];
  const objLists = props.filter((p) => p.spec.k === "list" && p.spec.of.k === "obj");
  const component = prune({
    name,
    ifaces,
    props,
    template,
    scoped,
    helpers,
    propsVar,
    bindings,
    provides,
    head,
    consts,
    localEnums: r.chance(0.3),
    asyncHelpers: (Object.keys(HELPERS) as HelperName[]).filter(() => r.chance(0.15)),
    generic: objLists.length && r.chance(0.3) ? ((r.pick(objLists).spec as Spec & { k: "list" }).of as Spec & { k: "obj" }).iface : null,
    router,
    stores,
    i18n: i18n?.messages ?? null,
  });
  const fx: Record<string, unknown>[] = [];
  for (let i = 0; i < fixtures; i++) fx.push(randomFixture(r, component, i === 0));
  return { component, fixtures: fx };
}

export function clone<T>(x: T): T {
  if (Array.isArray(x)) return x.map(clone) as T;
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = clone(v);
    return o as T;
  }
  return x;
}

export function prune(c: Component): Component {
  let text = `${templateText(c)}\n${scriptLines({ ...c, bindings: [] }).join("\n")}`;
  const kept = new Set<Binding>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of c.bindings) {
      if (kept.has(b) || !mentions(text, b.name)) continue;
      kept.add(b);
      text += `\n${printExpr(b.e)}`;
      grew = true;
    }
  }
  const bindings = c.bindings.filter((b) => kept.has(b));
  const used = (name: string): boolean => mentions(text, name) || new RegExp(`(?<![\\w.$])props\\.${name}(?![\\w$])`).test(text);
  const props = c.props.filter((p) => used(p.name));
  const live = new Set<string>();
  const visit = (s: Spec): void => {
    if (s.k === "opt" || s.k === "nul" || s.k === "list") visit(s.of);
    else if (s.k === "obj" && !live.has(s.iface)) {
      live.add(s.iface);
      c.ifaces.find((i) => i.name === s.iface)!.fields.forEach((f) => visit(f.spec));
    }
  };
  props.forEach((p) => visit(p.spec));
  const full = `${text}\n${scriptLines({ ...c, bindings }).join("\n")}`;
  const routed = /<RouterLink|\$route\.|(?<![\w.$])route\./.test(full);
  const translated = /\$t\(|(?<![\w.$])t\(/.test(full) || mentions(full, "locale");
  const stores = storesUsed({ ...c, bindings }, full).map((u) => ({ ...u.st, refs: u.refs }));
  return { ...c, props, bindings, ifaces: c.ifaces.filter((i) => live.has(i.name)), router: routed ? c.router : null, i18n: translated ? c.i18n : null, stores };
}

function* exprSlots(nodes: Node[]): Generator<{ get: () => Expr; set: (e: Expr) => void }> {
  for (const n of nodes) {
    if (n.k === "interp") yield { get: () => n.e, set: (e) => (n.e = e) };
    else if (n.k === "if") {
      for (const b of n.branches) {
        if (b.cond && !b.cond.fixed) yield { get: () => b.cond!, set: (e) => (b.cond = e) };
        yield* exprSlots([b.node]);
      }
    } else if (n.k === "for") yield* exprSlots([n.node]);
    else if (n.k === "client") yield* exprSlots([...n.kids, ...(n.fallback ?? [])]);
    else if (n.k === "link") {
      const to = n.to;
      if (to.k === "str") yield { get: () => to.e, set: (e) => (to.e = e) };
      else if (to.k === "obj") for (const x of [...to.params, ...to.query]) yield { get: () => x.e, set: (e) => (x.e = e) };
      yield* exprSlots(n.kids);
    } else if (n.k === "teleport") {
      const t = n;
      if (t.disabled) yield { get: () => t.disabled!, set: (e) => (t.disabled = e) };
      yield* exprSlots(t.kids);
    }
    else if (n.k === "el" || n.k === "child") {
      if (n.k === "child" && n.is) {
        const is = n.is;
        yield { get: () => is.test, set: (e) => (is.test = e) };
      }
      for (const a of n.attrs) {
        if (a.k === "bind") yield { get: () => a.e, set: (e) => (a.e = e) };
        else if (a.k === "style") for (const en of a.entries) yield { get: () => en.e, set: (e) => (en.e = e) };
        else if (a.k === "class") {
          const v = a.v;
          if (v.k === "expr") yield { get: () => v.e, set: (e) => (v.e = e) };
          else if (v.k === "arr") for (let i = 0; i < v.items.length; i++) yield { get: () => v.items[i]!, set: (e) => (v.items[i] = e) };
          else for (const en of v.entries) yield { get: () => en.cond, set: (e) => (en.cond = e) };
        }
      }
      yield* exprSlots(n.kids);
    }
  }
}

function* allSlots(c: Component): Generator<{ get: () => Expr; set: (e: Expr) => void }> {
  for (const st of c.stores) for (const g of st.getters) yield { get: () => g.e, set: (e) => (g.e = e) };
  for (const b of c.bindings) if (b.kind !== "ref") yield { get: () => b.e, set: (e) => (b.e = e) };
  for (const p of c.provides) if (!p.e.fixed) yield { get: () => p.e, set: (e) => (p.e = whole(e)) };
  for (const h of c.head) for (const en of h.entries) yield { get: () => en.v.e, set: (e) => (en.v.e = whole(e)) };
  yield* exprSlots(c.template);
}

const LITERALS: Record<Ty, Expr> = { str: strLit("a"), int: numLit(1, "int"), float: numLit(0.5, "float"), bool: atom("bool", "true"), html: atom("html", "''") };

function* exprShrinks(e: Expr): Generator<Expr> {
  for (const k of e.kids) if (k.ty === e.ty && !k.fixed && !k.scoped) yield k;
  if (!e.fixed && (e.kids.length || e.ref)) yield LITERALS[e.ty];
  for (let i = 0; i < e.kids.length; i++) {
    for (const s of exprShrinks(e.kids[i]!)) {
      if (s.ty !== e.kids[i]!.ty) continue;
      const kids = [...e.kids];
      kids[i] = s;
      yield { ...e, kids };
    }
  }
}

export function componentShrinks(c: Component): Component[] {
  const out: Component[] = [];
  const edit = (f: (copy: Component) => boolean): void => {
    const copy = clone(c);
    if (f(copy)) out.push(prune(copy));
  };
  const lists = (comp: Component): Node[][] => {
    const acc: Node[][] = [comp.template];
    const walk = (ns: Node[]): void => {
      for (const n of ns) {
        if (n.k === "el" || n.k === "child") {
          acc.push(n.kids);
          walk(n.kids);
        } else if (n.k === "if") n.branches.forEach((b) => walk([b.node]));
        else if (n.k === "for") walk([n.node]);
        else if (n.k === "teleport" || n.k === "link") {
          acc.push(n.kids);
          walk(n.kids);
        } else if (n.k === "client") {
          acc.push(n.kids);
          walk(n.kids);
          if (n.fallback) {
            acc.push(n.fallback);
            walk(n.fallback);
          }
        }
      }
    };
    walk(comp.template);
    return acc;
  };
  const ls = lists(c);
  ls.forEach((l, li) =>
    l.forEach((_, ni) =>
      edit((x) => {
        const list = lists(x)[li]!;
        if (list === x.template && list.length === 1) return false;
        list.splice(ni, 1);
        return true;
      }),
    ),
  );
  ls.forEach((l, li) =>
    l.forEach((n, ni) => {
      if ((n.k === "el" && !n.void) || n.k === "child") edit((x) => (lists(x)[li]!.splice(ni, 1, ...(lists(x)[li]![ni] as Node & { kids: Node[] }).kids), true));
      if (n.k === "for") edit((x) => (lists(x)[li]!.splice(ni, 1, (lists(x)[li]![ni] as Node & { k: "for" }).node), true));
      if (n.k === "link") {
        const at = (x: Component): Node & { k: "link" } => lists(x)[li]![ni] as Node & { k: "link" };
        edit((x) => (lists(x)[li]!.splice(ni, 1, ...at(x).kids), true));
        if (n.to.k !== "lit" || n.to.path !== "/") edit((x) => ((at(x).to = { k: "lit", path: "/" }), true));
        if (n.to.k === "obj" && n.to.query.length) edit((x) => (((at(x).to as LinkTo & { k: "obj" }).query = []), true));
        if (n.to.k === "obj" && n.to.hash !== null) edit((x) => (((at(x).to as LinkTo & { k: "obj" }).hash = null), true));
        if (n.active !== null) edit((x) => ((at(x).active = null), true));
        if (n.exact !== null) edit((x) => ((at(x).exact = null), true));
        n.attrs.forEach((_, ai) => edit((x) => (at(x).attrs.splice(ai, 1), true)));
      }
      if (n.k === "teleport") {
        edit((x) => (lists(x)[li]!.splice(ni, 1, ...(lists(x)[li]![ni] as Node & { k: "teleport" }).kids), true));
        if (n.disabled) edit((x) => (((lists(x)[li]![ni] as Node & { k: "teleport" }).disabled = null), true));
      }
      if (n.k === "client") {
        edit((x) => (lists(x)[li]!.splice(ni, 1, ...((lists(x)[li]![ni] as Node & { k: "client" }).fallback ?? [])), true));
        if (n.fallback) edit((x) => (((lists(x)[li]![ni] as Node & { k: "client" }).fallback = null), true));
      }
      if (n.k === "if") {
        n.branches.forEach((_, bi) => edit((x) => (lists(x)[li]!.splice(ni, 1, (lists(x)[li]![ni] as Node & { k: "if" }).branches[bi]!.node), true)));
        n.branches.forEach((_, bi) => {
          edit((x) => {
            const list = lists(x)[li]!;
            const m = list[ni] as Node & { k: "if" };
            if (m.branches.length < 2) return false;
            m.branches.splice(bi, 1);
            if (m.branches[0]!.cond === null) list.splice(ni, 1, m.branches[0]!.node);
            return true;
          });
        });
      }
    }),
  );
  const elements = (comp: Component): (Node & { k: "el" | "child" })[] => {
    const acc: (Node & { k: "el" | "child" })[] = [];
    const walk = (ns: Node[]): void => {
      for (const n of ns) {
        if (n.k === "el" || n.k === "child") {
          acc.push(n);
          walk(n.kids);
        } else if (n.k === "if") walk(n.branches.map((b) => b.node));
        else if (n.k === "for") walk([n.node]);
        else if (n.k === "client") walk([...n.kids, ...(n.fallback ?? [])]);
        else if (n.k === "teleport" || n.k === "link") walk(n.kids);
      }
    };
    walk(comp.template);
    return acc;
  };
  elements(c).forEach((el, ei) => {
    if (el.k === "child" && el.is) {
      edit((x) => (delete (elements(x)[ei] as Node & { k: "child" }).is, true));
      if (el.is.other in HELPERS) edit((x) => (Object.assign(elements(x)[ei]!, { name: el.is!.other, is: undefined }), true));
    }
    el.attrs.forEach((a, ai) => {
      edit((x) => (elements(x)[ei]!.attrs.splice(ai, 1), true));
      const entries = a.k === "style" ? a.entries.length : a.k === "class" ? (a.v.k === "arr" ? a.v.items.length : a.v.k === "obj" ? a.v.entries.length : 0) : 0;
      for (let i = 0; entries > 1 && i < entries; i++) {
        edit((x) => {
          const b = elements(x)[ei]!.attrs[ai]!;
          if (b.k === "style") b.entries.splice(i, 1);
          else if (b.k === "class" && b.v.k === "arr") b.v.items.splice(i, 1);
          else if (b.k === "class" && b.v.k === "obj") b.v.entries.splice(i, 1);
          return true;
        });
      }
    });
  });
  if (c.scoped) edit((x) => ((x.scoped = false), true));
  if (c.propsVar) edit((x) => ((x.propsVar = false), true));
  if (c.router?.base) edit((x) => ((x.router!.base = null), true));
  if (c.router?.active) edit((x) => ((x.router!.active = null), true));
  if (c.router?.exact) edit((x) => ((x.router!.exact = null), true));
  c.router?.routes.forEach((route, ri) => {
    if (ri > 0) edit((x) => (x.router!.routes.splice(ri, 1), true));
    if (route.children.length) edit((x) => ((x.router!.routes[ri]!.children = []), true));
  });
  if (c.i18n && Object.keys(c.i18n.locales).length > 1) edit((x) => ((x.i18n!.locales = { en: x.i18n!.locales.en! }), true));
  if (c.i18n) {
    for (const key of Object.keys(c.i18n.locales.en ?? {})) {
      edit((x) => {
        for (const m of Object.values(x.i18n!.locales)) delete m[key];
        return true;
      });
    }
  }
  c.stores.forEach((st, si) => {
    st.getters.forEach((_, gi) => edit((x) => (x.stores[si]!.getters.splice(gi, 1), true)));
    st.refs.forEach((_, fi) => edit((x) => (x.stores[si]!.refs.splice(fi, 1), true)));
    st.fields.forEach((_, fi) => {
      if (st.fields.length > 1) edit((x) => (x.stores[si]!.fields.splice(fi, 1), true));
    });
  });
  if (c.localEnums) edit((x) => ((x.localEnums = false), true));
  if (c.generic !== null) edit((x) => ((x.generic = null), true));
  if (c.asyncHelpers.length) edit((x) => ((x.asyncHelpers = []), true));
  c.asyncHelpers.forEach((_, i) => edit((x) => (x.asyncHelpers.splice(i, 1), true)));
  c.provides.forEach((_, i) => edit((x) => (x.provides.splice(i, 1), true)));
  c.head.forEach((h, i) => {
    edit((x) => (x.head.splice(i, 1), true));
    if (h.entries.length > 1) h.entries.forEach((_, j) => edit((x) => (x.head[i]!.entries.splice(j, 1), true)));
    h.entries.forEach((en, j) => {
      if (en.v.getter) edit((x) => ((x.head[i]!.entries[j]!.v.getter = false), true));
    });
  });
  for (const h of helpersUsed(c.template)) {
    if (c.helpers[h].scoped) edit((x) => ((x.helpers[h].scoped = false), true));
    if (c.helpers[h].scoped && c.helpers[h].slotted && HELPERS[h].slot) edit((x) => ((x.helpers[h].slotted = false), true));
  }
  const slots = [...allSlots(c)];
  slots.forEach((s, si) => {
    let i = 0;
    for (const _ of exprShrinks(s.get())) {
      const which = i++;
      edit((x) => {
        const slot = [...allSlots(x)][si]!;
        const replacement = [...exprShrinks(slot.get())][which]!;
        slot.set(replacement);
        return true;
      });
    }
  });
  return out;
}

function* valueShrinks(v: unknown): Generator {
  if (typeof v === "string") {
    if (v === "") return;
    yield "";
    const cps = [...v];
    if (cps.length > 1) {
      yield cps.slice(0, Math.ceil(cps.length / 2)).join("");
      yield cps.slice(Math.ceil(cps.length / 2)).join("");
      if (cps.length <= 12) for (let i = 0; i < cps.length; i++) yield [...cps.slice(0, i), ...cps.slice(i + 1)].join("");
    }
    if (/[^a]/.test(v) && !/^[\x20-\x7e]*$/.test(v)) yield v.replace(/[\x20-\x7e]/g, "");
  } else if (typeof v === "number") {
    if (v !== 0 && !Object.is(v, -0)) yield 0;
    if (Number.isInteger(v) && Math.abs(v) > 1) yield Math.trunc(v / 2);
    if (!Number.isInteger(v)) yield Math.trunc(v);
  } else if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield [...v.slice(0, i), ...v.slice(i + 1)];
    for (let i = 0; i < v.length; i++) for (const s of valueShrinks(v[i])) yield v.map((x, j) => (j === i ? s : x));
  } else if (v && typeof v === "object" && ENTRIES in v) {
    const pairs = (v as Record<string, [string, unknown][]>)[ENTRIES]!;
    for (let i = 0; i < pairs.length; i++) yield { [ENTRIES]: [...pairs.slice(0, i), ...pairs.slice(i + 1)] };
    for (let i = 0; i < pairs.length; i++) {
      const [k, x] = pairs[i]!;
      for (const s of valueShrinks(k)) yield { [ENTRIES]: pairs.map((p, j) => (j === i ? [s, x] : p)) };
      for (const s of valueShrinks(x)) yield { [ENTRIES]: pairs.map((p, j) => (j === i ? [k, s] : p)) };
    }
  } else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) for (const s of valueShrinks(o[k])) yield { ...o, [k]: s };
  }
}

export function fixtureShrinks(c: Component, fixture: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const ifaces = new Map(c.ifaces.map((i) => [i.name, i]));
  const fieldsOf = (s: Spec, k: "opt" | "nul"): Set<string> =>
    s.k === "list" && s.of.k === "obj" ? new Set(ifaces.get(s.of.iface)!.fields.filter((f) => f.spec.k === k).map((f) => f.name)) : new Set();
  for (const p of c.props) {
    if (!(p.name in fixture)) continue;
    if (p.spec.k === "opt") {
      const { [p.name]: _, ...rest } = fixture;
      out.push(rest);
    }
    if (p.spec.k === "nul" && fixture[p.name] !== null) out.push({ ...fixture, [p.name]: null });
    const opt = fieldsOf(p.spec, "opt");
    const nul = fieldsOf(p.spec, "nul");
    if (opt.size || nul.size) {
      const list = fixture[p.name] as Record<string, unknown>[];
      list.forEach((item, i) => {
        for (const k of Object.keys(item)) {
          if (opt.has(k)) {
            const { [k]: _, ...rest } = item;
            out.push({ ...fixture, [p.name]: list.map((x, j) => (j === i ? rest : x)) });
          } else if (nul.has(k) && item[k] !== null) out.push({ ...fixture, [p.name]: list.map((x, j) => (j === i ? { ...item, [k]: null } : x)) });
        }
      });
    }
    const base = p.spec.k === "opt" ? p.spec.of : p.spec;
    if (base.k === "enum") {
      if (fixture[p.name] !== base.values[0]) out.push({ ...fixture, [p.name]: base.values[0] });
      continue;
    }
    if (base.k === "html") {
      if (fixture[p.name] !== "") out.push({ ...fixture, [p.name]: "" });
      continue;
    }
    for (const s of valueShrinks(fixture[p.name])) {
      if (typeof s === "number" && (p.spec.k === "int" || p.spec.k === "count" || ((p.spec.k === "opt" || p.spec.k === "nul") && p.spec.of.k === "int")) && !Number.isInteger(s)) continue;
      out.push({ ...fixture, [p.name]: s });
    }
  }
  if (typeof fixture.$route === "string" && fixture.$route !== "/") out.push({ ...fixture, $route: "/" });
  if (fixture.$locale !== undefined) {
    const { $locale: _, ...rest } = fixture;
    out.push(rest);
  }
  if (fixture.$stores && typeof fixture.$stores === "object") {
    for (const s of valueShrinks(fixture.$stores)) out.push({ ...fixture, $stores: s });
  }
  const keep = (f: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("$") || c.props.some((p) => p.name === k)));
  return out.map(keep);
}

export function caseSize(c: Component, fixture: Record<string, unknown>): number {
  return printComponent(c).length + helperFiles(c).reduce((n, [, text]) => n + text.length, 0) + fixtureJson(fixture).length;
}
