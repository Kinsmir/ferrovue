/* Random components and fixtures for the differential fuzzer (`run.ts`), within the grammar ferrovue
 * accepts (README, "What a component may use").
 *
 * Everything is driven by a seeded PRNG: `generateCase(seed, index)` always returns the same
 * component and fixtures. A component is kept as a small AST (props, interfaces, template nodes,
 * expression trees) rather than text, so the shrinker can remove nodes, attributes and
 * sub-expressions and still print a valid component.
 *
 * Two rules keep the output inside what ferrovue promises:
 * - expressions are well typed as TypeScript types them, and optional values are only read where
 *   they may be (`??`, interpolation, attributes, tests, or inside a `v-if` that narrows them);
 * - integer arithmetic stays exact: each integer expression carries a bound on its magnitude, and
 *   an operation that could leave ±2⁵³ is not generated. */

// ── PRNG ────────────────────────────────────────────────────────────────────────────────────────

/** sfc32, seeded through splitmix32: small, fast and the same on every platform. */
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
  /** A float in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  /** An integer in [lo, hi]. */
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
  /** One of the options, each with its weight. */
  weighted<T>(options: readonly (readonly [number, T])[]): T {
    const total = options.reduce((s, [w]) => s + w, 0);
    let r = this.next() * total;
    for (const [w, v] of options) {
      if ((r -= w) < 0) return v;
    }
    return options[options.length - 1]![1];
  }
}

// ── The component AST ───────────────────────────────────────────────────────────────────────────

export type Ty = "str" | "int" | "float" | "bool";

/** An expression: its type, an exclusive bound on its magnitude when it is an integer, its
 * sub-expressions, and how it prints given theirs (already parenthesised when not atomic). */
export interface Expr {
  ty: Ty;
  bound: number;
  kids: Expr[];
  fmt: (kids: string[]) => string;
  atom: boolean;
  /** A test that narrows an optional value: the shrinker leaves it alone. */
  fixed?: boolean;
  /** The value named, when the expression is a plain reference. */
  ref?: string;
  /** `&&`, whose operands TypeScript narrows in the branch it guards. */
  and?: boolean;
}

/** What a prop or an interface field holds, which says both its TypeScript type and how a fixture
 * value is drawn. */
export type Spec =
  | { k: "str" }
  | { k: "int"; wide: boolean }
  | { k: "count" }
  | { k: "float" }
  | { k: "bool" }
  | { k: "opt"; of: Spec }
  | { k: "list"; of: Spec }
  | { k: "obj"; iface: string };

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
  | { k: "el"; tag: string; attrs: Attr[]; kids: Node[]; void?: boolean }
  | { k: "text"; s: string }
  | { k: "interp"; e: Expr }
  /** A `v-if` chain: each branch an element (or `<template>`), the last one's test `null` for
   * `v-else`. */
  | { k: "if"; branches: { cond: Expr | null; node: Node & { k: "el" } }[] }
  /** `v-for="(item, index) in source"` on the element. */
  | { k: "for"; head: string; node: Node & { k: "el" } };

export interface Component {
  name: string;
  ifaces: Iface[];
  props: { name: string; spec: Spec }[];
  template: Node[];
}

export interface Case {
  /** The component, the fixtures drawn for it (props by name). */
  component: Component;
  fixtures: Record<string, unknown>[];
}

// ── Printing ────────────────────────────────────────────────────────────────────────────────────

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
    case "list":
      return `${tsType(spec.of)}[]`;
    case "obj":
      return spec.iface;
  }
}

const usesFloat = (spec: Spec): boolean =>
  spec.k === "float" || ((spec.k === "opt" || spec.k === "list") && usesFloat(spec.of));

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
    case "el": {
      const attrs = [...extra, ...n.attrs.map(printAttr)];
      const open = `<${n.tag}${attrs.map((a) => " " + a).join("")}`;
      if (n.void) return `${open} />`;
      const inner = n.kids.map((k) => printNode(k, indent + "  ")).join("");
      return `${open}>${inner}</${n.tag}>`;
    }
  }
}

