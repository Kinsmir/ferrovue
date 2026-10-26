import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError, GenErrors } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import { regexRefusal } from "../src/strings.ts";

const roots: string[] = [];
afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

function compiled(template: string): string {
  const root = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(root);
  mkdirSync(join(root, "components"));
  writeFileSync(join(root, "components", "X.vue"), `<script setup lang="ts">\nconst props = defineProps<{ s: string; n: number }>();\n</script>\n<template>${template}</template>\n`);
  return generate(root, { components: "components", out: "out" }).get("x.rs")!;
}

function refused(template: string): GenError {
  try {
    compiled(template);
  } catch (e) {
    if (e instanceof GenErrors) return e.errors[0] as GenError;
    if (e instanceof GenError) return e;
    throw e;
  }
  throw new Error("compiled without an error");
}

describe("regular expressions", () => {
  it("runs `.replace()`, `.replaceAll()`, `.split()` and `.test()` of a literal through one `JsRegex` held for the program's life", () => {
    const out = compiled("<p>{{ s.replace(/a+/gi, \"b\") }}|{{ s.split(/\\s*,\\s*/, n).length }}|{{ /^\\d+$/.test(s) }}|{{ s.replaceAll(/x/g, \"$&$&\") }}</p>");
    expect(out).toContain('{ static RE: std::sync::LazyLock<fv::strings::JsRegex> = std::sync::LazyLock::new(|| fv::strings::JsRegex::new("a+", "gi")); &RE }).replace(&props.s, "b")');
    expect(out).toContain('fv::strings::JsRegex::new("\\\\s*,\\\\s*", "")); &RE }).split(&props.s, Some(props.n as f64))');
    expect(out).toContain('fv::strings::JsRegex::new("^\\\\d+$", "")); &RE }).test(&props.s)');
  });

  it.each([
    ["alternation", "{{ s.replace(/a|b/, \"\") }}", "holds `|`"],
    ["a group", "{{ s.split(/(,)/) }}", "holds `(`"],
    ["the flag `m`", "{{ /^a/m.test(s) }}", "holds the flag `m`"],
    ["a backreference", "{{ s.replace(/a\\1/, \"\") }}", "holds the escape `\\1`"],
    ["`.replaceAll()` without `g`", "{{ s.replaceAll(/a/, \"b\") }}", "without the `g` flag"],
  ])("refuses %s with FV0710, at the literal", (_, template, message) => {
    const e = refused(`<p>${template}</p>`);
    expect(e.code).toBe("FV0710");
    expect(e.message).toContain(message);
    expect(e.at?.line).toBe(4);
  });

  it("refuses a regular expression on a string that may hold half of a surrogate pair, and keeps the pairs of one that can split none", () => {
    expect(refused('<p>{{ s.slice(1).replace(/a/, "") }}</p>').code).toBe("FV0706");
    expect(refused('<p>{{ s.replace(/./g, "").replace(/a/, "") }}</p>').code).toBe("FV0706");
    expect(compiled('<p>{{ s.replace(/[^a-z]+/g, "-").replace(/-+$/, "") }}|{{ s.replace(/b*/g, "") }}</p>')).toContain("JsRegex");
    expect(refused('<p>{{ s.replace(/b*/g, "").replace(/a/, "") }}</p>').code).toBe("FV0706");
  });

  it("refuses a method of a regular expression other than `.test()` with FV0710", () => {
    expect(refused("<p>{{ /a/.exec(s) }}</p>")).toMatchObject({ code: "FV0710", what: "a regular expression in a template, which the server does not run" });
  });

  it("checks the subset as the runtime parses it", () => {
    expect(regexRefusal("[a-\\d]", "")).toBe("a range that ends at a class escape");
    expect(regexRefusal("[z-a]", "")).toBe("a range out of order");
    expect(regexRefusal("a{3,2}", "")).toBe("a quantifier out of order");
    expect(regexRefusal("^*", "")).toBe("a quantifier of an assertion");
    expect(regexRefusal("[\\u0041-\\x5a]+?\\b.{2,}", "gi")).toBeNull();
    expect(regexRefusal("a", "gg")).toBe("the flag `g`");
  });
});
