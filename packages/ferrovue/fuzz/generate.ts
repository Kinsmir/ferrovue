import type { Config } from "../src/compiler.ts";
import { portableTime } from "../src/plugins/dates.ts";
import { loadKey } from "../src/loads.ts";
import { DATE_METHODS, HAND_STRINGS, HAND_TIMES, dateCases } from "../test/date-inputs.ts";

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

export type Ty = "str" | "int" | "float" | "bool" | "html" | "date";

export interface Expr {
  ty: Ty;
  bound: number;
  kids: Expr[];
  fmt: (kids: string[]) => string;
  atom: boolean;
  fixed?: boolean;
  valid?: boolean;
  ref?: string;
  and?: boolean;
  lone?: boolean;
  scoped?: boolean;
  members?: string[];
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
  | { k: "enum"; values: string[]; union?: true }
  | { k: "html"; inline: boolean }
  | { k: "date" };

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
  | { k: "read"; text: string }
  | { k: "load"; kid: string; args: { name: string; arg: LoadArg }[] };

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
  | "FzSlots"
  | "FzDate"
  | "FzStamp"
  | "FzCard";

const HELPERS: Record<HelperName, { template: string; imports: HelperName[]; slot: boolean; script?: string[]; props?: string }> = {
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
  FzDate: {
    template: `<time class="date">{{ at.getTime() }}|{{ at.getUTCFullYear() }}-{{ at.getUTCMonth() + 1 }}<b v-if="gone !== null">{{ gone.getUTCDate() }}</b><FzStamp :at="was ?? at" :was="was" /></time>`,
    imports: ["FzStamp"],
    slot: false,
    props: "defineProps<{ at: Date; was?: Date; gone: Date | null }>();",
  },
  FzStamp: {
    template: `<small class="stamp">{{ at.getUTCSeconds() }}<i v-if="was">{{ was.getTime() }}</i><b v-if="at.getTime() === at.getTime()">{{ at.toISOString() }}</b></small>`,
    imports: [],
    slot: false,
    props: "defineProps<{ at: Date; was?: Date }>();",
  },
  FzCard: {
    template: `<p class="card" :data-size="card.size">{{ card.title }}|{{ card.n }}|{{ card.tag ?? "-" }}|<b v-if="card.on === null">null</b><b v-else-if="card.on">yes</b><b v-else>no</b>|{{ card.words.join(",") }}<i v-for="(c, i) in cards" :key="i" :title="c.tag" :class="c.size">{{ c.title }}/{{ c.n }}</i></p>`,
    imports: [],
    slot: false,
    script: ["export interface FzCardT {", "  title: string;", "  n: number;", "  tag?: string;", "  on: boolean | null;", "  words: string[];", '  size: "sm" | "md" | "lg";', "}"],
    props: "defineProps<{ card: FzCardT; cards: FzCardT[] }>();",
  },
};

const FZ_CARD: Iface = {
  name: "FzCardT",
  fields: [
    { name: "title", spec: { k: "str" } },
    { name: "n", spec: { k: "int", wide: false } },
    { name: "tag", spec: { k: "opt", of: { k: "str" } } },
    { name: "on", spec: { k: "nul", of: { k: "bool" } } },
    { name: "words", spec: { k: "list", of: { k: "str" } } },
    { name: "size", spec: { k: "enum", values: ["sm", "md", "lg"], union: true } },
  ],
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
  toneText: string[];
  toneNote: (string | null)[];
  toneInfo: { label: string; n: number }[];
  fold: boolean;
}

export type Step = { k: "const"; name: string; e: Expr } | { k: "if"; test: Expr; e: Expr } | { k: "arrow"; fn: LocalFn };

export interface LocalFn {
  name: string;
  params: { name: string; ty: Ty }[];
  ret: Ty;
  steps: Step[];
  e: Expr;
}

export interface Binding {
  name: string;
  kind: "computed" | "const" | "ref";
  e: Expr;
  lazy?: string;
  steps?: Step[];
  obj?: { iface: string; list: boolean; how: "ret" | "param" };
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

export type ArgTy = "str" | "int" | "float" | "bool";

export interface LoaderParam {
  name: string;
  ty: ArgTy;
  mode: "plain" | "opt" | "undef" | "nul";
}

export interface LoaderDef {
  name: string;
  params: LoaderParam[];
  out: Spec;
}

export type LoadArg = { k: "lit"; text: string; value: unknown } | { k: "ref"; path: string[]; len?: boolean };

export type LoadBind = { k: "name"; name: string } | { k: "fields"; fields: { field: string; as: string | null }[] } | { k: "none" };

export interface Await {
  loader: string;
  args: LoadArg[];
  bind: LoadBind;
}

export interface LoadKid {
  name: string;
  props: { name: string; spec: Spec }[];
  awaits: Await[];
  template: Node[];
}

export interface Loads {
  ifaces: Iface[];
  loaders: LoaderDef[];
  awaits: Await[];
  kids: LoadKid[];
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
  fns: LocalFn[];
  provides: Provide[];
  head: HeadCall[];
  consts: Consts | null;
  localEnums: boolean;
  asyncHelpers: HelperName[];
  generic: string | null;
  router: AppRouter | null;
  stores: StoreDef[];
  i18n: Messages | null;
  loads: Loads | null;
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
      return spec.union ? spec.values.map((v) => JSON.stringify(v)).join(" | ") : "Tone";
    case "html":
      return spec.inline ? "InlineHtml" : "TrustedHtml";
    case "date":
      return "Date";
  }
}

const usesHtml = (spec: Spec, inline: boolean): boolean => (spec.k === "html" && spec.inline === inline) || (spec.k === "opt" && usesHtml(spec.of, inline));
const usesEnum = (spec: Spec): boolean => (spec.k === "enum" && !spec.union) || (spec.k === "opt" && usesEnum(spec.of));

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
    case "load":
      return `<${n.kid}${n.args.map((a) => ` :${a.name}="${argText(a.arg)}"`).join("")} />`;
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

const CONST_NAMES = ["LABELS", "LABEL", "LIMIT", "RATIO", "SHOWN", "WORDS", "NUMS", "ROWS", "Tone", "Rank", "TONE_TEXT", "TONE_NOTE", "TONE_INFO"] as const;

const LOOKUPS = new Set(["TONE_TEXT", "TONE_NOTE", "TONE_INFO"]);

const numText = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));

function enumLines(k: Consts, exported: boolean): string[] {
  const e = exported ? "export " : "";
  const literal = (v: string): string => (exported ? JSON.stringify(v) : JSON.stringify(v).replaceAll("</", "<\\/"));
  return [`${e}enum Tone {`, ...k.tone.map(([m, v]) => `  ${m} = ${literal(v)},`), "}", "", `${e}enum Rank {`, "  Low,", `  Mid = ${k.rank},`, "  High,", "}"];
}

function lookupLines(k: Consts, exported: boolean): string[] {
  const e = exported ? "export " : "";
  const literal = (v: string): string => (exported ? JSON.stringify(v) : JSON.stringify(v).replaceAll("</", "<\\/"));
  const entries = <T>(values: (T | null)[], show: (v: T) => string): string =>
    k.tone.flatMap(([m], i) => (values[i] === null ? [] : [`[Tone.${m}]: ${show(values[i]!)}`])).join(", ");
  return [
    `${e}const TONE_TEXT = { ${entries(k.toneText, literal)} };`,
    `${e}const TONE_NOTE: Partial<Record<Tone, string>> = { ${entries(k.toneNote, literal)} };`,
    `${e}const TONE_INFO = { ${entries(k.toneInfo, (v) => `{ label: ${literal(v.label)}, n: ${numText(v.n)} }`)} } as const;`,
  ];
}