/** The `.vue` file. */
export function printComponent(c: Component): string {
  const float = c.props.some((p) => usesFloat(p.spec)) || c.ifaces.some((i) => i.fields.some((f) => usesFloat(f.spec)));
  const lines = ['<script setup lang="ts">'];
  if (float) lines.push('import type { Float } from "ferrovue/types";', "");
  for (const i of c.ifaces) {
    lines.push(`interface ${i.name} {`);
    for (const f of i.fields) lines.push(`  ${f.name}${f.spec.k === "opt" ? "?" : ""}: ${tsType(f.spec)};`);
    lines.push("}", "");
  }
  const props = c.props.map((p) => `${p.name}${p.spec.k === "opt" ? "?" : ""}: ${tsType(p.spec)}`);
  lines.push(props.length ? `defineProps<{ ${props.join("; ")} }>();` : "defineProps<{}>();");
  lines.push("</script>", "", "<template>");
  for (const n of c.template) lines.push("  " + printNode(n, "  "));
  lines.push("</template>", "");
  return lines.join("\n");
}

/** A fixture as JSON, keeping negative zero (which `JSON.stringify` writes as `0`). */
export function fixtureJson(fixture: Record<string, unknown>): string {
  const NEG0 = "\u0000neg0\u0000";
  const text = JSON.stringify(fixture, (_, v: unknown) => (Object.is(v, -0) ? NEG0 : v), 2);
  return text.replaceAll(JSON.stringify(NEG0), "-0.0") + "\n";
}

// ── Values ──────────────────────────────────────────────────────────────────────────────────────

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
  "\\back\\slash",
  "a\u0000b",
  "\ud800",
];

const CHARS = [..."abcXYZ09 _-.,!?<>&\"'`/=;:#%{}()[]", "é", "ß", " ", "́", "🦀", "ש", "​", " ", "﻿", "\n", "\t"];

function randomString(r: Rng, hostile: boolean): string {
  if (hostile || r.chance(0.5)) {
    // Lone surrogates are not valid JSON for serde, and not text a fixture can carry: kept out.
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
  }
}

/** Fixture props for `c`: every required prop, and each optional one present or not. */
export function randomFixture(r: Rng, c: Component, hostile: boolean): Record<string, unknown> {
  const ifaces = new Map(c.ifaces.map((i) => [i.name, i]));
  const out: Record<string, unknown> = {};
  for (const p of c.props) {
    const v = randomValue(r, p.spec, ifaces, hostile);
    if (v !== undefined) out[p.name] = v;
  }
  return out;
}

// ── Expressions ─────────────────────────────────────────────────────────────────────────────────

const LIMIT = 2 ** 53;
const BOUND_SMALL = 1000;

/** A method's receiver: an integer literal needs parentheses (`(3).toFixed(1)`). */
const recv = (a: string | undefined): string => (/^[\d.]+$/.test(a ?? "") ? `(${a})` : (a ?? ""));
const atom = (ty: Ty, text: string, bound = 0): Expr => ({ ty, bound, kids: [], fmt: () => text, atom: true });
const node = (ty: Ty, kids: Expr[], fmt: (k: string[]) => string, bound = 0, isAtom = false): Expr => ({
  ty,
  bound,
  kids,
  fmt,
  atom: isAtom,
});

/** A literal string as a template can spell it inside a double-quoted attribute: single quotes,
 * with no quote, backslash or backtick inside. */
const STR_LITS = ["", "a", "x y", "<i>", "a&b", "&amp;", "→", "é", "🦀", " pad ", "px", "-", ", ", "Σ", "ß"];
const strLit = (s: string): Expr => atom("str", `'${s}'`);
/** Text inside a template literal. */
const TPL_TEXT = ["", " ", "n=", " & ", "<", "é", "/", "px", "🦀"];

function numLit(x: number, ty: Ty): Expr {
  const text = String(x);
  return { ...atom(ty, text, Math.abs(x) + 1), atom: x >= 0 && !Object.is(x, -0) };
}

/** A value in scope: a prop, a field of a loop item, an index or a range value. */
interface Var {
  name: string;
  ty: Ty;
  opt: boolean;
  bound: number;
}
interface ListVar {
  name: string;
  of: Spec;
}
interface Scope {
  vars: Var[];
  lists: ListVar[];
}

const specTy = (s: Spec): Ty | null =>
  s.k === "str" ? "str" : s.k === "int" || s.k === "count" ? "int" : s.k === "float" ? "float" : s.k === "bool" ? "bool" : null;
