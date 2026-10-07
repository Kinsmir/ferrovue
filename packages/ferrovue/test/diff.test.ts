import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { unifiedDiff } from "../src/diff.ts";

function gnu(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ferrovue-diff-"));
  try {
    writeFileSync(join(dir, "a"), before);
    writeFileSync(join(dir, "b"), after);
    const r = spawnSync("diff", ["-u", "--label", "a/x.rs", "--label", "b/x.rs", join(dir, "a"), join(dir, "b")], { encoding: "utf8" });
    return r.stdout.replace(/\n$/, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// GNU diff, the reference, is not on the PATH of every Windows machine.
const hasDiff = spawnSync("diff", ["--version"]).status === 0;

const lines = (n: number, f: (i: number) => string = (i) => `line ${i}`): string => Array.from({ length: n }, (_, i) => f(i + 1)).join("\n") + "\n";

it.skipIf(!hasDiff).each([
  ["one line changed in the middle", lines(20), lines(20, (i) => (i === 10 ? "changed" : `line ${i}`))],
  ["a line added and one removed far apart", lines(30), lines(30, (i) => `line ${i}`).replace("line 3\n", "").replace("line 25\n", "line 25\nadded\n")],
  ["changes close enough to share a hunk", lines(12), lines(12, (i) => (i === 4 || i === 8 ? `new ${i}` : `line ${i}`))],
  ["a change on the first line", lines(5), lines(5, (i) => (i === 1 ? "first" : `line ${i}`))],
  ["lines appended at the end", lines(4), lines(6)],
])("writes %s as diff -u does", (_, before, after) => {
  expect(unifiedDiff("x.rs", before, after)).toBe(gnu(before, after));
});

it("is empty for identical texts, and diffs against nothing for a file added or removed", () => {
  expect(unifiedDiff("x.rs", lines(3), lines(3))).toBe("");
  expect(unifiedDiff("x.rs", "", "a\n")).toBe("--- /dev/null\n+++ b/x.rs\n@@ -0,0 +1,1 @@\n+a");
  expect(unifiedDiff("x.rs", "a\nb\n", "")).toBe("--- a/x.rs\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b");
});
