/* The string routines the Rust crates reimplement, held to JavaScript's own: each vector file in
 * `crates/ferrovue/tests/vectors/` and `crates/ferrovue-core/tests/vectors/` (escaping and numbers)
 * is read by that crate's unit tests too, so both sides agree with the same answers. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml, normalizeClass } from "@vue/shared";
import { describe, expect, it } from "vitest";
import { mergeProps } from "vue";
import { ssrRenderAttrs, ssrRenderSlotInner } from "vue/server-renderer";
import { useHead, useSeoMeta } from "@unhead/vue";
import { createHead } from "@unhead/vue/server";
import { isComment } from "../src/template.ts";
import { seoMetaKey } from "../src/plugins/head.ts";
import { type Call, headCases } from "./head-inputs.ts";

const DIR = join(import.meta.dirname, "../../../crates/ferrovue/tests/vectors");
const CORE = join(import.meta.dirname, "../../../crates/ferrovue-core/tests/vectors");
const read = (name: string, dir = DIR): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

/** A vector file written one vector per line: thousands of them stay readable in a diff. */
function writeVectors(name: string, vectors: unknown[]): void {
  writeFileSync(join(DIR, name), `[\n${vectors.map((v) => JSON.stringify(v)).join(",\n")}\n]\n`);
}

/** One string method applied as `strings.json` describes it, its result as a server sends it. */
function stringOp(op: string, input: string, args: string[]): unknown {
  const num = (i: number): number | undefined => (args[i] === undefined ? undefined : Number(args[i]));
  const sent = (x: unknown): unknown =>
    typeof x === "string" ? (x.length > 1_000_000 ? { length: x.length } : x.toWellFormed()) : Array.isArray(x) ? x.map(sent) : x === undefined ? null : x;
  try {
    switch (op) {
      case "slice":
        return sent(input.slice(num(0), num(1)));
      case "substring":
        return sent(input.substring(num(0)!, num(1)));
      case "at":
        return sent(input.at(num(0)!));
      case "charAt":
        return sent(input.charAt(num(0)!));
      case "indexOf":
        return input.indexOf(args[0]!);
      case "lastIndexOf":
        return input.lastIndexOf(args[0]!);
      case "split":
        return sent(input.split(args[0]!));
      case "replace":
        return sent(input.replace(args[0]!, args[1]!));
      case "replaceAll":
        return sent(input.replaceAll(args[0]!, args[1]!));
      case "padStart":
        return sent(input.padStart(num(0)!, args[1]));
      case "padEnd":
        return sent(input.padEnd(num(0)!, args[1]));
      case "repeat":
        return sent(input.repeat(num(0)!));
      default:
        throw new Error(op);
    }
  } catch (e) {
    if (e instanceof RangeError) return { throws: "RangeError" };
    throw e;
  }
}

