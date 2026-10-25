import { expect, it } from "vitest";
import { invocation, modules } from "./stryker-run.ts";
import { compare, entry, listed, type Mutant, original, restricted } from "./stryker-survivors.ts";

const at = (line: number, column: number, endLine: number, endColumn: number): Mutant["location"] => ({ start: { line, column }, end: { line: endLine, column: endColumn } });
const mutant = (status: string, location: Mutant["location"], mutatorName = "EqualityOperator", replacement = "a <= b"): Mutant => ({ mutatorName, replacement, status, location });

it("reads the source text a mutant replaces, on one line and across lines", () => {
  expect(original("let x = a < b;\n", at(1, 9, 1, 14))).toBe("a < b");
  expect(original("f() {\n  one();\n  two();\n}\n", at(1, 5, 4, 2))).toBe("{\n  one();\n  two();\n}");
});

it("names a mutant by its text and the line it starts on, on one line and shortened when long", () => {
  expect(entry("src/a.ts", "\n\n  let x = a < b;", mutant("Survived", at(3, 11, 3, 16)))).toBe("src/a.ts: EqualityOperator: a < b => a <= b in let x = a < b;");
  const long = `{ ${"x(); ".repeat(40)}}`;
  const named = entry("src/a.ts", long, mutant("Survived", at(1, 1, 1, long.length + 1), "BlockStatement", "{}"));
  expect(named).toMatch(/^src\/a\.ts: BlockStatement: \{ x\(\); .* … .* x\(\); \} => \{\} in \{ x\(\); .* … .* x\(\); \}$/);
  expect(named.length).toBeLessThan(300);
});

it("reads the entries of a list, skipping its comments and blank lines", () => {
  expect(listed("# why\nsrc/a.ts: X: a => b\n\n# why not\nsrc/a.ts: X: a => b\n")).toEqual(["src/a.ts: X: a => b", "src/a.ts: X: a => b"]);
});

it("explains each survivor by one entry, and finds the entries no survivor uses", () => {
  const source = "a < b;\na < b;\nc < d;\n";
  const report = {
    files: {
      "src/a.ts": { source, mutants: [mutant("Survived", at(1, 1, 1, 6)), mutant("NoCoverage", at(2, 1, 2, 6)), mutant("Killed", at(3, 1, 3, 6)), mutant("Killed", at(3, 1, 3, 6))] },
    },
  };
  const one = "src/a.ts: EqualityOperator: a < b => a <= b in a < b;";
  const other = "src/a.ts: EqualityOperator: c < d => a <= b in c < d;";
  expect(compare(report, [one, one])).toEqual({ unexplained: [], stale: [] });
  expect(compare(report, [one])).toEqual({ unexplained: ["src/a.ts:2:1: NoCoverage: EqualityOperator: a < b => a <= b in a < b;"], stale: [] });
  expect(compare(report, [one, one, other, "src/b.ts: X: y => z in y"])).toEqual({ unexplained: [], stale: [other] });
});

it("counts a listed mutant that timed out as using its entry, and never as a survivor", () => {
  const source = "a < b;\n";
  const report = { files: { "src/a.ts": { source, mutants: [mutant("Timeout", at(1, 1, 1, 6))] } } };
  const one = "src/a.ts: EqualityOperator: a < b => a <= b in a < b;";
  expect(compare(report, [one])).toEqual({ unexplained: [], stale: [] });
  expect(compare(report, [])).toEqual({ unexplained: [], stale: [] });
});

it("holds only the modules a run mutated to the list, and every module when none is named", () => {
  const report = { files: { "src/a.ts": { source: "", mutants: [] }, "src/b.ts": { source: "", mutants: [] } } };
  expect(Object.keys(restricted(report, ["src/b.ts"]).files)).toEqual(["src/b.ts"]);
  expect(restricted(report, [])).toBe(report);
});

it("names the modules to mutate by path, by file name and without `.ts`", () => {
  const mutate = ["src/attrs.ts", "src/expr.ts"];
  expect(modules(mutate, [])).toEqual(mutate);
  expect(modules(mutate, ["expr", "src/attrs.ts"])).toEqual(["src/expr.ts", "src/attrs.ts"]);
  expect(modules(mutate, ["attrs.ts"])).toEqual(["src/attrs.ts"]);
  expect(() => modules(mutate, ["dynamic"])).toThrow("`dynamic` is not among the modules stryker.config.json mutates: name one of attrs, expr");
});

it("passes the options written `--name=value` on to Stryker, and reads the rest as modules", () => {
  const mutate = ["src/attrs.ts", "src/expr.ts"];
  expect(invocation(mutate, ["expr", "--reporters=json,dashboard", "--dashboard.module=expr"])).toEqual({ files: ["src/expr.ts"], options: ["--reporters=json,dashboard", "--dashboard.module=expr"] });
  expect(invocation(mutate, ["--reporters=json"])).toEqual({ files: mutate, options: ["--reporters=json"] });
  expect(invocation(mutate, [])).toEqual({ files: mutate, options: [] });
});
