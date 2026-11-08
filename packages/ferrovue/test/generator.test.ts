import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { generate } from "../src/compiler.ts";
import { GENERATED_VERSION } from "../src/rust.ts";
import { borrowsHeld } from "../src/borrows.ts";
import { CONFIG, compile, island } from "./project.ts";

describe("the generator", () => {
  it("translates a component inside its vocabulary", () => {
    const out = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ label: string }>();
</script>
<template><b :title="label">{{ label }}</b></template>`),
    );
    expect(out.get("x.rs")).toContain("pub fn render");
  });

  it.each(['<template lang="html">', '<template lang="">'])("compiles a template written in HTML: %s", (open) => {
    const out = compile(island(`<script setup lang="ts">\ndefineProps<{ tag: "b" | "i" }>();\n</script>\n${open}<component :is="tag" /></template>\n`));
    expect(out.get("x.rs")).toContain("pub fn render");
  });

  it("writes a component named after a Rust keyword to the file its raw module name reads", () => {
    const leaf = "<template><p>x</p></template>";
    const out = compile(island(leaf, { Type: leaf, Match: leaf, Self: leaf }));
    expect([...out.keys()].toSorted()).toEqual(["match.rs", "mod.rs", "self_.rs", "type.rs", "x.rs"]);
    expect(out.get("mod.rs")).toContain("pub mod r#type;");
  });

  it.each([
    [{ "My-Card": "" }, "components/My-Card.vue", "not a Rust name"],
    [{ FooBar: "", Foo_bar: "" }, "components/Foo_bar.vue", "as components/FooBar.vue's is"],
    [{ Mod: "" }, "components/Mod.vue", "`mod.rs`, which holds the generated modules"],
  ])("refuses component files whose module would not be their own: %o", (files, file, message) => {
    const leaf = "<template><p>x</p></template>";
    const project = island(leaf, Object.fromEntries(Object.keys(files).map((name) => [name, leaf])));
    expect(() => compile(project)).toThrow(expect.objectContaining({ code: "FV0007", at: { file }, message: expect.stringContaining(message) }));
  });

  it.each(["", "<style>p { color: red }</style>\n"])("refuses a component file with neither template nor script at its first line, naming it by its relative path: %j", (source) => {
    const project = island(source);
    expect(() => compile(project)).toThrow(
      expect.objectContaining({
        code: "FV0002",
        at: expect.objectContaining({ file: "components/X.vue", line: 1, column: 1 }),
        message: expect.stringMatching(/^components\/X\.vue:1:1: SyntaxError: At least one <template> or <script> is required in a single file component\. components\/X\.vue\n/),
      }),
    );
    expect(() => compile(project)).not.toThrow(new RegExp(project));
  });

  it("gives a component that needs only its props an html and island that hold them as well", () => {
    const borrowing = compile(
      island(`<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template><b>{{ label }}</b></template>`),
    ).get("x.rs")!;
    expect(borrowing).toContain("pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::html::Html<'p, Props<'a>> {");
    expect(borrowing).toContain("pub fn into_html<'a>(props: Props<'a>) -> fv::html::Html<'a, Props<'a>> {\n    fv::html::Html::markup_owned_fallible(props, render, try_render)");
    expect(borrowing).toContain("pub fn into_island<'a>(props: Props<'a>) -> fv::html::Html<'a, Props<'a>> {\n    fv::html::Html::island_owned_fallible(NAME, props, render, try_render)");
    const counting = compile(
      island(`<script setup lang="ts">
defineProps<{ count: number }>();
</script>
<template><b>{{ count }}</b></template>`),
    ).get("x.rs")!;
    expect(counting).toContain("pub fn into_html(props: Props) -> fv::html::Html<'static, Props> {");
    expect(counting).toContain("pub fn into_island(props: Props) -> fv::html::Html<'static, Props> {");
  });

  it("writes a nullable prop's None as null, and an optional one's not at all", () => {
    const out = compile(
      island(`<script setup lang="ts">
defineProps<{ gone: string | null; note?: string }>();
</script>
<template><b v-if="gone !== null">{{ gone }}</b><i v-else-if="note != null">{{ note }}</i></template>`),
    ).get("x.rs")!;
    expect(out).toContain('    pub gone: Option<Cow<\'a, str>>,');
    expect(out).toContain('    #[serde(default, skip_serializing_if = "Option::is_none")]');
    expect(out).toContain("/// Set `gone`, which is `null` otherwise.");
    expect(out).toContain("/// Props with nothing set, every optional one absent and every nullable one `null`.");
    expect(out).toContain("if let Some(fv_gone) = props.gone.as_deref() {");
    expect(out).toContain("if let Some(fv_note) = props.note.as_deref() {");
  });

  it("compiles `<component :is>` over a closed set to a match over its choices", () => {
    const out = compile(
      island(
        `<script setup lang="ts">
import Y from "./Y.vue";
import Z from "./Z.vue";
defineProps<{ kind: "y" | "z" | "rule"; tag: "b" | "i"; boxed: boolean }>();
const KINDS = { y: Y, z: Z, rule: "hr" } as const;
</script>
<template><div><component :is="KINDS[kind]" :c="null" /><component :is="tag">t</component><component :is="boxed ? Y : 'span'" /></div></template>`,
        {
          Y: `<script setup lang="ts">
defineProps<{ b?: string }>();
</script>
<template><b>{{ b }}</b></template>`,
          Z: `<script setup lang="ts">
defineProps<{ c: string | null }>();
</script>
<template><i>{{ c }}</i></template>`,
        },
      ),
    ).get("x.rs")!;
    expect(out).toContain("match props.kind {");
    expect(out).toContain("XKind::Y => {");
    expect(out).toContain("XKind::Z => {");
    expect(out).toContain("super::z::try_render(out, &super::z::Props { c: None })?;");
    expect(out).toContain("XKind::Rule => {\n            out.push_str(\"<hr>\");");
    expect(out).toContain('let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };');
    expect(out).toContain("if props.boxed {");
    expect(out.slice(out.indexOf("pub fn render"))).not.toContain("_ =>");
  });

  it("reads a prop destructured under a new name, which Vue writes as `$props['x']`, as it reads the prop", () => {
    const rendered = (script: string, names: Record<string, string>) => {
      const template = `<p :title="${names.label}" :class="{ on: ${names.on} }">{{ ${names.label} }} {{ ${names.n} + 1 }}<b v-if="${names.on}">!</b><component :is="${names.tag}">t</component><component :is="KINDS[${names.kind}]" /></p>`;
      const source = `<script setup lang="ts">
import Y from "./Y.vue";
${script}
const KINDS = { y: Y, rule: "hr" } as const;
</script>
<template>${template}</template>`;
      return compile(island(source, { Y: "<template><b>y</b></template>" })).get("x.rs")!;
    };
    const declared = 'defineProps<{ label: string; n: number; on: boolean; tag: "b" | "i"; kind: "y" | "rule" }>()';
    const plain = rendered(`${declared};`, { label: "label", n: "n", on: "on", tag: "tag", kind: "kind" });
    const renamed = rendered(`const { label: text, n: count, on: shown, tag: t, kind: k } = ${declared};`, { label: "text", n: "count", on: "shown", tag: "t", kind: "k" });
    expect(renamed).toBe(plain);
    expect(renamed).toContain('let fv_tag = match props.tag { XTag::B => "b", XTag::I => "i" };');
    expect(renamed).toContain("match props.kind {");
  });

  it("applies the default of a prop destructured under a new name", () => {
    const out = compile(
      island(`<script setup lang="ts">
const { label: text = "none", size: s = "md" } = defineProps<{ label?: string; size?: "sm" | "md" }>();
</script>
<template><component :is="s === 'sm' ? 'small' : 'span'">{{ text }}</component></template>`),
    ).get("x.rs")!;
    expect(out).toContain('fv::core::escape_into(out, props.label.as_deref().unwrap_or("none"));');
    expect(out).toContain("props.size.unwrap_or(XSize::Md)");
  });

  it("matches every variant in `<component :is>`, however the choices group", () => {
    const out = compile(
      island(
        `<script setup lang="ts">
import Y from "./Y.vue";
import Z from "./Z.vue";
defineProps<{ k: "a" | "b" | "c" }>();
const PICK = { a: Y, b: Z, c: Y } as const;
const TAG = { a: "em", b: "strong", c: "em" } as const;
</script>
<template><div><component :is="PICK[k]" /><component :is="TAG[k]">t</component></div></template>`,
        { Y: "<template><span>y</span></template>", Z: "<template><span>z</span></template>" },
      ),
    ).get("x.rs")!;
    expect(out).toContain("XK::B => {\n            super::z::try_render(");
    expect(out).toContain("XK::A | XK::C => {\n            super::y::try_render(");
    expect(out).toContain('match props.k { XK::B => "strong", XK::A | XK::C => "em" }');
  });

  it("reserves a loop's markup per item and the text the props hold", () => {
    const out = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ label: string; items: string[] }>();
</script>
<template><ul :title="label"><li v-for="i in items">{{ i }}</li></ul></template>`),
    ).get("x.rs")!;
    const reserve = /out\.reserve\([^;]*;/.exec(out)![0];
    expect(reserve).toMatch(/\d+ \* props\.items\.len\(\)/);
    expect(reserve).toContain("props.label.len()");
    expect(reserve).toContain("props.items.iter().map(|v| v.len()).sum::<usize>()");
  });

  it("writes the reserve one term a line, so that a change of the template's markup changes only its constant", () => {
    const x = (title: string) =>
      compile(
        island(`<script setup lang="ts">
const props = defineProps<{ label: string; items: string[] }>();
</script>
<template><ul :title="label"><li v-for="i in items">{{ i }}</li></ul><h2>${title}</h2></template>`),
      ).get("x.rs")!;
    const before = x("Items").split("\n");
    const after = x("Item").split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]));
    expect(changed).toHaveLength(2);
    expect(changed[0]![0]).toMatch(/^ {8}\d+$/);
    expect(changed[1]![0]).toContain("<h2>Items</h2>");
    expect(x("Items")).toMatch(/ {4}out\.reserve\(\n {8}\d+\n( {8}\+ [^\n]+\n)+ {4}\);\n/);
  });

  it("adds the reserve's numbers into its constant, and writes a single term on one line", () => {
    const out = compile(island('<script setup lang="ts">\ndefineProps<{ tag: "b" | "i" }>();\n</script>\n<template><component :is="tag">x</component></template>')).get("x.rs")!;
    expect(out).toMatch(/ {4}out\.reserve\(\d+\);\n/);
  });

  it("writes a child's props one field a line where they do not fit on one", () => {
    const out = compile(
      island(
        `<script setup lang="ts">
import Kid from "./Kid.vue";
import P from "./P.vue";
defineProps<{ first: string; second: string; third: string }>();
</script>
<template><Kid :first="first" :second="second" :third="third" /><P a="x" b="y" /></template>`,
        {
          P: '<script setup lang="ts">\ndefineProps<{ a: string; b: string }>();\n</script>\n<template><i>{{ a }}{{ b }}</i></template>',
          Kid: '<script setup lang="ts">\ndefineProps<{ first: string; second: string; third: string }>();\n</script>\n<template><i>{{ first }}{{ second }}{{ third }}</i></template>',
        },
      ),
    ).get("x.rs")!;
    expect(out).toContain(
      [
        "    super::kid::try_render(out, &super::kid::Props {",
        "        first: Cow::Borrowed(&*props.first),",
        "        second: Cow::Borrowed(&*props.second),",
        "        third: Cow::Borrowed(&*props.third),",
        "    })?;",
      ].join("\n"),
    );
    expect(out).toContain('    super::p::try_render(out, &super::p::Props { a: Cow::Borrowed("x"), b: Cow::Borrowed("y") })?;');
  });

  it("reserves the text of structs whose fields all have a known length without binding them", () => {
    const out = compile(
      island(`<script setup lang="ts">
interface P { a: "x" | "yy"; b: "q" | "zzz" }
interface S { p?: P; a: "x" | "yy" }
defineProps<{ one?: P; many: P[]; named: Record<string, P>; nested: S[] }>();
</script>
<template><div>{{ one?.a }}<i v-for="p in many">{{ p.b }}</i><b v-for="p in named">{{ p.a }}</b><s v-for="s in nested">{{ s.p?.b }}</s></div></template>`),
    ).get("x.rs")!;
    const reserve = /out\.reserve\([^;]*;/.exec(out)![0];
    expect(reserve).toContain("props.one.as_ref().map_or(0, |_| 5)");
    expect(reserve).toContain("5 * props.many.len()");
    expect(reserve).toContain("props.named.iter().map(|(k, _)| k.len() + 5).sum::<usize>()");
    expect(reserve).toContain("props.nested.iter().map(|v| v.p.as_ref().map_or(0, |_| 5) + 2).sum::<usize>()");
  });

  it("derives `Default` for a struct whose `new` takes no arguments, and only for one", () => {
    const optional = compile(
      island(`<script setup lang="ts">
defineProps<{ note?: string }>();
</script>
<template><p>{{ note }}</p></template>`),
    ).get("x.rs")!;
    expect(optional).toContain("#[derive(Debug, Clone, Default, serde::Serialize)]\n#[cfg_attr(test, derive(serde::Deserialize))]\npub struct Props<'a> {");
    expect(optional).toContain("pub fn new() -> Self {");
    const none = compile(
      island(`<script setup lang="ts">
const greeting = "hi";
</script>
<template><p>{{ greeting }}</p></template>`),
    ).get("x.rs")!;
    expect(none).toContain("#[derive(Debug, Clone, Default, serde::Serialize)]\n#[cfg_attr(test, derive(serde::Deserialize))]\npub struct Props {");
    const required = compile(
      island(`<script setup lang="ts">
defineProps<{ label: string; note?: string }>();
</script>
<template><p>{{ label }}{{ note }}</p></template>`),
    ).get("x.rs")!;
    expect(required).toContain("#[derive(Debug, Clone, serde::Serialize)]\n#[cfg_attr(test, derive(serde::Deserialize))]\npub struct Props<'a> {");
  });

  describe("builders", () => {
    const withShared = () => {
      const root = island(`<script setup lang="ts">
import type { Row } from "../types/rows";
defineProps<{ label: string; rows: Row[]; note?: string }>();
</script>
<template><p>{{ label }}{{ note }}<i v-for="r in rows" :key="r.id">{{ r.id }}</i></p></template>`);
      mkdirSync(join(root, "types"));
      writeFileSync(join(root, "types", "rows.ts"), "export interface Row { id: number; hint?: string }\n");
      return root;
    };
    const fields = "    #[serde(default, skip_serializing_if = \"Option::is_none\")]\n    pub note: Option<Cow<'a, str>>,\n}\n";

    it("gives every props struct and shared type `new` and a setter per optional field by default", () => {
      const out = compile(withShared());
      expect(out.get("x.rs")).toContain(`${fields}\nimpl<'a> Props<'a> {\n    /// Props with its required fields, every optional one absent.\n    pub fn new(`);
      expect(out.get("x.rs")).toContain("pub fn note(mut self, note: impl Into<Cow<'a, str>>) -> Self {");
      expect(out.get("types.rs")).toContain("impl<'a> Row<'a> {\n    /// Row with its required fields, every optional one absent.\n    pub fn new(id: i64) -> Self {");
      expect(generate(withShared(), { ...CONFIG, builders: true })).toEqual(out);
    });

    it("leaves out every `impl` with `new` and the setters with `\"builders\": false`, keeping the fields and derives", () => {
      const root = withShared();
      const on = compile(root);
      const off = generate(root, { ...CONFIG, builders: false });
      for (const [name, text] of off) {
        expect(text, name).not.toMatch(/^impl/m);
        expect(text, name).not.toContain("pub fn new(");
      }
      expect(off.get("x.rs")).toContain(`#[derive(Debug, Clone, serde::Serialize)]\n#[cfg_attr(test, derive(serde::Deserialize))]\npub struct Props<'a> {`);
      expect(off.get("x.rs")).toContain(`${fields}\n/// Write the component's server render into \`out\`.`);
      expect(off.get("types.rs")).toContain("    pub hint: Option<Cow<'a, str>>,\n}\n");
      const render = (text: string) => text.slice(text.indexOf("/// Write the component's server render"));
      expect(render(off.get("x.rs")!)).toBe(render(on.get("x.rs")!));
      expect(off.get("mod.rs")).toContain("// `into_` forms and `NAME`) and an app calls only what it needs.");
    });

    it("keeps `Default` on a struct with no required field with `\"builders\": false`", () => {
      const out = generate(
        island(`<script setup lang="ts">
defineProps<{ note?: string }>();
</script>
<template><p>{{ note }}</p></template>`),
        { ...CONFIG, builders: false },
      ).get("x.rs")!;
      expect(out).toContain("#[derive(Debug, Clone, Default, serde::Serialize)]\n#[cfg_attr(test, derive(serde::Deserialize))]\npub struct Props<'a> {");
      expect(out).not.toContain("impl");
    });

    it("refuses a `builders` that is not a boolean", () => {
      const root = island(`<template><p /></template>`);
      for (const builders of ["false", 0, null]) {
        writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ ...CONFIG, builders }));
        expect(() => loadConfig(root)).toThrow(/`builders` in ferrovue\.config\.json is `true` or `false`/);
      }
      writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ ...CONFIG, builders: false }));
      expect(loadConfig(root).builders).toBe(false);
    });

    it("is what the Rust test of struct literals compiles", () => {
      const root = join(import.meta.dirname, "../../../crates/ferrovue/tests/literal_props");
      const config = loadConfig(root);
      expect(config.builders).toBe(false);
      const out = generate(root, config);
      expect([...out.keys()].toSorted()).toEqual(readdirSync(join(root, config.out)).toSorted());
      for (const [name, text] of out) expect(readFileSync(join(root, config.out, name), "utf8"), name).toBe(text);
    });
  });

  it("is what the Rust test of values outside a closed union compiles", () => {
    const root = join(import.meta.dirname, "../../../crates/ferrovue/tests/closed_unions");
    const config = loadConfig(root);
    const out = generate(root, config);
    expect([...out.keys()].toSorted()).toEqual(readdirSync(join(root, config.out)).toSorted());
    for (const [name, text] of out) expect(readFileSync(join(root, config.out, name), "utf8"), name).toBe(text);
  });

  describe("the version of generated code", () => {
    it("is checked by mod.rs against the versions the ferrovue crate supports, the newest of which it is", () => {
      const out = compile(island(`<template><p /></template>`));
      expect(out.get("mod.rs")).toContain(`\n#![allow(dead_code)]\n\nferrovue::__compat!(${GENERATED_VERSION});\n\npub mod x;`);
      const compat = readFileSync(join(import.meta.dirname, "../../../crates/ferrovue/src/compat.rs"), "utf8");
      const supported = [...compat.matchAll(/^    \((\d+)\) => \{\};$/gm)].map((m) => Number(m[1]));
      expect(Math.max(...supported)).toBe(GENERATED_VERSION);
      expect(compat).toContain(`supports version${supported.length > 1 ? "s" : ""} ${supported.length > 1 ? `${Math.min(...supported)} to ` : ""}${GENERATED_VERSION}: `);
    });
  });

  describe("ferrovue::html::Sanitised", () => {
    it("is what the Rust test of a sanitised `v-html` compiles", () => {
      const root = join(import.meta.dirname, "../../../crates/ferrovue/tests/sanitised");
      const config = loadConfig(root);
      expect(config.trustedHtml).toBe("ferrovue::html::Sanitised");
      const out = generate(root, config);
      expect([...out.keys()].toSorted()).toEqual(readdirSync(join(root, config.out)).toSorted());
      for (const [name, text] of out) expect(readFileSync(join(root, config.out, name), "utf8"), name).toBe(text);
    });
  });

  describe("chrono::DateTime<chrono::Utc>", () => {
    it("is what the Rust test of chrono Date props compiles, from the conformance suite's components", () => {
      const root = join(import.meta.dirname, "../../../crates/ferrovue/tests/chrono_dates");
      const config = loadConfig(root);
      expect(config.dateType).toBe("chrono::DateTime<chrono::Utc>");
      for (const name of readdirSync(join(root, config.components))) {
        expect(readFileSync(join(root, config.components, name), "utf8"), name).toBe(readFileSync(join(root, "../conformance/components", name), "utf8"));
      }
      const out = generate(root, config);
      expect([...out.keys()].toSorted()).toEqual(readdirSync(join(root, config.out)).toSorted());
      for (const [name, text] of out) expect(readFileSync(join(root, config.out, name), "utf8"), name).toBe(text);
    });
  });

  describe("a dateType of the project's own", () => {
    it("is what the Rust test of clipped time values compiles, from the conformance suite's component", () => {
      const root = join(import.meta.dirname, "../../../crates/ferrovue/tests/own_dates");
      const config = loadConfig(root);
      expect(config.dateType).toBe("crate::Loose");
      for (const name of readdirSync(join(root, config.components))) {
        expect(readFileSync(join(root, config.components, name), "utf8"), name).toBe(readFileSync(join(root, "../conformance/components", name), "utf8"));
      }
      const out = generate(root, config);
      expect([...out.keys()].toSorted()).toEqual(readdirSync(join(root, config.out)).toSorted());
      for (const [name, text] of out) expect(readFileSync(join(root, config.out, name), "utf8"), name).toBe(text);
    });
  });

  describe("unions of the project's own", () => {
    it("is what the Rust test of the application's own enums compiles, from the conformance suite's components", () => {
      const root = join(import.meta.dirname, "../../../crates/ferrovue/tests/own_unions");
      const config = loadConfig(root);
      expect(config.unions).toEqual({ Align: "crate::domain::Align", Hue: "crate::domain::Hue", Level: "crate::domain::Level", Shade: "crate::domain::Shade" });
      for (const name of readdirSync(join(root, config.components))) {
        expect(readFileSync(join(root, config.components, name), "utf8"), name).toBe(readFileSync(join(root, "../conformance/components", name), "utf8"));
      }
      expect(readFileSync(join(root, "types/unions.ts"), "utf8")).toBe(readFileSync(join(root, "../conformance/types/unions.ts"), "utf8"));
      const out = generate(root, config);
      expect([...out.keys()].toSorted()).toEqual(readdirSync(join(root, config.out)).toSorted());
      for (const [name, text] of out) expect(readFileSync(join(root, config.out, name), "utf8"), name).toBe(text);
    });
  });

  describe("a list of strings a setup local holds", () => {
    const held = (setup: string, template: string): string =>
      compile(
        island(`<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ words: string[]; text: string; a?: string; b: string; posts: { tags: string[] }[] }>();
${setup}
</script>
<template>${template}</template>`),
      ).get("x.rs")!;

    it("keeps borrowed the strings it takes from the props, a literal or an earlier local", () => {
      const out = held(
        `const long = computed(() => props.words.filter((w) => w.length > 2));
const words = computed(() => props.text.split(" "));
const both = computed(() => (props.a ? [props.a, props.b] : []));
const sorted = computed(() => [...long.value].sort());
const later = computed(() => long.value.filter((w) => w !== "x"));`,
        `<p v-for="w in long" :key="w">{{ w }}</p><i v-for="w in words" :key="w">{{ w }}</i><b v-for="w in both" :key="w">{{ w }}</b><s v-for="w in sorted" :key="w">{{ w }}</s><u v-for="w in later" :key="w">{{ w }}</u>`,
      );
      expect(out).toContain("let s_long = props.words.iter().map(|v| Cow::<str>::Borrowed(&**v)).filter(|fv_w| fv::strings::js_length(fv_w) > 2).collect::<Vec<_>>();");
      expect(out).toContain('let s_words = fv::strings::js_split(&props.text, " ").into_iter().collect::<Vec<_>>();');
      expect(out).toContain("[fv_a, &*props.b].iter().map(|v| Cow::<str>::Borrowed(&**v)).collect::<Vec<_>>()");
      expect(out).toMatch(/let s_later = s_long\.iter\(\)\.map\(\|v\| Cow::<str>::Borrowed\(&\*\*v\)\)\.filter\([^;]*\)\.collect::<Vec<_>>\(\);/);
      expect(out).not.toContain("into_owned");
    });

    it("owns the strings it takes from a value its own expression makes", () => {
      const out = held(
        `const tags = computed(() => props.posts.flatMap((p) => p.tags));
const first = computed(() => { const all = props.words.filter((w) => w.length > 1); return all.slice(0, 2); });`,
        `<p v-for="t in tags" :key="t">{{ t }}</p><i v-for="w in first" :key="w">{{ w }}</i>`,
      );
      expect(out).toContain("fv_p.tags.iter().map(|v| Cow::<str>::Borrowed(&**v)).map(|v| Cow::<str>::Owned(v.into_owned())).collect::<Vec<_>>()");
      expect(out).toMatch(/let s_first = \{ let fv_all = props\.words[^;]*\.collect::<Vec<_>>\(\); [^;]*fv_all\.iter\(\)[^;]*\.map\(\|v\| Cow::<str>::Owned\(v\.into_owned\(\)\)\)\.collect::<Vec<_>>\(\) \};/);
    });

    it("reads a chain as borrowing only what outlives the list", () => {
      for (const chain of [
        "props.words.iter()",
        "props.user.tags.iter().map(|v| Cow::Borrowed(&**v)).filter(|w| !w.is_empty()).rev()",
        "s_kept.iter().map(|v| Cow::Borrowed(&**v)).chain(props.more.iter().map(|v| Cow::Borrowed(&**v)))",
        '["x", &*props.b].iter().map(|v| Cow::Borrowed(&**v))',
        "[fv_a, &props.b].iter()",
        'fv::strings::js_split(&props.text, " ").into_iter()',
        "fv::strings::js_split_limit(&*s_line, \",\", 2.0f64).into_iter().take(1)",
        "fv::strings::js_slice_items(props.xs.iter(), -1, Some(3usize)).skip(1)",
        "fv::strings::js_sorted(props.xs.iter(), |a, b| fv::strings::js_cmp(a, b))",
        "fv::strings::js_slice_items(props.xs.iter(), None, 2i64)",
        "props.pair.10.iter()",
        "props.xs.iter().filter_map(|v| Some(v)).take_while(|v| true).skip_while(|v| false)",
        '["x", 12, 1.25, Some(12), Some(1.25), Some(1)].iter()',
        "fv::strings::js_x().into_iter()",
        "fv::strings::js_x(&props.a, ).into_iter()",
        "fv::strings::js_x(props.xs.iter().filter(|v| g(v, 1)), 1)",
        'fv::strings::js_x([&*props.a, "b"].iter(), 1)',
      ]) {
        expect(borrowsHeld(chain), chain).toBe(true);
      }
      for (const chain of [
        "fv_all.iter()",
        "props.words.iter().map(|v| Cow::Borrowed(&**v)).collect::<Vec<_>>().into_iter()",
        "props.words.iter().chain(fv_rest.iter())",
        "props.words.iter().map(|v| v.borrowed()).zip(props.b.iter())",
        "props.words.into_iter()",
        "props.words",
        "props.words.iter",
        "props.words.iter().map(",
        "[fv_a, fv_b].iter()",
        "[fv_a, &*props.b].into_iter()",
        "[fv_a, &*props.b",
        'fv::strings::js_split(&fv_w, " ").into_iter()',
        "fv::strings::js_split(&props.text, fv_sep).into_iter()",
        "fv::strings::js_split(&props.text, \"a\" ).into_iter()x",
        "fv::strings::js_slice_items(fv_xs.iter(), 1.0f64, None)",
        "fv::strings::js_slice_items(props.xs.iter(), fv_n, None)",
        "fv::strings::js_slice_items()",
        "fv::strings::js_slice_items(props.xs.iter(), 1.0f64",
        "fv::core::js_split(&props.text, \" \").into_iter()",
        "s_.iter()",
        "props.x.iter() ",
        "&props.words.iter()",
        "props.x.iter()x.map(|v| v)",
        "props.w[0..20].rev()",
        '["x"]1234567.rev()',
        "x.rev()",
        "xfv::strings::js_x().into_iter()",
        "[.rev()",
        '["x", fv_a.len()].iter()',
        '["x", gfv_a].iter()',
        '["x", props.a&].iter()',
        '["x", &props.a.len()].iter()',
        '["x", y].iter()',
        '["x", "a"x].iter()',
        '["x", 1x].iter()',
      ]) {
        expect(borrowsHeld(chain), chain).toBe(false);
      }
    });
  });

  describe("strings, computed lists and dictionaries", () => {
    it("counts a string's code units, and orders strings by them, through the runtime", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ a: string; b: string }>();
</script>
<template><i :title="a.slice(1, -1)">{{ a.padStart(4, "0") }}{{ a < b }}</i></template>`),
      ).get("x.rs")!;
      expect(out).toContain("fv::strings::js_slice(&props.a, 1.0f64, Some(-1.0f64))");
      expect(out).toContain("fv::strings::js_pad_start(&props.a, 4.0f64, \"0\")");
      expect(out).toContain("fv::strings::js_cmp(&props.a, &props.b).is_lt()");
    });

    it("keeps a dictionary as a `ferrovue::props::Record` and walks it in place", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ counts: Record<string, number>; labels: { [key: string]: string } }>();
</script>
<template><ul><li v-for="(n, k) in counts" :title="k">{{ n }}</li><li v-for="t in labels">{{ t }}</li></ul></template>`),
      ).get("x.rs")!;
      expect(out).toContain("pub counts: ferrovue::props::Record<'a, i64>,");
      expect(out).toContain("pub labels: ferrovue::props::Record<'a, Cow<'a, str>>,");
      expect(out).toContain("for (fv_k, fv_n_ref) in props.counts.iter() {");
      expect(out).toContain("for (_, fv_t_ref) in props.labels.iter() {");
    });

    it("takes Boolean as a list method's function, and keeps the present items of optional ones", () => {
      const out = compile(
        island(`<script setup lang="ts">
interface Row { n: number }
const props = defineProps<{ tags: (string | null)[]; rows: (Row | null)[]; words: string[]; name: string; title?: string }>();
</script>
<template><i>{{ tags.filter(Boolean).join() }}{{ rows.filter(Boolean).length }}{{ words.some(Boolean) }}{{ [name, title, null].filter(Boolean).join(" ") }}{{ Boolean(title) }}</i></template>`),
      ).get("x.rs")!;
      expect(out).toContain("props.tags.iter().filter_map(|v| v.as_deref()).map(Cow::<str>::Borrowed).filter(|fv_item| !fv_item.is_empty())");
      expect(out).toContain("props.rows.iter().filter_map(|v| v.as_ref()).count()");
      expect(out).toContain(".any(|fv_item_2| !fv_item_2.is_empty())");
      expect(out).toContain("[Some(&*props.name), props.title.as_deref()].into_iter().flatten()");
      expect(out).toContain("props.title.as_deref().is_some_and(|v| !v.is_empty())");
    });

    it("refuses a local named Boolean as it refuses any function passed by name", () => {
      const project = island(`<script setup lang="ts">
const props = defineProps<{ words: string[] }>();
const Boolean = (w: string) => w.length > 1;
</script>
<template><i>{{ words.filter(Boolean).length }}</i></template>`);
      expect(() => compile(project)).toThrow(expect.objectContaining({ code: "FV0805" }));
    });

    it("chains array methods as iterators, binding only the parameters the body reads", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ tags: string[]; nums: number[] }>();
