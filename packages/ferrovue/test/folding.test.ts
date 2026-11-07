import { describe, expect, it } from "vitest";
import { foldBranches } from "../src/folding.ts";

const fold = (code: string): string => foldBranches(code.split("\n")).join("\n");

describe("text next to an `if` chain", () => {
  it("moves the text after a chain into the end of each branch", () => {
    expect(
      fold(`    if a {
        x(out);
        out.push_str("<b>");
    } else {
        out.push('"');
    }
    out.push_str("</p>");`),
    ).toBe(`    if a {
        x(out);
        out.push_str("<b></p>");
    } else {
        out.push_str("\\"</p>");
    }`);
  });

  it("moves the text before a chain into the start of each branch", () => {
    expect(
      fold(`    out.push('\\'');
    if a {
        out.push_str("<b>");
        x(out);
    } else if b {
        out.push_str("<i>");
        y(out);
    } else {
        out.push_str("<s>");
        z(out);
    }`),
    ).toBe(`    if a {
        out.push_str("'<b>");
        x(out);
    } else if b {
        out.push_str("'<i>");
        y(out);
    } else {
        out.push_str("'<s>");
        z(out);
    }`);
  });

  it("leaves text next to a chain with no final `else`, a loop, or a branch that does not start or end in text", () => {
    const open = `    if a {
        out.push_str("<b>");
    }
    out.push_str("</p>");`;
    expect(fold(open)).toBe(open);
    const looped = `    for v in vs.iter() {
        out.push_str("<b>");
    }
    out.push_str("</p>");`;
    expect(fold(looped)).toBe(looped);
    const written = `    if a {
        out.push_str("<b>");
    } else {
        x(out);
    }
    out.push_str("</p>");`;
    expect(fold(written)).toBe(written);
  });

  it("leaves the text before a chain whose test may return or write", () => {
    const tried = `    out.push_str("<p>");
    if a()? {
        out.push_str("<b>");
        x(out);
    } else {
        out.push_str("<i>");
        y(out);
    }`;
    expect(fold(tried)).toBe(tried);
    const writing = tried.replace("a()?", "a(out)");
    expect(fold(writing)).toBe(writing);
  });

  it("leaves text longer than a few dozen bytes where it is", () => {
    const long = `    if a {
        out.push_str("<b>");
        x(out);
    } else {
        out.push_str("<i>");
        y(out);
    }
    out.push_str("${"x".repeat(49)}");`;
    expect(fold(long)).toBe(long);
  });
});

describe("chains that only write text", () => {
  it("writes the text a chain's test picks in one write", () => {
    expect(
      fold(`    out.push_str("<p>");
    if a {
        out.push_str("<b>");
    } else if b {
        out.push('i');
    } else {
        out.push_str("<!---->");
    }
    out.push_str("</p>");`),
    ).toBe(`    out.push_str(if a { "<p><b></p>" } else if b { "<p>i</p>" } else { "<p><!----></p>" });`);
  });

  it("writes the text of the branch a test known at compile time picks", () => {
    expect(
      fold(`    out.push_str("<p>");
    if true {
        out.push_str("<b>");
    } else {
        out.push_str("<!---->");
    }
    if false {
        out.push_str("<i>");
    } else {
        out.push_str("<!---->");
    }`),
    ).toBe(`    out.push_str("<p><b><!---->");`);
  });

  it("keeps a chain whose test binds a name", () => {
    const bound = `    if let Some(v) = a {
        out.push_str("<b>");
    } else {
        out.push_str("<i>");
    }`;
    expect(fold(bound)).toBe(bound);
  });
});
