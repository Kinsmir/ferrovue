/* The string routines the Rust crate reimplements, held to JavaScript's own: each vector file in
 * `crates/ferrovue/tests/vectors/` is read by the crate's unit tests too, so both sides agree with
 * the same answers. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "@vue/shared";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../../../crates/ferrovue/tests/vectors");
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), "utf8"));

/** A vector file written one vector per line: thousands of them stay readable in a diff. */
function writeVectors(name: string, vectors: unknown[]): void {
  writeFileSync(join(DIR, name), `[\n${vectors.map((v) => JSON.stringify(v)).join(",\n")}\n]\n`);
}

/** One string method applied as `strings.json` describes it, its result as a server sends it. */
function stringOp(op: string, input: string, args: string[]): unknown {
  const num = (i: number): number | undefined => (args[i] === undefined ? undefined : Number(args[i]));
  const sent = (x: unknown): unknown =>
    typeof x === "string" ? x.toWellFormed() : Array.isArray(x) ? x.map(sent) : x === undefined ? null : x;
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
  it("trim.json is String.prototype.trim", () => {
    for (const [input, want] of (read("trim.json") as [string, string][])) expect(input.trim(), JSON.stringify(input)).toBe(want);
  });

  it("escape.json is Vue's escapeHtml", () => {
    for (const [input, want] of (read("escape.json") as [string, string][])) expect(escapeHtml(input), JSON.stringify(input)).toBe(want);
  });

  // Recorded from JavaScript with `FERROVUE_VECTORS_WRITE=1`: the inputs are decimal strings, which
  // both sides parse to the same double, and the expected text is `String(Number(input))`.
  it("numbers.json is Number.prototype.toString", () => {
    const vectors = (read("numbers.json") as [string, string][]);
    const recorded = vectors.map(([input]) => [input, String(Number(input))]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeFileSync(join(DIR, "numbers.json"), JSON.stringify(recorded, null, 1) + "\n");
      return;
    }
    expect(vectors).toEqual(recorded);
  });

  // `[op, x, arg, expected]`, the expected text recorded from JavaScript with `FERROVUE_VECTORS_WRITE=1`.
  it("math.json is Math.round, Math.max, Math.min and toFixed", () => {
    const vectors = (read("math.json") as [string, string, string, string][]);
    const run = (op: string, x: string, arg: string): string => {
      switch (op) {
        case "round":
          return String(Math.round(Number(x)));
        case "toFixed":
          return Number(x).toFixed(Number(arg));
        case "max":
          return String(Math.max(Number(x), Number(arg)));
        case "min":
          return String(Math.min(Number(x), Number(arg)));
        default:
          throw new Error(op);
      }
    };
    const recorded = vectors.map(([op, x, arg]) => [op, x, arg, run(op, x, arg)]);
    if (process.env.FERROVUE_VECTORS_WRITE === "1") {
      writeFileSync(join(DIR, "math.json"), JSON.stringify(recorded, null, 1) + "\n");
      return;
    }
    expect(vectors).toEqual(recorded);
  });

  // `[op, input, args, expected]`: numeric arguments are decimal strings both sides read with
  // `Number`; a string result is written as a server writes it, a lone surrogate as U+FFFD
  // (`toWellFormed`); `null` is `undefined`, and `{ throws }` the error JavaScript throws.
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
});