</script>
<template><i>{{ tags.filter((t, i) => i > 0).map((t) => t.trim()).join(", ") }}{{ nums.some((n) => true) }}</i></template>`),
      ).get("x.rs")!;
      expect(out).toContain(".enumerate().filter(|fv_entry| { let fv_i = fv_entry.0 as i64; fv_i as f64 > 0.0 }).map(|(_, v)| v).map(|fv_t| ");
      expect(out).toContain(".any(|_| true)");
      expect(out).not.toContain("collect::<Vec<_>>().len()");
    });
  });

  describe("empty array literals", () => {
    const tree = (setup: string, template = `<i v-for="x in a">{{ x.label }}</i>`) =>
      compile(
        island(`<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
interface Item { id: string; children: Props[]; tags?: string[] }
export interface Props { label: string; flag: boolean; others: Props[]; item?: Item }
const props = defineProps<Props>();
${setup}
</script>
<template>${template}</template>`),
      ).get("x.rs")!;

    it.each([
      ["seeds a ref", "const a = shallowRef(props.item ? props.item.children : []);"],
      ["seeds a ref from a typed constant", "const none: Props[] = [];\nconst a = shallowRef(props.item ? props.item.children : none);"],
      ["seeds a ref from `as Props[]`", "const a = shallowRef(props.item ? props.item.children : ([] as Props[]));"],
      ["seeds a ref from `satisfies Props[]`", "const a = ref(props.item ? props.item.children : ([] satisfies Props[]));"],
      ["seeds a ref given its type", "const a = ref<Props[]>(props.item ? props.item.children : []);"],
      ["seeds a constant given its type", "const a: Props[] = props.item ? props.item.children : [];"],
      ["is a computed", "const a = computed(() => (props.item ? props.item.children : []));"],
    ])("takes its element type from the other branch of `?:` where it %s, borrowing the prop's list", (_, setup) => {
      const out = tree(setup);
      expect(out).toMatch(/let s_a = if let Some\(fv_item\) = props\.item\.as_ref\(\) \{ &fv_item\.children\[\.\.\] \} else \{ (?:&\[\]|s_none|<&\[Props<'_>\]>::default\(\)) \};/);
      expect(out).toContain("for fv_x in s_a.iter() {");
      expect(out).not.toContain(".collect::<Vec<_>>()");
    });

    it("walks a `?:` between a list and an empty one in the template", () => {
      const out = tree("", `<i v-for="x in (flag ? others : [])">{{ x.label }}</i><b>{{ (item ? item.children : []).length }}</b>`);
      expect(out).toContain("for fv_x in (if props.flag { &props.others[..] } else { &[] }).iter() {");
      expect(out).toMatch(/\(if let Some\(fv_item\) = props\.item\.as_ref\(\) \{ &fv_item\.children\[\.\.\] \} else \{ &\[\] \}\)\.len\(\) as i64/);
    });

    it("types the empty array literal a `?:` with a constant test chooses by the branch it leaves", () => {
      const out = tree("", `<i v-for="x in (false ? others : [])">{{ x.label }}</i><b>{{ (true ? [] : item?.tags ?? []).length }}</b>`);
      expect(out).toContain("for fv_x in <&[Props<'_>]>::default().iter() {");
      expect(out).toContain("<&[Cow<str>]>::default().len() as i64");
    });

    it("borrows both lists of a `?:` between two", () => {
      const out = tree("", `<i v-for="x in (flag ? others : item ? item.children : [])">{{ x.label }}</i>`);
      expect(out).toMatch(/if props\.flag \{ &props\.others\[\.\.\] \} else \{ if let Some\(fv_item\) = props\.item\.as_ref\(\) \{ &fv_item\.children\[\.\.\] \} else \{ &\[\] \} \}/);
    });

    it("falls back to an empty list, or another list, with `??` after `?.`", () => {
      const out = tree("const a = computed(() => props.item?.children ?? []);", `<i v-for="x in a">{{ x.label }}</i>{{ (item?.tags ?? []).join() }}{{ (item?.children ?? others).length }}`);
      expect(out).toMatch(/let s_a = props\.item\.as_ref\(\)\.map\(\|(fv_item)\| &\1\.children\)\.map\(\|v\| &v\[\.\.\]\)\.unwrap_or\(&\[\]\);/);
      expect(out).toMatch(/props\.item\.as_ref\(\)\.and_then\(\|(fv_item_2)\| \1\.tags\.as_ref\(\)\)\.map\(\|v\| &v\[\.\.\]\)\.unwrap_or\(&\[\]\)/);
      expect(out).toMatch(/props\.item\.as_ref\(\)\.map\(\|(fv_item_3)\| &\1\.children\)\.map\(\|v\| &v\[\.\.\]\)\.unwrap_or\(&props\.others\[\.\.\]\)\.len\(\)/);
    });

    it("collects a computed list chosen against an empty one", () => {
      const out = tree("const a = computed(() => (props.flag ? props.others.map((o) => o.label) : []));", `<i>{{ a.join() }}</i>`);
      expect(out).toMatch(/let s_a = if props\.flag \{ props\.others\.iter\(\)\.map\(.*\.collect::<Vec<_>>\(\) \} else \{ Vec::new\(\) \};/);
    });

    it("reads an object field through `?.` by reference", () => {
      const out = compile(
        island(`<script setup lang="ts">
