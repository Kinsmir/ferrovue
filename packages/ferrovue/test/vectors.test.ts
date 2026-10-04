/* The string routines the Rust crate reimplements, held to JavaScript's own: each vector file in
 * `crates/ferrovue/tests/vectors/` is read by the crate's unit tests too, so both sides agree with
 * the same answers. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml } from "@vue/shared";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../../../crates/ferrovue/tests/vectors");
const read = <T>(name: string): T => JSON.parse(readFileSync(join(DIR, name), "utf8")) as T;

describe("vectors shared with the Rust crate", () => {
  it("trim.json is String.prototype.trim", () => {
    for (const [input, want] of read<[string, string][]>("trim.json")) expect(input.trim(), JSON.stringify(input)).toBe(want);
  });

  it("escape.json is Vue's escapeHtml", () => {
    for (const [input, want] of read<[string, string][]>("escape.json")) expect(escapeHtml(input), JSON.stringify(input)).toBe(want);
  });

  it("length.json is String.prototype.length", () => {
    for (const [input, want] of read<[string, number][]>("length.json")) expect(input.length, JSON.stringify(input)).toBe(want);
  });
});
