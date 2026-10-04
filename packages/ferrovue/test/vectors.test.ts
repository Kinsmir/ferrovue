/* The string routines the Rust crate reimplements, held to JavaScript's own: each vector file in
 * `crates/ferrovue/tests/vectors/` is read by the crate's unit tests too, so both sides agree with
 * the same answers. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml, normalizeClass } from "@vue/shared";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../../../crates/ferrovue/tests/vectors");
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), "utf8"));

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
  // A number is written as `String` writes it, but `-0` as "-0": `String` hides the sign, which
  // `1 / x` shows.
  it("math.json is Math.round, Math.max, Math.min and toFixed", () => {
    const vectors = (read("math.json") as [string, string, string, string][]);
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
      writeFileSync(join(DIR, "math.json"), JSON.stringify(recorded, null, 1) + "\n");
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

  it("length.json is String.prototype.length", () => {
    for (const [input, want] of (read("length.json") as [string, number][])) expect(input.length, JSON.stringify(input)).toBe(want);
  });
});
