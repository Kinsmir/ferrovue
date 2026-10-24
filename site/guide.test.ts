import { describe, expect, it } from "vitest";
import { Items, benchmarks, description, generate, guideGroups, slugify, transform } from "./guide.ts";

const items = new Items();
items.scan("pub struct Html;\nimpl Html {\n    pub fn render_to(&self) {}\n}\npub trait JsTime {\n    fn time_value(&self) -> f64;\n}\npub fn push_int() {}\n");
items.scan("pub struct Args;\n", "i18n::");
items.scan("pub use ferrovue_i18n as i18n;\n");
const guide = new Set(["props", "quick_start"]);

describe("the site's guide", () => {
  it("drops hidden doctest lines and keeps escaped ones", () => {
    const out = transform("```rust\n# use x;\n#\nlet a = 1;\n## [attr]\n#[rustfmt::skip]\n```", { items, from: "t.md", guide });
    expect(out).toBe("```rust\nlet a = 1;\n# [attr]\n#[rustfmt::skip]\n```");
  });

  it("names a fence by its language and keeps other languages' lines", () => {
    expect(transform("```rust,ignore\n# x\n```", { items, from: "t.md", guide })).toBe("```rust\n```");
    expect(transform("```\n# x\ny\n```", { items, from: "t.md", guide })).toBe("```rust\ny\n```");
    expect(transform("```sh\n# a comment\n```", { items, from: "t.md", guide })).toBe("```sh\n# a comment\n```");
    expect(transform("  ```vue\n  <p/>\n  ```", { items, from: "t.md", guide })).toBe("  ```vue\n  <p/>\n  ```");
  });

  it("moves headings one level down outside code", () => {
    expect(transform("# Title\n```rust\n# hidden\n```", { items, from: "t.md", guide })).toBe("## Title\n```rust\n```");
  });

  it("links guide pages to the site and items to docs.rs", () => {
    const out = transform(
      "[a](crate::guide::props#unions) [b](crate::Html::render_to) [c](crate::JsTime::time_value) [d](crate::i18n::Args) [e](crate#rust-version) [f](https://docs.rs/ferrovue/latest/ferrovue/guide/quick_start/index.html#x)",
      { items, from: "t.md", guide },
    );
    expect(out).toBe(
      "[a](./props.md#unions) [b](https://docs.rs/ferrovue/latest/ferrovue/struct.Html.html#method.render_to) [c](https://docs.rs/ferrovue/latest/ferrovue/trait.JsTime.html#tymethod.time_value) [d](https://docs.rs/ferrovue/latest/ferrovue/i18n/struct.Args.html) [e](./overview.md#rust-version) [f](./quick-start.md#x)",
    );
  });

  it("resolves shortcut links in the crate's scope", () => {
    expect(transform("[`push_int`] and [`i18n`]", { items, from: "t.md", guide, scope: "crate" })).toBe(
      "[`push_int`](https://docs.rs/ferrovue/latest/ferrovue/fn.push_int.html) and [`i18n`](https://docs.rs/ferrovue/latest/ferrovue/i18n/index.html)",
    );
    expect(transform("[`props`]", { items, from: "t.md", guide })).toBe("[`props`](./props.md)");
  });

  it("refuses a link to an item the crate lacks", () => {
    expect(() => transform("[x](crate::Missing)", { items, from: "t.md", guide })).toThrow("t.md: no item of the crate for the link to crate::Missing");
  });

  it("gives headings rustdoc's ids", () => {
    expect(slugify("`v-bind()` in `<style>`")).toBe("v-bind-in-style");
    expect(slugify("FV0724")).toBe("fv0724");
    expect(slugify("Unions of string literals")).toBe("unions-of-string-literals");
  });

  it("describes a page by its first paragraph", () => {
    expect(description("What is `escaped`, [where](crate::x).\n\nMore.")).toBe("What is escaped, where.");
  });

  it("reads the guide's order and groups from guide.rs", () => {
    const groups = guideGroups('//! Read them:\n//!\n//! 1. [`quick_start`]: one.\n#![cfg_attr(\n    x,\n    doc = "2. [`props`]: two."\n)]\n//! Moving:\n//! - [`porting`]: three.\n//! Upgrading:\n//! - [`upgrading_to_0_11`]: four.\n');
    expect(groups.map((g) => [g.label, g.pages.map((p) => p.slug)])).toEqual([
      ["Guide", ["quick-start", "props"]],
      ["Porting and support", ["porting"]],
      ["Upgrading", ["upgrading-to-0-11"]],
    ]);
    expect(groups[2]!.pages[0]!.title).toBe("Upgrading to 0.11");
  });

  it("takes the benchmark table from the README", () => {
    expect(benchmarks("## Performance\n\nText.\n\n| a |\n|---|\n\nMore.\n\n## Versions\n")).toBe("::: v-pre\n| a |\n|---|\n:::\n");
  });

  it("generates every guide page of the repository", () => {
    const files = generate();
    expect(files.has("guide/quick-start.md")).toBe(true);
    expect(files.has("guide/error-codes.md")).toBe(true);
    expect(files.get("guide/props.md")).toMatch(/^---\ntitle: "Props"\ndescription: "How a component's props/);
  });
});
