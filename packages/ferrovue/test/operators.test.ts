import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError, GenErrors } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import { like } from "./code.ts";

const roots: string[] = [];

function project(files: Record<string, string>): string {
  const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(made);
  const dir = join(made, "components");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return made;
}

function sfc(script: string, template: string): string {
  return `<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>\n`;
}

function render(script: string, template: string, files: Record<string, string> = {}): string {
  const out = generate(project({ "X.vue": sfc(script, template), ...files }), { components: "components", out: "out" }).get("x.rs")!;
  return /pub fn try_render[\s\S]*?\n}\n/.exec(out)![0];
}

function refusals(script: string, template: string, files: Record<string, string> = {}): string[] {
  try {
    generate(project({ "X.vue": sfc(script, template), ...files }), { components: "components", out: "out" });
  } catch (e) {
    if (e instanceof GenErrors) return e.errors.map((one) => (one instanceof GenError ? `${one.code} ${one.what}` : String(one)));
    if (e instanceof GenError) return [`${e.code} ${e.what}`];
    throw e;
  }
  throw new Error("compiled without an error");
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

const PROPS = `import type { Float } from "ferrovue/types";
interface R { t: string; u?: string; r?: R2 }
interface R2 { v: string }
defineProps<{ s: string; d: string; k: "a" | "b"; o?: "a" | "b"; xs: string[]; ys?: string[]; is: number[]; ns?: number[]; n: number; m?: number; f: Float; g?: Float; b: boolean; c?: boolean; os?: string; nl: string | null; zs: string[] | null; at: Date; on?: Date; r: R; q?: R; rs: Record<string, string> }>();`;

const lines = (template: string, script = PROPS, files: Record<string, string> = {}) =>
  render(script, template, files)
    .split("\n")
    .slice(1, -2)
    .map((line) => line.trim())
    .filter((line) => !/^(?:out\.reserve\(|let fv_refusals = |Ok\(\(\)\)$)/.test(line))
    .join("\n");

const V = {
  "V.vue": sfc('export interface Item { label: string; n?: number }\ndefineProps<{ item: Item; items?: Item[] }>();', "<b>{{ item.label }}{{ items?.length }}</b>"),
};
const ITEM = 'import V, { type Item } from "./V.vue";\nconst props = defineProps<{ on: boolean; s: string; it?: Item }>();\nfunction one(): Item | undefined { return props.on ? { label: "a" } : undefined; }\n';

describe("`&&` and `||`", () => {
  it("gives the right side of `&&` and the left side of `||` where the left side is always truthy", () => {
    expect(lines("<p>{{ (xs || ['z']).length }}|{{ xs && 'y' }}|{{ k || 'z' }}|{{ k && 'y' }}|{{ at && 'x' }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::push_int(out, props.xs.len() as i64);",
      'out.push_str("|y|");',
      "fv::core::escape_into(out, fv::props::Union::as_str(props.k));",
      'out.push_str("|y|x</p>");',
    ].join("\n"), true));
  });

  it("gives the right side of `||` where an optional value on its left is absent or falsy", () => {
    expect(lines("<p>{{ o || 'z' }}|{{ os || os }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'fv::core::escape_into(out, if let Some(n1) = props.o { fv::props::Union::as_str(n1) } else { "z" });',
      "out.push('|');",
      "if let Some(v) = if let Some(n2) = props.os.as_deref().filter(|v| !v.is_empty()) { Some(n2) } else { props.os.as_deref() } {",
    ].join("\n")));
  });

  it("chooses between booleans, strings and numbers with `||`", () => {
    expect(lines("<p>{{ b || c === true }}|{{ b && c === true }}|{{ s || 'x' }}|{{ s.trim() || d }}|{{ s || d.trim() }}|{{ `${s}` || d }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'out.push_str(if props.b || props.c.unwrap_or(false) { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.b && props.c.unwrap_or(false) { "true" } else { "false" });',
      "out.push('|');",
      'fv::core::escape_into(out, { let a = &*props.s; if !a.is_empty() { a } else { "x" } });',
      "out.push('|');",
      "fv::core::escape_into(out, { let a = fv::strings::js_trim(&props.s); if !a.is_empty() { a } else { &props.d } });",
      "out.push('|');",
      "fv::core::escape_into(out, { let a = &*props.s; if !a.is_empty() { a } else { fv::strings::js_trim(&props.d) } });",
      "out.push('|');",
      "fv::core::escape_into(out, { let a = &*props.s; if !a.is_empty() { a } else { &props.d } });",
      'out.push_str("</p>");',
    ].join("\n"), true));
    expect(lines('<p>{{ "" || d }}|{{ "q" || d }}</p>')).toMatch(like(['out.push_str("<p>");', "fv::core::escape_into(out, &props.d);", 'out.push_str("|q</p>");'].join("\n"), true));
  });

  it("writes `||` of two numbers as a test of the first", () => {
    expect(lines("<p>{{ n || n }}|{{ f || f }}</p>", 'import type { Float } from "ferrovue/types";\ndefineProps<{ n: number; f: Float }>();')).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::push_int(out, { let a = props.n; if a != 0 { a } else { props.n } });",
      "out.push('|');",
      "fv::core::push_number(out, { let a = props.f; if a != 0.0 && !a.is_nan() { a } else { props.f } });",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("writes `|| undefined` as the value where it is truthy", () => {
    expect(lines("<p>{{ os || undefined }}|{{ s || undefined }}|{{ n || undefined }}|{{ (q || undefined)?.t }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "if let Some(v) = props.os.as_deref().filter(|v| !v.is_empty()) {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = Some(&*props.s).filter(|v| !v.is_empty()) {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = Some(props.n).filter(|v| *v != 0) {",
      "fv::core::push_int(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = props.q.as_ref().map(|fv_o1| &*fv_o1.t) {",
      "fv::core::escape_into(out, v);",
      "}",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  const refused: [string, string, string][] = [
    ["`||` of a string and a number", "<p>{{ s || n }}</p>", "FV0617 `||` between these types"],
    ["`||` of a number and a string", "<p>{{ n || 'x' }}</p>", "FV0617 `||` between these types"],
    ["`||` of a boolean and a string", "<p>{{ b || s }}</p>", "FV0617 `||` between these types"],
    ["`||` of an optional list and a list", "<p>{{ (ys || xs).length }}</p>", "FV0617 `||` between these types"],
    ["`&&` of two strings", "<p>{{ s && d }}</p>", "FV0614 `&&` is supported between booleans only, and its left side is a string"],
    ["`&&` of a number and a boolean", "<p>{{ n && b }}</p>", "FV0614 `&&` is supported between booleans only, and its left side is a number"],
    ["`&&` of a boolean and a string", "<p>{{ b && s }}</p>", "FV0614 `&&` is supported between booleans only, and its right side is a string"],
    ["`||` of a string and a boolean", "<p>{{ s || b }}</p>", "FV0617 `||` between these types"],
    ["`||` of a number and a boolean", "<p>{{ n || b }}</p>", "FV0617 `||` between these types"],
    ["`||` of `undefined` and a string", "<p>{{ undefined || s }}</p>", "FV0617 `||` between these types"],
    ["`||` of `null` and a string", "<p>{{ null || s }}</p>", "FV0617 `||` between these types"],
    ["`||` of a number literal and a string", "<p>{{ 1 || 'x' }}</p>", "FV0617 `||` between these types"],
    ["`||` of an empty string and a number", "<p>{{ '' || n }}</p>", "FV0617 `||` between these types"],
    ["`||` of a computed string and a number", "<p>{{ `a${s}` || n }}</p>", "FV0617 `||` between these types"],
    ["`||` of a number and a computed string", "<p>{{ n || `a${s}` }}</p>", "FV0617 `||` between these types"],
    ["`||` of two optional objects", "<p>{{ (q || q)?.t }}</p>", "FV0617 `||` between these types"],
    ["`&&` of an optional date and a string", "<p>{{ (b ? on : on) && 'x' }}</p>", "FV0614 `&&` is supported between booleans only, and its left side is an optional `Date`"],
    ["`&&` of an optional date and a boolean", "<p>{{ (c ? on : undefined) && b }}</p>", "FV0614 `&&` is supported between booleans only, and its left side is an optional `Date`"],
  ];
  for (const [what, template, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(PROPS, template)).toEqual([message]);
    });
  }

  it("narrows by a presence test only where it decides the result", () => {
    expect(lines("<p>{{ os != null || b }}|{{ os == null && b }}|{{ (os !== undefined) ?? b }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'out.push_str(if props.os.as_deref().is_some() || props.b { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.os.as_deref().is_none() && props.b { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.os.as_deref().is_some() { "true" } else { "false" });',
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("gives the right side of `||` where the left side is known to be falsy", () => {
    expect(lines('<p>{{ "" || `a${s}` }}|{{ 0 || n }}|{{ 2 || n }}</p>')).toMatch(like([
      'out.push_str("<p>a");',
      "fv::core::escape_into(out, &props.s);",
      "out.push('|');",
      "fv::core::push_int(out, props.n);",
      'out.push_str("|2</p>");',
    ].join("\n"), true));
  });

  it("checks `||` of integers computed as floats where the expression starts", () => {
    expect(lines("<p>{{ xs[n || -n] }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "if let Some(v) = props.xs.get(usize::try_from(fv_refusals.keep(fv::render::try_int({ let a = props.n as f64; if a != 0.0 { a } else { -(props.n as f64) } }), 7, 21)).unwrap_or(usize::MAX)).map(|v| &**v) {",
      "fv::core::escape_into(out, v);",
      "}",
      'out.push_str("</p>");',
      "fv_refusals.check(Ok(()))",
    ].join("\n"), true));
  });
});

describe("`??`", () => {
  it("gives the left side where it is never absent, and the right side where it always is", () => {
    expect(lines("<p>{{ s ?? 'x' }}|{{ n ?? 1 }}|{{ undefined ?? 'x' }}|{{ null ?? s }}|{{ c ?? true }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::escape_into(out, &props.s);",
      "out.push('|');",
      "fv::core::push_int(out, props.n);",
      'out.push_str("|x|");',
      "fv::core::escape_into(out, &props.s);",
      "out.push('|');",
      'out.push_str(if props.c.unwrap_or(false) { "true" } else { "false" });',
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("keeps the left side, optional, before `undefined` or `null`", () => {
    expect(lines("<p>{{ os ?? undefined }}|{{ os ?? null }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "if let Some(v) = props.os.as_deref() {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = props.os.as_deref() {",
      "fv::core::escape_into(out, v);",
      "}",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("falls back from an optional list to a list or an empty array literal", () => {
    expect(lines('<i v-for="v in ys ?? xs">{{ v }}</i><b>{{ (ys ?? []).length }}</b>')).toMatch(like([
      'out.push_str("<!--[--><!--[-->");',
      "for v_ref in props.ys.as_ref().map(|v| &v[..]).unwrap_or(&props.xs[..]).iter() {",
      "let v: &str = v_ref;",
      'out.push_str("<i>");',
      "fv::core::escape_into(out, v);",
      'out.push_str("</i>");',
      "}",
      'out.push_str("<!--]--><b>");',
      "fv::core::push_int(out, props.ys.as_ref().map(|v| &v[..]).unwrap_or(&[]).len() as i64);",
      'out.push_str("</b><!--]-->");',
    ].join("\n"), true));
  });

  it("falls back from an optional list to an array literal as `?:` does", () => {
    expect(lines("<b>{{ (ys ?? ['q']).length }}|{{ (zs ?? ['q', 'r']).join('-') }}|{{ (ns ?? [1, 2]).length }}</b>")).toMatch(like([
      'out.push_str("<b>");',
      "fv::core::push_int(out, (if let Some(n1) = props.ys.as_ref() { n1.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>() } else { [\"q\"].iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>() }).len() as i64);",
      "out.push('|');",
      'fv::core::escape_into(out, &(if let Some(n2) = props.zs.as_ref() { n2.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>() } else { ["q", "r"].iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>() }).into_iter().collect::<Vec<_>>().join("-"));',
      "out.push('|');",
      "fv::core::push_int(out, (if let Some(n3) = props.ns.as_ref() { n3.to_vec() } else { [1i64, 2i64].to_vec() }).len() as i64);",
      'out.push_str("</b>");',
    ].join("\n"), true));
  });

  it("falls back from optional strings to strings, held where the right side is computed", () => {
    expect(lines("<p>{{ os ?? s }}|{{ os ?? s.trim() }}|{{ os ?? `a${s}` }}|{{ os ?? nl }}|{{ q?.u?.trim() ?? s }}|{{ q?.u ?? 'x' }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::escape_into(out, props.os.as_deref().unwrap_or(&*props.s));",
      "out.push('|');",
      "fv::core::escape_into(out, props.os.as_deref().unwrap_or(fv::strings::js_trim(&props.s)));",
      "out.push('|');",
      'fv::core::escape_into(out, &props.os.as_deref().map(std::borrow::Cow::<str>::Borrowed).unwrap_or(std::borrow::Cow::<str>::Owned(format!("a{}", props.s))));',
      "out.push('|');",
      "if let Some(v) = props.os.as_deref().or(props.nl.as_deref()) {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "fv::core::escape_into(out, props.q.as_ref().and_then(|fv_o1| fv_o1.u.as_deref()).map(fv::strings::js_trim).unwrap_or(&*props.s));",
      "out.push('|');",
      'fv::core::escape_into(out, props.q.as_ref().and_then(|fv_o3| fv_o3.u.as_deref()).unwrap_or("x"));',
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("falls back between integers and floats", () => {
    expect(lines("<p>{{ m ?? 1.5 }}|{{ g ?? 1 }}|{{ g ?? n }}|{{ m ?? n }}|{{ m ?? m ?? 0 }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::push_number(out, props.m.map(|v| v as f64).unwrap_or(1.5f64));",
      "out.push('|');",
      "fv::core::push_number(out, props.g.unwrap_or(1.0f64));",
      "out.push('|');",
      "fv::core::push_number(out, props.g.unwrap_or(props.n as f64));",
      "out.push('|');",
      "fv::core::push_int(out, props.m.unwrap_or(props.n));",
      "out.push('|');",
      "fv::core::push_int(out, props.m.or(props.m).unwrap_or(0i64));",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("falls back from an optional enum to a member, or to its string", () => {
    expect(lines("<p>{{ o ?? 'b' }}|{{ o ?? 'z' }}|{{ o ?? s }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::escape_into(out, fv::props::Union::as_str(props.o.unwrap_or(XO::B)));",
      "out.push('|');",
      'fv::core::escape_into(out, props.o.map(fv::props::Union::as_str).unwrap_or("z"));',
      "out.push('|');",
      "fv::core::escape_into(out, props.o.map(fv::props::Union::as_str).unwrap_or(&*props.s));",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("falls back between dates with `??` and `||`", () => {
    expect(lines("<p>{{ (on ?? at).getTime() }}|{{ (on || at).getTime() }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::push_number(out, props.on.as_ref().map(fv::date::js_time_of).unwrap_or(fv::date::js_time_of(&props.at)));",
      "out.push('|');",
      "fv::core::push_number(out, props.on.as_ref().map(fv::date::js_time_of).unwrap_or(fv::date::js_time_of(&props.at)));",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("falls back from a value built from object literals, building the fallback only where it may panic", () => {
    expect(render(`${ITEM}function base(): Item { return { label: "b" }; }`, '<V :item="one() ?? base()" />', V)).toMatch(like(
      '(if props.on { Some(super::v::Item { label: std::borrow::Cow::<str>::Borrowed("a"), n: None }) } else { None }).unwrap_or(super::v::Item { label: std::borrow::Cow::<str>::Borrowed("b"), n: None })',
    ));
    expect(render(`${ITEM}function base(): Item { return { label: props.s.repeat(2) }; }`, '<V :item="one() ?? base()" />', V)).toMatch(like(
      ".unwrap_or_else(|| super::v::Item { label: std::borrow::Cow::<str>::Owned(fv_refusals.keep(fv::strings::try_repeat(&props.s, 2.0f64), 5, 41)), n: None })",
    ));
    expect(render(`${ITEM}function base(): Item { return { label: "b" }; }`, '<V :item="it ?? base()" />', V)).toMatch(like(
      'item: props.it.as_ref().cloned().unwrap_or(super::v::Item { label: std::borrow::Cow::<str>::Borrowed("b"), n: None })',
    ));
  });

  const refused: [string, string, string][] = [
    ["`??` falling back to a computed list", '<i v-for="v in ys ?? xs.filter((x) => x)">{{ v }}</i>', "FV0615 `??` falling back to a computed list"],
    ["`??` of an optional list falling back to a string", "<p>{{ ys ?? 'x' }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional number falling back to a string", "<p>{{ m ?? 'x' }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional list of numbers falling back to strings", "<p>{{ (ns ?? ['q']).length }}</p>", "FV0616 `??` between different types"],
    [
      "`??` after an optional chain that computes a list, falling back to a list",
      '<i v-for="v in ys?.filter((x) => x) ?? xs">{{ v }}</i>',
      "FV0630 `??` after an optional chain that computes a list, falling back to another list: fall back to `[]`",
    ],
    ["`??` of an optional string falling back to an empty array literal", "<p>{{ os ?? [] }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional object falling back to an empty array literal", "<p>{{ q ?? [] }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional number falling back to an empty array literal", "<p>{{ m ?? [] }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional string falling back to a list", "<p>{{ os ?? xs }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional number falling back to a computed string", "<p>{{ m ?? `a${s}` }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional string falling back to an optional number", "<p>{{ os ?? m }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional number falling back to an optional string", "<p>{{ m ?? os }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional chain's string falling back to a number", "<p>{{ q?.u?.trim() ?? n }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional string falling back to a number", "<p>{{ os ?? n }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional string falling back to a float", "<p>{{ os ?? f }}</p>", "FV0616 `??` between different types"],
    ["`??` of an optional float falling back to a string", "<p>{{ g ?? 'x' }}</p>", "FV0616 `??` between different types"],
    ["`??` of a held optional string falling back to a number", "<p>{{ (b ? os : `a${s}`) ?? n }}</p>", "FV0616 `??` between different types"],
    ["`??` whose right side is refused, after a value never absent", "<p>{{ k ?? (n == 1) }}</p>", "FV0619 `==`: `==` and `!=` compare with `null` or `undefined` only; use `===`"],
    ["`??` whose right side is refused, after a date", "<p>{{ at ?? (n == 1) }}</p>", "FV0619 `==`: `==` and `!=` compare with `null` or `undefined` only; use `===`"],
  ];
  for (const [what, template, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(PROPS, template)).toEqual([message]);
    });
  }

  it("refuses `??` of a value built from object literals falling back to another type", () => {
    expect(refusals(ITEM, "<p>{{ one() ?? 'x' }}</p>", V)).toEqual([
      "FV0636 `??` of a value built from object literals in place, which the server holds only while the expression that builds it runs: give it a `computed` of its own and read that",
    ]);
  });

  it("refuses `??` of an optional list falling back to a list built from object literals", () => {
    const script = 'import V, { type Item } from "./V.vue";\nconst props = defineProps<{ s: string; list?: Item[] }>();\nfunction rows(): Item[] { return [{ label: props.s }]; }';
    expect(refusals(script, '<V v-for="x in (list ?? rows())" :item="x" />', V)).toEqual([
      "FV0636 `??` of a value built from object literals in place, which the server holds only while the expression that builds it runs: give it a `computed` of its own and read that",
    ]);
  });

  it("falls back from an optional union with no member to read, and from a float to an integer computed as a float", () => {
    expect(lines('<p>{{ (b ? o : undefined) ?? "b" }}|{{ g ?? -n }}</p>')).toMatch(like([
      'out.push_str("<p>");',
      'fv::core::escape_into(out, (if props.b { props.o.map(fv::props::Union::as_str) } else { None }).unwrap_or("b"));',
      "out.push('|');",
      "fv::core::push_number(out, props.g.unwrap_or(-(props.n as f64)));",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("checks `??` of integers computed as floats where the expression starts", () => {
    expect(lines("<p>{{ xs[m ?? -n] }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "if let Some(v) = props.xs.get(usize::try_from(fv_refusals.keep(fv::render::try_int(props.m.map(|v| v as f64).unwrap_or(-(props.n as f64))), 7, 21)).unwrap_or(usize::MAX)).map(|v| &**v) {",
      "fv::core::escape_into(out, v);",
      "}",
      'out.push_str("</p>");',
      "fv_refusals.check(Ok(()))",
    ].join("\n"), true));
  });
});

describe("unary operators", () => {
  it("negates numbers", () => {
    expect(lines("<p>{{ -n }}|{{ -f }}|{{ -(2) }}|{{ -2.5 }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::push_number(out, -(props.n as f64));",
      "out.push('|');",
      "fv::core::push_number(out, -props.f);",
      'out.push_str("|-2|-2.5</p>");',
    ].join("\n"), true));
  });

  it("negates a float constant as a float", () => {
    expect(lines("<p>{{ (-Math.PI).toFixed(1) }}|{{ String(-Math.PI) }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::escape_into(out, &fv::core::js_to_fixed(-std::f64::consts::PI, 1));",
      "out.push('|');",
      "fv::core::escape_into(out, &fv::core::Js(-std::f64::consts::PI).to_string());",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  for (const op of ["-s", "+n", "~n", "void n"]) {
    it(`refuses \`${op}\``, () => {
      expect(refusals(PROPS, `<p>{{ ${op} }}</p>`)).toEqual([`FV0618 unary \`${op.replace(/ ?[sn]$/, "")}\``]);
    });
  }
});

describe("equality", () => {
  it("tests optional values against `null` and `undefined`, and knows the answer for values never absent", () => {
    expect(lines("<p>{{ os == null }}|{{ os != null }}|{{ nl == undefined }}|{{ s == null }}|{{ s != undefined }}|{{ s === undefined }}|{{ s !== undefined }}|{{ s === null }}|{{ null === s }}|{{ undefined !== s }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'out.push_str(if props.os.as_deref().is_none() { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.os.as_deref().is_some() { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.nl.as_deref().is_none() { "true" } else { "false" });',
      'out.push_str("|false|true|false|true|false|false|true</p>");',
    ].join("\n"), true));
    expect(lines("<p>{{ undefined === undefined }}|{{ null === undefined }}|{{ null !== null }}|{{ undefined === null }}|{{ undefined == null }}|{{ null != undefined }}</p>")).toMatch(like([
      'out.push_str("<p>true|false|false|false|true|false</p>");',
    ].join("\n"), true));
  });

  it("writes a test against a boolean known when compiling as the other side", () => {
    expect(lines("<p>{{ b === true }}|{{ b === false }}|{{ true === b }}|{{ false !== b }}|{{ b === (n > 1) }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'out.push_str(if props.b { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if !props.b { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.b { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.b { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.b == (props.n as f64 > 1.0) { "true" } else { "false" });',
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("compares an optional value with a value of its type", () => {
    expect(lines("<p>{{ os === s }}|{{ s === os }}|{{ os === 'x' }}|{{ m === n }}|{{ n === m }}|{{ f === n }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'out.push_str(if props.os.as_deref() == Some(&*props.s) { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if Some(&*props.s) == props.os.as_deref() { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.os.as_deref() == Some("x") { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.m == Some(props.n) { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if Some(props.n) == props.m { "true" } else { "false" });',
      "out.push('|');",
      'out.push_str(if props.f == props.n as f64 { "true" } else { "false" });',
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  const refused: [string, string, string[]][] = [
    ["`==` of two values", "<p>{{ n == 1 }}</p>", ["FV0619 `==`: `==` and `!=` compare with `null` or `undefined` only; use `===`"]],
    ["`!=` of two strings", "<p>{{ s != 'a' }}</p>", ["FV0619 `!=`: `==` and `!=` compare with `null` or `undefined` only; use `===`"]],
    ["`==` of a date and `null`", "<p>{{ at == null }}</p>", ["FV0620 `==` of a `Date`: compare with `=== undefined`"]],
    ["`!=` of a date and `undefined`", "<p>{{ at != undefined }}</p>", ["FV0620 `!=` of a `Date`: compare with `!== undefined`"]],
    ["`===` of a date and `null`", "<p>{{ at === null }}</p>", ["FV0621 `===` between a `Date` and `null`"]],
    ["`!==` of `undefined` and a date", "<p>{{ undefined !== at }}</p>", ["FV0621 `!==` between a `Date` and `undefined`"]],
    ["`===` of a list and a list", "<p>{{ xs === xs }}</p>", ["FV0622 `===` between these types"]],
    ["`===` of a string and a number", "<p>{{ s === n }}</p>", ["FV0622 `===` between these types"]],
    ["`===` of an optional string and a nullable one", "<p>{{ os === nl }}</p>", ["FV0622 `===` between these types"]],
    ["`===` of `true` and a number", "<p>{{ true === n }}</p>", ["FV0622 `===` between these types"]],
    ["`===` of an optional list of cut strings and a cut string", "<p>{{ ys?.map((x) => x.slice(0, 1)) === s.slice(0, 1) }}</p>", ["FV0622 `===` between these types"]],
    [
      "`===` of two cut strings",
      "<p>{{ s.slice(0, 1) === d.slice(0, 1) }}|{{ os?.slice(0, 1) === d.slice(0, 1) }}|{{ d.slice(0, 1) === os?.slice(0, 1) }}</p>",
      Array<string>(3).fill(
        "FV0706 `===` with a string that may hold half of a surrogate pair (cut by `slice`, `substring`, `at`, `charAt`, `split(\"\")` and the like): JavaScript keeps the half, which can match, order or join with another where ferrovue holds U+FFFD",
      ),
    ],
    [
      "`===` of a nullable string and a value always `undefined`",
      "<p>{{ nl === (b ? undefined : undefined) }}</p>",
      ["FV0627 `=== undefined` of a value that is `T | null`, never `undefined`: compare with `null`"],
    ],
    [
      "`!==` of an optional string and a value always `null`",
      "<p>{{ os !== (b ? null : null) }}</p>",
      ["FV0627 `!== null` of a value that is optional, which is `undefined` when absent, never `null`: compare with `undefined`"],
    ],
  ];
  for (const [what, template, messages] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(PROPS, template)).toEqual(messages);
    });
  }

  it("writes `== null` of a value never absent as a constant wherever it is read", () => {
    expect(lines("<p>{{ String(xs == null) }}</p>")).toMatch(like(['out.push_str("<p>");', 'fv::core::escape_into(out, if false { "true" } else { "false" });', 'out.push_str("</p>");'].join("\n"), true));
    const flag = { "F.vue": sfc("defineProps<{ flag: boolean }>();", "<b>{{ flag }}</b>") };
    expect(render('import F from "./F.vue";\ndefineProps<{ xs: string[] }>();', '<F :flag="xs == null" />', flag)).toMatch(like("super::f::try_render(out, &super::f::Props { flag: false })?;"));
  });

  it("compares values of one optional type, and with a value always `undefined`", () => {
    expect(lines("<p>{{ os === (b ? undefined : undefined) }}|{{ (b ? undefined : undefined) !== (b ? undefined : undefined) }}|{{ os === os }}|{{ m === m }}|{{ os !== os }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'out.push_str(if props.os.as_deref().is_none() { "true" } else { "false" });',
      'out.push_str("|false|");',
      'out.push_str(if props.os.as_deref() == props.os.as_deref() { "true" } else { "false" });',
      'out.push_str("|true|");',
      'out.push_str(if props.os.as_deref() != props.os.as_deref() { "true" } else { "false" });',
      'out.push_str("</p>");',
    ].join("\n"), true));
  });
});

describe("`?:`", () => {
  it("types the empty array literal a test known when compiling chooses by the branch it leaves", () => {
    expect(lines('<i v-for="v in (true ? [] : xs)">{{ v }}</i><b v-for="v in (false ? xs : [])">{{ v }}</b>')).toMatch(like([
      'out.push_str("<!--[--><!--[-->");',
      "for v_ref in <&[std::borrow::Cow<str>]>::default().iter() {",
      "let v: &str = v_ref;",
      'out.push_str("<i>");',
      "fv::core::escape_into(out, v);",
      'out.push_str("</i>");',
      "}",
      'out.push_str("<!--]--><!--[-->");',
      "for v_ref in <&[std::borrow::Cow<str>]>::default().iter() {",
      "let v: &str = v_ref;",
      'out.push_str("<b>");',
      "fv::core::escape_into(out, v);",
      'out.push_str("</b>");',
      "}",
      'out.push_str("<!--]--><!--]-->");',
    ].join("\n"), true));
    expect(refusals(PROPS, '<i v-for="v in (true ? [] : s.x)">{{ v }}</i>')).toEqual(["FV0819 `v-for` over an empty array literal"]);
  });

  it("writes one branch where both are the same", () => {
    expect(lines("<p>{{ b ? s : s }}|{{ (b ? r : r).t }}</p>")).toMatch(like(['out.push_str("<p>");', "fv::core::escape_into(out, &props.s);", "out.push('|');", "fv::core::escape_into(out, &props.r.t);", 'out.push_str("</p>");'].join("\n"), true));
  });

  it("borrows a struct each branch reads from a field", () => {
    expect(lines("<p>{{ (b ? r.r : q?.r)?.v }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "if let Some(v) = (if props.b { props.r.r.as_ref() } else { props.q.as_ref().and_then(|fv_o1| fv_o1.r.as_ref()) }).map(|fv_o2| &*fv_o2.v) {",
      "fv::core::escape_into(out, v);",
      "}",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("chooses between lists, slices and empty array literals", () => {
    expect(lines('<i v-for="v in b ? [] : xs">{{ v }}</i><i v-for="v in b ? xs : []">{{ v }}</i><b>{{ (b ? is : []).length }}</b>')).toMatch(like([
      'out.push_str("<!--[--><!--[-->");',
      "for v_ref in (if props.b { &[] } else { &props.xs[..] }).iter() {",
      "let v: &str = v_ref;",
      'out.push_str("<i>");',
      "fv::core::escape_into(out, v);",
      'out.push_str("</i>");',
      "}",
      'out.push_str("<!--]--><!--[-->");',
      "for v_ref in (if props.b { &props.xs[..] } else { &[] }).iter() {",
      "let v: &str = v_ref;",
      'out.push_str("<i>");',
      "fv::core::escape_into(out, v);",
      'out.push_str("</i>");',
      "}",
      'out.push_str("<!--]--><b>");',
      "fv::core::push_int(out, (if props.b { &props.is[..] } else { &[] }).len() as i64);",
      'out.push_str("</b><!--]-->");',
    ].join("\n"), true));
    expect(lines("<b>{{ (b ? ['a'] : []).length }}|{{ (b ? [] : xs.slice(1)).length }}</b>")).toMatch(like([
      'out.push_str("<b>");',
      'fv::core::push_int(out, (if props.b { ["a"].iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>() } else { Vec::new() }).len() as i64);',
      "out.push('|');",
      "fv::core::push_int(out, (if props.b { Vec::new() } else { fv::strings::js_slice_items(props.xs.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)), 1.0f64, None).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>() }).len() as i64);",
      'out.push_str("</b>");',
    ].join("\n"), true));
  });

  it("chooses between strings, borrowing the second", () => {
    expect(lines("<p>{{ b ? s : 'x' }}|{{ b ? s.trim() : d }}|{{ b ? d : s.trim() }}|{{ b ? s : n }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'fv::core::escape_into(out, if props.b { &props.s } else { "x" });',
      "out.push('|');",
      "fv::core::escape_into(out, if props.b { fv::strings::js_trim(&props.s) } else { &props.d });",
      "out.push('|');",
      "fv::core::escape_into(out, if props.b { &props.d } else { fv::strings::js_trim(&props.s) });",
      "out.push('|');",
      'fv::core::escape_into(out, &(if props.b { std::borrow::Cow::<str>::Borrowed(&*props.s) } else { std::borrow::Cow::<str>::Owned(format!("{}", fv::core::Js(props.n))) }));',
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("narrows a value its test finds present", () => {
    expect(lines("<p>{{ os ? os : 'x' }}|{{ !os ? 'x' : os }}|{{ os ? 1 : 2 }}|{{ m != null ? m + 1 : 0 }}|{{ os ? os.trim() : 'x' }}|{{ os ? os.length : undefined }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      'fv::core::escape_into(out, props.os.as_deref().filter(|v| !v.is_empty()).unwrap_or("x"));',
      "out.push('|');",
      'fv::core::escape_into(out, props.os.as_deref().filter(|v| !v.is_empty()).unwrap_or("x"));',
      "out.push('|');",
      "fv::core::push_int(out, if props.os.as_deref().is_some_and(|v| !v.is_empty()) { 1i64 } else { 2i64 });",
      "out.push('|');",
      "fv::core::push_number(out, if let Some(n4) = props.m { n4 as f64 + 1.0 } else { 0.0f64 });",
      "out.push('|');",
      'fv::core::escape_into(out, if let Some(n5) = props.os.as_deref().filter(|v| !v.is_empty()) { fv::strings::js_trim(n5) } else { "x" });',
      "out.push('|');",
      "if let Some(v) = props.os.as_deref().filter(|v| !v.is_empty()).map(|n6| fv::strings::js_length(n6)) {",
      "fv::core::push_int(out, v);",
      "}",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("chooses between numbers as floats, and between optional values", () => {
    expect(lines("<p>{{ b ? n : f }}|{{ b ? 1 : 2.5 }}|{{ b ? os : undefined }}|{{ b ? undefined : os }}|{{ b ? s : undefined }}|{{ b ? m : 1 }}|{{ b ? nl : s }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::push_number(out, if props.b { props.n as f64 } else { props.f });",
      "out.push('|');",
      "fv::core::push_number(out, if props.b { 1.0f64 } else { 2.5f64 });",
      "out.push('|');",
      "if let Some(v) = if props.b { props.os.as_deref() } else { None } {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = if props.b { None } else { props.os.as_deref() } {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = if props.b { Some(&*props.s) } else { None } {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = if props.b { props.m } else { Some(1i64) } {",
      "fv::core::push_int(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = if props.b { props.nl.as_deref() } else { Some(&*props.s) } {",
      "fv::core::escape_into(out, v);",
      "}",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("holds optional strings where a branch computes one", () => {
    expect(lines("<p>{{ b ? s.trim() : undefined }}|{{ b ? os : s.trim() }}|{{ b ? q?.u : s }}|{{ b ? s : q?.u?.trim() }}|{{ b ? os : m }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "if let Some(v) = if props.b { Some(fv::strings::js_trim(&props.s)) } else { None } {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = if props.b { props.os.as_deref() } else { Some(fv::strings::js_trim(&props.s)) } {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = if props.b { props.q.as_ref().and_then(|fv_o1| fv_o1.u.as_deref()) } else { Some(&*props.s) } {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      "if let Some(v) = if props.b { Some(&*props.s) } else { props.q.as_ref().and_then(|fv_o2| fv_o2.u.as_deref()).map(fv::strings::js_trim) } {",
      "fv::core::escape_into(out, v);",
      "}",
      "out.push('|');",
      'if let Some(v) = (if props.b { props.os.as_deref().map(std::borrow::Cow::<str>::Borrowed) } else { props.m.map(|n4| std::borrow::Cow::<str>::Owned(format!("{}", fv::core::Js(n4)))) }).as_deref() {',
      "fv::core::escape_into(out, v);",
      "}",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("writes one value where both branches after a presence test are the same", () => {
    expect(lines("<p>{{ os ? 1 : 1 }}|{{ m != null ? 2 : 2 }}</p>")).toMatch(like('out.push_str("<p>1|2</p>");', true));
  });

  it("gives the branch a test known when compiling chooses, typing an empty array literal only by a typed list", () => {
    expect(lines("<p>{{ (false ? is : xs).length }}|{{ (true ? [] : s).length }}</p>")).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::push_int(out, props.xs.len() as i64);",
      'out.push_str("|0</p>");',
    ].join("\n"), true));
  });

  it("keeps collecting refusals after a test known when compiling tries the branch it leaves", () => {
    expect(refusals(PROPS, "<p>{{ (true ? [] : xs).length }}</p><p>{{ s == 1 }}</p><p>{{ d == 1 }}</p>")).toEqual(
      Array<string>(2).fill("FV0619 `==`: `==` and `!=` compare with `null` or `undefined` only; use `===`"),
    );
  });

  it("borrows a struct each branch reads from a field of a field", () => {
    const script = "interface R { w: R2 }\ninterface R2 { v: string }\ndefineProps<{ b: boolean; r: R; p: R }>();";
    expect(lines("<p>{{ (b ? r.w : p.w).v }}</p>", script)).toMatch(like([
      'out.push_str("<p>");',
      "fv::core::escape_into(out, &*if props.b { &props.r.w } else { &props.p.w }.v);",
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("borrows a record or a child's props each branch reads from a field, once", () => {
    const script = 'import C, { type Props as CProps } from "./C.vue";\ninterface R { c: CProps; ws: Record<string, string> }\ndefineProps<{ b: boolean; r: R; p: R }>();';
    const child = { "C.vue": sfc("defineProps<{ label: string }>();", "<b>{{ label }}</b>") };
    expect(lines('<C v-bind="b ? r.c : p.c" /><i v-for="(v, k) in (b ? r.ws : p.ws)">{{ k }}</i>', script, child)).toMatch(like([
      'out.push_str("<!--[-->");',
      "super::c::try_render(out, if props.b { &props.r.c } else { &props.p.c })?;",
      'out.push_str("<!--[-->");',
      "for (fv_k, _) in (if props.b { &props.r.ws } else { &props.p.ws }).iter() {",
      'out.push_str("<i>");',
      "fv::core::escape_into(out, fv_k);",
      'out.push_str("</i>");',
      "}",
      'out.push_str("<!--]--><!--]-->");',
    ].join("\n"), true));
  });

  it("types a value of `?:` by both branches where one is optional", () => {
    const script = `${PROPS}\nconst T = { x: "one", y: "two" } as const;`;
    expect(lines('<p>{{ T[(b ? "x" : (c ? "y" : undefined)) ?? "x"] }}</p>', script)).toMatch(like([
      'out.push_str("<p>");',
      'fv::core::escape_into(out, match (if props.b { Some("x") } else { if props.c.unwrap_or(false) { Some("y") } else { None } }).unwrap_or("x") { "x" => "one", _ => "two" });',
      'out.push_str("</p>");',
    ].join("\n"), true));
    expect(refusals(PROPS, '<p>{{ encodeURIComponent((b ? String(n) : os)?.slice(0, 1) ?? "") }}</p>')).toEqual([
      "FV0706 `encodeURIComponent()` with a string that may hold half of a surrogate pair (cut by `slice`, `substring`, `at`, `charAt`, `split(\"\")` and the like): JavaScript keeps the half, which can match, order or join with another where ferrovue holds U+FFFD; it throws a `URIError` on a half",
    ]);
  });

  const refused: [string, string, string][] = [
    ["`?:` of an empty array literal and a string", "<p>{{ b ? [] : s }}</p>", "FV0623 the two branches of `?:` differ in type"],
    ["`?:` of a string and an empty array literal", "<p>{{ b ? s : [] }}</p>", "FV0623 the two branches of `?:` differ in type"],
    ["`?:` of `undefined` and `null`", "<p>{{ b ? undefined : null }}</p>", "FV0623 the two branches of `?:` differ in type"],
    ["`?:` of `null` and `undefined`", "<p>{{ b ? null : undefined }}</p>", "FV0623 the two branches of `?:` differ in type"],
    ["an empty array literal a test known when compiling chooses over a number", "<p>{{ true ? [] : n }}</p>", "FV0401 `{{ }}` of a list: only strings, numbers and booleans can be interpolated"],
    [
      "`?:` of a float and an integer computed as a float, as an index",
      "<p>{{ xs[b ? f : -n] }}</p>",
      "FV0824 `[…]` reads a list's item by an integer index, a `number` that is present, and this index is a `Float`, which may hold a fraction or be `NaN`: `.at()` takes any number",
    ],
  ];
  for (const [what, template, message] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(PROPS, template)).toEqual([message]);
    });
  }
});

const BUILT_V = {
  "V.vue": sfc("export interface Sub { v: string }\nexport interface Item { label: string; sub: Sub; subs: Sub[] }\ndefineProps<{ item?: Item; sub?: Sub }>();", "<b>{{ item?.label }}{{ sub?.v }}</b>"),
};
const BUILT_SCRIPT = `import V, { type Item } from "./V.vue";
interface R2 { v: string }
interface R { t: string; k: number; m?: number; w: R2; l: string[]; rs: R2[] }
const props = defineProps<{ s: string; b: boolean; n: number; m?: number; xs: string[]; r: R; it?: Item }>();
function one(): R { return { t: props.s, k: props.n, w: { v: props.s }, l: [props.s], rs: [] }; }
function base(): Item { return { label: props.s, sub: { v: props.s }, subs: [] }; }`;
const BUILT = "(R { t: std::borrow::Cow::<str>::Borrowed(&*props.s), k: props.n, w: R2 { v: std::borrow::Cow::<str>::Borrowed(&*props.s) }, l: Vec::from([std::borrow::Cow::<str>::Borrowed(&*props.s)]), rs: Vec::new(), m: None })";
const ITEM_BUILT = "super::v::Item { label: std::borrow::Cow::<str>::Borrowed(&*props.s), sub: super::v::Sub { v: std::borrow::Cow::<str>::Borrowed(&*props.s) }, subs: Vec::new() }";

describe("values built from object literals", () => {
  it("chooses between a built value's field and a value of its type", () => {
    expect(lines("<p>{{ b ? m : one().m }}|{{ (b ? one().l : xs).length }}|{{ (b ? xs : one().l).length }}|{{ (b ? one().l : []).length }}|{{ (b ? one().l : xs.filter((x) => x)).length }}</p>", BUILT_SCRIPT, BUILT_V)).toMatch(like([
      'out.push_str("<p>");',
      `if let Some(v) = if props.b { props.m } else { ${BUILT}.m } {`,
      "fv::core::push_int(out, v);",
      "}",
      "out.push('|');",
      `fv::core::push_int(out, (if props.b { ${BUILT}.l } else { props.xs.to_vec() }).len() as i64);`,
      "out.push('|');",
      `fv::core::push_int(out, (if props.b { props.xs.to_vec() } else { ${BUILT}.l }).len() as i64);`,
      "out.push('|');",
      `fv::core::push_int(out, (if props.b { ${BUILT}.l } else { Vec::new() }).len() as i64);`,
      "out.push('|');",
      `fv::core::push_int(out, (if props.b { ${BUILT}.l } else { props.xs.iter().map(|v| std::borrow::Cow::<str>::Borrowed(&**v)).filter(|fv_x| !fv_x.is_empty()).map(|v| std::borrow::Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>() }).len() as i64);`,
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("reads the fields of a built value's fields, and chooses between built structs", () => {
    expect(lines("<p>{{ one().w.v }}|{{ (b ? one().rs : r.rs).length }}|{{ (b ? one().w : r.w).v }}</p>", BUILT_SCRIPT, BUILT_V)).toMatch(like([
      'out.push_str("<p>");',
      `fv::core::escape_into(out, &((${BUILT}.w).v));`,
      "out.push('|');",
      `fv::core::push_int(out, (if props.b { ${BUILT}.rs } else { props.r.rs.iter().cloned().collect::<Vec<_>>() }).len() as i64);`,
      "out.push('|');",
      `fv::core::escape_into(out, &((if props.b { ${BUILT}.w } else { props.r.w.clone() }).v));`,
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("chooses between a built struct of another component and an optional one, or none", () => {
    const out = render(BUILT_SCRIPT, '<V :item="b ? it : base()" /><V :item="b ? undefined : base()" /><V :sub="b ? base().sub : { v: s }" />', BUILT_V);
    expect(out).toMatch(like(`super::v::try_render(out, &super::v::Props { item: if props.b { props.it.as_ref().cloned() } else { Some(${ITEM_BUILT}) }, sub: None })?;`));
    expect(out).toMatch(like(`super::v::try_render(out, &super::v::Props { item: if props.b { None } else { Some(${ITEM_BUILT}) }, sub: None })?;`));
    expect(out).toMatch(like(`super::v::try_render(out, &super::v::Props { item: None, sub: Some(if props.b { (${ITEM_BUILT}).sub } else { super::v::Sub { v: std::borrow::Cow::<str>::Borrowed(&*props.s) } }) })?;`));
  });

  it("reads a field typed as a union of string literals through its `as_str()`, and compares its variants", () => {
    const script = 'interface R { t: string; e: "a" | "b"; o?: "x" | "y" }\nconst props = defineProps<{ s: string; o?: "x" | "y" }>();\nfunction one(): R { return { t: props.s, e: "a", o: props.o }; }';
    const built = "(R { t: std::borrow::Cow::<str>::Borrowed(&*props.s), e: RE::A, o: props.o.map(|v| match v { XO::X => RO::X, XO::Y => RO::Y }) })";
    expect(lines('<p>{{ one().e }}|{{ one().e === "a" }}|{{ one().o ?? "none" }}|{{ one().o === "y" }}</p>', script)).toMatch(like([
      'out.push_str("<p>");',
      `fv::core::escape_into(out, fv::props::Union::as_str(${built}.e));`,
      "out.push('|');",
      `out.push_str(if ${built}.e == RE::A { "true" } else { "false" });`,
      "out.push('|');",
      `fv::core::escape_into(out, ${built}.o.map(fv::props::Union::as_str).unwrap_or("none"));`,
      "out.push('|');",
      `out.push_str(if ${built}.o == Some(RO::Y) { "true" } else { "false" });`,
      'out.push_str("</p>");',
    ].join("\n"), true));
  });

  it("refuses a date read from a built value", () => {
    const script = "interface R { t: string; at: Date }\nconst props = defineProps<{ s: string; r: R }>();\nfunction one(): R { return { t: props.s, at: props.r.at }; }";
    expect(refusals(script, "<p>{{ one().at.getTime() }}</p>")).toEqual([
      "FV0636 `.at`, a `Date`, of a value built from object literals in place, which the server holds only while the expression that builds it runs: give it a `computed` of its own and read that",
    ]);
  });
});

describe("other expressions", () => {
  const refused: [string, string, string, string[]][] = [
    ["`new` of a namespace's class", PROPS, "<p>{{ new a.b.C() }}</p>", ["FV0624 `new ….C(…)` builds an object the server has no twin for: compute the value in Rust and pass it as a prop"]],
    ["`new` of a computed member", PROPS, "<p>{{ new Foo['Bar']() }}</p>", ["FV0624 `new …(…)` builds an object the server has no twin for: compute the value in Rust and pass it as a prop"]],
    ["a regular expression in a template", PROPS, "<p>{{ /a/ }}</p>", ["FV0710 a regular expression in a template, which the server does not run"]],
    [
      "a regular expression in a `computed`",
      'import { computed } from "vue";\nconst c = computed(() => /a/);',
      "<p>{{ c }}</p>",
      ["FV0710 a regular expression in a `computed`, which the server does not run (the template reads it as `c` at components/X.vue:5:17)"],
    ],
    [
      "`await` inside a `computed`",
      'import { computed } from "vue";\nconst props = defineProps<{ s: string }>();\nconst c = computed(async () => await props.s);',
      "<p>{{ c }}</p>",
      ["FV0625 `await` inside an expression is not supported in a `computed` (the template reads it as `c` at components/X.vue:6:17)"],
    ],
    ["a comma expression", PROPS, "<p>{{ (s, d) }}</p>", ["FV0625 a comma expression is not supported in a template"]],
    ["`new` of a conditional", PROPS, "<p>{{ new (b ? s : d)() }}</p>", ["FV0624 `new …(…)` builds an object the server has no twin for: compute the value in Rust and pass it as a prop"]],
    ["`new` of a logical expression", PROPS, "<p>{{ new (s || d)() }}</p>", ["FV0624 `new …(…)` builds an object the server has no twin for: compute the value in Rust and pass it as a prop"]],
  ];
  for (const [what, script, template, messages] of refused) {
    it(`refuses ${what}`, () => {
      expect(refusals(script, template)).toEqual(messages);
    });
  }

  it("says how to await a loader where a `computed` awaits", () => {
    let caught: unknown = null;
    try {
      generate(project({ "X.vue": sfc('import { computed } from "vue";\nconst props = defineProps<{ s: string }>();\nconst c = computed(async () => await props.s);', "<p>{{ c }}</p>") }), { components: "components", out: "out" });
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof GenError ? [caught.code, caught.help] : caught).toEqual(["FV0625", "await a loader as a statement of its own, `const x = await loadX(…)`, and read `x`"]);
  });

  it("reads each field of an item that may hold half of a surrogate pair as one that may", () => {
    const script = 'import { computed } from "vue";\ninterface R { t: string; u?: string; r: R2; l: string[]; n: number }\ninterface R2 { v: string }\nconst props = defineProps<{ rs: R[] }>();\nconst c = computed(() => props.rs.map((r): R => ({ t: r.t.slice(0, 1), r: r.r, l: r.l, u: r.u, n: r.n })));';
    const half = "with a string that may hold half of a surrogate pair (cut by `slice`, `substring`, `at`, `charAt`, `split(\"\")` and the like): JavaScript keeps the half, which can match, order or join with another where ferrovue holds U+FFFD";
    expect(refusals(script, "<p v-for=\"x in c\">{{ encodeURIComponent(x.t) }}|{{ encodeURIComponent(x.r.v) }}|{{ encodeURIComponent(x.l.join('')) }}|{{ encodeURIComponent(x.u ?? '') }}|{{ encodeURIComponent(String(x.n)) }}</p>")).toEqual([
      `FV0706 \`encodeURIComponent()\` ${half}; it throws a \`URIError\` on a half`,
      `FV0706 \`encodeURIComponent()\` ${half}; it throws a \`URIError\` on a half`,
      `FV0706 \`.join()\` with no literal separator ${half}`,
      `FV0706 \`encodeURIComponent()\` ${half}; it throws a \`URIError\` on a half`,
    ]);
  });
});

describe("an operand beside itself", () => {
  it("writes `-`, `/`, `===`, `&&` and `||` of one place with itself as JavaScript computes them", () => {
    const out = lines("<p>{{ n - n }}|{{ n / n }}|{{ f - f }}|{{ f / f }}|{{ s === s }}|{{ b && b }}|{{ b || b }}|{{ (n > 1) === (n > 1) }}|{{ n % n }}</p>");
    expect(out).toContain('out.push_str("<p>0|");');
    expect(out).toContain("fv::core::push_number(out, (props.n as f64).abs() / (props.n as f64).abs());");
    expect(out).toContain("fv::core::push_number(out, props.f.abs() - props.f.abs());");
    expect(out).toContain("fv::core::push_number(out, props.f.abs() / props.f.abs());");
    expect(out).toContain('out.push_str("|true|");');
    expect(out).toContain('out.push_str(if props.b { "true" } else { "false" });');
    expect(out).toContain("props.n as f64 % props.n as f64");
    expect(out).not.toMatch(/props\.(\w+)(?: as f64)? (?:-|\/|==|&&|\|\|) props\.\1\b/);
  });

  it("keeps a call that appears on both sides", () => {
    expect(lines("<p>{{ s.trim() === s.trim() }}</p>")).toContain("==");
  });

  it("keeps the stronger of two bounds of one number joined by `&&`, and gives `false` for two that cannot hold together", () => {
    const out = lines("<p>{{ n > 3 && n > 4 }}|{{ n >= 3 && n > 3 }}|{{ n > 3 && n < 2 }}|{{ n >= 2 && n < 2 }}|{{ 2 < n && n < 9 }}|{{ n <= 2 && n >= 2 }}</p>");
    expect(out).toContain("if props.n as f64 > 4.0 {");
    expect(out).toContain("if props.n as f64 > 3.0 {");
    expect(out).toContain('out.push_str("|false|false|");');
    expect(out).toContain("if 2.0 < props.n as f64 && (props.n as f64) < 9.0 {");
    expect(out).toContain("if props.n as f64 == 2.0 {");
  });

  it("joins two comparisons of the same two numbers into one", () => {
    const out = lines("<p>{{ n < f || n > f }}|{{ n <= f || f < n }}|{{ f === n || f !== n }}|{{ n < f && f < n }}|{{ n <= f && n >= f }}|{{ n === f || n < f }}</p>");
    expect(out).toContain('out.push_str(if (props.n as f64).partial_cmp(&props.f).is_some_and(std::cmp::Ordering::is_ne) { "true" } else { "false" });');
    expect(out).toContain('out.push_str(if (props.n as f64).partial_cmp(&props.f).is_some() { "true" } else { "false" });');
    expect(out).toContain('out.push_str("|true|false|");');
    expect(out).toContain('out.push_str(if props.n as f64 == props.f { "true" } else { "false" });');
    expect(out).toContain('out.push_str(if props.n as f64 <= props.f { "true" } else { "false" });');
  });

  it("writes nothing for a `v-for` over a constant range of 0 or below", () => {
    expect(lines('<p><i v-for="k in 0">{{ k }}</i><b v-for="(k, i) in -2">{{ i }}</b></p>')).toBe('out.push_str("<p><!--[--><!--]--><!--[--><!--]--></p>");');
  });
});
