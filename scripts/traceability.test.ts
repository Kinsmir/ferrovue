import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const CONFORMANCE = join(ROOT, "crates/ferrovue/tests/conformance");
const README_SECTION = "## What a component may use";
const TESTING_SECTION = "### The README's rows and the components that exercise them";

function cells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

function tableAfter(text: string, heading: string): string[][] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) throw new Error(`no "${heading}" heading`);
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^#{1,3} /.test(l));
  const section = end < 0 ? rest : rest.slice(0, end);
  const start = section.findIndex((l) => l.startsWith("|"));
  if (start < 0) throw new Error(`no table under "${heading}"`);
  const stop = section.findIndex((l, i) => i > start && !l.startsWith("|"));
  return section
    .slice(start, stop < 0 ? undefined : stop)
    .slice(2)
    .map(cells);
}

function readmeRows(readme: string): string[] {
  return tableAfter(readme, README_SECTION).map((c) => c[0]!);
}

function traced(testing: string): [string, string[]][] {
  return tableAfter(testing, TESTING_SECTION).map((c) => [c[0]!, [...(c[1] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]!)]);
}

function traceProblems(rows: string[], table: [string, string[]][], components: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const named = new Map<string, number>();
  for (const [row, names] of table) {
    named.set(row, (named.get(row) ?? 0) + 1);
    if (!rows.includes(row)) problems.push(`TESTING.md traces "${row}", which is not a row of the README`);
    if (!names.length) problems.push(`TESTING.md traces "${row}" to no component`);
    for (const name of names) {
      if (!components.has(name)) problems.push(`TESTING.md traces "${row}" to ${name}, which is not a conformance component with fixtures`);
    }
  }
  for (const row of rows) {
    if (!named.has(row)) problems.push(`the README's row "${row}" is not traced in TESTING.md`);
    else if (named.get(row)! > 1) problems.push(`TESTING.md traces "${row}" more than once`);
  }
  return problems;
}

function componentsWithFixtures(): Set<string> {
  return new Set(
    readdirSync(join(CONFORMANCE, "components"))
      .filter((f) => f.endsWith(".vue"))
      .map((f) => f.slice(0, -".vue".length))
      .filter((name) => {
        const dir = join(CONFORMANCE, "fixtures", name);
        return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".json"));
      }),
  );
}

describe("traceability of the README to the conformance suite", () => {
  it("traces every row of the README's table to conformance components that exist", () => {
    const rows = readmeRows(readFileSync(join(ROOT, "README.md"), "utf8"));
    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(traceProblems(rows, traced(readFileSync(join(ROOT, "TESTING.md"), "utf8")), componentsWithFixtures())).toEqual([]);
  });

  it("reads a row's first cell whole, escaped pipes and code included", () => {
    const readme = `# x\n\n${README_SECTION}\n\nText.\n\n| Area | Supported |\n|---|---|\n| \`class\` | a \\| b |\n| Prop types | \`"sm" \\| "md"\` |\n\nAfter.\n\n## Next\n\n| Other | x |\n|---|---|\n| no | x |\n`;
    expect(readmeRows(readme)).toEqual(["`class`", "Prop types"]);
  });

  it("names a missing row, a row the README lacks, a component that is not there, an empty row and a row given twice", () => {
    const testing = `${TESTING_SECTION}\n\n| README row | Components |\n|---|---|\n| Text | \`Text\`, \`Gone\` |\n| Old | \`Text\` |\n| Lists | none |\n| Lists | \`Lists\` |\n`;
    expect(traceProblems(["Text", "Lists", "Slots"], traced(testing), new Set(["Text", "Lists"]))).toEqual([
      'TESTING.md traces "Text" to Gone, which is not a conformance component with fixtures',
      'TESTING.md traces "Old", which is not a row of the README',
      'TESTING.md traces "Lists" to no component',
      'TESTING.md traces "Lists" more than once',
      `the README's row "Slots" is not traced in TESTING.md`,
    ]);
  });
});