describe("vectors shared with the Rust crate", () => {
  it("holds every vector it was written with", () => {
    const floors: [string, number, string?][] = [
      ["trim.json", 10],
      ["length.json", 12],
      ["comment.json", 28],
      ["class.json", 14],
      ["attrs.json", 61],
      ["strings.json", 4655],
      ["compare.json", 400],
      ["parse.json", 498],
      ["keys.json", 8],
      ["json.json", 12],
      ["head.json", 458],
      ["escape.json", 10, CORE],
      ["numbers.json", 370, CORE],
      ["math.json", 715, CORE],
    ];
    expect(floors.map(([name, least, dir]) => [name, Math.min((read(name, dir) as unknown[]).length, least)])).toEqual(floors.map(([name, least]) => [name, least]));
  });

  it("trim.json is String.prototype.trim", () => {
    for (const [input, want] of (read("trim.json") as [string, string][])) expect(input.trim(), JSON.stringify(input)).toBe(want);
  });

  // `[chunk, expected]`: whether `ssrRenderSlot` reads slot content that pushed `chunk` alone as
  // nothing and shows the fallback, recorded from Vue with `FERROVUE_VECTORS_WRITE=1`. The compiler's
  // own `isComment`, which decides what it can at compile time, is held to the same answers.
  it("comment.json is ssrRenderSlot's isComment", () => {
    const vectors = (read("comment.json") as [string, boolean][]);
    const recorded = vectors.map(([chunk]) => {
      let fallback = false;
      const out: unknown[] = [];
      const slots = { default: (_: unknown, push: (s: string) => void) => push(chunk) };
      ssrRenderSlotInner(slots, "default", {}, () => (fallback = true), (s: unknown) => out.push(s), null as never);
      return [chunk, fallback];
    });
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeVectors("comment.json", recorded);
      return;
    }
    expect(vectors).toEqual(recorded);
    for (const [chunk, want] of vectors) expect(isComment(chunk), JSON.stringify(chunk)).toBe(want);
  });

  it("escape.json is Vue's escapeHtml", () => {
    for (const [input, want] of (read("escape.json", CORE) as [string, string][])) expect(escapeHtml(input), JSON.stringify(input)).toBe(want);
  });

  // Recorded from JavaScript with `FERROVUE_VECTORS_WRITE=1`: the inputs are decimal strings, which
  // both sides parse to the same double, and the expected text is `String(Number(input))`.
  it("numbers.json is Number.prototype.toString", () => {
    const vectors = (read("numbers.json", CORE) as [string, string][]);
    const recorded = vectors.map(([input]) => [input, String(Number(input))]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeFileSync(join(CORE, "numbers.json"), JSON.stringify(recorded, null, 1) + "\n");
      return;
    }
    expect(vectors).toEqual(recorded);
  });

  // `[op, x, arg, expected]`, the expected text recorded from JavaScript with `FERROVUE_VECTORS_WRITE=1`.
  // A number is written as `String` writes it, but `-0` as "-0": `String` hides the sign, which
  // `1 / x` shows.
  it("math.json is Math.round, Math.max, Math.min and toFixed", () => {
    const vectors = (read("math.json", CORE) as [string, string, string, string][]);
    const text = (n: number): string => (Object.is(n, -0) ? "-0" : String(n));
    const run = (op: string, x: string, arg: string): string => {
      switch (op) {
        case "round":
          return text(Math.round(Number(x)));
        case "toFixed":
          return Number(x).toFixed(Number(arg));
        case "max":
          return text(Math.max(Number(x), Number(arg)));
        case "min":
          return text(Math.min(Number(x), Number(arg)));
        default:
          throw new Error(op);
      }
    };
    const recorded = vectors.map(([op, x, arg]) => [op, x, arg, run(op, x, arg)]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeFileSync(join(CORE, "math.json"), JSON.stringify(recorded, null, 1) + "\n");
      return;
    }
    expect(vectors).toEqual(recorded);
  });

  // `[entries, expected]`: a class object as `[name, condition]` pairs in source order, which
  // JavaScript makes an object of (a repeated name keeps its first place and its last condition,
  // array indices first), and Vue's `normalizeClass` of it, recorded with `FERROVUE_VECTORS_WRITE=1`.
  it("class.json is normalizeClass of an object", () => {
    const vectors = (read("class.json") as [[string, boolean][], string][]);
    const recorded = vectors.map(([entries]) => {
      const object: Record<string, boolean> = {};
      for (const [name, on] of entries) object[name] = on;
      return [entries, normalizeClass(object)];
    });
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeFileSync(join(DIR, "class.json"), JSON.stringify(recorded, null, 1) + "\n");
      return;
    }
    expect(vectors).toEqual(recorded);
  });

  // `[sources, expected]`: attribute lists as `[name, value]` pairs, merged in order by Vue's
  // `mergeProps` and written by `ssrRenderAttrs`, recorded with `FERROVUE_VECTORS_WRITE=1`. A value
  // is a string, a number or a boolean as it is, `null` for `undefined`, `{ "style": [[k, v], …] }`
  // for a style object and `{ "names": "…" }` for a class bound to an array, which equals nothing.
  it("attrs.json is ssrRenderAttrs of mergeProps", () => {
    type Value = string | number | boolean | null | { style: [string, Value][] } | { names: string };
    const vectors = read("attrs.json") as [[string, Value][][], string][];
    const js = (v: Value): unknown =>
      v === null ? undefined : typeof v !== "object" ? v : "names" in v ? [v.names] : Object.fromEntries(v.style.map(([k, x]) => [k, js(x)]));
    const recorded = vectors.map(([sources]) => [sources, ssrRenderAttrs(mergeProps(...sources.map((s) => Object.fromEntries(s.map(([k, v]) => [k, js(v)])))))]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeVectors("attrs.json", recorded);
      return;
    }
    expect(vectors).toEqual(recorded);
  });

  // `[op, input, args, expected]`: numeric arguments are decimal strings both sides read with
  // `Number`; a string result is written as a server writes it, a lone surrogate as U+FFFD
  // (`toWellFormed`) and one longer than a million code units as `{ length }`; `null` is
  // `undefined`, and `{ throws }` the error JavaScript throws.
  it("strings.json is JavaScript's string methods", () => {
    const vectors = read("strings.json") as [string, string, string[], unknown][];
    const recorded = vectors.map(([op, input, args]) => [op, input, args, stringOp(op, input, args)]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") return writeVectors("strings.json", recorded);
    expect(vectors).toEqual(recorded);
  });

  // `[a, b, expected]`: -1, 0 or 1 as JavaScript's `<` and `>` order the two strings.
  it("compare.json is JavaScript's ordering of strings", () => {
    const vectors = read("compare.json") as [string, string, number][];
    const recorded = vectors.map(([a, b]) => [a, b, a < b ? -1 : a > b ? 1 : 0]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") return writeVectors("compare.json", recorded);
    expect(vectors).toEqual(recorded);
  });

  // `[op, input, expected]`: the number written as `String` writes it, with `-0` told apart.
  it("parse.json is Number, parseInt and parseFloat of strings", () => {
    const vectors = read("parse.json") as [string, string, string][];
    const shown = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
    const run = (op: string, input: string): number => {
      switch (op) {
        case "Number":
          return Number(input);
        case "parseInt":
          return parseInt(input);
        case "parseInt10":
          return parseInt(input, 10);
        case "parseInt16":
          return parseInt(input, 16);
        case "parseInt7":
          return parseInt(input, 7);
        case "parseInt36":
          return parseInt(input, 36);
        case "parseFloat":
          return parseFloat(input);
        default:
          throw new Error(op);
      }
    };
    const recorded = vectors.map(([op, input]) => [op, input, shown(run(op, input))]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") return writeVectors("parse.json", recorded);
    expect(vectors).toEqual(recorded);
  });

  // `[json, keys]`: the order `Object.keys` gives an object `JSON.parse` read.
  it("keys.json is the order of an object's keys", () => {
    const vectors = read("keys.json") as [string, string[]][];
    const recorded = vectors.map(([json]) => [json, Object.keys(JSON.parse(json) as object)]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") return writeVectors("keys.json", recorded);
    expect(vectors).toEqual(recorded);
  });

  it("json.json is JSON.stringify of a string", () => {
    const vectors = read("json.json") as [string, string][];
    const recorded = vectors.map(([input]) => [input, JSON.stringify(input)]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") return writeVectors("json.json", recorded);
    expect(vectors).toEqual(recorded);
  });

  it("length.json is String.prototype.length", () => {
    for (const [input, want] of (read("length.json") as [string, number][])) expect(input.length, JSON.stringify(input)).toBe(want);
  });

  // `{ defaults, calls, expected }`: each call `{ head }` as `Head::push` takes it, or `{ seo }` as
  // the compiler writes `useSeoMeta` (its title and template, then each key's attribute and name),
  // and what unhead's server head renders, recorded with `FERROVUE_VECTORS_WRITE=1`.
  it("head.json is unhead's server head", () => {
    const recorded = headCases().map(({ defaults, calls }) => {
      const head = createHead(defaults ? {} : { disableDefaults: true });
      for (const call of calls) {
        if ("head" in call) useHead(call.head, { head });
        else useSeoMeta(call.seo, { head });
      }
      return { defaults, calls: calls.map(written), expected: head.render() };
    });
    if (process.env.FERROVUE_VECTORS_WRITE === "1") return writeVectors("head.json", recorded);
    expect(read("head.json")).toEqual(recorded);
  });
});

function encoded(v: unknown): unknown {
  if (v === undefined) return { $u: 1 };
  if (typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0))) return { $n: Object.is(v, -0) ? "-0" : String(v) };
  if (Array.isArray(v)) return v.map(encoded);
  if (v && typeof v === "object") return { $o: Object.keys(v).map((k) => [k, encoded((v as Record<string, unknown>)[k])]) };
  return v;
}

function written(call: Call): unknown {
  if ("head" in call) return { head: encoded(call.head) };
  const { title, titleTemplate, ...rest } = call.seo;
  const meta = Object.entries(rest).map(([key, value]) => [...seoMetaKey(key), encoded(value)]);
  return { seo: [encoded({ title, titleTemplate }), meta] };
}
