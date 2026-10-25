import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALLOWED, findings, rustReExports, tsReExports } from "./no-re-exports.ts";

let dir = "";

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function project(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "ferrovue-re-exports-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe("re-exports in Rust", () => {
  it("finds `pub use` of every visibility, alone or as a group over lines", () => {
    const source = "mod a;\npub use a::B;\npub(crate) use a::C;\npub(super) use a::D;\npub(in crate::x) use a::E;\npub use a::{\n    F, G,\n};\n";
    expect(rustReExports("lib.rs", source).map((f) => [f.line, f.text])).toEqual([
      [2, "pub use a::B;"],
      [3, "pub(crate) use a::C;"],
      [4, "pub(super) use a::D;"],
      [5, "pub(in crate::x) use a::E;"],
      [6, "pub use a::{"],
    ]);
  });

  it("leaves private imports, comments and doctests' stand-ins alone", () => {
    const source = "use crate::a::B;\nuse a::{C, D};\n// pub use a::B;\n/// # mod ferrovue { pub use ferrovue_core as core; }\n//! pub use x;\npub fn user() {}\npub mod used;\n";
    expect(rustReExports("lib.rs", source)).toEqual([]);
  });

  it("allows the ferrovue crate's three whole-crate modules, there alone", () => {
    const lines = ALLOWED["crates/ferrovue/src/lib.rs"]!;
    expect(lines).toEqual(["pub use ferrovue_core as core;", "pub use ferrovue_i18n as i18n;", "pub use ferrovue_router as router;"]);
    const source = `#[doc(inline)]\n${lines.join("\n")}\npub use ferrovue_core::escape::escape_into;\n`;
    expect(rustReExports("crates/ferrovue/src/lib.rs", source, lines).map((f) => f.text)).toEqual(["pub use ferrovue_core::escape::escape_into;"]);
    expect(rustReExports("crates/ferrovue/src/html.rs", source)).toHaveLength(4);
  });
});

describe("re-exports in TypeScript", () => {
  it("finds every `export … from`", () => {
    const source = [
      'export { a } from "./a.ts";',
      'export type { B } from "./b.ts";',
      'export { c as d, type E } from "./c.ts";',
      'export * from "./f.ts";',
      'export * as g from "./g.ts";',
      "export {",
      "  h,",
      '} from "./h.ts";',
    ].join("\n");
    expect(tsReExports("x.ts", source).map((f) => [f.line, f.text])).toEqual([
      [1, 'export { a } from "./a.ts";'],
      [2, 'export type { B } from "./b.ts";'],
      [3, 'export { c as d, type E } from "./c.ts";'],
      [4, 'export * from "./f.ts";'],
      [5, 'export * as g from "./g.ts";'],
      [6, 'export { h, } from "./h.ts";'],
    ]);
  });

  it("finds an `export { … }` or `export default` of a name the file imports", () => {
    const source = [
      'import { a, b as c } from "./a.ts";',
      'import type { D } from "./d.ts";',
      'import e, { f } from "./e.ts";',
      'import * as g from "./g.ts";',
      "export { c };",
      "export type { D };",
      "export { e as default };",
      "export default g;",
    ].join("\n");
    expect(tsReExports("x.ts", source).map((f) => f.text)).toEqual(["export { c };", "export type { D };", "export { e as default };", "export default g;"]);
  });

  it("leaves exports of what the file defines alone", () => {
    const source = [
      'import { a } from "./a.ts";',
      "const plugin = a();",
      'export { plugin as "module.exports" };',
      "export default plugin;",
      "export function own(): void {}",
      "export const value = 1;",
      'const text = `export { a } from "./a.ts"`;',
    ].join("\n");
    expect(tsReExports("x.ts", source)).toEqual([]);
  });
});

describe("the repository", () => {
  it("scans Rust under crates/ and TypeScript under packages/, scripts/ and site/, generated code included", () => {
    const root = project({
      "crates/x/src/lib.rs": "pub use inner::Item;\n",
      "crates/x/tests/generated/mod.rs": "pub use super::a::B;\n",
      "crates/ferrovue/src/lib.rs": "pub use ferrovue_core as core;\n",
      "packages/x/src/index.ts": 'export { a } from "./a.ts";\n',
      "packages/x/node_modules/y/index.ts": 'export { a } from "./a.ts";\n',
      "packages/x/dist/index.ts": 'export { a } from "./a.ts";\n',
      "scripts/x.ts": 'import { a } from "./a.ts";\nexport { a };\n',
      "site/x.mts": 'export * from "./a.ts";\n',
      "examples/x/src/lib.rs": "pub use a::B;\n",
      "examples/x/client/index.ts": 'export { a } from "./a.ts";\n',
    });
    expect(findings(root).map((f) => `${f.file}:${f.line}`).toSorted()).toEqual([
      "crates/x/src/lib.rs:1",
      "crates/x/tests/generated/mod.rs:1",
      "packages/x/src/index.ts:1",
      "scripts/x.ts:2",
      "site/x.mts:1",
    ]);
  });

  it("holds no re-export but the three the rule allows", () => {
    expect(findings()).toEqual([]);
  });
});