function constsFile(k: Consts): string {
  const cut = Math.floor([...k.label].length / 2);
  const [head, tail] = [[...k.label].slice(0, cut).join(""), [...k.label].slice(cut).join("")];
  const folded = [
    "const STEP = 3;",
    `const HEAD = ${JSON.stringify(head)};`,
    `export const LABEL = HEAD + ${JSON.stringify(tail)};`,
    `export const LIMIT = ${numText(k.limit - 6)} + 2 * STEP;`,
    `export const RATIO = ${numText(k.ratio)} * 1;`,
  ];
  return [
    ...(k.fold ? folded : [`export const LABEL = ${JSON.stringify(k.label)};`, `export const LIMIT = ${numText(k.limit)};`, `export const RATIO = ${numText(k.ratio)};`]),
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
    ...lookupLines(k, true),
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

function stepLine(st: Step): string {
  if (st.k === "arrow") return `  const ${st.fn.name} = (${st.fn.params.map((p) => `${p.name}: ${TS_TYPES[p.ty]!}`).join(", ")}): ${TS_TYPES[st.fn.ret]!} => ${printExpr(st.fn.e)};`;
  return st.k === "const" ? `  const ${st.name} = ${printExpr(st.e)};` : `  if (${printExpr(st.test)}) return ${printExpr(st.e)};`;
}

function bindingText(b: Binding): string {
  return [...(b.steps ?? []).flatMap((st) => (st.k === "const" ? [st.e] : st.k === "arrow" ? [st.fn.e] : [st.test, st.e])), b.e].map(printExpr).join("\n");
}

function argText(a: LoadArg): string {
  return a.k === "lit" ? a.text : `${a.path.join(".")}${a.len ? ".length" : ""}`;
}

const boundNames = (a: Await): string[] => (a.bind.k === "name" ? [a.bind.name] : a.bind.k === "fields" ? a.bind.fields.map((f) => f.as ?? f.field) : []);

function awaitLine(a: Await): string {
  const call = `await ${a.loader}(${a.args.map(argText).join(", ")})`;
  if (a.bind.k === "none") return `${call};`;
  if (a.bind.k === "name") return `const ${a.bind.name} = ${call};`;
  return `const { ${a.bind.fields.map((f) => (f.as === null ? f.field : `${f.field}: ${f.as}`)).join(", ")} } = ${call};`;
}

const PARAM_TS: Record<ArgTy, string> = { str: "string", int: "number", float: "Float", bool: "boolean" };

function paramText(p: LoaderParam): string {
  const t = PARAM_TS[p.ty];
  if (p.mode === "opt") return `${p.name}?: ${t}`;
  return `${p.name}: ${t}${p.mode === "undef" ? " | undefined" : p.mode === "nul" ? " | null" : ""}`;
}

const loadNodes = (template: Node[]): (Node & { k: "load" })[] => template.filter((n): n is Node & { k: "load" } => n.k === "load");

function kidsUsed(c: Component): LoadKid[] {
  const seen: LoadKid[] = [];
  const walk = (template: Node[]): void => {
    for (const n of loadNodes(template)) {
      const kid = c.loads?.kids.find((k) => k.name === n.kid);
      if (!kid || seen.includes(kid)) continue;
      seen.push(kid);
      walk(kid.template);
    }
  };
  walk(c.template);
  return seen;
}

function loadersUsed(c: Component): LoaderDef[] {
  const names = new Set([...(c.loads?.awaits ?? []), ...kidsUsed(c).flatMap((k) => k.awaits)].map((a) => a.loader));
  return (c.loads?.loaders ?? []).filter((l) => names.has(l.name));
}

const ifaceOf = (s: Spec): string | null => (s.k === "obj" ? s.iface : s.k === "list" || s.k === "nul" ? ifaceOf(s.of) : null);

const ifaceLines = (i: Iface, exported: boolean): string[] => [
  `${exported ? "export " : ""}interface ${i.name} {`,
  ...i.fields.map((f) => `  ${f.name}${f.spec.k === "opt" ? "?" : ""}: ${tsType(f.spec)};`),
  "}",
];

function loadersFile(c: Component): string {
  const used = loadersUsed(c);
  const ifaces = c.loads!.ifaces.filter((i) => used.some((l) => ifaceOf(l.out) === i.name));
  const float = used.some((l) => l.params.some((p) => p.ty === "float") || usesFloat(l.out)) || ifaces.some((i) => i.fields.some((f) => usesFloat(f.spec)));
  const lines = ['import { defineLoader } from "ferrovue/client";'];
  if (float) lines.push('import type { Float } from "ferrovue/types";');
  lines.push("");
  for (const i of ifaces) lines.push(...ifaceLines(i, true), "");
  lines.push("function missing(name: string): never {", "  throw new Error(`the fixture gives no result for ${name}`);", "}", "");
  for (const l of used) {
    lines.push(`export const ${l.name} = defineLoader(${JSON.stringify(l.name)}, async (${l.params.map(paramText).join(", ")}): Promise<${tsType(l.out)}> => missing(${JSON.stringify(l.name)}));`);
  }
  lines.push("");
  return lines.join("\n");
}

const definePropsLine = (props: { name: string; spec: Spec }[], named: boolean): string => {
  const define = props.length ? `defineProps<{ ${props.map((p) => `${p.name}${p.spec.k === "opt" ? "?" : ""}: ${tsType(p.spec)}`).join("; ")} }>();` : "defineProps<{}>();";
  return named ? `const props = ${define}` : define;
};

function kidText(kid: LoadKid): string {
  return [...kid.awaits.map(awaitLine), ...kid.template.map((n) => printNode(n, ""))].join("\n");
}

function printKid(kid: LoadKid): string {
  const loaders = [...new Set(kid.awaits.map((a) => a.loader))].toSorted();
  const kids = [...new Set(loadNodes(kid.template).map((n) => n.kid))].toSorted();
  const lines = ['<script setup lang="ts">'];
  if (loaders.length) lines.push(`import { ${loaders.join(", ")} } from "./fz-loaders";`);
  for (const k of kids) lines.push(`import ${k} from "./${k}.vue";`);
  if (kid.props.some((p) => usesFloat(p.spec))) lines.push('import type { Float } from "ferrovue/types";');
  lines.push("", definePropsLine(kid.props, new RegExp(`${FREE}props\\.`).test(kidText(kid))), ...kid.awaits.map(awaitLine), "</script>", "", "<template>");
  for (const n of kid.template) lines.push("  " + printNode(n, "  "));
  lines.push("</template>", "");
  return lines.join("\n");
}

const TS_TYPES: Partial<Record<Ty, string>> = { str: "string", int: "number", bool: "boolean" };

function scriptLines(c: Component): string[] {
  const lines: string[] = [];
  for (const f of c.fns) {
    lines.push(`function ${f.name}(${f.params.map((p) => `${p.name}: ${TS_TYPES[p.ty]!}`).join(", ")}): ${TS_TYPES[f.ret]!} {`, ...f.steps.map(stepLine), `  return ${printExpr(f.e)};`, "}");
  }
  for (const a of c.loads?.awaits ?? []) lines.push(awaitLine(a));
  for (const b of c.bindings) {
    const e = printExpr(b.e);
    if (b.obj) {
      const t = b.obj.list ? `${b.obj.iface}[]` : b.obj.iface;
      lines.push(b.obj.how === "ret" ? `const ${b.name} = computed((): ${t} => ${e});` : `const ${b.name} = computed<${t}>(() => ${e});`);
      continue;
    }
    if (b.steps?.length) lines.push(`const ${b.name} = computed(() => {`, ...b.steps.map(stepLine), `  return ${e};`, "});");
    else lines.push(b.kind === "computed" ? `const ${b.name} = computed(() => ${e});` : b.kind === "ref" ? `const ${b.name} = ref(${e});` : `const ${b.name} = ${e};`);
  }
  for (const p of c.provides) lines.push(`provide(${p.key === "str" ? '"fz-s"' : p.key === "num" ? "FzNum" : "FzLive"}, ${printExpr(p.e)});`);
  for (const h of c.head) lines.push(printHead(h));
  return lines;
}

const templateText = (c: Component): string => c.template.map((n) => printNode(n, "")).join("\n");

const FREE = "(?<![\\w$])(?:(?<=\\.\\.\\.)|(?<!\\.))";
const mentions = (text: string, name: string): boolean => new RegExp(`(?<!')${FREE}${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(text);

function constsUsed(c: Component): string[] {
  if (!c.consts) return [];
  const text = `${templateText(c)}\n${scriptLines(c).join("\n")}`;
  const used: string[] = CONST_NAMES.filter((n) => mentions(text, n));
  if ((c.props.some((p) => usesEnum(p.spec)) || used.some((n) => LOOKUPS.has(n))) && !used.includes("Tone")) used.push("Tone");
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

const READS_ROUTE = new RegExp(`${FREE}route\\.`);
const CALLS_T = new RegExp(`${FREE}t\\(`);

function contextText(c: Component): string {
  return `${templateText(c)}\n${scriptLines(c).join("\n")}`;
}

function storesUsed(c: Component, text = contextText(c)): { st: StoreDef; refs: string[]; local: boolean }[] {
  return c.stores
    .map((st) => {
      const refs = st.refs.filter((r) => mentions(text, r));
      return { st, refs, local: refs.length > 0 || new RegExp(`${FREE}${st.local}\\.`).test(text) };
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
    const lines = ['<script setup lang="ts">', ...h.imports.map((i) => `import ${i} from "./${i}.vue";`), ...(h.script ?? []), h.props ?? "defineProps<{}>();", "</script>", "", `<template>${h.template}</template>`];
    if (flags.scoped) lines.push(...scopedStyle(flags.slotted && h.slot));
    return [`${name}.vue`, lines.join("\n") + "\n"];
  });
  if (used.includes("FzInj") || c.provides.some((p) => p.key !== "str")) files.push(["fz-keys.ts", KEYS_FILE]);
  if (c.consts && constsUsed(c).length) files.push(["fz-consts.ts", constsFile(c.consts)]);
  if (c.router) files.push(["../routes.json", JSON.stringify(routesJson(c.router.routes), null, 2) + "\n"]);
  for (const st of c.stores) files.push([`../stores/${st.id}.ts`, storeFile(st)]);
  if (c.i18n) for (const [locale, messages] of Object.entries(c.i18n.locales)) files.push([`../locales/${locale}.json`, localeJson(messages)]);
  if (loadersUsed(c).length) files.push(["fz-loaders.ts", loadersFile(c)]);
  for (const kid of kidsUsed(c)) files.push([`${kid.name}.vue`, printKid(kid)]);
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
  const loaders = [...new Set((c.loads?.awaits ?? []).map((a) => a.loader))].toSorted();
  if (loaders.length) lines.push(`import { ${loaders.join(", ")} } from "./fz-loaders";`);
  for (const kid of [...new Set(loadNodes(c.template).map((n) => n.kid))].toSorted()) lines.push(`import ${kid} from "./${kid}.vue";`);
  const local = (n: string): boolean => c.localEnums && (n === "Tone" || n === "Rank" || LOOKUPS.has(n));
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
  if (c.consts && consts.some((n) => LOOKUPS.has(n) && local(n))) lines.push(...lookupLines(c.consts, false), "");
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
  lines.push(c.propsVar || new RegExp(`${FREE}props\\.`).test(`${tpl}\n${script.join("\n")}`) ? `const props = ${define}` : define);
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

const timeOf = (x: string | number): number => new Date(x).getTime();
const portable = (xs: Iterable<string>): string[] => [...new Set(xs)].filter((s) => portableTime(s) !== undefined);
const finite = (xs: Iterable<number>): number[] => [...new Set(xs)].filter(Number.isFinite);
const CASES = dateCases();
const DATE_STRINGS = portable(CASES.filter(([op]) => op === "parse").map(([, s]) => s));
const DATE_TIMES = finite(CASES.filter(([op]) => op === "Date").map(([, x]) => Number(x)));
const EDGE_STRINGS = portable(HAND_STRINGS);
const EDGE_TIMES = finite(HAND_TIMES);
const INVALID_DATES = [...EDGE_STRINGS, ...EDGE_TIMES].filter((x) => Number.isNaN(timeOf(x)));
const VALID_STRINGS = DATE_STRINGS.filter((s) => !Number.isNaN(timeOf(s)));
const VALID_TIMES = DATE_TIMES.filter((x) => !Number.isNaN(timeOf(x)));

function dateValue(r: Rng, hostile: boolean): string | number {
  return r.weighted<() => string | number>([
    [hostile ? 3 : 1, () => r.pick(EDGE_STRINGS)],
    [hostile ? 2 : 1, () => r.pick(EDGE_TIMES)],
    [hostile ? 2 : 1, () => r.pick(INVALID_DATES)],
    [4, () => r.pick(DATE_STRINGS)],
    [2, () => r.pick(DATE_TIMES)],
  ])();
}

function randomValue(r: Rng, spec: Spec, ifaces: Map<string, Iface>, hostile: boolean): unknown {
  switch (spec.k) {
    case "date":
      return dateValue(r, hostile);
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
    toneText: tone.map(text),
    toneNote: tone.map(() => (r.chance(0.4) ? null : text())),
    toneInfo: tone.map(() => ({ label: text(), n: r.int(-50, 50) })),
    fold: r.chance(0.5),
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
const plainLit = (s: string): boolean => /^[\w <>&,.-]*$/.test(s);
const UNION_LITS = ["sm", "md", "lg", "x-large", "2xl", "", "<i>", "a&b", "x y", "→a", "Mixed", "Σx"];
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
  members?: string[];
}
interface ListVar {
  name: string;
  of: Spec;
}
interface RecordVar {
  name: string;
  of: Spec;
}
interface DateVar {
  name: string;
  key: string;
  opt: boolean;
  nul?: boolean;
  valid?: boolean;
}
interface Scope {
  vars: Var[];
  lists: ListVar[];
  records: RecordVar[];
  htmls: Var[];
  dates: DateVar[];
}

const DATE_TEXTS = new Set<string>(["toISOString", "toUTCString", "toJSON"]);
const DATE_READS = ["getTime", "valueOf", ...DATE_METHODS.filter((m) => !DATE_TEXTS.has(m))];
const isoLit = (s: string): Expr => ({ ...atom("date", `new Date('${s}')`), ...(Number.isNaN(timeOf(s)) ? {} : { valid: true }) });
const msLit = (x: number): Expr => ({ ...atom("date", `new Date(${numText(x)})`), ...(Number.isNaN(timeOf(x)) ? {} : { valid: true }) });

interface ListExpr {
  of: Spec;
  kids: Expr[];
  fmt: (kids: string[], at: number) => string;
  lone: boolean;
  mapped?: boolean;
}

const REPLACEMENTS = ["", "-", "$&", "$$", "$`", "$'", "$1", "$<x>", "[$&]", "🦀", "$"];
const quoted = (s: string): string => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const LOW_LITS = ["", "a", "x y", "<i>", "a&b", "→", "é", "Σ", "ß", "-"];

const specTy = (s: Spec): Ty | null =>
  s.k === "str" || s.k === "enum" ? "str" : s.k === "int" || s.k === "count" ? "int" : s.k === "float" ? "float" : s.k === "bool" ? "bool" : null;
const specBound = (s: Spec): number => (s.k === "int" ? (s.wide ? LIMIT : BOUND_SMALL) : s.k === "count" ? 10 : 0);

class Gen {
  scope: Scope = { vars: [], lists: [], records: [], htmls: [], dates: [] };
  lazies: { dep: string; v: Var }[] = [];
  fns: LocalFn[] = [];
  dateLits = 0;
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
  plain = false;
  readonly r: Rng;
  readonly ifaces: Map<string, Iface>;
  constructor(r: Rng, ifaces: Map<string, Iface>) {
    this.r = r;
    this.ifaces = ifaces;
  }

  bind(name: string, spec: Spec, prop = false, lone = false): void {
    const date = spec.k === "date" ? spec : (spec.k === "opt" || spec.k === "nul") && spec.of.k === "date" ? spec.of : null;
    if (date) {
      const key = name.replace(/^props\./, "");
      this.scope.dates.push({ name, key, opt: spec.k !== "date", ...(spec.k === "nul" ? { nul: true } : {}) });
    } else if (spec.k === "html" || (spec.k === "opt" && spec.of.k === "html")) {
      const html = spec.k === "opt" ? spec.of : spec;
      this.scope.htmls.push({ name, ty: "html", opt: spec.k === "opt", bound: 0, ...(html.k === "html" && html.inline ? { inline: true } : {}) });
    }
    else if (spec.k === "list") this.scope.lists.push({ name, of: spec.of });
    else if (spec.k === "record") this.scope.records.push({ name, of: spec.of });
    else if (spec.k === "obj") for (const f of this.ifaces.get(spec.iface)!.fields) this.bind(`${name}.${f.name}`, f.spec);
    else if (spec.k === "opt") {
      const ty = specTy(spec.of);
      if (ty) this.scope.vars.push({ name, ty, opt: !(prop && ty === "bool"), bound: specBound(spec.of), ...(spec.of.k === "enum" ? { members: spec.of.values } : {}) });
    } else if (spec.k === "nul") {
      const ty = specTy(spec.of);
      if (ty) this.scope.vars.push({ name, ty, opt: true, nul: true, bound: specBound(spec.of), ...(spec.of.k === "enum" ? { members: spec.of.values } : {}) });
    } else {
      const ty = specTy(spec)!;
      this.scope.vars.push({ name, ty, opt: false, bound: specBound(spec), ...(lone && ty === "str" ? { lone } : {}), ...(spec.k === "enum" ? { members: spec.values } : {}) });
    }
  }

  withScope<T>(f: () => T): T {
    const saved = { vars: [...this.scope.vars], lists: [...this.scope.lists], records: [...this.scope.records], htmls: [...this.scope.htmls], dates: [...this.scope.dates] };
    try {
      return f();
    } finally {
      this.scope = saved;
    }
  }

  vars(ty: Ty, maxBound = Infinity, opt = false): Var[] {
    return this.scope.vars.filter((v) => v.ty === ty && v.opt === opt && (ty !== "int" || v.bound <= maxBound));
  }

  fnsOf(ty: Ty, maxBound = Infinity): LocalFn[] {
    return this.fns.filter((f) => f.ret === ty && (ty !== "int" || f.e.bound <= maxBound));
  }

  call(f: LocalFn, d: number): Expr {
    const args = f.params.map((p) => (p.ty === "str" ? whole(this.str(d - 1)) : p.ty === "int" ? this.int(d - 1, BOUND_SMALL) : this.bool(d - 1)));
    return { ...node(f.ret, args, (k) => `${f.name}(${k.join(", ")})`, f.e.bound, true), ...(f.e.lone ? { lone: true } : {}) };
  }

  varRef(v: Var): Expr {
    return { ...atom(v.ty, v.name, v.bound), ref: v.name, ...(v.lone ? { lone: true } : {}), ...(v.members ? { members: v.members } : {}) };
  }

  dateRef(v: DateVar): Expr {
    return { ...atom("date", v.name), ref: v.name, ...(v.valid ? { valid: true } : {}) };
  }

  dateWeight(w: number): number {
    return this.scope.dates.length ? w : w * this.dateLits;
  }

  date(d: number, valid = false): Expr {
    const r = this.r;
    const vars = this.scope.dates.filter((v) => !v.opt && (!valid || v.valid));
    const opts = this.scope.dates.filter((v) => v.opt);
    const leaf = (): Expr =>
      r.weighted<() => Expr>([
        [vars.length ? 6 : 0, () => this.dateRef(r.pick(vars))],
        [3, () => isoLit(r.pick(valid ? VALID_STRINGS : r.chance(0.3) ? EDGE_STRINGS : DATE_STRINGS))],
        [2, () => msLit(r.pick(valid ? VALID_TIMES : r.chance(0.3) ? EDGE_TIMES : DATE_TIMES))],
      ])();
    if (d <= 0 || r.chance(0.4)) return leaf();
    const either = (a: Expr, b: Expr): { valid?: true } => (a.valid && b.valid ? { valid: true } : {});
    return r.weighted<() => Expr>([
      [valid ? 0 : 2, () => node("date", [this.num(d - 1)], ([a]) => `new Date(${a})`, 0, true)],
      [1, () => {
        const e = this.date(d - 1, valid);
        return { ...node("date", [e], ([a]) => `new Date(${a})`, 0, true), ...either(e, e) };
      }],
      [2, () => {
        const [a, b] = [this.date(d - 1, valid), this.date(d - 1, valid)];
        return { ...node("date", [this.test(d - 1), a, b], ([c, x, y]) => `${c} ? ${x} : ${y}`), ...either(a, b) };
      }],
      [opts.length && !valid ? 2 : 0, () => node("date", [this.dateRef(r.pick(opts)), this.date(d - 1)], ([a, b]) => `${a} ?? ${b}`)],
      [opts.length && !valid ? 2 : 0, () => node("date", [this.dateRef(r.pick(opts)), this.date(d - 1)], ([a, b]) => `${a} || ${b}`)],
      [opts.length > 1 && !valid ? 1 : 0, () => {
        const a = r.pick(opts);
        const b = r.pick(opts.filter((v) => v !== a));
        return node("date", [this.dateRef(a), this.dateRef(b), this.date(d - 1)], ([x, y, z]) => `${x} || ${y} || ${z}`);
      }],
      [1, () => {
        const [a, b] = [this.date(d - 1, valid), this.date(d - 1)];
        return { ...node("date", [a, b], ([x, y]) => `${x} || ${y}`), ...(a.valid ? { valid: true } : {}) };
      }],
    ])();
  }

  dateNum(d: number): Expr {
    const r = this.r;
    if (r.chance(0.1)) return atom("float", `Date.parse('${r.pick(r.chance(0.3) ? EDGE_STRINGS : DATE_STRINGS)}')`);
    const m = r.pick(DATE_READS);
    return node("float", [this.date(d - 1)], ([a]) => `${a}.${m}()`, 0, true);
  }

  isoString(d: number): Expr {
    return node("str", [this.date(d - 1, true)], ([a]) => `${a}.toISOString()`, 0, true);
  }

  dateText(d: number): Expr {
    const r = this.r;
    return r.weighted<() => Expr>([
      [3, () => node("str", [this.date(d - 1)], ([a]) => `${a}.toUTCString()`, 0, true)],
      [2, () => node("str", [this.date(d - 1)], ([a]) => `JSON.stringify(${a})`, 0, true)],
      [2, () => node("str", [this.date(d - 1), strLit(r.pick(STR_LITS))], ([a, b]) => `${a}.toJSON() ?? ${b}`)],
    ])();
  }

  dateUtc(d: number): Expr {
    const r = this.r;
    const part = (max: number): Expr => (r.chance(0.15) ? numLit(r.pick([0.5, -0.5, 99.9, 1.5, -1.25]), "float") : this.int(d - 1, max));
    const parts = [part(200_000), part(10_000), part(1_000_000), part(1_000_000), part(1_000_000), part(1_000_000)].slice(0, r.int(1, 6));
    if (parts.length === 6 && r.chance(0.5)) parts.push(this.num(d - 1));
    return node("float", parts, (xs) => `Date.UTC(${xs.join(", ")})`, 0, true);
  }

  dateOrder(d: number): Expr {
    const op = this.r.pick(["<", ">", "<=", ">="]);
    return node("bool", [this.date(d - 1), this.date(d - 1)], ([a, b]) => `${a} ${op} ${b}`);
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
      [lists.length ? 2 : 0, () => {
        const v = r.pick(lists);
        const [yes, no] = r.chance(0.5) ? [v.name, "[]"] : ["[]", v.name];
        return { of: v.of, kids: [this.test(d - 1)], fmt: (k, at) => `(${k[at]} ? ${yes} : ${no})`, lone: false };
      }],
      [records.length ? 2 : 0, () => {
        const v = r.pick(records);
        return r.chance(0.5) ? { of: { k: "str" }, kids: [], fmt: () => `Object.keys(${v.name})`, lone: false } : { of: v.of, kids: [], fmt: () => `Object.values(${v.name})`, lone: false };
      }],
      [records.length ? 2 : 0, () => {
        const v = r.pick(records);
        const n = this.arrows++;
        const [key, value] = [`k${n}`, `v${n}`];
        const pair = r.weighted<[string, boolean, boolean]>([[3, [`[${key}, ${value}]`, true, true]], [1, [`[${key}]`, true, false]], [1, [`[, ${value}]`, false, true]]]);
        const bindPair = () => {
          if (pair[1]) this.bind(key, { k: "str" });
          if (pair[2]) this.bind(value, v.of);
        };
        const test = r.chance(0.4) ? this.withScope(() => (bindPair(), this.test(d - 1))) : null;
        let out: Expr | undefined;
        const body = this.withScope(() => (bindPair(), (out = r.chance(0.6) ? this.str(d - 1) : this.int(d - 1, BOUND_SMALL))));
        const of: Spec = out!.ty === "str" ? { k: "str" } : { k: "int", wide: false };
        const kids = test ? [{ ...test, scoped: true }, { ...body, scoped: true }] : [{ ...body, scoped: true }];
        const filter = (k: string[]) => (test ? `.filter((${pair[0]}) => ${k[0]})` : "");
        return { of, kids, fmt: (k, at) => `Object.entries(${v.name})${filter(k.slice(at))}.map((${pair[0]}) => ${k[at + kids.length - 1]})`, lone: !!out!.lone, ...(of.k === "int" ? { mapped: true } : {}) };
      }],
      [2, () => {
        const s = this.str(d - 1);
        const sep = r.pick([",", " ", "", "a", "🦀", ", "]);
        const limit = r.chance(0.3) ? `, ${r.pick(["0", "1", "2", "3", "-1", "4294967297", "1.5"])}` : "";
        return { of: { k: "str" }, kids: [s], fmt: (k, at) => `${recv(k[at])}.split(${quoted(sep)}${limit})`, lone: !!s.lone || sep === "" };
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
          return { of, kids: [...prev.kids, fn.body], fmt: (k, at) => `${prev.fmt(k, at)}.map(${fn.params} => ${k[at + width]})`, lone: !!out!.lone, ...(of.k === "int" ? { mapped: true } : {}) };
        }],
        [1, () => {
          const split = r.chance(0.4);
          const sep = r.pick([",", "", "a", " "]);
          let pair: Expr | undefined;
          const fn = this.arrow(prev.of, prev.lone, () => {
            const str = split || r.chance(0.6);
            const one = () => (str ? this.str(d - 1) : this.int(d - 1, BOUND_SMALL));
            const [a, b] = [one(), one()];
            pair = split ? a : node(a.ty, [a, b], ([x, y]) => `[${x}, ${y}]`, 0, true);
            return pair;
          });
          const of: Spec = pair!.ty === "str" ? { k: "str" } : { k: "int", wide: false };
          const lone = !!pair!.lone || pair!.kids.some((x) => x.lone) || (split && sep === "");
          const each = (x: string) => (split ? `${recv(x)}.split(${quoted(sep)})` : x);
          return { of, kids: [...prev.kids, fn.body], fmt: (k, at) => `${prev.fmt(k, at)}.flatMap(${fn.params} => ${each(k[at + width]!)})`, lone, ...(of.k === "int" ? { mapped: true } : {}) };
        }],
        [2, () => {
          const a = this.small();
          const b = r.chance(0.5) ? this.small() : null;
          const kids = b ? [a, b] : [a];
          return { ...prev, kids: [...prev.kids, ...kids], fmt: (k, at) => `${prev.fmt(k, at)}.slice(${k[at + width]}${b ? `, ${k[at + width + 1]}` : ""})` };
        }],
        [1, () => {
          const same = this.scope.lists.filter((v) => JSON.stringify(v.of) === JSON.stringify(prev.of));
          const lit = prev.of.k === "str" ? `['${r.pick(STR_LITS)}']` : prev.of.k === "int" ? `[${r.int(-3, 9)}, ${r.int(0, 9)}]` : null;
          const other = r.weighted<() => string>([
            [same.length ? 3 : 0, () => r.pick(same).name],
            [lit ? 2 : 0, () => lit!],
            [1, () => "[]"],
          ])();
          return { ...prev, fmt: (k, at) => `${prev.fmt(k, at)}.concat(${other})` };
        }],
        [1, () => {
          const copy = r.chance(0.3);
          return { ...prev, fmt: (k, at) => (copy ? `[...${prev.fmt(k, at)}].reverse()` : `${prev.fmt(k, at)}.toReversed()`) };
        }],
        [prev.of.k === "obj" || prev.lone ? 0 : 1, () => {
          const copy = r.chance(0.3);
          return { ...prev, fmt: (k, at) => (copy ? `[...${prev.fmt(k, at)}].sort()` : `${prev.fmt(k, at)}.toSorted()`) };
        }],
        [1, () => {
          const cmp = this.comparator(prev);
          if (cmp === null) return prev;
          const copy = r.chance(0.3);
          return { ...prev, fmt: (k, at) => (copy ? `[...${prev.fmt(k, at)}].sort(${cmp})` : `${prev.fmt(k, at)}.toSorted(${cmp})`) };
        }],
        [1, () => {
          const same = this.scope.lists.filter((v) => JSON.stringify(v.of) === JSON.stringify(prev.of));
          const lit = prev.of.k === "str" ? `'${r.pick(STR_LITS)}'` : prev.of.k === "int" ? String(r.int(-3, 9)) : null;
          const other = same.length ? r.pick(same).name : null;
          const shape = r.weighted<(list: string) => string>([
            [other ? 3 : 0, (list) => `[...${list}, ...${other}]`],
            [lit ? 2 : 0, (list) => `[${lit}, ...${list}]`],
            [lit ? 2 : 0, (list) => `[...${list}, ${lit}, ...${list}]`],
            [1, (list) => `[...${list}]`],
            [1, (list) => `[...[], ...${list}]`],
          ]);
          return { ...prev, fmt: (k, at) => shape(prev.fmt(k, at)) };
        }],
      ])();
    }
    return l;
  }

  comparator(l: ListExpr): string | null {
    const r = this.r;
    const n = this.arrows++;
    const [a, b] = [`c${n}`, `e${n}`];
    let key = "";
    let int = l.of.k === "int";
    if (l.of.k === "obj") {
      const fields = this.ifaces.get(l.of.iface)?.fields.filter((f) => f.spec.k === "int" || f.spec.k === "count" || f.spec.k === "str") ?? [];
      if (!fields.length) return null;
      const f = r.pick(fields);
      key = `.${f.name}`;
      int = f.spec.k !== "str";
    } else if ((l.of.k === "str" && l.lone) || (l.of.k !== "str" && l.of.k !== "int") || l.mapped) {
      return null;
    }
    const [x, y] = [`${a}${key}`, `${b}${key}`];
    return r.weighted<() => string>([
      [int ? 3 : 0, () => `(${a}, ${b}) => ${x} - ${y}`],
      [int ? 2 : 0, () => `(${a}, ${b}) => ${y} - ${x}`],
      [2, () => `(${a}, ${b}) => (${x} < ${y} ? -1 : ${x} > ${y} ? 1 : 0)`],
      [2, () => `(${a}, ${b}) => (${x} > ${y} ? -1 : ${x} < ${y} ? 1 : 0)`],
      [1, () => `(${a}, ${b}) => (${x} === ${y} ? 0 : ${x} < ${y} ? 1 : -1)`],
      [1, () => `(${a}, ${b}) => (${y} <= ${x} ? (${x} === ${y} ? 0 : 1) : -1)`],
    ])();
  }

  reduction(l: ListExpr, d: number, ty: "str" | "num" | "bool"): Expr {
    const r = this.r;
    const n = this.arrows++;
    const [acc, p] = [`acc${n}`, `a${n}`];
    const withIndex = r.chance(0.25);
    const method = r.chance(0.3) ? "reduceRight" : "reduce";
    const e = this.withScope(() => {
      this.bind(p, l.of, false, l.lone);
      if (withIndex) this.scope.vars.push({ name: `j${n}`, ty: "int", opt: false, bound: 100 });
      if (ty === "str") {
        const part = this.str(d - 1);
        return part.lone ? strLit(r.pick(LOW_LITS)) : part;
      }
      return ty === "num" ? this.int(d - 1, BOUND_SMALL) : this.bool(d - 1);
    });
    const params = withIndex ? `(${acc}, ${p}, j${n})` : `(${acc}, ${p})`;
    const step = r.weighted<(x: string) => string>(
      ty === "str"
        ? [[3, (x) => `${acc} + (${x})`], [1, (x) => `(${x}) + ${acc}`]]
        : ty === "num"
          ? [[3, (x) => `${acc} + (${x})`], [1, (x) => `Math.max(${acc}, ${x})`], [1, (x) => `${acc} - (${x})`]]
          : [[1, (x) => `${acc} && (${x})`], [1, (x) => `${acc} || (${x})`]],
    );
    const init = ty === "str" ? `'${r.pick(STR_LITS)}'` : ty === "num" ? String(r.pick([0, 1, -1, 0.5, -0])) : r.pick(["true", "false"]);
    const out: Ty = ty === "num" ? "float" : ty;
    return { ty: out, bound: 0, kids: [...l.kids, { ...e, scoped: true }], atom: true, fmt: (k) => `${l.fmt(k, 0)}.${method}(${params} => ${step(k[l.kids.length]!)}, ${init})` };
  }

  spreadExtreme(d: number): Expr | null {
    const r = this.r;
    const l = this.listExpr(d);
    if (!l || l.of.k !== "int") return null;
    const f = r.pick(["max", "min"]);
    const extra = r.weighted<string>([[3, ""], [1, ", 0"], [1, ", -0"], [1, ", 0.5"]]);
    const before = r.chance(0.2) ? "1, " : "";
    return { ty: "float", bound: 0, kids: l.kids, atom: true, fmt: (k) => `Math.${f}(${before}...${l.fmt(k, 0)}${extra})` };
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
    if (!l || l.of.k === "obj") return l && l.of.k === "obj" ? this.fromObjList(l, d) : null;
    const str = l.of.k === "str";
    const lone = l.lone ? { lone: true as const } : {};
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
      [str ? 3 : 0, () => {
        const at = r.chance(0.5);
        const i = at ? this.small() : this.index();
        const then = r.pick(["", "", "?.trim()", "?.toUpperCase()", "?.padEnd(3, '.')"]);
        const fallback = r.pick(STR_LITS);
        const read = (list: string, x: string) => (at ? `${list}.at(${x})` : `${list}[${x}]`);
        return { ty: "str", bound: 0, kids: [...l.kids, i], atom: false, fmt: (k) => `${read(l.fmt(k, 0), k[l.kids.length]!)}${then} ?? '${fallback}'`, ...lone };
      }],
      [str ? 1 : 0, () => {
        const fn = this.arrow(l.of, l.lone, () => this.test(d - 1));
        const fallback = r.pick(STR_LITS);
        return { ty: "str", bound: 0, kids: [...l.kids, fn.body], atom: false, fmt: (k) => `${l.fmt(k, 0)}.findLast(${fn.params} => ${k[l.kids.length]}) ?? '${fallback}'`, ...lone };
      }],
      [l.lone ? 0 : 2, () => this.reduction(l, d, "str")],
    ])();
  }

  index(): Expr {
    const r = this.r;
    return r.weighted<() => Expr>([
      [3, () => numLit(r.int(-2, 6), "int")],
      [2, () => this.int(1, BOUND_SMALL)],
    ])();
  }

  fromObjList(l: ListExpr, d: number): Expr {
    const r = this.r;
    const iface = l.of.k === "obj" ? this.ifaces.get(l.of.iface) : undefined;
    const fields = iface?.fields.filter((f) => f.spec.k === "str") ?? [];
    if (!fields.length || r.chance(0.4)) return { ty: "str", bound: 0, kids: l.kids, atom: true, fmt: (k) => `String(${l.fmt(k, 0)}.length)` };
    const field = r.pick(fields).name;
    const fallback = r.pick(STR_LITS);
    return r.weighted<() => Expr>([
      [3, () => {
        const at = r.chance(0.5);
        const i = at ? this.small() : this.index();
        const read = (list: string, x: string) => (at ? `${list}.at(${x})` : `${list}[${x}]`);
        return { ty: "str", bound: 0, kids: [...l.kids, i], atom: false, fmt: (k) => `${read(l.fmt(k, 0), k[l.kids.length]!)}?.${field} ?? '${fallback}'` };
      }],
      [2, () => {
        const fn = this.arrow(l.of, false, () => this.test(d - 1));
        return { ty: "str", bound: 0, kids: [...l.kids, fn.body], atom: false, fmt: (k) => `${l.fmt(k, 0)}.findLast(${fn.params} => ${k[l.kids.length]})?.${field} ?? '${fallback}'` };
      }],
    ])();
  }

  optChain(fallback: boolean): Expr | null {
    const r = this.r;
    const opts = this.scope.vars.filter((v) => v.opt && (v.ty === "str" || v.ty === "int" || v.ty === "float"));
    if (!opts.length) return null;
    const v = r.pick(opts);
    type Link = "str" | "num" | "list" | "int";
    type Step = { text: string; to: Link; maybe?: true; lone?: true };
    const steps: Record<Exclude<Link, "int">, [number, () => Step][]> = {
      str: [
        [3, () => ({ text: r.pick(["trim()", "toUpperCase()", "toLowerCase()", "trimEnd()"]), to: "str" })],
        [1, () => ({ text: `slice(${r.int(-3, 3)})`, to: "str", lone: true })],
        [1, () => ({ text: `padStart(${r.int(0, 6)}, '*')`, to: "str" })],
        [1, () => ({ text: "replace('a', '$&$&')", to: "str" })],
        [1, () => ({ text: `at(${r.int(-2, 2)})`, to: "str", maybe: true, lone: true })],
        [1, () => ({ text: "split(',')", to: "list" })],
        [2, () => ({ text: r.pick(["length", "indexOf('a')"]), to: "int" })],
      ],
      list: [
        [2, () => ({ text: "join('-')", to: "str" })],
        [1, () => ({ text: r.pick(["length", "indexOf('a')"]), to: "int" })],
        [2, () => ({ text: r.chance(0.5) ? `at(${r.int(-2, 2)})` : `[${r.int(0, 2)}]`, to: "str", maybe: true })],
        [1, () => ({ text: "concat(['x'])", to: "list" })],
      ],
      num: [[1, () => ({ text: v.ty === "float" ? `toFixed(${r.int(0, 3)})` : "toString()", to: "str" })]],
    };
    let text = v.name;
    let ty: Link = v.ty === "str" ? "str" : "num";
    let lone = !!v.lone;
    let maybe = true;
    for (let n = r.int(1, 3); n > 0 && ty !== "int"; n--) {
      const step = r.weighted(steps[ty])();
      text += step.text.startsWith("[") ? `${maybe ? "?." : ""}${step.text}` : `${maybe ? "?." : "."}${step.text}`;
      ty = step.to;
      maybe = !!step.maybe;
      lone ||= !!step.lone;
    }
    if (ty === "list" || ty === "num") text += `${maybe ? "?." : "."}${ty === "list" ? "join('|')" : "toString()"}`;
    const isInt = ty === "int";
    const tail = fallback ? (isInt ? ` ?? ${r.int(0, 3)}` : ` ?? '${r.pick(STR_LITS)}'`) : "";
    return { ty: isInt ? "int" : "str", bound: isInt ? 2 ** 31 : 0, kids: [], atom: !fallback, fmt: () => `${text}${tail}`, ...(lone ? { lone: true } : {}) };
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
      [1, () => {
        const fn = this.arrow(l.of, l.lone, () => this.test(d - 1));
        return { ty: "int", bound: 2 ** 31, kids: [...l.kids, fn.body], atom: true, fmt: (k) => `${l.fmt(k, 0)}.findLastIndex(${fn.params} => ${k[l.kids.length]})` };
      }],
      [l.of.k === "obj" ? 0 : 2, () => {
        const m = r.pick(["indexOf", "lastIndexOf"]);
        const x = l.of.k === "str" ? `'${r.pick(STR_LITS)}'` : String(r.pick([0, 1, 2, -1, 7]));
        return { ty: "int", bound: 2 ** 31, kids: l.kids, atom: true, fmt: (k) => `${l.fmt(k, 0)}.${m}(${x})` };
      }],
      [l.of.k === "int" ? 3 : 0, () => {
        const at = r.chance(0.5);
        const i = at ? this.small() : this.index();
        const read = (list: string, x: string) => (at ? `${list}.at(${x})` : `${list}[${x}]`);
        const fallback = r.int(0, 3);
        return { ty: "int", bound: BOUND_SMALL, kids: [...l.kids, i], atom: false, fmt: (k) => `${read(l.fmt(k, 0), k[l.kids.length]!)} ?? ${fallback}` };
      }],
      [l.of.k === "int" ? 1 : 0, () => {
        const fn = this.arrow(l.of, l.lone, () => this.test(d - 1));
        return { ty: "int", bound: BOUND_SMALL, kids: [...l.kids, fn.body], atom: false, fmt: (k) => `${l.fmt(k, 0)}.findLast(${fn.params} => ${k[l.kids.length]}) ?? 0` };
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
      [1, () => this.reduction(l, d, "bool")],
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
        [opts.length ? 2 : 0, () => {
          const v = r.pick(opts);
          const safe = v.members?.filter(plainLit) ?? [];
          const member = safe.length && r.chance(0.6) ? r.pick(safe) : null;
          const e = node("str", [this.varRef(v), strLit(member ?? r.pick(STR_LITS))], ([a, b]) => `${a} ?? ${b}`);
          return v.members !== undefined && (member !== null || v.members.includes(printExpr(e.kids[1]!).slice(1, -1))) ? { ...e, members: v.members } : e;
        }],
        [this.tKeys.length && this.tNames.length ? 2 : 0, () => this.translated(d)],
        [this.fnsOf("str").length ? 2 : 0, () => this.call(r.pick(this.fnsOf("str")), d)],
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
      [1, () => {
        const sep = r.pick(["", ",", " "]);
        const shape = r.int(0, 2);
        return node("str", [this.num(d - 1), numLit(r.int(-2, 12), "int")], ([a, i]) =>
          shape === 0 ? `String(${a}).split('').join('${sep}')` : shape === 1 ? `((String(${a})[${i}] ?? '?') + String(${a}).length)` : `String(${a}).split('').reduce((acc, ch, i) => (i > 0 && i % 3 === 0 ? acc + '${sep}' + ch : acc + ch), '')`, 0, true);
      }],
      [2, () => { const t = this.test(d - 1); const [a, b] = [this.str(d - 1), this.str(d - 1)]; const e = str([t, a, b], ([c, x, y]) => `${c} ? ${x} : ${y}`, [a, b]); return a.members !== undefined && b.members !== undefined ? { ...e, members: [...new Set([...a.members, ...b.members])] } : e; }],
      [1, () => str([this.str(d - 1), this.str(d - 1)], ([a, b]) => `${a} || ${b}`)],
      [opts.length ? 2 : 0, () => str([this.varRef(r.pick(opts)), this.str(d - 1)], ([a, b]) => `${a} ?? ${b}`)],
      [
        4,
        () => {
          const m = r.pick(["trim", "trimStart", "trimEnd", "trimLeft", "trimRight", "toUpperCase", "toLowerCase"]);
          return str([this.str(d - 1)], ([a]) => `${recv(a)}.${m}()`, undefined, true);
        },
      ],
      [2, () => {
        const m = r.pick(["encodeURIComponent", "encodeURIComponent", "encodeURI"]);
        const v = r.weighted<() => Expr>([[4, () => this.str(d - 1)], [1, () => this.num(d - 1)], [1, () => this.shown(d - 1) ?? this.str(d - 1)]])();
        return v.lone ? leaf() : node("str", [v], ([a]) => `${m}(${a})`, 0, true);
      }],
      [3, () => this.shown(d) ?? leaf()],
      [1, () => {
        const s = this.str(d - 1);
        const kids = r.chance(0.6) ? [s, this.small(), this.small()] : [s, this.small()];
        return { ...node("str", kids, ([a, i, j]) => `${recv(a)}.substr(${i}${j === undefined ? "" : `, ${j}`})`, 0, true), lone: true };
      }],
      [1, () => {
        const parts = [this.str(d - 1), this.str(d - 1), ...(r.chance(0.5) ? [this.str(d - 1)] : [])];
        const kept = parts.map((p, i) => (i > 0 && p.lone && parts.slice(0, i).some((q) => q.lone) ? strLit(r.pick(["a", "-", "x y"])) : p));
        return str(kept, ([a, ...rest]) => `${recv(a)}.concat(${rest.join(", ")})`, kept, true);
      }],
      [3, () => {
        const m = r.pick(["slice", "slice", "substring"]);
        const s = this.str(d - 1);
        const kids = r.chance(0.6) ? [s, this.small(), this.small()] : [s, this.small()];
        return { ...node("str", kids, ([a, i, j]) => `${recv(a)}.${m}(${i}${j === undefined ? "" : `, ${j}`})`, 0, true), lone: true };
      }],
      [2, () => {
        const s = this.str(d - 1);
        if (r.chance(0.5)) return { ...node("str", [s, this.small()], ([a, i]) => `${recv(a)}.charAt(${i})`, 0, true), lone: true };
        const fallback = r.pick(STR_LITS);
        return { ...node("str", [s, this.small()], ([a, i]) => `${recv(a)}.at(${i}) ?? '${fallback}'`), lone: true };
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
        const times = r.int(0, 3);
        return node("str", [s], ([a]) => `${recv(a)}.repeat(${times})`, 0, true);
      }],
      [1, () => {
        const v = r.weighted<() => Expr>([[3, () => this.str(d - 1)], [2, () => this.num(d - 1)], [1, () => this.bool(d - 1)]])();
        return v.lone ? leaf() : node("str", [v], ([a]) => `JSON.stringify(${a})`, 0, true);
      }],
      [3, () => this.fromList(d) ?? leaf()],
      [2, () => { const e = this.optChain(true); return e?.ty === "str" ? e : leaf(); }],
      [this.dateWeight(2), () => this.isoString(d)],
      [this.dateWeight(2), () => this.dateText(d)],
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
        2,
        () => {
          const p = r.pick(["", "", "1", "1", "2", "3", "3", "4", "6", "10", "16", "17", "21", "2.5", "100"]);
          return node("str", [this.num(d - 1)], ([a]) => `${recv(a)}.toPrecision(${p})`, 0, true);
        },
      ],
      [
        2,
        () => {
          const f = r.pick(["", "", "0", "0", "1", "2", "2", "3", "5", "15", "16", "20", "1.5", "100"]);
          return node("str", [this.num(d - 1)], ([a]) => `${recv(a)}.toExponential(${f})`, 0, true);
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

  shown(d: number): Expr | null {
    const r = this.r;
    const opts = this.scope.vars.filter((v) => v.opt);
    const optLists = this.scope.lists.filter((l) => (l.of.k === "opt" || l.of.k === "nul") && specTy(l.of.of) !== null);
    const wrap = (e: Expr, inner: (a: string) => string): Expr => ({ ...node("str", [e], ([a]) => inner(a!), 0, true), ...(e.lone ? { lone: true } : {}) });
    const [called, before, after] = [r.chance(0.5), r.pick(TPL_TEXT), r.pick(TPL_TEXT)];
    const around = (a: string): string => (called ? `String(${a})` : "`" + before + "${" + a + "}" + after + "`");
    return r.weighted<() => Expr | null>([
      [opts.length ? 4 : 0, () => wrap(this.varRef(r.pick(opts)), around)],
      [optLists.length ? 1 : 0, () => wrap(atom("str", r.pick(optLists).name), around)],
      [3, () => {
        const l = this.listExpr(d);
        if (!l || l.of.k === "obj") return null;
        const lone = l.lone && l.of.k === "str";
        return { ...node("str", l.kids, (k) => around(l.fmt(k, 0)), 0, true), ...(lone ? { lone: true } : {}) };
      }],
    ])();
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
    const opts = this.scope.vars.filter((v) => v.opt);
    for (let n = r.int(1, 3); n > 0; n--) {
      parts.push(r.weighted<() => Expr>([[4, () => this.str(d - 1)], [3, () => this.num(d - 1)], [1, () => this.bool(d - 1)], [opts.length ? 1 : 0, () => this.varRef(r.pick(opts))], [d > 1 ? 1 : 0, () => this.mixed(d - 1)]])());
    }
    const texts = [r.pick(TPL_TEXT), ...parts.map(() => r.pick(TPL_TEXT))];
    let open = false;
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && texts[i]) open = false;
      if (parts[i]!.lone && open && !texts[i]) texts[i] = " ";
      if (parts[i]!.lone) open = true;
      else if (parts[i]!.ty !== "str") open = false;
    }
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
        [this.fnsOf("int", max).length ? 2 : 0, () => this.call(r.pick(this.fnsOf("int", max)), d)],
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
      [max > 2 ** 31 ? 1 : 0, () => {
        const m = r.pick(["indexOf", "lastIndexOf"]);
        const lit = r.pick(STR_LITS);
        return node("int", [this.str(d - 1), this.small()], ([a, i]) => `${recv(a)}.${m}('${lit}', ${i})`, 2 ** 31, true);
      }],
      [max > 2 ** 21 ? 1 : 0, () => {
        const s = this.str(d - 1);
        if (s.lone) return leaf();
        const fallback = r.int(-1, 3);
        return node("int", [s, this.small()], ([a, i]) => `${recv(a)}.codePointAt(${i}) ?? ${fallback}`, 0x110000);
      }],
      [1, () => { const a = this.int(d - 1, max); return node("int", [a], ([x]) => `Math.sign(${x})`, 2, true); }],
      [1, () => {
        const [b, e] = [r.int(-12, 12), r.int(0, 12)];
        const p = Number(BigInt(b) ** BigInt(e));
        if (Math.abs(p) >= max) return leaf();
        return r.chance(0.5) ? node("int", [], () => `${b < 0 ? `(${b})` : b} ** ${e}`, Math.abs(p) + 1) : node("int", [], () => `Math.pow(${b}, ${e})`, Math.abs(p) + 1, true);
      }],
      [max > 2 ** 31 ? 2 : 0, () => this.intFromList(d) ?? leaf()],
      [max > 2 ** 31 ? 1 : 0, () => { const e = this.optChain(true); return e?.ty === "int" ? e : leaf(); }],
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
        [this.dateWeight(3), () => this.dateNum(0)],
      ])();
    };
    if (d <= 0 || r.chance(0.3)) return leaf();
    const options: [number, () => Expr][] = [
      [this.dateWeight(3), () => this.dateNum(d)],
      [1, () => this.dateUtc(d)],
      [4, () => { const op = r.pick(["+", "-", "*"]); const [a, b] = r.chance(0.5) ? [this.float(d - 1), this.num(d - 1)] : [this.num(d - 1), this.float(d - 1)]; return node("float", [a, b], ([x, y]) => `${x} ${op} ${y}`); }],
      [3, () => node("float", [this.num(d - 1), this.num(d - 1)], ([x, y]) => `${x} / ${y}`)],
      [1, () => node("float", [this.float(d - 1), this.num(d - 1)], ([x, y]) => `${x} % ${y}`)],
      [this.vars("int").length ? 1 : 0, () => node("float", [this.int(d - 1), this.varRef(r.pick(this.vars("int")))], ([x, y]) => `${x} % ${y}`)],
      [1, () => node("float", [this.float(d - 1)], ([x]) => `-${x}`)],
      [2, () => { const f = r.pick(["round", "floor", "ceil", "trunc", "abs"]); return node("float", [this.float(d - 1)], ([x]) => `Math.${f}(${x})`, 0, true); }],
      [2, () => { const f = r.pick(["sqrt", "sqrt", "sign"]); return node("float", [r.chance(0.5) ? this.float(d - 1) : this.num(d - 1)], ([x]) => `Math.${f}(${x})`, 0, true); }],
      [1, () => atom("float", `Math.${r.pick(["PI", "E", "LN2", "LN10", "LOG2E", "LOG10E", "SQRT2", "SQRT1_2"])}`)],
      [1, () => atom("float", `Number.${r.pick(["EPSILON", "MAX_VALUE", "MIN_VALUE", "NaN", "POSITIVE_INFINITY", "NEGATIVE_INFINITY"])}`)],
      [1, () => {
        const s = this.str(d - 1);
        return s.lone ? leaf() : node("float", [s, this.small()], ([a, i]) => `${recv(a)}.charCodeAt(${i})`, 0, true);
      }],
      [1, () => { const f = r.pick(["max", "min"]); return node("float", [this.float(d - 1), this.num(d - 1)], ([x, y]) => `Math.${f}(${x}, ${y})`, 0, true); }],
      [1, () => node("float", [this.test(d - 1), this.float(d - 1), this.float(d - 1)], ([c, x, y]) => `${c} ? ${x} : ${y}`)],
      [2, () => this.spreadExtreme(d) ?? leaf()],
      [1, () => { const l = this.listExpr(d); return l && !l.lone ? this.reduction(l, d, "num") : leaf(); }],
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
      const fns = this.fnsOf("bool");
      if (fns.length && r.chance(0.2)) return this.call(r.pick(fns), d);
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
        const e = a.members !== undefined ? a : b;
        if (e.members !== undefined) {
          const safe = e.members.filter(plainLit);
          if (!safe.length) return node("bool", [e], ([x]) => `${recv(x)}.length ${op} 0`);
          const member = strLit(r.pick(safe));
          return node("bool", e === a ? [e, member] : [member, e], ([x, y]) => `${x} ${op} ${y}`);
        }
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
      [1, () => {
        const m = r.pick(["includes", "startsWith", "endsWith"]);
        const needle = this.str(d - 1);
        return node("bool", [this.str(d - 1), needle.lone ? strLit(r.pick(STR_LITS)) : needle, this.small()], ([a, b, i]) => `${recv(a)}.${m}(${b}, ${i})`, 0, true);
      }],
      [2, () => this.typeofTest(d)],
      [2, () => this.boolFromList(d) ?? leaf()],
      [1, () => { const op = r.pick(["===", "!=="]); return node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} ${op} ${b}`); }],
      [2, () => node("bool", [this.bool(d - 1)], ([a]) => `!${a}`)],
      [2, () => node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} && ${b}`)],
      [2, () => node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} || ${b}`)],
      [2, () => { const m = r.pick(["includes", "startsWith", "endsWith"]); const lit = r.pick(STR_LITS); return node("bool", [this.str(d - 1)], ([a]) => `${recv(a)}.${m}('${lit}')`, 0, true); }],
      [strLists.length ? 1 : 0, () => atom("bool", `${r.pick(strLists).name}.includes('${r.pick(STR_LITS)}')`)],
      [this.dateWeight(2), () => this.dateOrder(d)],
      [3, () => this.numberTest(d)],
      [this.scope.vars.some((v) => v.opt && !/[([]/.test(v.name)) ? 2 : 0, () => this.andChain(d)],
    ];
    return r.weighted(options)();
  }

  andChain(d: number): Expr {
    const r = this.r;
    const v = r.pick(this.scope.vars.filter((x) => x.opt && !/[([]/.test(x.name)));
    const negated = r.chance(0.35);
    const test = negated ? r.pick(["== null", `=== ${v.nul ? "null" : "undefined"}`]) : r.pick(["!= null", `!== ${v.nul ? "null" : "undefined"}`]);
    const rest = this.withScope(() => {
      this.scope.vars = this.scope.vars.map((x) => (x === v ? { ...x, opt: false } : x));
      return [this.bool(d - 1), this.bool(d - 1)];
    });
    const op = negated ? "||" : "&&";
    return node("bool", [this.varRef(v), ...rest], ([x, a, b]) => `${x} ${test} ${op} (${a}) ${op} (${b})`);
  }

  typeofTest(d: number): Expr {
    const r = this.r;
    const name = r.pick(["string", "number", "boolean", "undefined", "object"]);
    const op = r.pick(["===", "!==", "===", "==", "!="]);
    const target = r.weighted<() => Expr>([
      [this.scope.vars.length ? 4 : 0, () => this.varRef(r.pick(this.scope.vars))],
      [this.scope.lists.length ? 1 : 0, () => atom("int", r.pick(this.scope.lists).name)],
      [2, () => r.pick([() => this.str(d - 1), () => this.num(d - 1), () => this.bool(d - 1)])()],
    ])();
    const flipped = r.chance(0.2);
    return node("bool", [target], ([a]) => (flipped ? `'${name}' ${op} typeof ${recv(a)}` : `typeof ${recv(a)} ${op} '${name}'`));
  }

  numberTest(d: number): Expr {
    const r = this.r;
    const m = r.pick(["isNaN", "isFinite", "isInteger", "isSafeInteger"]);
    const opts = this.scope.vars.filter((v) => v.opt && (v.ty === "int" || v.ty === "float"));
    return r.weighted<() => Expr>([
      [4, () => node("bool", [this.num(d - 1)], ([a]) => `Number.${m}(${a})`, 0, true)],
      [3, () => node("bool", [this.float(d - 1)], ([a]) => `Number.${m}(${a})`, 0, true)],
      [opts.length ? 2 : 0, () => node("bool", [this.varRef(r.pick(opts))], ([a]) => `Number.${m}(${a})`, 0, true)],
      [2, () => { const f = r.pick(["isNaN", "isFinite"]); return node("bool", [this.num(d - 1)], ([a]) => `${f}(${a})`, 0, true); }],
    ])();
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
      [optVars.length ? 1 : 0, () => this.optChain(false) ?? this.bool(d)],
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
      [this.dateWeight(1), () => node("str", [this.date(d - 1)], ([a]) => `${a}.toJSON()`, 0, true)],
      [0.1, () => atom("int", r.pick(["1e21", "1e20", "2e3", "9007199254740993"]), LIMIT)],
      [d > 0 ? 2 : 0, () => this.mixed(d)],
    ])();
  }

  mixed(d: number): Expr {
    const r = this.r;
    const opts = this.scope.vars.filter((v) => v.opt);
    const branch = (): Expr =>
      r.weighted<() => Expr>([[3, () => this.str(d - 1)], [3, () => this.int(d - 1)], [2, () => this.float(d - 1)], [2, () => this.bool(d - 1)], [opts.length ? 2 : 0, () => this.varRef(r.pick(opts))]])();
    const [a, b] = [branch(), branch()];
    return { ...node("str", [this.test(d - 1), a, b], ([c, x, y]) => `(${c} ? ${x} : ${y})`, 0, true), ...(a.lone || b.lone ? { lone: true } : {}) };
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
      [depth < 4 && ctx === "block" && !this.plain ? 3 : 0, () => this.child(depth)],
      [depth < 4 && ctx === "block" && !this.plain ? 0.6 : 0, () => this.clientOnly(depth)],
      [depth < 4 && ctx === "block" && !this.slotted && !this.plain ? 0.4 : 0, () => this.teleport(depth)],
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
    if (r.chance(this.dateWeight(0.25))) return this.dateChild();
    if (r.chance(0.12)) return this.cardChild();
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
      [deep || ctx !== "block" || this.plain ? 0 : 1, () => this.child(depth)],
    ])();
  }

  ifNode(depth: number, ctx: "block" | "inline" | "list"): Node {
    const r = this.r;
    const branches: { cond: Expr | null; node: Node & { k: "el" } }[] = [];
    const n = r.weighted([[4, 1], [3, 2], [1, 3]]);
    for (let i = 0; i < n; i++) {
      const guards = this.scope.dates.filter((v) => v.opt || !v.valid);
      if (guards.length && r.chance(0.35)) {
        const lazy = guards.filter((v) => !v.opt && this.lazies.some((l) => l.dep === v.key));
        branches.push(this.dateBranch(r.pick(lazy.length && r.chance(0.6) ? lazy : guards), depth, ctx));
        continue;
      }
      const narrowable = this.scope.vars.filter((v) => v.opt);
      if (narrowable.length && r.chance(0.3)) {
        const v = r.pick(narrowable);
        const kind = { str: "string", int: "number", float: "number", bool: "boolean", html: "string", date: "object" }[v.ty];
        const typed = r.chance(0.5) ? `typeof ${v.name} === '${kind}'` : `typeof ${v.name} !== '${v.nul ? "object" : "undefined"}'`;
        const test = r.chance(0.3) ? `!= ${r.pick(["null", "undefined"])}` : `!== ${v.nul ? "null" : "undefined"}`;
        const cond: Expr = { ...r.weighted<() => Expr>([[6, () => this.varRef(v)], [3, () => node("bool", [this.varRef(v)], ([a]) => `${a} ${test}`)], [2, () => atom("bool", typed)]])(), fixed: true };
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

  dateBranch(v: DateVar, depth: number, ctx: "block" | "inline" | "list"): { cond: Expr; node: Node & { k: "el" } } {
    const r = this.r;
    const same = r.pick([`${v.name}.getTime() === ${v.name}.getTime()`, `!Number.isNaN(${v.name}.getTime())`, `Number.isFinite(${v.name}.getTime())`, `!isNaN(${v.name}.valueOf())`]);
    const present = v.nul ? `${v.name} !== null` : `${v.name} !== undefined`;
    const invalid = r.pick([`${v.name}.getTime() !== ${v.name}.getTime()`, `Number.isNaN(${v.name}.getTime())`, `!Number.isFinite(${v.name}.valueOf())`]);
    const text = v.opt ? r.pick([v.name, present, `${v.name} != null`, `${v.name} && ${same}`, `${present} && ${same}`]) : r.chance(0.85) ? same : invalid;
    const valid = text.endsWith(same);
    const el = this.withScope(() => {
      this.scope.dates = this.scope.dates.map((x) => (x === v ? { ...x, opt: false, ...(valid ? { valid } : {}) } : x));
      const lazies = valid ? this.lazies.filter((l) => l.dep === v.key).map((l) => l.v) : [];
      this.scope.vars.push(...lazies);
      const carried = this.carrier(depth, ctx);
      if (lazies.length && !carried.void && !carried.html && !["ul", "ol"].includes(carried.tag) && r.chance(0.7)) carried.kids.unshift({ k: "interp", e: this.varRef(r.pick(lazies)) });
      return carried;
    });
    return { cond: { ...atom("bool", text), fixed: true }, node: el };
  }

  fieldValue(spec: Spec, d: number): Expr | null {
    const r = this.r;
    const prim = (s: Spec): Expr => {
      const ty = specTy(s)!;
      return ty === "str" ? whole(this.str(d)) : ty === "int" ? this.int(d, BOUND_SMALL) : ty === "float" ? this.float(d) : this.bool(d);
    };
    if (spec.k === "enum" && spec.union) {
      const lit = (): Expr => atom("str", `'${r.pick(spec.values)}'`);
      return r.weighted<() => Expr>([
        [3, lit],
        [1, () => node("str", [this.bool(d), lit(), lit()], ([c, a, b]) => `(${c} ? ${a} : ${b})`)],
      ])();
    }
    if (spec.k === "opt" || spec.k === "nul") {
      const ty = specTy(spec.of)!;
      const held = this.vars(ty, BOUND_SMALL, true).filter((v) => !!v.nul === (spec.k === "nul") && !v.lone);
      return r.weighted<() => Expr | null>([
        [spec.k === "opt" ? 2 : 0, () => null],
        [1, () => atom(ty, spec.k === "opt" ? "undefined" : "null")],
        [3, () => prim(spec.of)],
        [held.length ? 2 : 0, () => this.varRef(r.pick(held))],
      ])();
    }
    if (spec.k === "list") {
      const lists = this.scope.lists.filter((l) => l.of.k === spec.of.k && (l.of.k === "str" || l.of.k === "int"));
      return r.weighted<() => Expr>([
        [1, () => atom("str", "[]")],
        [lists.length ? 2 : 0, () => atom("str", r.pick(lists).name)],
        [spec.of.k === "str" || spec.of.k === "int" ? 2 : 0, () => {
          const items = [prim(spec.of)];
          if (r.chance(0.5)) items.push(prim(spec.of));
          return node("str", items, (k) => `[${k.join(", ")}]`, 0, true);
        }],
      ])();
    }
    return prim(spec);
  }

  objectLiteral(fields: { name: string; spec: Spec }[], d: number): Expr {
    const keys: string[] = [];
    const values: Expr[] = [];
    for (const f of this.r.chance(0.3) ? fields.toReversed() : fields) {
      const v = this.fieldValue(f.spec, d);
      if (v === null) continue;
      keys.push(f.name);
      values.push(v);
    }
    return { ...node("str", values, (k) => `({ ${keys.map((key, i) => `${key}: ${k[i]}`).join(", ")} })`, 0, true), fixed: true };
  }

  mappedLiterals(fields: { name: string; spec: Spec }[], d: number, returns: string | null): Expr | null {
    const lists = this.scope.lists.filter((l) => l.of.k === "str" || l.of.k === "int" || l.of.k === "obj");
    if (!lists.length) return null;
    const l = this.r.pick(lists);
    const { params, body } = this.arrow(l.of, false, () => this.objectLiteral(fields, d));
    const typed = returns !== null && this.r.chance(0.5) ? `: ${returns}` : "";
    return { ...node("str", [body], (k) => `${l.name}.map(${params}${typed} => ${k[0]})`, 0, true), fixed: true };
  }

  cardChild(): Node {
    const r = this.r;
    this.nodes++;
    const card = this.objectLiteral(FZ_CARD.fields, r.int(0, 2));
    const cards = r.weighted<() => Expr>([
      [1, () => ({ ...atom("str", "[]"), fixed: true })],
      [3, () => this.mappedLiterals(FZ_CARD.fields, r.int(0, 1), null) ?? { ...atom("str", "[]"), fixed: true }],
      [1, () => ({ ...node("str", [this.objectLiteral(FZ_CARD.fields, 1)], (k) => `[${k[0]}]`, 0, true), fixed: true })],
    ])();
    const attrs: Attr[] = r.chance(0.5) ? [{ k: "bind", name: "card", e: card }, { k: "bind", name: "cards", e: cards }] : [{ k: "bind", name: "cards", e: cards }, { k: "bind", name: "card", e: card }];
    return { k: "child", name: "FzCard", attrs, kids: [] };
  }

  dateChild(): Node {
    const r = this.r;
    this.nodes++;
    const opts = this.scope.dates.filter((v) => v.opt && !v.nul);
    const nuls = this.scope.dates.filter((v) => v.nul && v.opt);
    const attrs: Attr[] = [{ k: "bind", name: "at", e: this.date(r.int(0, 2)) }];
    if (r.chance(0.6)) attrs.push({ k: "bind", name: "was", e: opts.length && r.chance(0.6) ? this.dateRef(r.pick(opts)) : this.date(1) });
    const gone = r.weighted<() => Expr>([
      [nuls.length ? 3 : 0, () => this.dateRef(r.pick(nuls))],
      [1, () => atom("date", "null")],
      [2, () => this.date(1)],
    ])();
    attrs.push({ k: "bind", name: "gone", e: gone });
    if (r.chance(0.4)) attrs.push(...this.attrs("div"));
    return { k: "child", name: "FzDate", attrs, kids: [] };
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

function enumKeys(props: { name: string; spec: Spec }[], prefix: string): { name: string; opt: boolean }[] {
  return props.filter((p) => usesEnum(p.spec)).map((p) => ({ name: `${prefix}${p.name}`, opt: p.spec.k === "opt" }));
}

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
  const keys = g.scope.vars.filter((v) => v.ty === "str" && !v.opt && v.name.startsWith("props."));
  if (keys.length && r.chance(p)) {
    const key = r.pick(keys).name;
    g.scope.vars.push({ name: `Object.hasOwn(LABELS, ${key})`, ty: "bool", opt: false, bound: 0 });
    g.scope.vars.push({ name: `(Object.hasOwn(LABELS, ${key}) ? LABELS[${key}] : '-')`, ty: "str", opt: false, bound: 0 });
  }
  if (r.chance(p)) g.bind("WORDS", { k: "list", of: { k: "str" } });
  if (r.chance(p)) g.bind("NUMS", { k: "list", of: { k: "int", wide: false } });
  if (r.chance(p)) g.bind("ROWS", { k: "list", of: { k: "obj", iface: ROW_IFACE.name } });
}

function bindLookups(g: Gen, k: Consts, keys: { name: string; opt: boolean }[], p: number): void {
  const r = g.r;
  const bound = Math.max(...k.toneInfo.map((i) => Math.abs(i.n))) + 1;
  for (const key of keys) {
    const at = key.opt ? `${key.name} ?? Tone.${r.pick(k.tone)[0]}` : key.name;
    const vars: Var[] = [
      { name: `TONE_TEXT[${at}]`, ty: "str", opt: false, bound: 0 },
      { name: `TONE_INFO[${at}].label`, ty: "str", opt: false, bound: 0 },
      { name: `TONE_INFO[${at}].n`, ty: "int", opt: false, bound },
      ...(key.opt ? [] : [{ name: `TONE_NOTE[${at}]`, ty: "str" as const, opt: !k.toneNote.every((v) => v !== null), bound: 0 }]),
      ...(key.opt && k.tone.every(([, v]) => v !== "") ? [{ name: `((${key.name} && TONE_TEXT[${key.name}]) ?? '-')`, ty: "str" as const, opt: false, bound: 0 }] : []),
    ];
    for (const v of vars) if (r.chance(p)) g.scope.vars.push(v);
  }
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

function bodySteps(g: Gen, ty: Ty, at: number): Step[] {
  const steps: Step[] = [];
  for (let k = g.r.int(1, 3); k > 0; k--) {
    if (g.r.chance(0.5)) {
      const name = `l${at}_${steps.length}`;
      const e = scriptExpr(g, g.r.pick<Ty>(["str", "int", "float", "bool"]), g.r.int(1, 2));
      steps.push({ k: "const", name, e });
      g.scope.vars.push(bindingVar({ name, kind: "const", e }));
    } else if (g.r.chance(0.3)) {
      const at2 = `${at}_${steps.length}`;
      const ret = g.r.pick<Ty>(["str", "int", "bool"]);
      const params = [{ name: `b${at2}`, ty: g.r.pick<Ty>(["str", "int", "bool"]) }];
      const vars: Var[] = params.map((p) => ({ name: p.name, ty: p.ty, opt: false, bound: p.ty === "int" ? BOUND_SMALL : 0 }));
      g.scope.vars.push(...vars);
      const e = scriptExpr(g, ret, g.r.int(1, 2));
      g.scope.vars = g.scope.vars.filter((v) => !vars.includes(v));
      const fn: LocalFn = { name: `in${at2}`, params, ret, steps: [], e };
      g.fns.push(fn);
      steps.push({ k: "arrow", fn });
    } else steps.push({ k: "if", test: g.bool(g.r.int(1, 2)), e: scriptExpr(g, ty, g.r.int(1, 2)) });
  }
  return steps;
}

function localFn(g: Gen, k: number): LocalFn {
  const ret = g.r.pick<Ty>(["str", "str", "int", "bool"]);
  const params = Array.from({ length: g.r.int(1, 2) }, (_, i) => ({ name: `a${k}_${i}`, ty: g.r.pick<Ty>(["str", "int", "bool"]) }));
  const vars: Var[] = params.map((p) => ({ name: p.name, ty: p.ty, opt: false, bound: p.ty === "int" ? BOUND_SMALL : 0 }));
  g.scope.vars.push(...vars);
  const steps = g.r.chance(0.6) ? bodySteps(g, ret, 100 + k) : [];
  const e = scriptExpr(g, ret, g.r.int(1, 2));
  dropArrows(g, steps);
  const local = new Set([...vars.map((v) => v.name), ...steps.flatMap((st) => (st.k === "const" ? [st.name] : []))]);
  g.scope.vars = g.scope.vars.filter((v) => !local.has(v.name));
  const f = { name: `fn${k}`, params, ret, steps, e: joined(e, steps) };
  g.fns.push(f);
  return f;
}

function dropArrows(g: Gen, steps: Step[]): void {
  const inner = new Set(steps.flatMap((st) => (st.k === "arrow" ? [st.fn] : [])));
  g.fns = g.fns.filter((f) => !inner.has(f));
}

function joined(e: Expr, steps: Step[]): Expr {
  const returns = [e, ...steps.flatMap((st) => (st.k === "if" ? [st.e] : []))];
  return { ...e, bound: Math.max(...returns.map((x) => x.bound)), ...(returns.some((x) => x.lone) ? { lone: true } : {}) };
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
    g.scope = { vars: [], lists: [], records: [], htmls: [], dates: [] };
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

const specPrefix = (s: Spec): string =>
  s.k === "opt" ? "o" + specPrefix(s.of) : s.k === "nul" ? "z" + specPrefix(s.of) : s.k === "list" ? "l" : s.k === "record" ? "d" : { str: "s", int: "n", count: "c", float: "f", bool: "b", obj: "r", enum: "t", html: "h", date: "m" }[s.k];

interface Source {
  path: string[];
  ty: ArgTy;
  absence: "undefined" | "null" | null;
  len?: boolean;
}

const argTy = (s: Spec): ArgTy | null => (s.k === "str" ? "str" : s.k === "int" || s.k === "count" ? "int" : s.k === "float" ? "float" : s.k === "bool" ? "bool" : null);

function sourcesOf(path: string[], spec: Spec, ifaces: Map<string, Iface>, prop: boolean): Source[] {
  const ty = argTy(spec);
  if (ty) return [{ path, ty, absence: null }];
  if (spec.k === "opt" || spec.k === "nul") {
    const of = argTy(spec.of);
    if (!of) return [];
    if (spec.k === "opt" && prop && of === "bool") return [{ path, ty: of, absence: null }];
    return [{ path, ty: of, absence: spec.k === "opt" ? "undefined" : "null" }];
  }
  if (spec.k === "list") return [{ path, ty: "int", absence: null, len: true }];
  if (spec.k === "obj") return ifaces.get(spec.iface)!.fields.flatMap((f) => sourcesOf([...path, f.name], f.spec, ifaces, false));
  return [];
}

const ARG_STRS = ["", "a", "x y", "<i>", "é", "🦀", " pad ", "Σ", "ß", "-", "it's", "1e21", "\\"];
const ARG_INTS = [0, 1, -1, 7, 42, 100, MAX, -MAX];
const ARG_FLOATS = [0.5, -0, 0.1, 1.5, -2.5, 123.456, 1e-7, 1e21, 5e-324, 1.7976931348623157e308, 0.30000000000000004, 3];

function argLit(r: Rng, ty: ArgTy): LoadArg {
  if (ty === "str") {
    const s = r.pick(ARG_STRS);
    return { k: "lit", text: quoted(s), value: s };
  }
  if (ty === "bool") {
    const b = r.chance(0.5);
    return { k: "lit", text: String(b), value: b };
  }
  const x = r.pick(ty === "int" ? ARG_INTS : ARG_FLOATS);
  return { k: "lit", text: numText(x), value: x };
}

interface ArgSlot {
  ty: ArgTy;
  nul: boolean;
  undef: boolean;
  undefLit: boolean;
}

function drawArg(r: Rng, slot: ArgSlot, sources: Source[]): LoadArg {
  const fits = sources.filter(
    (s) => (s.ty === slot.ty || (slot.ty === "float" && s.ty === "int" && s.absence === null)) && (s.absence === null || (s.absence === "null" ? slot.nul : slot.undef)),
  );
  return r.weighted<() => LoadArg>([
    [fits.length ? 6 : 0, () => {
      const s = r.pick(fits);
      return { k: "ref", path: s.path, ...(s.len ? { len: true } : {}) };
    }],
    [3, () => argLit(r, slot.ty)],
    [slot.nul ? 2 : 0, () => ({ k: "lit", text: "null", value: null })],
    [slot.undefLit ? 1 : 0, () => ({ k: "lit", text: "undefined", value: undefined })],
  ])();
}

function boundSpecs(a: Await, loaders: LoaderDef[], ifaces: Map<string, Iface>): { name: string; spec: Spec }[] {
  const out = loaders.find((l) => l.name === a.loader)!.out;
  if (a.bind.k === "name") return [{ name: a.bind.name, spec: out }];
  if (a.bind.k === "none" || out.k !== "obj") return [];
  const fields = ifaces.get(out.iface)!.fields;
  return a.bind.fields.map((f) => ({ name: f.as ?? f.field, spec: fields.find((x) => x.name === f.field)!.spec }));
}

function randomAwaits(r: Rng, loaders: LoaderDef[], ifaces: Map<string, Iface>, given: Source[], count: number): { awaits: Await[]; sources: Source[] } {
  const awaits: Await[] = [];
  const results: Source[] = [];
  const bare = new Set<string>();
  let alias = 0;
  for (let i = 0; i < count; i++) {
    const again = awaits.length && r.chance(0.15) ? r.pick(awaits) : null;
    const l = again ? loaders.find((x) => x.name === again.loader)! : r.pick(loaders);
    let args: LoadArg[];
    if (again) args = clone(again.args);
    else {
      const optional = l.params.filter((p) => p.mode === "opt").length;
      const passed = l.params.slice(0, l.params.length - r.int(0, optional));
      args = passed.map((p) => {
        const loose = p.mode === "opt" || p.mode === "undef";
        return drawArg(r, { ty: p.ty, nul: p.mode === "nul", undef: loose, undefLit: loose }, [...given, ...results]);
      });
    }
    const fields = l.out.k === "obj" ? ifaces.get(l.out.iface)!.fields : [];
    const bind = r.weighted<() => LoadBind>([
      [6, () => ({ k: "name", name: `ld${i}` })],
      [fields.length ? 3 : 0, () => {
        const take = fields.filter(() => r.chance(0.6));
        if (!take.length) take.push(r.pick(fields));
        return {
          k: "fields",
          fields: take.map((f) => {
            const plain = argTy(f.spec) !== null || ((f.spec.k === "opt" || f.spec.k === "nul") && argTy(f.spec.of) !== null);
            if (plain && !bare.has(f.name) && r.chance(0.5)) {
              bare.add(f.name);
              return { field: f.name, as: null };
            }
            return { field: f.name, as: `dz${alias++}` };
          }),
        };
      }],
      [1, () => ({ k: "none" })],
    ])();
    const a: Await = { loader: l.name, args, bind };
    awaits.push(a);
    for (const b of boundSpecs(a, loaders, ifaces)) results.push(...sourcesOf([b.name], b.spec, ifaces, false));
  }
  return { awaits, sources: results };
}

function loadSpec(r: Rng, ifaces: Iface[]): Spec {
  const prim = (): Spec => r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }, { k: "float" }, { k: "bool" }]);
  return r.weighted<() => Spec>([
    [3, () => ({ k: "str" })],
    [2, () => ({ k: "int", wide: r.chance(0.2) })],
    [1, () => ({ k: "float" })],
    [1, () => ({ k: "bool" })],
    [3, () => ({ k: "nul", of: prim() })],
    [2, () => ({ k: "list", of: r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }]) })],
    [ifaces.length ? 2 : 0, () => ({ k: "list", of: { k: "obj", iface: r.pick(ifaces).name } })],
    [ifaces.length ? 4 : 0, () => ({ k: "obj", iface: r.pick(ifaces).name })],
    [1, () => ({ k: "record", of: r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }, { k: "bool" }]), dict: r.chance(0.3) })],
  ])();
}

function randomLoaders(r: Rng, ifaceMap: Map<string, Iface>): { ifaces: Iface[]; loaders: LoaderDef[] } {
  const ifaces: Iface[] = [];
  for (let i = r.weighted([[1, 0], [2, 1], [2, 2]]); i > 0; i--) {
    const n = ifaces.length;
    const fields = Array.from({ length: r.int(1, 4) }, (_, j) => ({ name: `g${n}_${j}`, spec: randomSpec(r, [], 1) }));
    ifaces.push({ name: `Got${n}`, fields });
  }
  for (const i of ifaces) ifaceMap.set(i.name, i);
  const loaders: LoaderDef[] = [];
  for (let i = r.int(1, 3); i > 0; i--) {
    const params: LoaderParam[] = [];
    const ty = (): ArgTy => r.pick<ArgTy>(["str", "str", "int", "float", "bool"]);
    for (let n = r.weighted([[2, 0], [3, 1], [3, 2], [1, 3]]); n > 0; n--) {
      params.push({ name: `p${params.length}`, ty: ty(), mode: r.weighted<LoaderParam["mode"]>([[5, "plain"], [2, "nul"], [1, "undef"]]) });
    }
    for (let n = r.weighted([[3, 0], [2, 1], [1, 2]]); n > 0; n--) params.push({ name: `p${params.length}`, ty: ty(), mode: "opt" });
    loaders.push({ name: `fzLoad${loaders.length}`, params, out: loadSpec(r, ifaces) });
  }
  return { ifaces, loaders };
}

function loadNode(r: Rng, kid: LoadKid, sources: Source[]): Node {
  const args: { name: string; arg: LoadArg }[] = [];
  for (const p of kid.props) {
    if (p.spec.k === "opt" && r.chance(0.3)) continue;
    const of = p.spec.k === "opt" || p.spec.k === "nul" ? p.spec.of : p.spec;
    const ty = argTy(of)!;
    args.push({ name: p.name, arg: drawArg(r, { ty, nul: p.spec.k === "nul", undef: p.spec.k === "opt" && ty !== "bool", undefLit: false }, sources) });
  }
  return { k: "load", kid: kid.name, args };
}

function kidSpec(r: Rng): Spec {
  const prim = (): Spec => r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }, { k: "float" }, { k: "bool" }]);
  return r.weighted<() => Spec>([
    [3, () => ({ k: "str" })],
    [2, () => ({ k: "int", wide: false })],
    [1, () => ({ k: "float" })],
    [1, () => ({ k: "bool" })],
    [2, () => ({ k: "opt", of: prim() })],
    [2, () => ({ k: "nul", of: prim() })],
  ])();
}

function randomKid(g: Gen, loads: Loads, depth: number): LoadKid {
  const r = g.r;
  const props: { name: string; spec: Spec }[] = [];
  for (let n = r.int(0, 3); n > 0; n--) {
    const spec = kidSpec(r);
    props.push({ name: `${specPrefix(spec)}${props.length}`, spec });
  }
  const own = props.flatMap((p) => sourcesOf(["props", p.name], p.spec, g.ifaces, true));
  const { awaits, sources } = randomAwaits(r, loads.loaders, g.ifaces, own, r.weighted([[3, 1], [3, 2], [1, 3]]));
  const kid: LoadKid = { name: `FzLd${loads.kids.length}`, props, awaits, template: [] };
  loads.kids.push(kid);
  const saved = { scope: g.scope, fns: g.fns, tKeys: g.tKeys, tNames: g.tNames, routes: g.routes, reads: g.reads, lazies: g.lazies, plain: g.plain };
  g.scope = { vars: [], lists: [], records: [], htmls: [], dates: [] };
  Object.assign(g, { fns: [], tKeys: [], tNames: [], routes: [], reads: [], lazies: [], plain: true });
  try {
    for (const p of props) g.bind(p.name, p.spec, true);
    for (const a of awaits) for (const b of boundSpecs(a, loads.loaders, g.ifaces)) g.bind(b.name, b.spec);
    for (let n = r.int(1, 2); n > 0; n--) kid.template.push(g.node(0, "block"));
  } finally {
    Object.assign(g, saved);
  }
  if (depth > 0 && r.chance(0.4)) {
    const next = randomKid(g, loads, depth - 1);
    const here = [...props.flatMap((p) => sourcesOf([p.name], p.spec, g.ifaces, true)), ...sources];
    for (let n = r.weighted([[3, 1], [1, 2]]); n > 0; n--) kid.template.splice(r.int(0, kid.template.length), 0, loadNode(r, next, here));
  }
  return kid;
}

function evalArg(a: LoadArg, env: Record<string, unknown>): unknown {
  if (a.k === "lit") return a.value;
  let v: unknown = env;
  for (const p of a.path) v = v === null || v === undefined ? undefined : (v as Record<string, unknown>)[p];
  return a.len ? (v as unknown[] | undefined)?.length : v;
}

function propsEnv(props: { name: string; spec: Spec }[], values: Record<string, unknown>): Record<string, unknown> {
  const own: Record<string, unknown> = {};
  for (const p of props) own[p.name] = values[p.name] === undefined && p.spec.k === "opt" && p.spec.of.k === "bool" ? false : values[p.name];
  return { ...own, props: own };
}

function walkLoads(c: Component, fixture: Record<string, unknown>, get: (key: string, spec: Spec) => unknown): void {
  const loads = c.loads;
  if (!loads) return;
  const run = (awaits: Await[], env: Record<string, unknown>, template: Node[]): void => {
    for (const a of awaits) {
      const l = loads.loaders.find((x) => x.name === a.loader)!;
      const value = get(loadKey(l.name, a.args.map((x) => evalArg(x, env))), l.out);
      if (a.bind.k === "name") env[a.bind.name] = value;
      else if (a.bind.k === "fields") for (const f of a.bind.fields) env[f.as ?? f.field] = (value as Record<string, unknown> | undefined)?.[f.field];
    }
    for (const n of loadNodes(template)) {
      const kid = loads.kids.find((k) => k.name === n.kid)!;
      const given: Record<string, unknown> = {};
      for (const a of n.args) given[a.name] = evalArg(a.arg, env);
      run(kid.awaits, propsEnv(kid.props, given), kid.template);
    }
  };
  run(loads.awaits, propsEnv(c.props, fixture), c.template);
}

function keyHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const valueIfaces = (c: Component): Map<string, Iface> => new Map([...c.ifaces, FZ_ITEM, ...(c.loads?.ifaces ?? [])].map((i) => [i.name, i]));

/** The fixture with `$loads` holding a result for each call the render makes, and no other: the
 * results it has for those keys, and new ones from `fresh` for the rest. */
export function withLoads(c: Component, fixture: Record<string, unknown>, fresh?: (spec: Spec) => unknown): Record<string, unknown> {
  const { $loads, ...rest } = fixture;
  if (!c.loads) return rest;
  const old = ($loads ?? {}) as Record<string, unknown>;
  const ifaces = valueIfaces(c);
  const out: Record<string, unknown> = {};
  walkLoads(c, rest, (key, spec) => {
    if (!(key in out)) out[key] = key in old ? old[key] : fresh ? fresh(spec) : randomValue(new Rng(keyHash(key)), spec, ifaces, false);
    return out[key];
  });
  return Object.keys(out).length ? { ...rest, $loads: out } : rest;
}

function loadSpecs(c: Component, fixture: Record<string, unknown>): Map<string, Spec> {
  const specs = new Map<string, Spec>();
  const loads = (fixture.$loads ?? {}) as Record<string, unknown>;
  walkLoads(c, fixture, (key, spec) => {
    specs.set(key, spec);
    return loads[key];
  });
  return specs;
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
  const prefix = specPrefix;
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
  if (r.chance(0.3)) {
    const values: string[] = [];
    for (let n = r.int(2, 4); values.length < n; ) {
      const v = r.pick(UNION_LITS);
      if (!values.includes(v)) values.push(v);
    }
    const union: Spec = { k: "enum", values, union: true };
    const spec = r.weighted<() => Spec>([
      [5, () => union],
      [3, () => ({ k: "opt", of: union })],
      [2, () => ({ k: "nul", of: union })],
    ])();
    props.push({ name: `${prefix(spec)}${props.length}`, spec });
  }
  if (r.chance(0.12)) {
    const html: Spec = { k: "html", inline: r.chance(0.4) };
    const spec: Spec = r.chance(0.7) ? html : { k: "opt", of: html };
    props.push({ name: `${prefix(spec)}${props.length}`, spec });
  }
  if (r.chance(0.3)) {
    for (let n = r.int(1, 3); n > 0; n--) {
      const spec = r.weighted<Spec>([[3, { k: "date" }], [2, { k: "opt", of: { k: "date" } }], [2, { k: "nul", of: { k: "date" } }]]);
      props.push({ name: `${prefix(spec)}${props.length}`, spec });
    }
  }

  const g = new Gen(r, new Map([...ifaces, ROW_IFACE, FZ_ITEM].map((i) => [i.name, i])));
  const fresh = (): Scope => ({ vars: [], lists: [], records: [], htmls: [], dates: [] });
  const router = r.chance(0.3) ? randomRouter(r) : null;
  const stores = r.chance(0.3) ? randomStores(r, g) : [];
  const i18n = r.chance(0.3) ? randomMessages(r) : null;
  const plan = r.chance(0.3) ? randomLoaders(r, g.ifaces) : null;
  const root = plan ? randomAwaits(r, plan.loaders, g.ifaces, props.flatMap((p) => sourcesOf(["props", p.name], p.spec, g.ifaces, true)), r.weighted([[1, 0], [3, 1], [3, 2], [2, 3], [1, 4]])) : null;
  const loads: Loads | null = plan && root ? { ...plan, awaits: root.awaits, kids: [] } : null;
  const results = loads ? loads.awaits.flatMap((a) => boundSpecs(a, loads.loaders, g.ifaces)) : [];
  g.dateLits = r.chance(0.25) ? 1 : 0;
  const useT = r.chance(0.5);
  const scoped = r.chance(0.35);
  const propsVar = r.chance(0.3);
  const bindings: Binding[] = [];
  const fns: LocalFn[] = [];
  const provides: Provide[] = [];
  const head: HeadCall[] = [];
  if (r.chance(0.45)) {
    g.scope = fresh();
    for (const p of props) g.bind(`props.${p.name}`, p.spec, true);
    if (consts) bindConsts(g, consts, 0.5);
    if (consts) bindLookups(g, consts, enumKeys(props, "props."), 0.5);
    bindStores(g, stores, false);
    if (router) bindRoute(g, router, false);
    if (i18n && useT) {
      g.tKeys = i18n.keys;
      g.tNames = ["t"];
    }
    for (let n = r.chance(0.35) ? r.int(1, 2) : 0; n > 0; n--) fns.push(localFn(g, fns.length));
    for (const b of results) g.bind(b.name, b.spec);
    for (let n = r.weighted([[2, 0], [3, 1], [2, 2], [1, 3]]); n > 0; n--) {
      const kind = r.weighted<Binding["kind"]>([[3, "computed"], [2, "const"], [1, "ref"]]);
      const ty = r.pick<Ty>(["str", "str", "int", "float", "bool"]);
      const steps = kind === "computed" && r.chance(0.4) ? bodySteps(g, ty, bindings.length) : undefined;
      const e = kind === "ref" ? literalOf(r, ty) : scriptExpr(g, ty, r.int(1, 2));
      if (steps) dropArrows(g, steps);
      if (steps) g.scope.vars = g.scope.vars.filter((v) => !steps.some((st) => st.k === "const" && st.name === v.name));
      const binding = { name: `${kind === "computed" ? "cmp" : kind === "const" ? "cst" : "ref"}${bindings.length}`, kind, e: steps ? joined(e, steps) : e, ...(steps ? { steps } : {}) };
      bindings.push(binding);
      if (kind === "const") g.scope.vars.push(bindingVar(binding));
    }
    for (let n = g.dateWeight(1) ? r.weighted([[2, 0], [3, 1], [1, 2]]) : 0; n > 0; n--) bindings.push({ name: `cmp${bindings.length}`, kind: "computed", e: g.date(r.int(1, 2)) });
    for (let n = ifaces.length && r.chance(0.4) ? r.int(1, 2) : 0; n > 0; n--) {
      const iface = r.pick(ifaces);
      const list = r.chance(0.4) ? g.mappedLiterals(iface.fields, r.int(0, 2), iface.name) : null;
      bindings.push({ name: `obj${bindings.length}`, kind: "computed", e: list ?? g.objectLiteral(iface.fields, r.int(0, 2)), obj: { iface: iface.name, list: list !== null, how: r.chance(0.5) ? "ret" : "param" } });
    }
    if (r.chance(0.35)) {
      if (r.chance(0.7)) provides.push({ key: "str", e: whole(g.str(r.int(0, 2))) });
      if (r.chance(0.5)) provides.push({ key: "num", e: g.int(r.int(0, 2), BOUND_SMALL) });
      const live = bindings.filter((b) => b.kind !== "const" && b.e.ty === "str" && b.lazy === undefined && !b.obj);
      if (live.length && r.chance(0.6)) provides.push({ key: "live", e: { ...atom("str", r.pick(live).name), fixed: true } });
    }
    if (r.chance(0.3)) head.push(headCall(g, "useHead"));
    if (r.chance(0.15)) head.push(headCall(g, "useSeoMeta"));
  }
  const sure = props.filter((p) => p.spec.k === "date");
  for (let n = sure.length && r.chance(0.6) ? r.int(1, 2) : 0; n > 0; n--) {
    const p = r.pick(sure);
    const tail = r.pick(["", ".slice(0, 10)", ".slice(11)", ".length"]);
    const read = `props.${p.name}.toISOString()${tail}`;
    const e = tail === ".length" ? atom("int", read, 100) : { ...atom("str", read), ...(tail ? { lone: true } : {}) };
    bindings.push({ name: `cmp${bindings.length}`, kind: "computed", e, lazy: p.name });
  }

  g.scope = fresh();
  for (const p of props) g.bind(propsVar && r.chance(0.4) ? `props.${p.name}` : p.name, p.spec, true);
  for (const b of results) g.bind(b.name, b.spec);
  if (consts) bindConsts(g, consts, 0.35);
  if (consts) bindLookups(g, consts, enumKeys(props, ""), 0.5);
  for (const b of bindings) {
    if (b.obj) g.bind(b.name, b.obj.list ? { k: "list", of: { k: "obj", iface: b.obj.iface } } : { k: "obj", iface: b.obj.iface });
    else if (b.e.ty === "date") g.scope.dates.push({ name: b.name, key: b.name, opt: false, ...(b.e.valid ? { valid: true } : {}) });
    else if (b.lazy !== undefined) g.lazies.push({ dep: b.lazy, v: bindingVar(b) });
    else g.scope.vars.push(bindingVar(b));
  }
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
  if (loads && (!loads.awaits.length || r.chance(0.6))) {
    const kid = randomKid(g, loads, 1);
    const here = [...props.flatMap((p) => sourcesOf([p.name], p.spec, g.ifaces, true)), ...root!.sources];
    for (let n = r.weighted([[3, 1], [1, 2]]); n > 0; n--) template.splice(r.int(0, template.length), 0, loadNode(r, kid, here));
  }

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
    fns,
    provides,
    head,
    consts,
    localEnums: r.chance(0.3),
    asyncHelpers: (Object.keys(HELPERS) as HelperName[]).filter(() => r.chance(0.15)),
    generic: objLists.length && r.chance(0.3) ? ((r.pick(objLists).spec as Spec & { k: "list" }).of as Spec & { k: "obj" }).iface : null,
    router,
    stores,
    i18n: i18n?.messages ?? null,
    loads,
  });
  const fx: Record<string, unknown>[] = [];
  for (let i = 0; i < fixtures; i++) fx.push(withLoads(component, randomFixture(r, component, i === 0), (spec) => randomValue(r, spec, valueIfaces(component), i === 0)));
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
      text += `\n${bindingText(b)}`;
      grew = true;
    }
  }
  const bindings = c.bindings.filter((b) => kept.has(b));
  const used = (name: string): boolean => mentions(text, name) || new RegExp(`${FREE}props\\.${name}(?![\\w$])`).test(text);
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
  for (const b of bindings) if (b.obj) visit({ k: "obj", iface: b.obj.iface });
  const full = `${text}\n${scriptLines({ ...c, bindings }).join("\n")}`;
  const routed = /<RouterLink|\$route\./.test(full) || READS_ROUTE.test(full);
  const translated = /\$t\(/.test(full) || CALLS_T.test(full) || mentions(full, "locale");
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
        if (a.k === "bind" && !a.e.fixed) yield { get: () => a.e, set: (e) => (a.e = e) };
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
  for (const b of c.bindings) if (b.kind !== "ref" && !b.obj) yield { get: () => b.e, set: (e) => (b.e = b.steps ? joined(e, b.steps) : e) };
  for (const p of c.provides) if (!p.e.fixed) yield { get: () => p.e, set: (e) => (p.e = whole(e)) };
  for (const h of c.head) for (const en of h.entries) yield { get: () => en.v.e, set: (e) => (en.v.e = whole(e)) };
  yield* exprSlots(c.template);
}

const LITERALS: Record<Ty, Expr> = { str: strLit("a"), int: numLit(1, "int"), float: numLit(0.5, "float"), bool: atom("bool", "true"), html: atom("html", "''"), date: { ...atom("date", "new Date(0)"), valid: true } };

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
  if (c.loads) loadShrinks(c, edit);
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

const SIMPLE_LITS: Record<ArgTy, LoadArg> = {
  str: { k: "lit", text: "'a'", value: "a" },
  int: { k: "lit", text: "1", value: 1 },
  float: { k: "lit", text: "0.5", value: 0.5 },
  bool: { k: "lit", text: "true", value: true },
};

function simpler(p: LoaderParam): LoadArg {
  if (p.mode === "nul") return { k: "lit", text: "null", value: null };
  if (p.mode === "opt" || p.mode === "undef") return { k: "lit", text: "undefined", value: undefined };
  return SIMPLE_LITS[p.ty];
}

function loadShrinks(c: Component, edit: (f: (copy: Component) => boolean) => void): void {
  const loads = c.loads!;
  const kidOf = (x: Component, name: string): LoadKid => x.loads!.kids.find((k) => k.name === name)!;
  const awaitShrinks = (awaits: Await[], at: (x: Component) => Await[], text: (x: Component) => string): void => {
    awaits.forEach((a, i) => {
      const unread = (x: Component): boolean => !boundNames(a).some((n) => mentions(text(x), n));
      edit((x) => (at(x).splice(i, 1), unread(x)));
      if (a.bind.k !== "none") edit((x) => ((at(x)[i]!.bind = { k: "none" }), unread(x)));
      const l = loads.loaders.find((y) => y.name === a.loader)!;
      a.args.forEach((arg, j) => {
        const lit = simpler(l.params[j]!);
        if (argText(arg) !== argText(lit)) edit((x) => ((at(x)[i]!.args[j] = lit), true));
      });
      if (a.args.length && l.params[a.args.length - 1]!.mode === "opt") edit((x) => (at(x)[i]!.args.pop(), true));
    });
  };
  awaitShrinks(loads.awaits, (x) => x.loads!.awaits, printComponent);
  const nodeShrinks = (template: Node[], at: (x: Component) => Node[], remove: boolean): void => {
    template.forEach((n, i) => {
      if (remove && template.length > 1) edit((x) => (at(x).splice(i, 1), true));
      if (n.k !== "load") return;
      const kid = loads.kids.find((k) => k.name === n.kid)!;
      n.args.forEach((a, j) => {
        const spec = kid.props.find((p) => p.name === a.name)!.spec;
        const node = (x: Component): Node & { k: "load" } => at(x)[i] as Node & { k: "load" };
        if (spec.k === "opt") edit((x) => (node(x).args.splice(j, 1), true));
        if (a.arg.k === "ref") {
          const base = spec.k === "opt" || spec.k === "nul" ? spec.of : spec;
          edit((x) => ((node(x).args[j]!.arg = spec.k === "nul" ? { k: "lit", text: "null", value: null } : SIMPLE_LITS[argTy(base)!]), true));
        }
      });
    });
  };
  for (const kid of kidsUsed(c)) {
    awaitShrinks(kid.awaits, (x) => kidOf(x, kid.name).awaits, (x) => kidText(kidOf(x, kid.name)));
    nodeShrinks(kid.template, (x) => kidOf(x, kid.name).template, true);
    kid.props.forEach((p, i) => {
      edit((x) => {
        const k = kidOf(x, kid.name);
        k.props.splice(i, 1);
        const walk = (template: Node[]): void => {
          for (const n of loadNodes(template)) if (n.kid === kid.name) n.args = n.args.filter((a) => a.name !== p.name);
        };
        walk(x.template);
        x.loads!.kids.forEach((y) => walk(y.template));
        return !mentions(kidText(k), p.name);
      });
    });
  }
  nodeShrinks(c.template, (x) => x.template, false);
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
    const base = p.spec.k === "opt" || (p.spec.k === "nul" && p.spec.of.k === "enum") ? p.spec.of : p.spec;
    if (base.k === "enum") {
      if (fixture[p.name] !== base.values[0]) out.push({ ...fixture, [p.name]: base.values[0] });
      continue;
    }
    if (base.k === "html") {
      if (fixture[p.name] !== "") out.push({ ...fixture, [p.name]: "" });
      continue;
    }
    if (base.k === "date" || (base.k === "nul" && base.of.k === "date")) {
      const v = fixture[p.name];
      if (typeof v === "string") out.push({ ...fixture, [p.name]: Number.isNaN(timeOf(v)) ? 8.64e15 + 1 : timeOf(v) });
      if (typeof v === "number") for (const s of valueShrinks(v)) out.push({ ...fixture, [p.name]: s });
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
  const loads = fixture.$loads as Record<string, unknown> | undefined;
  if (loads) {
    for (const [key, spec] of loadSpecs(c, fixture)) {
      const v = loads[key];
      if (spec.k === "nul" && v !== null) out.push({ ...fixture, $loads: { ...loads, [key]: null } });
      const integer = spec.k === "int" || (spec.k === "nul" && spec.of.k === "int");
      for (const s of valueShrinks(v)) if (!(integer && Object.is(s, -0))) out.push({ ...fixture, $loads: { ...loads, [key]: s } });
    }
  }
  const keep = (f: Record<string, unknown>): Record<string, unknown> =>
    withLoads(c, Object.fromEntries(Object.entries(f).filter(([k]) => k.startsWith("$") || c.props.some((p) => p.name === k))));
  return out.map(keep);
}

export function caseSize(c: Component, fixture: Record<string, unknown>): number {
  return printComponent(c).length + helperFiles(c).reduce((n, [, text]) => n + text.length, 0) + fixtureJson(fixture).length;
}
