import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generate } from "../packages/ferrovue/src/compiler.ts";
import { writeProject } from "./build-budget.ts";

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
    expect(files.get("comp008.rs")).toContain("super::comp005::render");
  });
});
