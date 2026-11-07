import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generate } from "../packages/ferrovue/src/compiler.ts";
import { generatedSize, SIZE_BUDGET, writeProject } from "./build-budget.ts";

let dir = "";

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("the synthetic project", () => {
  it("compiles with ferrovue, every shape of component included", () => {
    dir = mkdtempSync(join(tmpdir(), "ferrovue-budget-"));
    writeProject(dir, 10);
    const files = generate(dir);
    expect([...files.keys()].toSorted()).toEqual([...Array.from({ length: 10 }, (_, i) => `comp00${i}.rs`), "mod.rs"]);
    expect(files.get("comp008.rs")).toContain("super::comp005::try_render");
  });
});

describe("the size of the generated Rust", () => {
  it("counts the lines and bytes of the `.rs` files alone", () => {
    dir = mkdtempSync(join(tmpdir(), "ferrovue-budget-"));
    writeFileSync(join(dir, "a.rs"), "fn a() {}\n// é\n");
    writeFileSync(join(dir, "mod.rs"), "pub mod a;\n");
    writeFileSync(join(dir, "notes.txt"), "not rust\n");
    expect(generatedSize(dir)).toEqual({ lines: 3, bytes: 27 });
  });

  it("holds the synthetic project's modules within the budget, in proportion to its 500 components", () => {
    dir = mkdtempSync(join(tmpdir(), "ferrovue-budget-"));
    writeProject(dir, 50);
    const bytes = [...generate(dir).values()].reduce((n, text) => n + Buffer.byteLength(text), 0);
    expect(bytes * 10).toBeLessThan(SIZE_BUDGET);
  });
});