const specBound = (s: Spec): number => (s.k === "int" ? (s.wide ? LIMIT : BOUND_SMALL) : s.k === "count" ? 10 : 0);

class Gen {
  scope: Scope = { vars: [], lists: [] };
  loopDepth = 0;
  nodes = 0;
  readonly r: Rng;
  readonly ifaces: Map<string, Iface>;
  constructor(r: Rng, ifaces: Map<string, Iface>) {
    this.r = r;
    this.ifaces = ifaces;
  }

  /** Add the values a spec makes visible under `name` (a prop or `item.field`). */
  bind(name: string, spec: Spec, prop = false): void {
    if (spec.k === "list") this.scope.lists.push({ name, of: spec.of });
    else if (spec.k === "obj") for (const f of this.ifaces.get(spec.iface)!.fields) this.bind(`${name}.${f.name}`, f.spec);
    else if (spec.k === "opt") {
      const ty = specTy(spec.of);
      // An absent optional boolean prop is `false` to Vue: it is read as a boolean. (A field of an
      // object is not cast: absent, it is `undefined`.)
      if (ty) this.scope.vars.push({ name, ty, opt: !(prop && ty === "bool"), bound: specBound(spec.of) });
    } else {
      const ty = specTy(spec)!;
      this.scope.vars.push({ name, ty, opt: false, bound: specBound(spec) });
    }
  }

  withScope<T>(f: () => T): T {
    const saved = { vars: [...this.scope.vars], lists: [...this.scope.lists] };
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
    return { ...atom(v.ty, v.name, v.bound), ref: v.name };
  }

  // Each generator takes a depth budget; at zero it makes a leaf.

