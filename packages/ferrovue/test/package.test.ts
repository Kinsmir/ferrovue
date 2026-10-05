import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  exports: Record<string, { types: string; default: string }>;
  sideEffects: unknown;
};

function graph(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)) {
      const spec = m[1]!;
      if (spec.startsWith(".")) visit(resolve(dirname(file), spec));
      else if (!/^\s*(?:import|export)\s+type\b/.test(m[0])) packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);
    }
  };
  visit(join(ROOT, entry));
  return { files, packages };
}

it("keeps the package root to the browser API, reaching only Vue", () => {
  const { files, packages } = graph("src/index.ts");
  expect([...packages].toSorted()).toEqual(["vue"]);
  expect([...files].map((f) => f.slice(ROOT.length + 1)).toSorted()).toEqual(["src/client.ts", "src/index.ts", "src/types.ts"]);
});

it("keeps every browser entry free of the compiler", () => {
  for (const entry of ["src/client.ts", "src/types.ts", "src/islands.ts"]) {
    const { files } = graph(entry);
    expect([...files].some((f) => f.endsWith("/compiler.ts")), entry).toBe(false);
  }
});

it("exports modules the build emits, with the compiler under ferrovue/compiler", () => {
  expect(pkg.exports["."]!.default).toBe("./dist/index.js");
  expect(pkg.exports["./compiler"]!.default).toBe("./dist/compiler.js");
  for (const [name, target] of Object.entries(pkg.exports)) {
    const source = target.default.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts");
    expect(existsSync(join(ROOT, source)), `${name} → ${source}`).toBe(true);
    expect(target.types, name).toBe(target.default.replace(/\.js$/, ".d.ts"));
  }
});

it("is marked free of side effects, so bundlers drop what is not imported", () => {
  expect(pkg.sideEffects).toBe(false);
});