interface Inner { n: number }
interface Outer { inner: Inner }
defineProps<{ outer?: Outer }>();
</script>
<template><i>{{ outer?.inner?.n }}</i></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/props\.outer\.as_ref\(\)\.map\(\|(fv_outer)\| &\1\.inner\)\.map\(\|(fv_inner)\| \2\.n\)/);
    });

    it.each([
      ["a value `as` a type the server holds it as", "const a = computed(() => props.label as string);", "<i>{{ a }}</i>"],
      ["a number `as` another kind of number", "const a = computed(() => props.others.length as number);", "<i>{{ a }}</i>"],
    ])("accepts %s", (_, setup, template) => {
      expect(tree(setup, template)).toContain("pub fn render");
    });

    it.each([
      ["a string `as` a number", "const a = computed(() => props.label as number);", /`as` states a number of a string/],
      ["an empty array literal `as` a string", "const a = computed(() => [] as string);", /`as` gives an empty array literal a string/],
    ])("refuses %s, which the server would hold as it is", (_, setup, message) => {
      expect(() => tree(setup, "<i>{{ a }}</i>")).toThrow(expect.objectContaining({ code: "FV0628", message: expect.stringMatching(message) }));
    });

    it("leaves a `?:` between two empty array literals untyped", () => {
      expect(() => tree("", `<i v-for="x in (flag ? [] : [])">{{ x }}</i>`)).toThrow(expect.objectContaining({ code: "FV0819" }));
    });
  });
});