  str(d: number): Expr {
    const r = this.r;
    const leaf = (): Expr => {
      const vs = this.vars("str");
      const opts = this.vars("str", Infinity, true);
      return r.weighted<() => Expr>([
        [vs.length ? 6 : 0, () => this.varRef(r.pick(vs))],
        [2, () => strLit(r.pick(STR_LITS))],
        [opts.length ? 2 : 0, () => node("str", [this.varRef(r.pick(opts)), strLit(r.pick(STR_LITS))], ([a, b]) => `${a} ?? ${b}`)],
      ])();
    };
    if (d <= 0 || r.chance(0.3)) return leaf();
    const lists = this.scope.lists.filter((l) => l.of.k === "str" || l.of.k === "int");
    const opts = this.vars("str", Infinity, true);
    const options: [number, () => Expr][] = [
      [3, () => node("str", [this.str(d - 1), this.str(d - 1)], ([a, b]) => `${a} + ${b}`)],
      [2, () => node("str", [this.str(d - 1), this.num(d - 1)], ([a, b]) => `${a} + ${b}`)],
      [1, () => node("str", [this.num(d - 1), this.str(d - 1)], ([a, b]) => `${a} + ${b}`)],
      [3, () => this.template(d)],
      [2, () => node("str", [this.test(d - 1), this.str(d - 1), this.str(d - 1)], ([c, a, b]) => `${c} ? ${a} : ${b}`)],
      [1, () => node("str", [this.str(d - 1), this.str(d - 1)], ([a, b]) => `${a} || ${b}`)],
      [opts.length ? 2 : 0, () => node("str", [this.varRef(r.pick(opts)), this.str(d - 1)], ([a, b]) => `${a} ?? ${b}`)],
      [
        4,
        () => {
          const m = r.pick(["trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase"]);
          return node("str", [this.str(d - 1)], ([a]) => `${recv(a)}.${m}()`, 0, true);
        },
      ],
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

  template(d: number): Expr {
    const r = this.r;
    const parts: Expr[] = [];
    for (let n = r.int(1, 3); n > 0; n--) {
      parts.push(r.weighted<() => Expr>([[4, () => this.str(d - 1)], [3, () => this.num(d - 1)], [1, () => this.bool(d - 1)]])());
    }
    const texts = [r.pick(TPL_TEXT), ...parts.map(() => r.pick(TPL_TEXT))];
    return {
      ty: "str",
      bound: 0,
      kids: parts,
      atom: true,
      // Inside `${}` a sub-expression needs no parentheses, but they do no harm.
      fmt: (k) => "`" + texts[0] + k.map((s, i) => "${" + s + "}" + texts[i + 1]).join("") + "`",
    };
  }

  /** An integer expression whose magnitude stays below `max`. */
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
        // README: "`??`" on a `Float`; an integer fallback is refused today (`??` between different types).
        [opts.length ? 0.1 : 0, () => node("float", [this.varRef(r.pick(opts)), numLit(0, "float")], ([a, b]) => `${a} ?? ${b}`)],
        [vs.length ? 0 : 2, () => node("float", [this.int(0), this.int(0)], ([a, b]) => `${a} / ${b}`)],
      ])();
    };
    if (d <= 0 || r.chance(0.3)) return leaf();
    const options: [number, () => Expr][] = [
      [4, () => { const op = r.pick(["+", "-", "*"]); const [a, b] = r.chance(0.5) ? [this.float(d - 1), this.num(d - 1)] : [this.num(d - 1), this.float(d - 1)]; return node("float", [a, b], ([x, y]) => `${x} ${op} ${y}`); }],
      [3, () => node("float", [this.num(d - 1), this.num(d - 1)], ([x, y]) => `${x} / ${y}`)],
      [1, () => node("float", [this.float(d - 1), this.num(d - 1)], ([x, y]) => `${x} % ${y}`)],
      // An integer divided by a value that may be zero is NaN: a fraction to ferrovue.
      [this.vars("int").length ? 1 : 0, () => node("float", [this.int(d - 1), this.varRef(r.pick(this.vars("int")))], ([x, y]) => `${x} % ${y}`)],
      [1, () => node("float", [this.float(d - 1)], ([x]) => `-${x}`)],
      [2, () => { const f = r.pick(["round", "floor", "ceil", "trunc", "abs"]); return node("float", [this.float(d - 1)], ([x]) => `Math.${f}(${x})`, 0, true); }],
      [1, () => { const f = r.pick(["max", "min"]); return node("float", [this.float(d - 1), this.num(d - 1)], ([x, y]) => `Math.${f}(${x}, ${y})`, 0, true); }],
      [1, () => node("float", [this.test(d - 1), this.float(d - 1), this.float(d - 1)], ([c, x, y]) => `${c} ? ${x} : ${y}`)],
    ];
    return r.weighted(options)();
  }

  /** A number of either kind. */
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
      [3, () => { const op = r.pick(["===", "!=="]); return node("bool", [this.str(d - 1), r.chance(0.6) ? strLit(r.pick(STR_LITS)) : this.str(d - 1)], ([a, b]) => `${a} ${op} ${b}`); }],
      [1, () => { const op = r.pick(["===", "!=="]); return node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} ${op} ${b}`); }],
      [2, () => node("bool", [this.bool(d - 1)], ([a]) => `!${a}`)],
      [2, () => node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} && ${b}`)],
      [2, () => node("bool", [this.bool(d - 1), this.bool(d - 1)], ([a, b]) => `${a} || ${b}`)],
      [2, () => { const m = r.pick(["includes", "startsWith", "endsWith"]); const lit = r.pick(STR_LITS); return node("bool", [this.str(d - 1)], ([a]) => `${recv(a)}.${m}('${lit}')`, 0, true); }],
      [strLists.length ? 1 : 0, () => atom("bool", `${r.pick(strLists).name}.includes('${r.pick(STR_LITS)}')`)],
    ];
    return r.weighted(options)();
  }

  /** A test outside `v-if` (`?:`, a class object): a boolean, or one value by its truthiness. */
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

  /** A `v-if` test: `!`, `&&` and `||` combine the truthiness of values of any type. */
  cond(d: number): Expr {
    const r = this.r;
    const optVars = this.scope.vars.filter((v) => v.opt);
    if (optVars.length && r.chance(0.1)) {
      // Presence, which ferrovue tests in a `v-if` only.
      const v = r.pick(optVars);
      const op = r.pick(["===", "!=="]);
      return node("bool", [this.varRef(v)], ([a]) => `${a} ${op} undefined`);
    }
    if (d <= 0 || r.chance(0.6)) return this.test(d);
    return r.weighted<() => Expr>([
      [2, () => node("bool", [this.cond(d - 1)], ([a]) => `!${a}`)],
      [2, () => { const a = this.cond(d - 1), b = this.cond(d - 1); return { ...node(a.ty === b.ty ? a.ty : "bool", [a, b], ([x, y]) => `${x} && ${y}`), and: true }; }],
      [2, () => { const a = this.cond(d - 1), b = this.cond(d - 1); return node(a.ty === b.ty ? a.ty : "bool", [a, b], ([x, y]) => `${x} || ${y}`); }],
    ])();
  }

  /** Something to interpolate. */
  text(d: number): Expr {
    const r = this.r;
    const opts = this.scope.vars.filter((v) => v.opt);
    return r.weighted<() => Expr>([
      [5, () => this.str(d)],
      [3, () => this.int(d)],
      [3, () => this.float(d)],
      [2, () => this.bool(d)],
      [opts.length ? 2 : 0, () => this.varRef(r.pick(opts))],
      // An integer literal beyond i64, or written with an exponent, as JavaScript allows.
      [0.1, () => atom("int", r.pick(["1e21", "1e20", "2e3", "9007199254740993"]), LIMIT)],
    ])();
  }

  // ── Attributes ──

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
          // Literal names are distinct (TypeScript refuses a repeated one); computed ones may meet.
          const seen = new Set<string>();
          const entries: { key: string | Expr; cond: Expr }[] = [];
          for (let n = r.int(1, 3); n > 0; n--) {
            const key = r.chance(0.25) ? this.str(1) : name().replace(/^([\w]+)-([\w]+)$/, "'$1-$2'");
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
        [1, () => add({ k: "static", name: r.pick(["disabled", "hidden"]), value: null }, "boolean")],
        [5, () => { const name = r.pick(["title", "data-x", "aria-label", "id", "data-n", "tabindex", "lang", "alt", "placeholder"]); add({ k: "bind", name, e: this.text(2) }, name); }],
        [2, () => { const name = r.pick(["disabled", "hidden", "readonly", "checked"]); add({ k: "bind", name, e: r.chance(0.8) ? this.bool(2) : this.test(1) }, name); }],
        [3, () => add({ k: "class", v: this.classBind() }, ":class")],
        [2, () => add({ k: "style", entries: this.style() }, ":style")],
      ])();
    }
    if (tag === "input" && r.chance(0.5)) add({ k: "bind", name: "value", e: this.text(1) }, "value");
    // A static and a bound attribute of the same name: the static one first, as authors write it.
    return out.sort((a, b) => (a.k === "static" ? 0 : 1) - (b.k === "static" ? 0 : 1));
  }

  // ── Nodes ──

  /** Children for an element that holds flow (`block`) or phrasing (`inline`) content. */
  kids(depth: number, ctx: "block" | "inline" | "list"): Node[] {
    const r = this.r;
    const out: Node[] = [];
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
          ? r.weighted([[5, r.pick(["span", "b", "i", "em", "strong", "a", "small", "code", "label"])], [1, r.pick(["br", "img", "input"])]])
          : r.weighted([[4, r.pick(["div", "section", "article", "header", "footer"])], [2, "p"], [2, r.pick(["ul", "ol"])], [3, r.pick(["span", "b", "em"])], [1, r.pick(["br", "hr", "img", "input"])]]);
    const isVoid = ["br", "hr", "img", "input"].includes(tag);
    const attrs = this.attrs(tag);
    if (isVoid) return { k: "el", tag, attrs, kids: [], void: true };
    const inner = tag === "ul" || tag === "ol" ? "list" : ["div", "section", "article", "header", "footer", "li", "template"].includes(tag) ? (ctx === "inline" ? "inline" : "block") : "inline";
    return { k: "el", tag, attrs, kids: this.kids(depth + 1, inner) };
  }

  /** An element, or `<template>`, to carry a directive. */
  carrier(depth: number, ctx: "block" | "inline" | "list"): Node & { k: "el" } {
    if (ctx !== "list" && this.r.chance(0.2)) {
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
    ])();
  }

  ifNode(depth: number, ctx: "block" | "inline" | "list"): Node {
    const r = this.r;
    const branches: { cond: Expr | null; node: Node & { k: "el" } }[] = [];
    const n = r.weighted([[4, 1], [3, 2], [1, 3]]);
    for (let i = 0; i < n; i++) {
      const narrowable = this.scope.vars.filter((v) => v.opt);
      if (narrowable.length && r.chance(0.3)) {
        // A test that narrows: inside the branch the value is no longer optional.
        const v = r.pick(narrowable);
        // README: narrowed "as TypeScript narrows them"; ferrovue narrows a truthiness test (and
        // `a && b`), and today refuses reading a value narrowed by `!== undefined`: kept rare.
        const cond: Expr = { ...(r.chance(0.95) ? this.varRef(v) : node("bool", [this.varRef(v)], ([a]) => `${a} !== undefined`)), fixed: true };
        const el = this.withScope(() => {
          this.scope.vars = this.scope.vars.map((x) => (x === v ? { ...x, opt: false } : x));
          return this.carrier(depth, ctx);
        });
        branches.push({ cond, node: el });
      } else {
        // `a && b` narrows each optional operand inside the branch, in TypeScript and in ferrovue.
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
        const source = r.weighted<() => [string, Spec]>([
          [this.scope.lists.length ? 6 : 0, () => { const l = r.pick(this.scope.lists); return [l.name, l.of]; }],
          [1, () => [String(r.int(0, 4)), { k: "count" }]],
          [counts.length ? 2 : 0, () => [r.pick(counts).name, { k: "count" }]],
          [1, () => [`[${Array.from({ length: r.int(1, 3) }, () => printExpr(strLit(r.pick(STR_LITS)))).join(", ")}]`, { k: "str" }]],
        ])();
        const [src, of] = source;
        let head: string;
        if (of.k === "obj" && d === 0 && r.chance(0.3) && this.ifaces.get(of.iface)!.fields.some((f) => !this.scope.vars.some((v) => v.name === f.name))) {
          // Destructured: the fields become names of their own.
          const fields = this.ifaces.get(of.iface)!.fields.filter((f) => !this.scope.vars.some((v) => v.name === f.name));
          const take = fields.filter(() => r.chance(0.6));
          if (!take.length && fields.length) take.push(fields[0]!);
          for (const f of take) this.bind(f.name, f.spec);
          head = `({ ${take.map((f) => f.name).join(", ")} }${withIndex ? `, ${index}` : ""}) in ${src}`;
        } else {
          this.bind(item, of.k === "count" ? { k: "int", wide: false } : of);
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

// ── Components ──────────────────────────────────────────────────────────────────────────────────

function randomSpec(r: Rng, ifaces: Iface[], depth: number): Spec {
  return r.weighted<() => Spec>([
    [5, () => ({ k: "str" })],
    [3, () => ({ k: "int", wide: r.chance(0.3) })],
    [3, () => ({ k: "float" })],
    [3, () => ({ k: "bool" })],
    [depth === 0 ? 4 : 1, () => ({ k: "opt", of: r.pick<Spec>([{ k: "str" }, { k: "int", wide: false }, { k: "float" }, { k: "bool" }]) })],
    [depth === 0 ? 2 : 1, () => ({ k: "list", of: r.pick<Spec>([{ k: "str" }, { k: "str" }, { k: "int", wide: false }]) })],
    [depth === 0 && ifaces.length ? 2 : 0, () => ({ k: "list", of: { k: "obj", iface: r.pick(ifaces).name } })],
  ])();
}

/** The component and fixtures for case `index` of a run seeded `seed`. */
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
  const prefix = (s: Spec): string => (s.k === "opt" ? "o" + prefix(s.of) : s.k === "list" ? "l" : { str: "s", int: "n", count: "c", float: "f", bool: "b", obj: "r" }[s.k]);
  for (let i = r.int(1, 7); i > 0; i--) {
    const spec = randomSpec(r, ifaces, 0);
    props.push({ name: `${prefix(spec)}${props.length}`, spec });
  }
  if (r.chance(0.3)) props.push({ name: `c${props.length}`, spec: { k: "count" } });

  const g = new Gen(r, new Map(ifaces.map((i) => [i.name, i])));
  for (const p of props) g.bind(p.name, p.spec, true);
  const template: Node[] = [];
  for (let n = r.weighted([[6, 1], [1, 2], [1, 3]]); n > 0; n--) template.push(g.node(0, "block"));

  const component = prune({ name, ifaces, props, template });
  const fx: Record<string, unknown>[] = [];
  for (let i = 0; i < fixtures; i++) fx.push(randomFixture(r, component, i === 0));
  return { component, fixtures: fx };
}

// ── Shrinking ───────────────────────────────────────────────────────────────────────────────────

/** A deep copy that keeps functions (an expression's printer) by reference. */
export function clone<T>(x: T): T {
  if (Array.isArray(x)) return x.map(clone) as T;
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = clone(v);
    return o as T;
  }
  return x;
}

/** The component without the props and interfaces its template no longer reads. */
export function prune(c: Component): Component {
  const text = c.template.map((n) => printNode(n, "")).join("\n");
  const used = (name: string): boolean => new RegExp(`(?<![\\w.$'])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(text);
  const props = c.props.filter((p) => used(p.name));
  const live = new Set<string>();
  const visit = (s: Spec): void => {
    if (s.k === "opt" || s.k === "list") visit(s.of);
    else if (s.k === "obj" && !live.has(s.iface)) {
      live.add(s.iface);
      c.ifaces.find((i) => i.name === s.iface)!.fields.forEach((f) => visit(f.spec));
    }
  };
  props.forEach((p) => visit(p.spec));
  return { ...c, props, ifaces: c.ifaces.filter((i) => live.has(i.name)) };
}

/** Every expression slot in a node tree, as getter/setter pairs. */
function* exprSlots(nodes: Node[]): Generator<{ get: () => Expr; set: (e: Expr) => void }> {
  for (const n of nodes) {
    if (n.k === "interp") yield { get: () => n.e, set: (e) => (n.e = e) };
    else if (n.k === "if") {
      for (const b of n.branches) {
        if (b.cond && !b.cond.fixed) yield { get: () => b.cond!, set: (e) => (b.cond = e) };
        yield* exprSlots([b.node]);
      }
    } else if (n.k === "for") yield* exprSlots([n.node]);
    else if (n.k === "el") {
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

/** Every way to make an expression smaller: a sub-expression of the same type in its place, or a
 * sub-expression's own shrinks. */
const LITERALS: Record<Ty, Expr> = { str: strLit("a"), int: numLit(1, "int"), float: numLit(0.5, "float"), bool: atom("bool", "true") };

function* exprShrinks(e: Expr): Generator<Expr> {
  for (const k of e.kids) if (k.ty === e.ty && !k.fixed) yield k;
  if (!e.fixed && (e.kids.length || e.ref)) yield LITERALS[e.ty];
  for (let i = 0; i < e.kids.length; i++) {
    for (const s of exprShrinks(e.kids[i]!)) {
      // Keep the type of the operand: a test may take any type, an operand its own.
      if (s.ty !== e.kids[i]!.ty) continue;
      const kids = [...e.kids];
      kids[i] = s;
      yield { ...e, kids };
    }
  }
}

/** The edits the shrinker tries, largest first, each applied to a fresh copy of `c`. */
export function componentShrinks(c: Component): Component[] {
  const out: Component[] = [];
  const edit = (f: (copy: Component) => boolean): void => {
    const copy = clone(c);
    if (f(copy)) out.push(prune(copy));
  };
  // Lists of sibling nodes, found in the same order on a copy.
  const lists = (comp: Component): Node[][] => {
    const acc: Node[][] = [comp.template];
    const walk = (ns: Node[]): void => {
      for (const n of ns) {
        if (n.k === "el") {
          acc.push(n.kids);
          walk(n.kids);
        } else if (n.k === "if") n.branches.forEach((b) => walk([b.node]));
        else if (n.k === "for") walk([n.node]);
      }
    };
    walk(comp.template);
    return acc;
  };
  const ls = lists(c);
  // Remove one node.
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
  // Put a plain element's children (or a directive's element) in its place.
  ls.forEach((l, li) =>
    l.forEach((n, ni) => {
      if (n.k === "el" && !n.void) edit((x) => (lists(x)[li]!.splice(ni, 1, ...(lists(x)[li]![ni] as Node & { k: "el" }).kids), true));
      if (n.k === "for") edit((x) => (lists(x)[li]!.splice(ni, 1, (lists(x)[li]![ni] as Node & { k: "for" }).node), true));
      if (n.k === "if") {
        // One branch's element in place of the whole chain, its test dropped.
        n.branches.forEach((_, bi) => edit((x) => (lists(x)[li]!.splice(ni, 1, (lists(x)[li]![ni] as Node & { k: "if" }).branches[bi]!.node), true)));
        n.branches.forEach((_, bi) => {
          edit((x) => {
            const list = lists(x)[li]!;
            const m = list[ni] as Node & { k: "if" };
            if (m.branches.length < 2) return false;
            m.branches.splice(bi, 1);
            // A `v-else` left alone is shown always.
            if (m.branches[0]!.cond === null) list.splice(ni, 1, m.branches[0]!.node);
            return true;
          });
        });
      }
    }),
  );
  // Remove one attribute, or one entry of a class or style.
  const elements = (comp: Component): (Node & { k: "el" })[] => {
    const acc: (Node & { k: "el" })[] = [];
    const walk = (ns: Node[]): void => {
      for (const n of ns) {
        if (n.k === "el") {
          acc.push(n);
          walk(n.kids);
        } else if (n.k === "if") walk(n.branches.map((b) => b.node));
        else if (n.k === "for") walk([n.node]);
      }
    };
    walk(comp.template);
    return acc;
  };
  elements(c).forEach((el, ei) => {
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
  // Make one expression smaller.
  const slots = [...exprSlots(c.template)];
  slots.forEach((s, si) => {
    let i = 0;
    for (const _ of exprShrinks(s.get())) {
      const which = i++;
      edit((x) => {
        const slot = [...exprSlots(x.template)][si]!;
        const replacement = [...exprShrinks(slot.get())][which]!;
        slot.set(replacement);
        return true;
      });
    }
  });
  return out;
}

/** The ways to make a fixture value smaller. */
function* valueShrinks(v: unknown): Generator<unknown> {
  if (typeof v === "string") {
    if (v === "") return;
    yield "";
    const cps = [...v];
    if (cps.length > 1) {
      yield cps.slice(0, Math.ceil(cps.length / 2)).join("");
      yield cps.slice(Math.ceil(cps.length / 2)).join("");
      if (cps.length <= 12) for (let i = 0; i < cps.length; i++) yield [...cps.slice(0, i), ...cps.slice(i + 1)].join("");
    }
    if (/[^a]/.test(v) && /^[\x20-\x7e]*$/.test(v) === false) yield v.replace(/[\x20-\x7e]/g, "");
  } else if (typeof v === "number") {
    if (v !== 0 && !Object.is(v, -0)) yield 0;
    if (Number.isInteger(v) && Math.abs(v) > 1) yield Math.trunc(v / 2);
    if (!Number.isInteger(v)) yield Math.trunc(v);
  } else if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield [...v.slice(0, i), ...v.slice(i + 1)];
    for (let i = 0; i < v.length; i++) for (const s of valueShrinks(v[i])) yield v.map((x, j) => (j === i ? s : x));
  } else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) for (const s of valueShrinks(o[k])) yield { ...o, [k]: s };
  }
}

/** Smaller fixtures for `c`: an optional prop left out, or one value made smaller. */
export function fixtureShrinks(c: Component, fixture: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const ifaces = new Map(c.ifaces.map((i) => [i.name, i]));
  const optionalFields = (s: Spec): Set<string> =>
    s.k === "list" && s.of.k === "obj" ? new Set(ifaces.get(s.of.iface)!.fields.filter((f) => f.spec.k === "opt").map((f) => f.name)) : new Set();
  for (const p of c.props) {
    if (!(p.name in fixture)) continue;
    if (p.spec.k === "opt") {
      const { [p.name]: _, ...rest } = fixture;
      out.push(rest);
    }
    const opt = optionalFields(p.spec);
    if (opt.size) {
      const list = fixture[p.name] as Record<string, unknown>[];
      list.forEach((item, i) => {
        for (const k of Object.keys(item)) {
          if (!opt.has(k)) continue;
          const { [k]: _, ...rest } = item;
          out.push({ ...fixture, [p.name]: list.map((x, j) => (j === i ? rest : x)) });
        }
      });
    }
    for (const s of valueShrinks(fixture[p.name])) {
      // A required integer stays an integer; a value keeps its type.
      if (typeof s === "number" && (p.spec.k === "int" || p.spec.k === "count" || (p.spec.k === "opt" && p.spec.of.k === "int")) && !Number.isInteger(s)) continue;
      out.push({ ...fixture, [p.name]: s });
    }
  }
  // Only the props the component still declares.
  const keep = (f: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(f).filter(([k]) => c.props.some((p) => p.name === k)));
  return out.map(keep);
}

export function caseSize(c: Component, fixture: Record<string, unknown>): number {
  return printComponent(c).length + fixtureJson(fixture).length;
}
