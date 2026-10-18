import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Baseline, compare, gungraunVersion, parseSummaries, table } from "./instructions.ts";

const summary = (id: string, ir: number): string =>
  JSON.stringify({ id, profiles: [{ tool: "Callgrind", data: { total: { metrics: { Ir: { values: { new: ir, old: ir } } } } } }] });

describe("parseSummaries", () => {
  it("reads each benchmark's instruction count", () => {
    const counts = parseSummaries(`${summary("small", 100)}\n${summary("list", 2000)}\n`);
    expect([...counts]).toEqual([
      ["small", 100],
      ["list", 2000],
    ]);
  });

  it("refuses a benchmark with no Callgrind count", () => {
    expect(() => parseSummaries(JSON.stringify({ id: "x", profiles: [] }))).toThrow(/no instruction count for x/);
  });
});

describe("compare", () => {
  it("passes a scenario at or under its budget", () => {
    const rows = compare({ a: 1000, b: 1000 }, new Map([["a", 1050], ["b", 900]]), 5);
    expect(rows.map((r) => [r.scenario, r.change, r.over])).toEqual([
      ["a", 5, false],
      ["b", -10, false],
    ]);
  });

  it("fails a scenario over its budget", () => {
    const [row] = compare({ a: 1000 }, new Map([["a", 1051]]), 5);
    expect(row?.over).toBe(true);
  });

  it("fails a scenario missing from either side", () => {
    const rows = compare({ gone: 10 }, new Map([["new", 10]]), 5);
    expect(rows).toEqual([
      { scenario: "gone", baseline: 10, measured: null, change: null, over: true },
      { scenario: "new", baseline: null, measured: 10, change: null, over: true },
    ]);
  });

  it("writes a table naming the scenarios over budget", () => {
    const rows = compare({ a: 1000, b: 1000 }, new Map([["a", 1200], ["b", 1000]]), 5);
    expect(table(rows, 5)).toBe(
      [
        "| Scenario | Baseline | Measured | Change (budget +5%) |",
        "|---|---|---|---|",
        "| a | 1,000 | 1,200 | +20.00% (over) |",
        "| b | 1,000 | 1,000 | +0.00% |",
      ].join("\n"),
    );
  });
});

describe("the committed baseline", () => {
  const root = join(import.meta.dirname, "..");
  const baseline = JSON.parse(readFileSync(join(root, "crates/ferrovue/benches/instructions.json"), "utf8")) as Baseline;

  it("names an exact toolchain, the musl target and a 5% budget", () => {
    expect(baseline.toolchain).toMatch(/^\d+\.\d+\.\d+$/);
    expect(baseline.target).toBe("x86_64-unknown-linux-musl");
    expect(baseline.budget).toBe(5);
  });

  it("is a placeholder or has a count for every benchmark in instructions.rs", () => {
    const source = readFileSync(join(root, "crates/ferrovue/benches/instructions.rs"), "utf8");
    const ids = [...source.matchAll(/#\[bench::(\w+)\(/g)].map((m) => m[1]);
    expect(ids).toHaveLength(7);
    expect(baseline.instructions ? Object.keys(baseline.instructions) : ids).toEqual(ids);
  });

  it("finds the gungraun version in Cargo.lock", () => {
    expect(gungraunVersion(readFileSync(join(root, "Cargo.lock"), "utf8"))).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
