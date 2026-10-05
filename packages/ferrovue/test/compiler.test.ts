import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenError, generate, loadConfig } from "../src/compiler.ts";
import { type Code, ERRORS } from "../src/errors.ts";

const roots: string[] = [];

const CONFIG = { components: "components", out: "out" };

const compile = (project: string) => generate(project, CONFIG);

function island(source: string, others: Record<string, string> = {}): string {
  const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
  roots.push(made);
  const dir = join(made, "components");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "X.vue"), source);
  for (const [name, text] of Object.entries(others)) writeFileSync(join(dir, `${name}.vue`), text);
  return made;
}

afterEach(() => {
  for (const made of roots.splice(0)) rmSync(made, { recursive: true, force: true });
});

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
    expect(borrowing).toContain("pub fn html<'p, 'a>(props: &'p Props<'a>) -> fv::Html<'p, Props<'a>> {");
    expect(borrowing).toContain("pub fn into_html<'a>(props: Props<'a>) -> fv::Html<'a, Props<'a>> {\n    fv::Html::markup_owned(props, render)");
    expect(borrowing).toContain("pub fn into_island<'a>(props: Props<'a>) -> fv::Html<'a, Props<'a>> {\n    fv::Html::island_owned(NAME, props, render)");
    const counting = compile(
      island(`<script setup lang="ts">
defineProps<{ count: number }>();
</script>
<template><b>{{ count }}</b></template>`),
    ).get("x.rs")!;
    expect(counting).toContain("pub fn into_html(props: Props) -> fv::Html<'static, Props> {");
    expect(counting).toContain("pub fn into_island(props: Props) -> fv::Html<'static, Props> {");
  });

  it("writes a nullable prop's None as null, and an optional one's not at all", () => {
    const out = compile(
      island(`<script setup lang="ts">
defineProps<{ gone: string | null; note?: string }>();
</script>
<template><b v-if="gone !== null">{{ gone }}</b><i v-else-if="note != null">{{ note }}</i></template>`),
    ).get("x.rs")!;
    expect(out).toContain('    #[serde(rename = "gone")]\n    pub gone: Option<Cow<\'a, str>>,');
    expect(out).toContain('    #[serde(rename = "note", default, skip_serializing_if = "Option::is_none")]');
    expect(out).toContain("/// Set `gone`, which is `null` otherwise.");
    expect(out).toContain("/// Props with nothing set, every optional one absent and every nullable one `null`.");
    expect(out).toContain("if let Some(n1) = props.gone.as_deref() {");
    expect(out).toContain("if let Some(n2) = props.note.as_deref() {");
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
    expect(out).toContain("match &*props.kind {");
    expect(out).toContain('"y" => {');
    expect(out).toContain('"z" => {');
    expect(out).toContain("super::z::render(out, &super::z::Props { c: None });");
    expect(out).toContain("_ => {\n            out.push_str(\"<hr>\");");
    expect(out).toContain('let fv_tag1 = match &*props.tag { "b" => "b", _ => "i" };');
    expect(out).toContain("if props.boxed {");
  });

  it("reserves a loop's markup per item and the text the props hold", () => {
    const out = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ label: string; items: string[] }>();
</script>
<template><ul :title="label"><li v-for="i in items">{{ i }}</li></ul></template>`),
    ).get("x.rs")!;
    const reserve = out.split("\n").find((l) => l.includes("out.reserve("))!;
    expect(reserve).toMatch(/\d+ \* props\.items\.len\(\)/);
    expect(reserve).toContain("props.label.len()");
    expect(reserve).toContain("props.items.iter().map(|v| v.len()).sum::<usize>()");
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
    const fields = "    #[serde(rename = \"note\", default, skip_serializing_if = \"Option::is_none\")]\n    pub note: Option<Cow<'a, str>>,\n}\n";

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

  describe("ferrovue::Sanitised", () => {
    it("is what the Rust test of a sanitised `v-html` compiles", () => {
      const root = join(import.meta.dirname, "../../../crates/ferrovue/tests/sanitised");
      const config = loadConfig(root);
      expect(config.trustedHtml).toBe("ferrovue::Sanitised");
      const out = generate(root, config);
      expect([...out.keys()].toSorted()).toEqual(readdirSync(join(root, config.out)).toSorted());
      for (const [name, text] of out) expect(readFileSync(join(root, config.out, name), "utf8"), name).toBe(text);
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
      expect(out).toContain("fv::js_slice(&props.a, 1.0f64, Some(-1.0f64))");
      expect(out).toContain("fv::js_pad_start(&props.a, 4.0f64, \"0\")");
      expect(out).toContain("fv::js_cmp(&props.a, &props.b).is_lt()");
    });

    it("keeps a dictionary as a `ferrovue::Record` and walks it in place", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ counts: Record<string, number>; labels: { [key: string]: string } }>();
</script>
<template><ul><li v-for="(n, k) in counts" :title="k">{{ n }}</li><li v-for="t in labels">{{ t }}</li></ul></template>`),
      ).get("x.rs")!;
      expect(out).toContain("pub counts: ferrovue::Record<'a, i64>,");
      expect(out).toContain("pub labels: ferrovue::Record<'a, Cow<'a, str>>,");
      expect(out).toContain("for (k, n_ref) in props.counts.iter() {");
      expect(out).toContain("for (_, t_ref) in props.labels.iter() {");
    });

    it("chains array methods as iterators, binding only the parameters the body reads", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ tags: string[]; nums: number[] }>();
</script>
<template><i>{{ tags.filter((t, i) => i > 0).map((t) => t.trim()).join(", ") }}{{ nums.some((n) => true) }}</i></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/\.enumerate\(\)\.filter\(\|fv_e\d+\| \{ let fv_i\d+ = fv_e\d+\.0 as i64; /);
      expect(out).toContain(".any(|_| true)");
      expect(out).not.toContain("collect::<Vec<_>>().len()");
    });
  });

  describe("child components", () => {
    const child = `<script setup lang="ts">
export interface Props { label: string; count?: number }
defineProps<Props>();
</script>
<template><b>{{ label }}</b></template>`;

    it("renders a child given no props", () => {
      const bare = `<script setup lang="ts">
defineProps<{ note?: string }>();
</script>
<template><i>{{ note }}</i></template>`;
      const parent = `<script setup lang="ts">
import Bare from "./Bare.vue";
defineProps<{ a: string }>();
</script>
<template><div><Bare /><span>{{ a }}</span></div></template>`;
      expect(compile(island(parent, { Bare: bare })).get("x.rs")).toContain("super::bare::render(out, &super::bare::Props { note: None });");
    });

    it("writes an exported `interface Props` once, as the props struct", () => {
      const out = compile(island(child)).get("x.rs")!;
      expect(out.match(/pub struct Props/g)).toHaveLength(1);
    });

    it("hands a v-bind of the child's own Props straight to it", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
import type { Props as ChildProps } from "./Child.vue";
const props = defineProps<{ inner?: ChildProps }>();
</script>
<template><div><Child v-if="inner" v-bind="inner" /></div></template>`;
      const out = compile(island(parent, { Child: child })).get("x.rs")!;
      expect(out).toContain("pub inner: Option<super::child::Props<'a>>,");
      expect(out).toMatch(/if let Some\((n\d+)\) = props\.inner\.as_ref\(\) \{\s*super::child::render\(out, \1\);/);
    });

    it("borrows each item of a list of the child's Props", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
import type { Props as ChildProps } from "./Child.vue";
const props = defineProps<{ items: ChildProps[] }>();
</script>
<template><ul><Child v-for="item in items" v-bind="item" /></ul></template>`;
      const out = compile(island(parent, { Child: child })).get("x.rs")!;
      expect(out).toContain("let item = item_ref;");
      expect(out).toContain("super::child::render(out, item);");
      expect(out).not.toContain("use std::borrow::Cow;");
    });

    it("passes a key the child does not declare as an attribute, which falls through to its root", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ a: string }>();
</script>
<template><div><Child :label="a" :colour="a" @click="() => {}" /></div></template>`;
      const out = compile(island(parent, { Child: child }));
      expect(out.get("x.rs")).toContain(`&fv::Attrs::new(&[("colour", fv::Attr::str(&props.a))], "")`);
      expect(out.get("child.rs")).toContain("pub fn render_scoped(out: &mut String, props: &Props<'_>, fv_attrs: &fv::Attrs<'_>)");
      expect(out.get("child.rs")).toContain(`fv::passed_attrs_into(out, fv_attrs.list(), "");`);
    });

    it("gives a kebab-case key to the camelCase prop it names, as Vue does", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" :co-unt="2" /></div></template>`;
      const counted = child.replace("count?: number", "coUnt?: number");
      const out = compile(island(parent, { Child: counted }));
      expect(out.get("x.rs")).toContain("co_unt: Some(2i64)");
      expect(out.get("child.rs")).not.toContain("fv::Attrs");
    });

    it("leaves a component no parent passes attributes as it was", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" /></div></template>`;
      const out = compile(island(parent, { Child: child }));
      expect(out.get("child.rs")).not.toContain("render_scoped");
      expect(out.get("x.rs")).toContain("super::child::render(out, ");
    });

    it("refuses an attribute that would reach a prop of the component a root passes it on to", () => {
      const wrapper = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><Child label="x" /></template>`;
      const parent = `<script setup lang="ts">
import W from "./W.vue";
</script>
<template><div><W count="2" /></div></template>`;
      expect(() => compile(island(parent, { W: wrapper, Child: child }))).toThrow(/`count`, an attribute W may be passed, would reach Child as its prop `count`/);
    });

    it("refuses `$attrs` in a component that is the root of one that may be handed scope ids", () => {
      const inner = `<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>
<template><p><b v-bind="$attrs">x</b></p></template>`;
      const wrapper = `<script setup lang="ts">
import Inner from "./Inner.vue";
</script>
<template><Inner /></template>`;
      const parent = `<script setup lang="ts">
import W from "./W.vue";
</script>
<template><div><W /></div></template>
<style scoped>div { color: red; }</style>`;
      expect(() => compile(island(parent, { W: wrapper, Inner: inner }))).toThrow(/`\$attrs` in Inner, the root of a component that may be handed scope ids/);
    });

    it("refuses attributes passed to a root `<Transition>` around a `v-if`, which Vue's server drops", () => {
      const fade = `<script setup lang="ts">
defineProps<{ on: boolean }>();
</script>
<template><Transition><b v-if="on">x</b></Transition></template>`;
      const parent = `<script setup lang="ts">
import Fade from "./Fade.vue";
</script>
<template><div><Fade :on="true" class="c" /></div></template>`;
      expect(() => compile(island(parent, { Fade: fade }))).toThrow(/Fade\.vue:4:11: a root `<Transition>` or `<KeepAlive>` around a `v-if` in Fade/);
    });

    it("refuses an attribute named by a number, which a JavaScript object lists first", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" v-bind="{ 7: 'seven' }" /></div></template>`;
      expect(() => compile(island(parent, { Child: child }))).toThrow(/an attribute named `7`/);
    });

    it("refuses a `$route.query` value as an attribute that falls through", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
</script>
<template><div><Child label="x" :title="$route.query.q" /></div></template>`;
      const project = island(parent, { Child: child });
      writeFileSync(join(project, "routes.json"), '["/"]');
      expect(() => generate(project, { ...CONFIG, routes: "routes.json" })).toThrow(/an attribute that may fall through is a string, a number or a boolean/);
    });

    it("refuses an attribute passed on to a `<RouterLink>` that would be its prop", () => {
      const link = `<script setup lang="ts">
defineProps<{}>();
</script>
<template><RouterLink to="/">go</RouterLink></template>`;
      const parent = `<script setup lang="ts">
import L from "./L.vue";
</script>
<template><div><L replace /></div></template>`;
      const project = island(parent, { L: link });
      writeFileSync(join(project, "routes.json"), '["/"]');
      expect(() => generate(project, { ...CONFIG, routes: "routes.json" })).toThrow(/`replace`, an attribute L may be passed, would reach its `<RouterLink>` as a prop/);
    });

    it("refuses a child left without a prop it requires", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ a: string }>();
</script>
<template><div><Child :count="1" /></div></template>`;
      expect(() => compile(island(parent, { Child: child }))).toThrow(/Child requires `label`/);
    });

    it("hands a child an array literal, and an empty one as an empty list", () => {
      const lister = `<script setup lang="ts">
export interface Props { items: string[] }
defineProps<Props>();
</script>
<template><ul><li v-for="i in items">{{ i }}</li></ul></template>`;
      const parent = `<script setup lang="ts">
import Lister from "./Lister.vue";
defineProps<{ a: string }>();
</script>
<template><div><Lister :items="[]" /><Lister :items="['a', a]" /></div></template>`;
      const out = compile(island(parent, { Lister: lister })).get("x.rs")!;
      expect(out).toContain("items: Vec::new()");
      expect(out).toContain('items: ["a", &*props.a].iter().map(|v| std::borrow::Cow::Borrowed(&**v)).collect()');
    });

    it("refuses an object of the parent's own type where the child declares its own", () => {
      const card = `<script setup lang="ts">
interface User { name: string }
defineProps<{ user: User }>();
</script>
<template><b>{{ user.name }}</b></template>`;
      const parent = `<script setup lang="ts">
import Card from "./Card.vue";
interface User { name: string }
defineProps<{ user: User }>();
</script>
<template><div><Card :user="user" /></div></template>`;
      expect(() => compile(island(parent, { Card: card }))).toThrow(/share a type only when both import it from one `.ts` file/);
    });

    it("sends a Teleport's content to the page's Teleports, and hands them down", () => {
      const modal = `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><Teleport to="#modals"><p>{{ a }}</p></Teleport></div></template>`;
      const out = compile(island(modal)).get("x.rs")!;
      expect(out).toContain('fv::teleport_into(out, fv_teleports, "#modals", false, &|out: &mut String| {');
      expect(out).toContain("fv_teleports: &fv::Teleports");
    });

    it("pushes useHead and useSeoMeta onto the page's Head, before the template renders, and hands it down", () => {
      const headed = `<script setup lang="ts">
import { useHead as head, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string }>();
const entry = head({ title: () => props.a });
useSeoMeta({ ogTitle: props.a, titleTemplate: "%s!", title: "t" });
</script>
<template><p>{{ a }}</p></template>`;
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
defineProps<{ a: string }>();
</script>
<template><div><Child :a="a" /></div></template>`;
      const files = compile(island(parent, { Child: headed }));
      const out = files.get("child.rs")!;
      expect(out).toContain('fv_head.push(fv::HeadValue::object([("title", fv::HeadValue::str(&props.a))]));');
      expect(out).toContain('fv_head.push_seo_meta(fv::HeadValue::object([("title", fv::HeadValue::str("t")), ("titleTemplate", fv::HeadValue::str("%s!"))]), vec![("property", "og:title", fv::HeadValue::str(&props.a))]);');
      expect(out.indexOf("fv_head.push(")).toBeLessThan(out.indexOf('out.push_str("<p>")'));
      expect(files.get("x.rs")).toContain("fv_head: &fv::Head");
    });

    it("renders Suspense's default content in place", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><Suspense><p>{{ a }}</p></Suspense></div></template>`),
      ).get("x.rs")!;
      expect(out).toContain('out.push_str("<div><p>");');
    });

    it("refuses a v-bind of anything but the child's own Props", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
interface Other { label: string }
const props = defineProps<{ other: Other }>();
</script>
<template><div><Child v-bind="other" /></div></template>`;
      expect(() => compile(island(parent, { Child: child }))).toThrow(/`v-bind` of Child's own `Props`/);
    });
  });

  describe("narrowing", () => {
    it("binds an optional object a v-if found present, and reads it inside the branch", () => {
      const out = compile(
        island(`<script setup lang="ts">
interface Embed { provider: string }
const props = defineProps<{ embed?: Embed }>();
</script>
<template><p v-if="embed">{{ embed.provider }}</p></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/if let Some\((n\d+)\) = props\.embed\.as_ref\(\) \{[\s\S]*fv::escape_into\(out, &\1\.provider\)/);
    });

    it("keeps JavaScript's truthiness for an optional string: empty is not taken", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ note?: string }>();
</script>
<template><p v-if="note">{{ note }}</p></template>`),
      ).get("x.rs")!;
      expect(out).toContain(".filter(|v| !v.is_empty())");
    });

    it("counts a list with .length and joins strings with +", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ items: string[]; name: string }>();
</script>
<template><ul v-if="items.length" :title="'list of ' + name"><li v-for="i in items">{{ i }}</li></ul></template>`),
      ).get("x.rs")!;
      expect(out).toContain("props.items.len() as i64");
      expect(out).toContain('format!("list of {}", props.name)');
    });

    it("adds two numbers, and refuses + between a number and anything but a string", () => {
      const sum = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ n: number; m: number }>();
</script>
<template><b :title="n + m"></b></template>`),
    ).get("x.rs")!;
    expect(sum).toContain("(props.n as f64 + props.m as f64) as i64");
    expect(() =>
      compile(
        island(`<script setup lang="ts">
const props = defineProps<{ n: number; on: boolean }>();
</script>
<template><b :title="n + on"></b></template>`),
      ),
    ).toThrow(/`\+` joins a string to a string or a number, or adds two numbers/);
    });
  });

  describe("conditions", () => {
    it("negates the whole truthiness test, never the number inside it", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ items: string[]; note?: string }>();
</script>
<template><p v-if="!items.length">none</p><p v-if="!items.length || note">either</p></template>`),
      ).get("x.rs")!;
      expect(out).toContain("if props.items.len() as i64 == 0 {");
      expect(out).toContain("if props.items.len() as i64 == 0 || props.note.as_deref().is_some_and(|v| !v.is_empty()) {");
      expect(out).not.toMatch(/!props\.items/);
    });
  });

  describe("v-html", () => {
    const trusted = `<script setup lang="ts">
import type { TrustedHtml } from "ferrovue/types";
const props = defineProps<{ body: TrustedHtml; extra?: TrustedHtml }>();
</script>
<template><div class="md" v-html="body"></div><aside v-html="extra"></aside></template>`;

    it("writes a TrustedHtml prop raw, as the configured Rust type", () => {
      const out = generate(island(trusted), { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" }).get("x.rs")!;
      expect(out).toContain("pub body: crate::sanitize::SafeHtml,");
      expect(out).toContain("pub extra: Option<crate::sanitize::SafeHtml>,");
      expect(out).toContain("fv::trusted_into(out, &props.body);");
      expect(out).toMatch(/if let Some\(html\) = props\.extra\.as_ref\(\) \{\s*fv::trusted_into\(out, html\);/);
    });

    it("refuses a TrustedHtml prop when the configuration names no Rust type for it", () => {
      expect(() => compile(island(trusted))).toThrow(/`trustedHtml` in ferrovue\.config\.json/);
    });

    it("refuses v-html on a plain string", () => {
      const source = `<script setup lang="ts">
const props = defineProps<{ body: string }>();
</script>
<template><div v-html="body"></div></template>`;
      expect(() => generate(island(source), { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" })).toThrow(
        /`v-html` renders only a `TrustedHtml` prop/,
      );
    });

    it("trusts only the TrustedHtml that ferrovue/types exports", () => {
      const source = `<script setup lang="ts">
import type { TrustedHtml } from "./somewhere-else";
const props = defineProps<{ body: TrustedHtml }>();
</script>
<template><div v-html="body"></div></template>`;
      expect(() => generate(island(source), { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" })).toThrow(
        /unsupported prop type `TrustedHtml`/,
      );
    });

    const placed = (template: string, others: Record<string, string> = {}) => `<script setup lang="ts">
import type { InlineHtml as Inline, TrustedHtml } from "ferrovue/types";
${Object.keys(others)
  .map((name) => `import ${name} from "./${name}.vue";\n`)
  .join("")}const props = defineProps<{ body: TrustedHtml; short: Inline; maybe?: Inline; items: string[] }>();
</script>
<template>${template}</template>`;
    const SAFE = { ...CONFIG, trustedHtml: "crate::sanitize::SafeHtml" };
    const placing = (template: string, others: Record<string, string> = {}) => () => generate(island(placed(template, others), others), SAFE);

    it("writes an InlineHtml prop as ferrovue::InlineHtml, inside a <p>, with no trustedHtml configured", () => {
      const source = `<script setup lang="ts">
import type { InlineHtml } from "ferrovue/types";
defineProps<{ note: InlineHtml; extra?: InlineHtml }>();
</script>
<template><p v-html="note"></p><p><b v-html="extra"></b></p></template>`;
      const out = compile(island(source)).get("x.rs")!;
      expect(out).toContain("pub note: ferrovue::InlineHtml,");
      expect(out).toContain("pub extra: Option<ferrovue::InlineHtml>,");
      expect(out).toContain("fv::trusted_into(out, &props.note);");
      expect(out).not.toContain("<'a>");
    });

    it("makes every TrustedHtml prop inline when trustedHtml names ferrovue::InlineHtml", () => {
      const out = generate(island(placed(`<p v-html="body"></p>`)), { ...CONFIG, trustedHtml: "ferrovue::InlineHtml" }).get("x.rs")!;
      expect(out).toContain("pub body: ferrovue::InlineHtml,");
    });

    it.each([
      ["table", `<table v-html="body"></table>`],
      ["thead", `<table><thead v-html="body"></thead></table>`],
      ["tbody", `<table><tbody v-html="body"></tbody></table>`],
      ["tfoot", `<table><tfoot v-html="body"></tfoot></table>`],
      ["tr", `<table><tr v-html="body"></tr></table>`],
      ["colgroup", `<table><colgroup v-html="body"></colgroup></table>`],
    ])("refuses v-html on a <%s>, whose markup the parser moves out of the table", (tag, template) => {
      expect(placing(template)).toThrow(
        expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`^components/X\\.vue:5:\\d+: \`v-html\` on \`<${tag}>\`.*a \`<td>\`, \`<th>\` or \`<caption>\``)) }),
      );
    });

    it.each([
      ["select", `<select v-html="body"></select>`],
      ["optgroup", `<select><optgroup v-html="short"></optgroup></select>`],
    ])("refuses v-html on a <%s>, whose tags the parser drops", (tag, template) => {
      expect(placing(template)).toThrow(expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`\`<${tag}>\`.*write the \`<option>\`s in the template`)) }));
    });

    it.each([
      ["svg", `<svg v-html="body"></svg>`],
      ["g", `<svg><g v-html="short"></g></svg>`],
      ["text", `<svg><text v-html="body"></text></svg>`],
    ])("refuses v-html on an SVG <%s>", (tag, template) => {
      expect(placing(template)).toThrow(expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`SVG \`<${tag}>\`.*inside a \`<foreignObject>\``)) }));
    });

    it.each([
      ["math", `<math v-html="body"></math>`],
      ["mrow", `<math><mrow v-html="body"></mrow></math>`],
      ["annotation-xml", `<math><annotation-xml v-html="body"></annotation-xml></math>`],
      ["annotation-xml", `<math><annotation-xml encoding="application/mathml+xml" v-html="body"></annotation-xml></math>`],
      ["annotation-xml", `<math><annotation-xml :encoding="'text/html'" v-html="body"></annotation-xml></math>`],
    ])("refuses v-html on a MathML <%s> that holds no HTML", (tag, template) => {
      expect(placing(template)).toThrow(expect.objectContaining({ code: "FV1512", message: expect.stringMatching(new RegExp(`MathML \`<${tag}>\`.*on an \`<mtext>\``)) }));
    });

    it.each([
      `<table><tr><td v-html="body"></td><th v-html="body"></th></tr><caption v-html="body"></caption></table>`,
      `<svg><foreignObject v-html="body"></foreignObject><desc v-html="body"></desc><title v-html="body"></title><foreignObject><div v-html="body"></div></foreignObject></svg>`,
      `<math><mi v-html="body"></mi><mo v-html="body"></mo><mn v-html="body"></mn><ms v-html="body"></ms><mtext v-html="body"></mtext></math>`,
      `<math><annotation-xml encoding="text/html" v-html="body"></annotation-xml><annotation-xml encoding="Application/XHTML+XML" v-html="body"></annotation-xml></math>`,
      `<select><option v-html="body"></option></select><span v-html="body"></span><div><span v-html="maybe"></span></div>`,
    ])("accepts v-html where the browser keeps any markup: %s", (template) => {
      expect(placing(template)).not.toThrow();
    });

    it.each([
      [`<p v-html="body"></p>`, "on"],
      [`<div>\n<p><b><span v-html="body" /></b></p></div>`, "inside"],
      [`<p><template v-if="items.length"><span v-for="i in items" :key="i" v-html="body"></span></template></p>`, "inside"],
      [`<p><slot><i v-html="body"></i></slot></p>`, "inside"],
    ])("refuses v-html of HTML that may hold blocks in a <p>: %s", (template, where) => {
      expect(placing(template)).toThrow(
        expect.objectContaining({
          code: "FV1513",
          message: expect.stringMatching(new RegExp(`^components/X\\.vue:\\d+:\\d+: \`v-html\` ${where} a \`<p>\` .*type the prop \`InlineHtml\` from \`ferrovue/types\``)),
        }),
      );
    });

    it("points at the v-html it refuses", () => {
      expect(placing(`<div><p v-html="short"></p>\n  <p><span v-html="body"></span></p></div>`)).toThrow(/^components\/X\.vue:6:19: `v-html` inside a `<p>`/);
    });

    it.each([
      `<p v-html="short"></p><p><b v-html="maybe"></b></p>`,
      `<p><button><span v-html="body"></span></button><object><span v-html="body"></span></object></p>`,
      `<p><svg><foreignObject><div v-html="body"></div></foreignObject></svg></p>`,
      `<p><template><span v-html="body"></span></template></p>`,
      `<p><Y><span v-html="body"></span></Y></p>`,
    ])("accepts v-html in a <p> where the parser keeps its blocks to themselves, or the HTML is inline: %s", (template) => {
      expect(placing(template, template.includes("<Y>") ? { Y: "<template><div><slot /></div></template>" } : {})).not.toThrow();
    });
  });

  describe("slots", () => {
    const frame = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><div><slot name="head">{{ title }}</slot><slot /></div></template>`;

    it("gives a component with <slot> a Slots argument, one optional field per slot", () => {
      const out = compile(island(frame)).get("x.rs")!;
      expect(out).toContain("pub head: Option<fv::Slot<'s>>,");
      expect(out).toContain("pub default: Option<fv::Slot<'s>>,");
      expect(out).toContain("pub fn render(out: &mut String, props: &Props<'_>, fv_slots: Slots<'_>)");
      expect(out).not.toContain("pub fn island");
      expect(out).not.toContain("pub fn into_");
    });

    it("decides at generation time when slot content always holds something", () => {
      const parent = `<script setup lang="ts">
import Frame from "./Frame.vue";
const props = defineProps<{ on: boolean }>();
</script>
<template><Frame title="t"><template #head><b v-if="on">h</b></template><i>body</i></Frame></template>`;
      const out = compile(island(parent, { Frame: frame })).get("x.rs")!;
      expect(out).toContain("head: Some(fv::Slot::markup(&|out: &mut String| -> bool {");
      expect(out).toContain("default: Some(fv::Slot::new(&|out: &mut String| {");
    });

    it("asks of a push whose values decide whether it is only comments what it wrote", () => {
      const parent = (body: string) => `<script setup lang="ts">
import Frame from "./Frame.vue";
const props = defineProps<{ note?: string; tags: string[] }>();
</script>
<template><Frame title="t">${body}</Frame></template>`;
      const markers = compile(island(parent(`{{ note }}<i v-for="t in tags">{{ t }}</i>`), { Frame: frame })).get("x.rs")!;
      expect(markers).toContain("let fv_chunk = out.len();");
      expect(markers).toContain("filled |= !fv::is_comment(&out[fv_chunk..]);");
      const text = compile(island(parent(`{{ note }} of {{ tags.length }}<i v-for="t in tags">{{ t }}</i>`), { Frame: frame })).get("x.rs")!;
      expect(text).not.toContain("fv::is_comment");
      expect(text).toContain("default: Some(fv::Slot::new(&|out: &mut String| {");
    });

    it("reads $slots.x as whether the parent gave that slot content", () => {
      const source = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><div><aside v-if="$slots.side"><slot name="side" /></aside></div></template>`;
      expect(compile(island(source)).get("x.rs")).toContain("if fv_slots.side.is_some() {");
      const unknown = source.replace("$slots.side", "$slots.other");
      expect(() => compile(island(unknown))).toThrow(/`\$slots\.other` names a slot this template does not render/);
    });

    const lister = `<script setup lang="ts">
defineProps<{ items: string[] }>();
</script>
<template><ul><li v-for="(it, i) in items"><slot name="item" :text="it" :index="i">{{ it }}</slot></li></ul></template>`;

    it("gives a scoped slot a props struct, and its content the props through a closure", () => {
      const out = compile(island(lister)).get("x.rs")!;
      expect(out).toContain("pub struct ItemSlotProps<'v> {\n    pub text: &'v str,\n    pub index: i64,\n}");
      expect(out).toContain("pub type ItemSlot<'s> = dyn for<'v> Fn(&mut String, &ItemSlotProps<'v>) -> bool + 's;");
      expect(out).toContain("pub item: Option<&'s ItemSlot<'s>>,");
      expect(out).toContain("fv::scoped_slot_into(out, fv_slots.item, &ItemSlotProps { text: it, index: i }, Some(");
    });

    it("binds the props a parent destructures, whatever order it generates in", () => {
      const parent = `<script setup lang="ts">
import Lister from "./Lister.vue";
defineProps<{ items: string[] }>();
</script>
<template><Lister :items="items"><template #item="{ text, index: n }"><b :data-n="n">{{ text }}</b></template></Lister></template>`;
      const out = compile(island(lister, { A: parent, Lister: lister })).get("a.rs")!;
      expect(out).toMatch(/item: Some\(&\|out: &mut String, (fv_sp\d+): &super::lister::ItemSlotProps<'_>\| -> bool \{/);
      expect(out).toMatch(/fv::escape_into\(out, fv_sp\d+\.text\);/);
    });

    it("refuses outlets of one slot that pass different props", () => {
      const twice = `<script setup lang="ts">
defineProps<{ a: string; n: number }>();
</script>
<template><div><slot :v="a" /><slot :v="n" /></div></template>`;
      expect(() => compile(island(twice))).toThrow(/every `<slot>` passes the same props/);
    });

    it("refuses an array literal as a slot prop", () => {
      const literal = `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><slot :list="[a]" /></div></template>`;
      expect(() => compile(island(literal))).toThrow(/a slot prop is not an array literal/);
    });

    it("refuses slot props a slot does not pass, and defaults for them", () => {
      const plain = `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><slot /></div></template>`;
      const taker = `<script setup lang="ts">
import Plain from "./Plain.vue";
defineProps<{ a: string }>();
</script>
<template><Plain a="x" v-slot="{ v }">{{ v }}</Plain></template>`;
      expect(() => compile(island(taker, { Plain: plain }))).toThrow(/`<slot>` in Plain passes no props/);
      const defaulted = `<script setup lang="ts">
import Lister from "./Lister.vue";
defineProps<{ items: string[] }>();
</script>
<template><Lister :items="items"><template #item="{ text = 'x' }">{{ text }}</template></Lister></template>`;
      expect(() => compile(island(defaulted, { Lister: lister }))).toThrow(/without defaults/);
    });

    it("refuses content for a slot the child does not have", () => {
      const parent = `<script setup lang="ts">
import Frame from "./Frame.vue";
defineProps<{ on: boolean }>();
</script>
<template><Frame title="t"><template #foot>f</template></Frame></template>`;
      expect(() => compile(island(parent, { Frame: frame }))).toThrow(/Frame has no slot `foot`/);
    });
  });

  describe("scoped styles", () => {
    const leaf = `<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template><b>{{ label }}</b></template>
<style scoped>b { color: red }</style>`;
    const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

    it("hashes the path and source from Vite's root, as `@vitejs/plugin-vue` does", () => {
      const root = island(leaf);
      expect(compile(root).get("x.rs")).toContain(`<b data-v-${hash(`components/X.vue${leaf}`)}>`);
      expect(generate(root, { ...CONFIG, scopeId: "filepath" }).get("x.rs")).toContain(`<b data-v-${hash("components/X.vue")}>`);
      const nested = join(root, "app");
      mkdirSync(nested);
      expect(generate(root, { ...CONFIG, scopeId: "filepath", viteRoot: ".." }).get("x.rs")).toContain(`<b data-v-${hash(`${basename(root)}/components/X.vue`)}>`);
      writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify({ ...CONFIG, scopeId: "dev" }));
      expect(() => loadConfig(root)).toThrow(/`scopeId` in ferrovue\.config\.json is "filepath" or "filepath-source"/);
    });

    it("hands a child's root the parent's id, and what a parent passes on to its root", () => {
      const middle = `<script setup lang="ts">
import Leaf from "./Leaf.vue";
</script>
<template><Leaf label="x" /></template>
<style scoped>b { color: blue }</style>`;
      const top = `<script setup lang="ts">
import Middle from "./Middle.vue";
</script>
<template><section><Middle /></section></template>
<style scoped>section { color: green }</style>`;
      const out = generate(island(top, { Middle: middle, Leaf: leaf }), { ...CONFIG, scopeId: "filepath" });
      expect(out.get("leaf.rs")).toContain("pub fn render_scoped(out: &mut String, props: &Props<'_>, fv_attrs: &str)");
      expect(out.get("leaf.rs")).toContain('render_scoped(out, props, "");');
      expect(out.get("leaf.rs")).toContain("out.push_str(fv_attrs);");
      expect(out.get("x.rs")).toContain(`super::middle::render_scoped(out, &super::middle::Props {  }, " data-v-${hash("components/X.vue")}");`);
      expect(out.get("middle.rs")).toContain(`super::leaf::render_scoped(out, &super::leaf::Props { label: std::borrow::Cow::Borrowed("x") }, &fv::scope_attrs(fv_attrs, "data-v-${hash("components/Middle.vue")}", ""));`);
    });

    it("gives slot content the slot scope id of a component with `:slotted()` styles", () => {
      const card = `<script setup lang="ts">
defineSlots<{ default(): unknown }>();
</script>
<template><div><slot /></div></template>
<style scoped>:slotted(p) { margin: 0 }</style>`;
      const parent = `<script setup lang="ts">
import Card from "./Card.vue";
</script>
<template><Card><p>x</p></Card></template>`;
      const out = generate(island(parent, { Card: card }), { ...CONFIG, scopeId: "filepath" });
      expect(out.get("card.rs")).toContain(`fv::slot_into_slotted(out, fv_slots.default, "data-v-${hash("components/Card.vue")}-s", None);`);
      expect(out.get("x.rs")).toContain("default: Some(fv::Slot::slotted(&|out: &mut String, fv_sid1: &str| -> bool {");
    });
  });

  describe("the router", () => {
    const withRoutes = (root: string) => {
      writeFileSync(join(root, "routes.json"), JSON.stringify(["/", "/users/:id"]));
      return generate(root, { ...CONFIG, routes: "routes.json" });
    };
    const nav = `<script setup lang="ts">
export interface Props { href: string }
defineProps<Props>();
</script>
<template><nav><RouterLink :to="href" class="tab">go</RouterLink></nav></template>`;

    it("refuses a query value that may be null, which vue-router writes as the key alone", () => {
      const source = `<script setup lang="ts">
defineProps<{ q: string | null }>();
</script>
<template><RouterLink :to="{ path: '/', query: { q } }">go</RouterLink></template>`;
      expect(() => withRoutes(island(source))).toThrow(/X\.vue:4:\d+: a query value that may be `null`, which vue-router writes as the key alone/);
    });

    it("refuses comparing a query value with null, which vue-router gives a key with no value", () => {
      const source = `<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>
<template><p v-if="route.query.q === null">bare</p></template>`;
      expect(() => withRoutes(island(source))).toThrow(/X\.vue:5:\d+: `===` between a query value and `null`/);
    });

    it("resolves a RouterLink against the route, and hands the route down to it", () => {
      const parent = `<script setup lang="ts">
import Nav from "./Nav.vue";
defineProps<{ href: string }>();
</script>
<template><header><Nav :href="href" /></header></template>`;
      const out = withRoutes(island(parent, { Nav: nav }));
      expect(out.get("nav.rs")).toContain("let fv_link = fv_route.link(&props.href);");
      expect(out.get("x.rs")).toContain("pub fn render(out: &mut String, props: &Props<'_>, fv_route: &fv::Route<'_>)");
      expect(out.get("x.rs")).toContain(", fv_route);");
      expect(out.get("route_table.rs")).toContain('"/users/:id",');
    });

    it("refuses a RouterLink when the configuration names no routes", () => {
      expect(() => compile(island(nav))).toThrow(/`routes` in ferrovue\.config\.json/);
    });

    it("gives a RouterLink scope ids as vue-router's virtual nodes take them, and refuses what they take otherwise", () => {
      const scoped = (template: string) => `<script setup lang="ts">
defineProps<{ href: string }>();
</script>
<template>${template}</template>
<style scoped>a { color: red }</style>`;
      const out = withRoutes(island(scoped(`<nav><RouterLink :to="href">go</RouterLink></nav>`))).get("x.rs")!;
      expect(out).toMatch(/out\.push_str\("\\" class=\\""\);\n.*\n\s+out\.push_str\("\\" data-v-[0-9a-f]{8}>go<\/a>"\);/);
      expect(() => withRoutes(island(scoped(`<main><RouterView /></main>`)))).toThrow(/`<RouterView>` in a component with `<style scoped>`/);
      expect(() => withRoutes(island(scoped(`<nav><RouterLink :to="href"><slot /></RouterLink></nav>`)))).toThrow(/X\.vue:4:33: a `<slot>` inside a `<RouterLink>` that takes scope ids/);
      const card = `<script setup lang="ts">
defineSlots<{ default(): unknown }>();
</script>
<template><div><slot /></div></template>
<style scoped>:slotted(a) { margin: 0 }</style>`;
      const parent = `<script setup lang="ts">
import Card from "./Card.vue";
</script>
<template><Card><RouterLink to="/"><b>go</b></RouterLink></Card></template>`;
      expect(() => withRoutes(island(parent, { Card: card }))).toThrow(/an element inside a `<RouterLink>` in slot content given a slot scope id/);
    });

    it("refuses a custom RouterLink, which renders a scoped slot", () => {
      const custom = `<script setup lang="ts">
defineProps<{ href: string }>();
</script>
<template><RouterLink :to="href" custom>go</RouterLink></template>`;
      expect(() => withRoutes(island(custom))).toThrow(/`custom` on `<RouterLink>`/);
    });

    const named = (root: string, router: Record<string, unknown> = {}) => {
      writeFileSync(join(root, "routes.json"), JSON.stringify([{ path: "/", name: "home" }, { path: "/users/:id", name: "user" }]));
      return generate(root, { ...CONFIG, router: { routes: "routes.json", ...router } });
    };
    const linkTo = (to: string) => `<script setup lang="ts">
defineProps<{ id: string }>();
</script>
<template><RouterLink :to="${to}">go</RouterLink></template>`;

    it("resolves a named route with its parameters, and writes the base and class names configured", () => {
      const out = named(island(linkTo("{ name: 'user', params: { id } }")), { base: "/app/", linkActiveClass: "on", linkExactActiveClass: "here" });
      expect(out.get("x.rs")).toContain('fv_route.link_named("user", &[("id", &*props.id)], "", "")');
      expect(out.get("x.rs")).toContain('if fv_link.active { "on" } else { "" }, if fv_link.exact { "here" } else { "" }');
      expect(out.get("route_table.rs")).toContain('pub const BASE: &str = "/app/";');
      expect(out.get("route_table.rs")).toContain('ferrovue::RouteDef { path: "/users/:id", name: Some("user"), view: true, children: &[] },');
    });

    it("writes nested routes as a tree, and asks a nested route for its parent's parameters too", () => {
      const root = island(linkTo("{ name: 'post', params: { id, post: id } }"));
      writeFileSync(
        join(root, "routes.json"),
        JSON.stringify([{ path: "/users/:id", name: "user", children: [{ path: "", name: "user-home" }, { path: "posts/:post", name: "post" }] }]),
      );
      const out = generate(root, { ...CONFIG, routes: "routes.json" });
      expect(out.get("route_table.rs")).toContain('ferrovue::RouteDef { path: "posts/:post", name: Some("post"), view: true, children: &[] },');
      expect(out.get("route_table.rs")).toContain('"/users/:id/posts/:post",');
      expect(out.get("x.rs")).toContain('fv_route.link_named("post", &[("id", &*props.id), ("post", &*props.id)], "", "")');
      const missing = island(linkTo("{ name: 'post', params: { post: id } }"));
      writeFileSync(join(missing, "routes.json"), JSON.stringify([{ path: "/users/:id", children: [{ path: "posts/:post", name: "post" }] }]));
      expect(() => generate(missing, { ...CONFIG, routes: "routes.json" })).toThrow(/route `post` needs `id`/);
    });

    it("refuses a route name no route has", () => {
      expect(() => named(island(linkTo("{ name: 'nobody' }")))).toThrow(/no route is called `nobody`/);
    });

    const withPages = (root: string, pages: Record<string, string>) => {
      for (const [file, text] of Object.entries(pages)) {
        mkdirSync(join(root, "pages", file, ".."), { recursive: true });
        writeFileSync(join(root, "pages", file), text);
      }
      return generate(root, { ...CONFIG, router: { routes: { pages: "pages" } } });
    };
    const view = "<template><p>page</p></template>";

    it("builds the routes from a folder of pages, and compiles each page as a component named by its path", () => {
      const out = withPages(island(linkTo("{ name: '/books/[id]', params: { id } }")), {
        "index.vue": view,
        "books/[id].vue": `<script setup lang="ts">
import { useRoute } from "vue-router";
const route = useRoute();
</script>
<template><h1>{{ route.params.id }}</h1></template>`,
        "[...path].vue": view,
      });
      const table = out.get("route_table.rs")!;
      expect(table).toContain("// @generated by ferrovue from pages. Do not edit: change the pages and run");
      expect(table).toContain('ferrovue::RouteDef { path: "/", name: Some("/"), view: true, children: &[] },');
      expect(table).toContain('ferrovue::RouteDef { path: "/books", name: None, view: false, children: &[\n        ferrovue::RouteDef { path: ":id", name: Some("/books/[id]"), view: true, children: &[] },');
      expect(table).toContain('ferrovue::RouteDef { path: "/:path(.*)", name: Some("/[...path]"), view: true, children: &[] },');
      expect(out.get("x.rs")).toContain('fv_route.link_named("/books/[id]", &[("id", &*props.id)], "", "")');
      expect(out.get("books_id.rs")).toContain('pub const NAME: &str = "BooksId";');
      expect(out.get("books_id.rs")).toContain('fv_route.param("id")');
      expect(out.has("index.rs") && out.has("path.rs")).toBe(true);
      expect(out.get("mod.rs")).toContain("pub mod books_id;");
    });

    it("takes an optional parameter given or left out", () => {
      const out = withPages(island(linkTo("{ name: '/[[lang]]/about' }"), { Y: linkTo("{ name: '/[[lang]]/about', params: { lang: id } }") }), { "[[lang]]/about.vue": view });
      expect(out.get("x.rs")).toContain('fv_route.link_named("/[[lang]]/about", &[], "", "")');
      expect(out.get("y.rs")).toContain('fv_route.link_named("/[[lang]]/about", &[("lang", &*props.id)], "", "")');
      expect(out.get("route_table.rs")).toContain('ferrovue::RouteDef { path: "/:lang?", name: None, view: false, children: &[');
    });

    it("refuses routes that are neither a file nor a folder of pages, and a page whose name is taken", () => {
      expect(() => generate(island(view), { ...CONFIG, routes: { folder: "pages" } as never })).toThrow(expect.objectContaining({ code: "FV1238" }));
      expect(() => withPages(island(view), { "x.vue": view })).toThrow(/pages\/x\.vue: the page's component would be called `X`, as components\/X\.vue is: rename one of them/);
      expect(() => withPages(island(view), { "a-b.vue": view, "a_b.vue": view })).toThrow(expect.objectContaining({ code: "FV1245" }));
      expect(() => withPages(island(view), { "404.vue": view })).toThrow(/would be called `404`, which is not a Rust name/);
    });

    it("refuses a named location without every parameter, or with one the route lacks", () => {
      expect(() => named(island(linkTo("{ name: 'user' }")))).toThrow(/route `user` needs `id`/);
      expect(() => named(island(linkTo("{ name: 'user', params: { id, page: id } }")))).toThrow(/route `user` has no parameter `page`/);
    });

    it("reads the route's path, hash, name and parameters, and refuses the rest", () => {
      const reader = (field: string) => `<script setup lang="ts">
import { useRoute } from "vue-router";
defineProps<{ a: string }>();
const route = useRoute();
</script>
<template><p>{{ route.${field} }}</p></template>`;
      expect(named(island(reader("params.id"))).get("x.rs")).toContain('fv_route.param("id")');
      expect(named(island(reader("query.q"))).get("x.rs")).toContain('fv_route.query("q").write_display(out);');
      expect(named(island(reader("fullPath"))).get("x.rs")).toContain("fv_route.full_path()");
      expect(() => named(island(reader("meta.title")))).toThrow(/`route.meta` is not available on the server/);
    });

    it("refuses a query value, an array when its key is repeated, as an attribute, unless narrowed to one string", () => {
      const bound = (value: string, attr = ":data-q") => `<script setup lang="ts">
import { useRoute } from "vue-router";
defineProps<{ a: string }>();
const route = useRoute();
</script>
<template><p ${attr}="${value}">x</p></template>`;
      const refused = /components\/X\.vue:6:\d+: `data-q` is bound to a query value, which is an array when its key is repeated: .*hydration then sets it.*typeof route\.query\.q === "string"/;
      expect(() => named(island(bound("route.query.q")))).toThrow(refused);
      expect(() => named(island(bound("route.query.q ?? 'none'")))).toThrow(refused);
      expect(() => named(island(bound("route.query.q", ":hidden")))).toThrow(/`hidden` is bound to a query value/);
      const narrowed = named(island(bound("typeof route.query.q === 'string' ? route.query.q : 'none'"))).get("x.rs")!;
      expect(narrowed).toContain('fv::escape_into(out, fv_route.query("q").attr_value().unwrap_or("none"));');
    });

    it("writes RouterView as the page the server supplies, and refuses it below the top", () => {
      const app = `<script setup lang="ts">
defineProps<{ title: string }>();
</script>
<template><main><RouterView /></main></template>`;
      expect(withRoutes(island(app)).get("x.rs")).toContain("fv_slots.router_view.render_to(out);");
      const parent = `<script setup lang="ts">
import App from "./App.vue";
defineProps<{ title: string }>();
</script>
<template><div><App title="t" /></div></template>`;
      expect(() => withRoutes(island(parent, { App: app }))).toThrow(/renders it at the top/);
    });
  });

  describe("Pinia stores", () => {
    const store = `import { defineStore } from "pinia";
export interface PrefsState { density: string; wide: boolean }
export const usePrefs = defineStore("prefs", { state: (): PrefsState => ({ density: "classic", wide: false }) });
`;
    const withStore = (root: string, source = store) => {
      mkdirSync(join(root, "stores"), { recursive: true });
      writeFileSync(join(root, "stores", "prefs.ts"), source);
      return generate(root, { ...CONFIG, stores: "stores" });
    };
    const reader = `<script setup lang="ts">
import { storeToRefs } from "pinia";
import { usePrefs } from "../stores/prefs";
defineProps<{ title: string }>();
const prefs = usePrefs();
const { wide } = storeToRefs(prefs);
</script>
<template><p :class="prefs.density" :data-wide="wide">{{ title }}</p></template>`;

    it("writes a setup store's nullable state as null, and refuses one that starts undefined", () => {
      const session = (init: string) => `import { defineStore } from "pinia";
import { ref } from "vue";
export const usePrefs = defineStore("prefs", () => {
  const user = ref<string | null>(${init});
  return { user };
});
`;
      const user = `<script setup lang="ts">
import { usePrefs } from "../stores/prefs";
const prefs = usePrefs();
</script>
<template><p>{{ prefs.user ?? "guest" }}</p></template>`;
      const out = withStore(island(user), session("null"));
      expect(out.get("stores.rs")).toContain('    #[serde(rename = "user")]\n    pub user: Option<Cow<\'a, str>>,');
      expect(() => withStore(island(user), session(""))).toThrow(/prefs\.ts:4:\d+: a `ref<T \| null>\(\)` with no value starts `undefined`/);
    });

    it("reads a store's state from the Stores the server is given, and hands it down", () => {
      const parent = `<script setup lang="ts">
import Reader from "./Reader.vue";
defineProps<{ title: string }>();
</script>
<template><div><Reader :title="title" /></div></template>`;
      const out = withStore(island(parent, { Reader: reader }));
      expect(out.get("reader.rs")).toContain("&*fv_stores.prefs.density");
      expect(out.get("reader.rs")).toContain("if fv_stores.prefs.wide");
      expect(out.get("x.rs")).toContain("fv_stores: &super::stores::Stores<'_>");
      expect(out.get("stores.rs")).toContain("pub prefs: PrefsState<'a>,");
    });

    it("refuses a store whose state has no declared type", () => {
      const untyped = store.replace("(): PrefsState =>", "() =>");
      expect(() => withStore(island(reader), untyped)).toThrow(/declares its return type/);
    });

    it("reads a setup store's returned refs as its state, and refuses one it cannot see", () => {
      const setup = `import { defineStore } from "pinia";
import { ref } from "vue";
export const usePrefs = defineStore("prefs", () => {
  const density = ref("classic");
  const wide = ref(false);
  return { density, wide };
});
`;
      const out = withStore(island(reader), setup);
      expect(out.get("stores.rs")).toContain("pub struct PrefsState<'a> {");
      expect(out.get("x.rs")).toContain("&*fv_stores.prefs.density");
      const expression = `import { defineStore } from "pinia";
export const usePrefs = defineStore("prefs", () => ({}));
`;
      expect(() => withStore(island(reader), expression)).toThrow(/returns its state from a block/);
      const untyped = setup.replace('ref("classic")', "ref([])");
      expect(() => withStore(island(reader), untyped)).toThrow(/declares its type: `ref<string\[\]>\(\[\]\)`/);
    });

    it("refuses storeToRefs of anything but a store bound in setup", () => {
      const wrong = reader.replace("storeToRefs(prefs)", "storeToRefs(usePrefs())");
      expect(() => withStore(island(wrong))).toThrow(/`storeToRefs` takes a store bound in this setup/);
    });

    it("refuses a field the store's state does not have", () => {
      const getter = reader.replace("prefs.density", "prefs.doubled");
      expect(() => withStore(island(getter))).toThrow(/`PrefsState` has no field `doubled`/);
    });

    it("translates a getter of the state where a component reads it", () => {
      const withGetter = store.replace("});\n", `, getters: { label: (s) => s.density + "!" } });\n`);
      const out = withStore(island(reader.replace("prefs.density", "prefs.label")), withGetter);
      expect(out.get("x.rs")).toContain('format!("{}!", fv_stores.prefs.density)');
    });

    it("refuses a getter that reads `this`, or returns a function", () => {
      const viaThis = store.replace("});\n", `, getters: { label(): string { return this.density; } } });\n`);
      expect(() => withStore(island(reader.replace("prefs.density", "prefs.label")), viaThis)).toThrow(/reads `this`/);
      const fn = store.replace("});\n", `, getters: { label: (s) => (x: string) => x } });\n`);
      expect(() => withStore(island(reader.replace("prefs.density", "prefs.label")), fn)).toThrow(/returns a function/);
    });
  });

  describe("error locations", () => {
    const where = (source: string, others: Record<string, string> = {}): string => {
      try {
        compile(island(source, others));
      } catch (e) {
        return (e as Error).message.split(": ")[0]!;
      }
      throw new Error("compiled without an error");
    };

    it("points at a template expression in the .vue file", () => {
      expect(where(`<script setup lang="ts">
defineProps<{ n: number }>();
</script>

<template>
  <div>
    <p>{{ n.toPrecision(2) }}</p>
  </div>
</template>`)).toBe("components/X.vue:7:11");
    });

    it("points at an attribute binding", () => {
      expect(where(`<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i :title="a.normalize()"></i></template>`)).toBe("components/X.vue:4:22");
    });

    it("points at a template expression on the <template> line itself", () => {
      expect(where(`<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><b>{{ n.toPrecision(2) }}</b></template>`)).toBe("components/X.vue:4:17");
    });

    it("points at a setup statement and a prop type", () => {
      expect(where(`<script setup lang="ts">
import { watchEffect } from "vue";
defineProps<{ a: string }>();
watchEffect(() => {});
</script>
<template><i></i></template>`)).toBe("components/X.vue:4:1");
      expect(where(`<script setup lang="ts">
defineProps<{
  when: Date;
}>();
</script>
<template><i></i></template>`)).toBe("components/X.vue:3:9");
    });

    it("quotes the line with a caret under the construct", () => {
      expect(() =>
        compile(island(`<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><b>{{ n.toPrecision(2) }}</b></template>`)),
      ).toThrow(" 4 | <template><b>{{ n.toPrecision(2) }}</b></template>\n   |                 ^");
    });
  });

  describe("attributes and text", () => {
    it("renders `:hidden` by the value's type, which Vue decides only at run time", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ on: boolean }>();
</script>
<template><p :hidden="on">x</p></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/if props\.on \{\s*out\.push_str\(" hidden"\);/);
    });

    it("refuses a list or an object as an attribute, which Vue's server renderer leaves out and hydration sets", () => {
      const bound = (attr: string) => `<script setup lang="ts">
interface Item { id: number }
defineProps<{ tags: string[]; item: Item; more?: string[] }>();
</script>
<template><p ${attr}>x</p></template>`;
      expect(() => compile(island(bound(`:data-tags="tags"`)))).toThrow(/components\/X\.vue:5:\d+: `data-tags` is bound to a list: .*join it into one string, as `\.join\(","\)`/);
      expect(() => compile(island(bound(`:title="more"`)))).toThrow(/`title` is bound to a list/);
      expect(() => compile(island(bound(`v-bind="{ 'aria-label': tags }"`)))).toThrow(/`aria-label` is bound to a list/);
      expect(() => compile(island(bound(`:data-item="item"`)))).toThrow(/`data-item` is bound to an object/);
      expect(compile(island(bound(`:data-tags="tags.join(',')"`))).get("x.rs")).toContain(" data-tags=");
    });

    it("counts a string's length in UTF-16 code units, as JavaScript does", () => {
      const out = compile(
        island(`<script setup lang="ts">
const props = defineProps<{ name: string }>();
</script>
<template><p>{{ name.length }}</p></template>`),
      ).get("x.rs")!;
      expect(out).toContain("fv::js_length(&props.name)");
      expect(out).not.toContain("props.name.len() as i64");
    });
  });

  describe("styles", () => {
    it("merges a static style, a binding and v-show, the last value of a property winning", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ on: boolean; c: string }>();
</script>
<template><p style="display: block; color: red" :style="{ color: c }" v-show="on">x</p></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/if !props\.on \{\s*out\.push_str\("display:none;"\);\s*\} else \{\s*out\.push_str\("display:block;"\);/);
      expect(out).toContain("fv::escape_into(out, &props.c);");
    });

    it("allows a global <style> block, which changes no markup", () => {
      const out = compile(
        island(`<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style>i { color: red }</style>`),
      ).get("x.rs")!;
      expect(out).toContain("pub fn render");
    });
  });

  describe("numbers", () => {
    const numbers = `<script setup lang="ts">
import type { Float } from "ferrovue/types";
defineProps<{ price: Float; qty: number; rate?: Float }>();
</script>
<template><p :data-total="price * qty">{{ (price * qty).toFixed(2) }}|{{ qty / 4 }}|{{ Math.round(price) }}|{{ rate ?? 0.5 }}|{{ qty % 3 }}</p></template>`;

    it("makes a Float prop an f64, written as JavaScript writes numbers", () => {
      const out = compile(island(numbers)).get("x.rs")!;
      expect(out).toContain("pub price: f64,");
      expect(out).toContain("pub rate: Option<f64>,");
      expect(out).toContain("fv::js_to_fixed(props.price * props.qty as f64, 2)");
      expect(out).toContain("fv::push_number(out, props.qty as f64 / 4.0);");
      expect(out).toContain("fv::js_round(props.price)");
      expect(out).toContain("props.rate.unwrap_or(0.5f64)");
      expect(out).toContain("fv::push_int(out, (props.qty as f64 % 3.0) as i64);");
    });

    it("refuses toFixed with digits that are not a literal", () => {
      const source = numbers.replace("toFixed(2)", "toFixed(qty)");
      expect(() => compile(island(source))).toThrow(/`\.toFixed\(\)` takes a literal number of digits/);
    });
  });

  describe("vue-i18n", () => {
    const withLocales = (root: string, messages: Record<string, unknown>) => {
      mkdirSync(join(root, "locales"), { recursive: true });
      writeFileSync(join(root, "locales", "en.json"), JSON.stringify(messages));
      return generate(root, { ...CONFIG, i18n: { messages: "locales", locale: "en" } });
    };
    const translating = (call: string) => `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ ${call} }}</p></template>`;

    it("compiles the messages to a table, and a $t call to a lookup in the request's locale", () => {
      const out = withLocales(island(translating("$t('apples', n)")), { apples: "one | {n} apples", a: { b: "@.upper:a.c" }, "a.c": "x" });
      expect(out.get("x.rs")).toContain('fv_i18n.t("apples", &fv::i18n::Args { named: &[], list: &[], plural: Some(props.n) })');
      expect(out.get("x.rs")).toContain("fv_i18n: &fv::I18n");
      expect(out.get("i18n.rs")).toContain('("apples", Message { cases: &[&[Part::Text("one")], &[Part::Named("n"), Part::Text(" apples")]] })');
      expect(out.get("i18n.rs")).toContain('Part::Linked { key: "a.c", modifier: Some("upper") }');
    });

    it("refuses $t without locale files, a default message, and a modifier vue-i18n does not define", () => {
      expect(() => compile(island(translating("$t('a')")))).toThrow(/`t\(\)` needs `i18n` in ferrovue\.config\.json/);
      expect(() => withLocales(island(translating("$t('a', 'fallback')")), { a: "x" })).toThrow(/a default message given to `t\(\)` is not supported/);
      expect(() => withLocales(island(translating("$t('a')")), { a: "@.shout:b", b: "x" })).toThrow(/the modifier `shout`, which vue-i18n does not define/);
    });
  });

  describe("helpers", () => {
    const config = {
      ...CONFIG,
      helpers: {
        module: "./helpers",
        functions: { plural: { rust: "crate::helpers::plural", params: ["int" as const], returns: "string" as const, maxLen: 1 } },
      },
    };

    it("calls a helper's Rust twin and reserves what it can write", () => {
      const out = generate(
        island(`<script setup lang="ts">
import { plural } from "./helpers";
const props = defineProps<{ n: number }>();
</script>
<template><p>item{{ plural(n) }}</p></template>`),
        config,
      ).get("x.rs")!;
      expect(out).toContain("fv::escape_into(out, crate::helpers::plural(props.n));");
    });

    it("refuses a helper with no Rust twin", () => {
      const source = `<script setup lang="ts">
import { shout } from "./helpers";
const props = defineProps<{ n: number }>();
</script>
<template><p>{{ shout(n) }}</p></template>`;
      expect(() => generate(island(source), config)).toThrow(/`shout` has no Rust twin/);
    });

    it("refuses a helper called with the wrong number of arguments", () => {
      const source = `<script setup lang="ts">
import { plural } from "./helpers";
const props = defineProps<{ n: number }>();
</script>
<template><p>{{ plural(n, n) }}</p></template>`;
      expect(() => generate(island(source), config)).toThrow(/`plural` takes 1 argument/);
    });
  });

  describe("<ClientOnly>", () => {
    const page = (inside: string, from = "ferrovue/client") => `<script setup lang="ts">
import { ClientOnly } from "${from}";
import Chart from "chart-library";
defineProps<{ label: string }>();
</script>
<template><div><ClientOnly>${inside}</ClientOnly></div></template>`;

    it("writes the fallback between fragment markers and skips the default slot", () => {
      const out = compile(island(page(`<Chart :data="window.points" /><v-tooltip>{{ label.at(-1) }}</v-tooltip><template #fallback><p>{{ label }}</p></template>`))).get("x.rs")!;
      expect(out).toContain('out.push_str("<div><!--[--><p>");\n    fv::escape_into(out, &props.label);\n    out.push_str("</p><!--]--></div>");');
      expect(out).not.toContain("tooltip");
    });

    it("writes a comment where there is no fallback, imported from the package root too", () => {
      const out = compile(island(page(`<Chart />`, "ferrovue"))).get("x.rs")!;
      expect(out).toContain('out.push_str("<div><!----></div>");');
    });

    it("still refuses a component resolved by name outside it", () => {
      const source = page(`<v-tooltip /></ClientOnly><v-tooltip /><ClientOnly>`);
      expect(() => compile(island(source))).toThrow(/a component the template resolves by name must be imported/);
    });

    it("refuses attributes, slots other than the default and `#fallback`, and fallback props", () => {
      expect(() => compile(island(page(`<Chart />`).replace("<ClientOnly>", '<ClientOnly class="wide">')))).toThrow(/`<ClientOnly>` takes no attributes/);
      expect(() => compile(island(page(`<template #header>h</template>`)))).toThrow(/a default slot and a `#fallback` slot, and no other/);
      expect(() => compile(island(page(`<template #fallback="{ x }">{{ x }}</template>`)))).toThrow(/`#fallback` passes no props/);
    });
  });

  describe("defineAsyncComponent", () => {
    const child = `<script setup lang="ts">
defineProps<{ text: string }>();
</script>
<template><p>{{ text }}</p></template>`;
    const parent = (declared: string) => `<script setup lang="ts">
import { defineAsyncComponent as lazy } from "vue";
const Later = ${declared};
defineProps<{ label: string }>();
</script>
<template><div><Later :text="label" /></div></template>`;

    it("renders the component it loads as a child", () => {
      for (const declared of ['lazy(() => import("./Y.vue"))', 'lazy({ loader: () => import("./Y.vue"), delay: 200 })']) {
        const out = compile(island(parent(declared), { Y: child })).get("x.rs")!;
        expect(out, declared).toContain("super::y::render(out, &super::y::Props { text: std::borrow::Cow::Borrowed(&*props.label) });");
      }
    });

    it("refuses a loader that is not an import of a `.vue` file", () => {
      for (const declared of ['lazy(() => import("./y.ts"))', "lazy(() => import(name))", "lazy(load)"]) {
        expect(() => compile(island(parent(declared).replace("const Later", "const name = 'Y';\nconst load = () => null;\nconst Later"), { Y: child })), declared).toThrow(/`defineAsyncComponent` loads a component of this project/);
      }
    });
  });

  describe("Rust twins", () => {
    const config = {
      ...CONFIG,
      twins: {
        VBtn: { rust: "crate::ui::v_btn", props: { label: "string" as const, size: "int?" as const, block: "bool" as const }, slots: ["default", "prepend"] },
        VIcon: { rust: "crate::ui::v_icon" },
      },
    };
    const using = (template: string, script = 'import { VBtn, VIcon } from "vuetify/components";') => `<script setup lang="ts">
${script}
defineProps<{ label: string }>();
</script>
<template>${template}</template>`;

    it("calls the twin with its props, slots and attributes", () => {
      const out = generate(island(using(`<VBtn :label="label" block class="wide"><b>{{ label }}</b></VBtn>`)), config).get("x.rs")!;
      expect(out).toContain("crate::ui::v_btn(out, &super::twins::VBtnProps { label: &props.label, size: None, block: true }, super::twins::VBtnSlots {");
      expect(out).toContain("default: Some(fv::Slot::new(&|out: &mut String| {");
      expect(out).toContain("prepend: None,");
      expect(out).toContain('}, &fv::Attrs::merged(&[&[("class", fv::Attr::str("wide"))]], ""));');
    });

    it("finds a twin the template resolves by name, as `<v-icon>`", () => {
      const out = generate(island(using("<p><v-icon /></p>", "")), config).get("x.rs")!;
      expect(out).toContain("crate::ui::v_icon(out, &super::twins::VIconProps {}, &fv::Attrs::NONE);");
    });

    it("writes the props, the slots and the signature each twin is held to", () => {
      const twins = generate(island(using("<p />")), config).get("twins.rs")!;
      expect(twins).toContain("pub struct VBtnProps<'a> {\n    pub label: &'a str,\n    pub size: Option<i64>,\n    pub block: bool,\n}");
      expect(twins).toContain("pub struct VBtnSlots<'s> {\n    /// `#default`\n    pub default: Option<fv::Slot<'s>>,\n    /// `#prepend`\n    pub prepend: Option<fv::Slot<'s>>,\n}");
      expect(twins).toContain("pub type VBtnRender = fn(&mut String, &VBtnProps<'_>, VBtnSlots<'_>, &fv::Attrs<'_>);\n\nconst _: VBtnRender = crate::ui::v_btn;");
      expect(twins).toContain("pub struct VIconProps {\n}");
      expect(twins).toContain("pub type VIconRender = fn(&mut String, &VIconProps, &fv::Attrs<'_>);");
      expect(generate(island(using("<p />")), config).get("mod.rs")).toContain("pub mod twins;");
      expect(compile(island(using("<p />", ""))).has("twins.rs")).toBe(false);
    });

    it("refuses a missing prop, a slot it does not name, and `v-bind` of an object", () => {
      expect(() => generate(island(using("<VBtn />")), config)).toThrow(/VBtn requires `label`/);
      expect(() => generate(island(using(`<VBtn :label="label"><template #append>a</template></VBtn>`)), config)).toThrow(/VBtn has no slot `append`/);
      expect(() => generate(island(using(`<VBtn v-bind="$props" />`)), config)).toThrow(/the props of VBtn, a Rust twin, are attributes or an object literal/);
      const nullable = using(`<VBtn :label="label" :size="count" />`).replace("defineProps<{ label: string }>", "defineProps<{ label: string; count: number | null }>");
      expect(() => generate(island(nullable), config)).toThrow(/a value that may be `null` where <VBtn>'s prop `size` takes .*write `\?\? undefined` after it/);
    });

    it("refuses a twin named after a component ferrovue compiles, and a twin without a function", () => {
      expect(() => generate(island(using("<p />", "")), { ...config, twins: { X: { rust: "crate::x" } } })).toThrow(/`twins\.X` in ferrovue\.config\.json names components\/X\.vue, which ferrovue compiles/);
      expect(() => generate(island(using("<p />", "")), { ...CONFIG, twins: { VBtn: { rust: "v_btn" } } })).toThrow(/`twins\.VBtn` in ferrovue\.config\.json needs `rust`/);
      expect(() => generate(island(using("<p />", "")), { ...CONFIG, twins: { "v-btn": { rust: "crate::v_btn" } } })).toThrow(/in PascalCase/);
    });
  });

  describe("output", () => {
    const source = `<script setup lang="ts">
const props = defineProps<{ label: string; note?: string }>();
</script>
<template><b v-if="note">{{ note }}</b><i v-if="note">{{ label }}</i></template>`;

    it("is the same on every run", () => {
      const project = island(source);
      expect(compile(project)).toEqual(compile(project));
    });

    it("marks every file as generated, naming its source", () => {
      for (const [name, text] of compile(island(source))) {
        expect(text.startsWith("// @generated by ferrovue from "), name).toBe(true);
      }
    });

    it("numbers narrowed bindings per component, so one file's text depends on its own source", () => {
      const alone = compile(island(source)).get("x.rs");
      const beside = compile(island(source, { A: source })).get("x.rs");
      expect(beside).toBe(alone);
    });
  });

  describe("idioms", () => {
    const withFile = (project: string, name: string, text: string): string => {
      writeFileSync(join(project, "components", name), text);
      return project;
    };

    it("compiles a component without a script, or with an empty `<script setup>`, as one without props", () => {
      const out = compile(
        island(
          `<script setup lang="ts">
import Icon from "./Icon.vue";
import Rule from "./Rule.vue";
defineProps<{ label: string }>();
</script>
<template><p><Icon class="i" />{{ label }}<Rule /></p></template>`,
          { Icon: `<template><svg><path d="M0 0" /></svg></template>`, Rule: `<script setup lang="ts"></script>\n<template><hr /></template>` },
        ),
      );
      expect(out.get("icon.rs")).toMatch(/pub struct Props \{\s*\}/);
      expect(out.get("rule.rs")).toContain("out.push_str(\"<hr>\");");
    });

    it("says a child, not an island, needs `<script setup>`", () => {
      const project = island(
        `<script setup lang="ts">
import Old from "./Old.vue";
</script>
<template><Old /></template>`,
        { Old: `<script lang="ts">\nexport default { name: "Old" };\n</script>\n<template><i>old</i></template>` },
      );
      expect(() => compile(project)).toThrow(/^components\/Old\.vue:1:1: a child component must have `<script setup lang="ts">`, or no script at all/);
    });

    it("reads constants and enums from a `.ts` file when it compiles", () => {
      const project = withFile(
        island(`<script setup lang="ts">
import { LABELS, OPTIONS, Tone } from "./consts";
defineProps<{ tone: Tone }>();
</script>
<template><p :class="tone">{{ LABELS.title }}<i v-for="o in OPTIONS">{{ o.label }}{{ o.price }}</i>{{ Tone.Loud }}</p></template>`),
        "consts.ts",
        `export const LABELS = { title: "T" } as const;
export const OPTIONS = [{ label: "a", price: 1 }, { label: "b", price: 1.5, sale: true }];
export enum Tone { Calm = "calm", Loud = "loud" }
`,
      );
      const out = compile(project);
      expect(out.get("types.rs")).toContain(
        `pub const OPTIONS: &[OptionsItem<'static>] = &[
    OptionsItem { label: Cow::Borrowed("a"), price: 1.0f64, sale: None },
    OptionsItem { label: Cow::Borrowed("b"), price: 1.5f64, sale: Some(true) },
];`,
      );
      expect(out.get("x.rs")).toContain("for o_ref in super::types::OPTIONS.iter()");
      expect(out.get("x.rs")).toContain('out.push_str("<!--]-->loud</p>");');
    });

    it("types a field of a constant list that holds `null` as nullable, and refuses one both `null` and absent", () => {
      const source = `<script setup lang="ts">
import { ROWS } from "./consts";
</script>
<template><p><i v-for="r in ROWS">{{ r.badge ?? "-" }}</i></p></template>`;
      const nullable = compile(withFile(island(source), "consts.ts", `export const ROWS = [{ badge: null }, { badge: "new" }];\n`));
      expect(nullable.get("types.rs")).toContain('RowsItem { badge: None },\n    RowsItem { badge: Some(Cow::Borrowed("new")) },');
      expect(() => compile(withFile(island(source), "consts.ts", `export const ROWS = [{ badge: null }, {}, { badge: "x" }];\n`))).toThrow(
        /^components\/consts\.ts:1:21: `badge` in a constant list's objects is `null` in some and absent in others/,
      );
    });

    it("refuses a constant it cannot evaluate where it is used, naming the file it comes from", () => {
      const project = withFile(
        island(`<script setup lang="ts">
import { NOW } from "./consts";
</script>
<template><p>{{ NOW }}</p></template>`),
        "consts.ts",
        `export const NOW = Date.now();\n`,
      );
      expect(() => compile(project)).toThrow(
        /X\.vue:4:17: `NOW` is set up in a way the server cannot evaluate: it is imported from components\/consts\.ts, where it is not a constant the compiler evaluates: components\/consts\.ts:1:20: a constant the compiler evaluates is a literal/,
      );
    });
  });

  const refused: [string, string, RegExp][] = [
    [
      "a type parameter without a constraint",
      `<script setup lang="ts" generic="T">
defineProps<{ value: T }>();
</script>
<template><i>{{ value }}</i></template>`,
      /X\.vue:1:34: `T` in `generic` has no constraint/,
    ],
    [
      "a slot read through `useSlots()` that the template does not render",
      `<script setup lang="ts">
import { useSlots } from "vue";
const slots = useSlots();
</script>
<template><div><i v-if="slots.footer">x</i><slot /></div></template>`,
      /`slots\.footer` names a slot this template does not render/,
    ],
    [
      "an enum read whole",
      `<script setup lang="ts">
enum Tone { Calm = "calm" }
</script>
<template><i>{{ Tone }}</i></template>`,
      /`Tone` is an object, read one field at a time: `Tone\.Calm`/,
    ],
    [
      "an enum read by a key chosen at run time",
      `<script setup lang="ts">
enum Tone { Calm = "calm" }
defineProps<{ k: string }>();
</script>
<template><i>{{ Tone[k] }}</i></template>`,
      /`Tone` read by a key chosen at run time/,
    ],
    [
      "an enum member that is not a literal",
      `<script setup lang="ts">
enum Size { Small = "s".length }
</script>
<template><i>{{ Size.Small }}</i></template>`,
      /`Size` is set up in a way the server cannot evaluate: it is not an enum the compiler evaluates: components\/X\.vue:2:21: a constant the compiler evaluates is a literal/,
    ],
    [
      "a value read from `$attrs`, which has no type",
      `<script setup lang="ts">
defineProps<{}>();
</script>
<template><b :title="$attrs.title">x</b></template>`,
      /`\$attrs` is bound whole/,
    ],
    [
      "a value read from `useAttrs()`, which has no type",
      `<script setup lang="ts">
import { useAttrs } from "vue";
const attrs = useAttrs();
</script>
<template><b :title="attrs.title">x</b></template>`,
      /`useAttrs\(\)` is bound whole/,
    ],
    [
      "a class merged with a string that may equal it, which Vue writes once",
      `<script setup lang="ts">
defineProps<{ s: string }>();
</script>
<template><b class="a" v-bind="{ class: s }">x</b></template>`,
      /a class merged with a string that may equal the class before it/,
    ],
    [
      "destructured props gathered with a rest element",
      `<script setup lang="ts">
const { color = "slate", ...rest } = defineProps<{ color?: string; size: string }>();
</script>
<template><span :title="color"></span></template>`,
      /`\.\.\.rest` has no Rust type/,
    ],
    [
      "a runtime props declaration, which has no types",
      `<script setup lang="ts">
defineProps(["label"]);
</script>
<template><span></span></template>`,
      /declared with a type/,
    ],
    [
      "a default that is not a literal",
      `<script setup lang="ts">
const label = "x";
withDefaults(defineProps<{ title?: string }>(), { title: () => label });
</script>
<template><span>{{ title }}</span></template>`,
      /the default of `title` must be a literal/,
    ],
    [
      "watchEffect, which runs on the server",
      `<script setup lang="ts">
import { watchEffect } from "vue";
defineProps<{ a: string }>();
watchEffect(() => {});
</script>
<template><span></span></template>`,
      /`watchEffect` runs once on the server/,
    ],
    [
      "an immediate watcher, which runs on the server",
      `<script setup lang="ts">
import { watch } from "vue";
const props = defineProps<{ a: string }>();
watch(() => props.a, () => {}, { immediate: true });
</script>
<template><span></span></template>`,
      /`watch` with `immediate` runs on the server/,
    ],
    [
      "a setup statement that changes state",
      `<script setup lang="ts">
import { ref } from "vue";
const props = defineProps<{ label: string }>();
const shown = ref("");
shown.value = props.label;
</script>
<template><b>{{ shown }}</b></template>`,
      /could change what renders/,
    ],
    [
      "a setup binding it cannot evaluate, named like a prop",
      `<script setup lang="ts">
const props = defineProps<{ label: string }>();
const label = props.label.normalize();
</script>
<template><i>{{ label }}</i></template>`,
      /`label` is set up in a way the server cannot evaluate/,
    ],
    [
      "an interface whose name the generated Rust already uses",
      `<script setup lang="ts">
interface Option { label: string }
const props = defineProps<{ options: Option[] }>();
</script>
<template><i v-for="o in options">{{ o.label }}</i></template>`,
      /an interface called `Option` would hide Rust's own `Option`/,
    ],
    [
      "a comparison of an optional value with null",
      `<script setup lang="ts">
const props = defineProps<{ note?: string }>();
</script>
<template><i v-if="note === null">x</i></template>`,
      /X\.vue:4:\d+: `=== null` of a value that is optional, .* never `null`: compare with `undefined`/,
    ],
    [
      "a comparison of a nullable value with undefined",
      `<script setup lang="ts">
const props = defineProps<{ note: string | null }>();
</script>
<template><i :title="note !== undefined ? 'a' : 'b'">x</i></template>`,
      /X\.vue:4:\d+: `!== undefined` of a value that is `T \| null`, never `undefined`: compare with `null`/,
    ],
    [
      "a strict comparison of a value that may be null or undefined",
      `<script setup lang="ts">
interface Entry { at: string | null }
const props = defineProps<{ entry?: Entry }>();
</script>
<template><i v-if="entry?.at === null">x</i></template>`,
      /X\.vue:5:\d+: `=== null` of a value that may be `null` or `undefined`, .*test both with `== null`/,
    ],
    [
      "loose equality between values",
      `<script setup lang="ts">
const props = defineProps<{ a: string; b: string }>();
</script>
<template><i v-if="a == b">x</i></template>`,
      /`==` and `!=` compare with `null` or `undefined` only; use `===`/,
    ],
    [
      "a nullable value passed where the child takes an optional one",
      `<script setup lang="ts">
import Y from "./Y.vue";
const props = defineProps<{ a: string | null }>();
</script>
<template><Y :b="a" /></template>`,
      /X\.vue:5:\d+: a value that may be `null` where the prop takes an optional string, .*`\?\? undefined`/,
    ],
    [
      "an optional value passed where the child takes a nullable one",
      `<script setup lang="ts">
import Z from "./Z.vue";
const props = defineProps<{ a?: string }>();
</script>
<template><Z :c="a" /></template>`,
      /X\.vue:5:\d+: a value that may be `undefined` where the prop takes a string or `null`, .*`\?\? null`/,
    ],
    [
      "a nullable prop the parent leaves out",
      `<script setup lang="ts">
import Z from "./Z.vue";
</script>
<template><Z /></template>`,
      /Z requires `c`, which is `T \| null`: Vue would hand it `undefined`; pass `null` for none/,
    ],
    [
      "an ordering comparison of a string and a number, which JavaScript makes numeric",
      `<script setup lang="ts">
const props = defineProps<{ a: string; n: number }>();
</script>
<template><i v-if="a < n">x</i></template>`,
      /`<` is supported between two numbers, or two strings, that are present: the other is a string/,
    ],
    [
      "two halves of surrogate pairs compared, which JavaScript tells apart",
      `<script setup lang="ts">
const props = defineProps<{ a: string; b: string }>();
</script>
<template><i v-if="a.charAt(0) === b.charAt(0)">same initial</i></template>`,
      /`===` with a string that may hold half of a surrogate pair/,
    ],
    [
      "a half of a surrogate pair searched for, which JavaScript finds in a whole pair",
      `<script setup lang="ts">
const props = defineProps<{ a: string; b: string }>();
</script>
<template><i>{{ a.includes(b.slice(0, 1)) }}</i></template>`,
      /`\.includes\(\)` with a string that may hold half of a surrogate pair/,
    ],
    [
      "two halves of surrogate pairs joined, which JavaScript makes one character",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.slice(0, 1) + a.slice(1) }}</i></template>`,
      /`\+` with a string that may hold half of a surrogate pair/,
    ],
    [
      "halves of surrogate pairs adjacent in a template literal",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ \`\${a.charAt(0)}\${a.slice(1)}\` }}</i></template>`,
      /a template literal with a string that may hold half of a surrogate pair/,
    ],
    [
      "a half of a surrogate pair ordered against a string beyond U+D7FF",
      `<script setup lang="ts">
const props = defineProps<{ a: string; b: string }>();
</script>
<template><i v-if="a.charAt(0) < b">x</i></template>`,
      /`<` with a string that may hold half of a surrogate pair/,
    ],
    [
      "halves of surrogate pairs joined with no separator",
      `<script setup lang="ts">
const props = defineProps<{ words: string[] }>();
</script>
<template><i>{{ words.map((w) => w.charAt(0)).join("") }}</i></template>`,
      /`\.join\(\)` with no literal separator with a string that may hold half of a surrogate pair/,
    ],
    [
      "a string that may hold half of a surrogate pair repeated",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.slice(1, 3).repeat(2) }}</i></template>`,
      /`\.repeat\(\)` with a string that may hold half of a surrogate pair/,
    ],
    [
      "JSON.stringify of a string that may hold half of a surrogate pair, which JavaScript escapes",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ JSON.stringify(a.slice(0, 3)) }}</i></template>`,
      /`JSON\.stringify\(\)` with a string that may hold half of a surrogate pair/,
    ],
    [
      "a negative literal count for repeat, which throws",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.repeat(-1) }}</i></template>`,
      /`\.repeat\(\)` with a negative or infinite count, which throws a `RangeError`/,
    ],
    [
      "toLocaleUpperCase, which depends on the server's locale",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.toLocaleUpperCase() }}</i></template>`,
      /`\.toLocaleUpperCase\(\)` maps case by the locale the server runs in/,
    ],
    [
      "replace with a regular expression",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.replace(/x/g, "y") }}</i></template>`,
      /`\.replace\(\)` with a regular expression/,
    ],
    [
      "replace with a function",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.replace("x", (m) => m) }}</i></template>`,
      /`\.replace\(\)` with a function/,
    ],
    [
      "includes with a starting position",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.includes("x", 2) }}</i></template>`,
      /`\.includes\(\)` takes 1 argument here/,
    ],
    [
      "parseInt with a radix other than 10 or 16",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ parseInt(a, 36) }}</i></template>`,
      /`parseInt\(\)` takes a radix of 10 or 16, written as a literal/,
    ],
    [
      "parseInt of a number, which JavaScript reads as a string",
      `<script setup lang="ts">
const props = defineProps<{ n: number }>();
</script>
<template><i>{{ parseInt(n) }}</i></template>`,
      /`parseInt\(\)` takes a string/,
    ],
    [
      "an arrow function with a block body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[] }>();
</script>
<template><i>{{ tags.filter((t) => { return t.length > 1; }).length }}</i></template>`,
      /`\.filter\(\)` takes an arrow function whose body is an expression/,
    ],
    [
      "a function passed to filter by name",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[] }>();
</script>
<template><i>{{ tags.filter(Boolean).length }}</i></template>`,
      /`\.filter\(\)` takes an arrow function of the item/,
    ],
    [
      "map to optional values",
      `<script setup lang="ts">
interface Row { note?: string }
const props = defineProps<{ rows: Row[] }>();
</script>
<template><i>{{ rows.map((r) => r.note).length }}</i></template>`,
      /`\.map\(\)` makes a list of strings, numbers, booleans or objects, not optional values/,
    ],
    [
      "a computed list as a slot prop",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[] }>();
</script>
<template><div><slot name="row" :tags="tags.filter((t) => t)" /></div></template>`,
      /a slot prop is not a computed list/,
    ],
    [
      "a record keyed by numbers",
      `<script setup lang="ts">
defineProps<{ m: Record<number, string> }>();
</script>
<template><i></i></template>`,
      /a `Record` is keyed by `string`/,
    ],
    [
      "a record of optional values, which JSON cannot hold",
      `<script setup lang="ts">
defineProps<{ m: Record<string, string | undefined> }>();
</script>
<template><i></i></template>`,
      /a `Record`'s values are strings, numbers, booleans, objects or lists of those/,
    ],
    [
      "Object.entries outside a v-for",
      `<script setup lang="ts">
defineProps<{ m: Record<string, string> }>();
</script>
<template><i>{{ Object.entries(m).map((e) => e).length }}</i></template>`,
      /`Object\.entries\(\)` is supported as the source of a `v-for`/,
    ],
    [
      "Object.keys of an object that is not a record",
      `<script setup lang="ts">
interface Row { a: string }
defineProps<{ row: Row }>();
</script>
<template><i>{{ Object.keys(row).length }}</i></template>`,
      /`Object\.keys\(\)` takes a `Record<string, T>`/,
    ],
    [
      "a field read from a record, which may be absent",
      `<script setup lang="ts">
defineProps<{ m: Record<string, string> }>();
</script>
<template><i>{{ m.title }}</i></template>`,
      /`\.title` on a value that is not an object/,
    ],
    [
      "a ternary whose branches differ in type",
      `<script setup lang="ts">
const props = defineProps<{ n: number }>();
</script>
<template><i>{{ n ? n : "none" }}</i></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a prop type with no Rust twin",
      `<script setup lang="ts">
const props = defineProps<{ when: Date }>();
</script>
<template><i></i></template>`,
      /unsupported prop type `Date`/,
    ],
    [
      "a component written with the Options API",
      `<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({ props: { a: String } });
</script>
<template><i>{{ a }}</i></template>`,
      /an island needs `<script setup lang="ts">`, or no script at all/,
    ],
    [
      "a constructor called in the template",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template>
  <p>{{ new Date(at).getFullYear() }}</p>
</template>`,
      /X\.vue:5:9: `new Date\(…\)` builds an object the server has no twin for/,
    ],
    [
      "a component that renders without a template",
      `<script setup lang="ts">
import { h } from "vue";
defineRender(() => h("i"));
</script>`,
      /a component needs a `<template>`/,
    ],
    [
      "an object interpolated",
      `<script setup lang="ts">
interface User { name: string }
defineProps<{ user: User }>();
</script>
<template><i>{{ user }}</i></template>`,
      /X\.vue:5:17: `\{\{ \}\}` of an object: only strings, numbers and booleans/,
    ],
    [
      "an `inheritAttrs` that is not a literal",
      `<script setup lang="ts">
const quiet = false;
defineOptions({ inheritAttrs: quiet });
defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>`,
      /`inheritAttrs` is `true` or `false`/,
    ],
    [
      "a CSS module, whose class names the bundler chooses",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style module>.i { color: red }</style>`,
      /`<style module>`/,
    ],
    [
      "v-bind() in a style block",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style>i { color: v-bind(a) }</style>`,
      /`v-bind\(\)` in `<style>`/,
    ],
    [
      "a style property whose place would depend on a condition",
      `<script setup lang="ts">
defineProps<{ on: boolean }>();
</script>
<template><i :style="[on ? { color: 'red' } : null, { width: '1px' }, { color: 'blue' }]"></i></template>`,
      /the place of style property `color` would depend on a condition/,
    ],
    [
      "a component resolved by name rather than imported",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><Unknown :a="a" /></div></template>`,
      /must be imported, or be this one/,
    ],
    [
      "a function call the server has no twin for",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.normalize() }}</i></template>`,
      /`\.normalize\(\)` is not supported/,
    ],
    [
      "a dynamic component over any string",
      `<script setup lang="ts">
defineProps<{ tag: string }>();
</script>
<template><div><component :is="tag" /></div></template>`,
      /X\.vue:4:\d+: `<component :is>` renders a closed set of choices: .*`tag` is not typed as a union of string literals/,
    ],
    [
      "a dynamic component over a value from elsewhere",
      `<script setup lang="ts">
import { ref } from "vue";
const chosen = ref<string>("b");
</script>
<template><div><component :is="chosen.toUpperCase()" /></div></template>`,
      /`<component :is>` renders a closed set of choices: .*this value is not one of those/,
    ],
    [
      "a dynamic component naming a custom element",
      `<script setup lang="ts">
defineProps<{ wide: boolean }>();
</script>
<template><div><component :is="wide ? 'my-wide' : 'b'" /></div></template>`,
      /`my-wide` is not an HTML element `<component :is>` renders/,
    ],
    [
      "a dynamic component over an optional prop",
      `<script setup lang="ts">
defineProps<{ tag?: "b" | "i" }>();
</script>
<template><div><component :is="tag">x</component></div></template>`,
      /`tag` may be absent, where Vue renders `<!---->` or fails/,
    ],
    [
      "a dynamic component reading a key its object lacks",
      `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ kind: "y" | "z" }>();
const KINDS = { y: Y };
</script>
<template><div><component :is="KINDS[kind]" /></div></template>`,
      /`z` is not a key of `KINDS`/,
    ],
    [
      "v-html on a dynamic component",
      `<script setup lang="ts">
defineProps<{ tag: "b" | "i"; html: string }>();
</script>
<template><div><component :is="tag" v-html="html" /></div></template>`,
      /X\.vue:4:\d+: `v-html` on `<component :is>`: Vue's server renders the element empty/,
    ],
    [
      "v-show inside a dynamic element",
      `<script setup lang="ts">
defineProps<{ tag: "b" | "i"; on: boolean }>();
</script>
<template><component :is="tag"><u v-show="on">u</u></component></template>`,
      /X\.vue:4:\d+: `v-show` in content Vue renders from virtual nodes/,
    ],
    [
      "a class apart from a later :class inside a dynamic element",
      `<script setup lang="ts">
defineProps<{ tag: "b" | "i"; on: boolean }>();
</script>
<template><component :is="tag"><u class="a" title="t" :class="{ on }">u</u></component></template>`,
      /X\.vue:4:\d+: in content Vue renders from virtual nodes, a `class` written before `:class`/,
    ],
    [
      "v-model on a select inside a dynamic element",
      `<script setup lang="ts">
import { ref } from "vue";
defineProps<{ tag: "div" | "p" }>();
const picked = ref("a");
</script>
<template><component :is="tag"><select v-model="picked"><option value="a">A</option></select></component></template>`,
      /`v-model` on a `<select>` in content Vue renders from virtual nodes/,
    ],
    [
      "a ClientOnly fallback inside a dynamic element",
      `<script setup lang="ts">
import { ClientOnly } from "ferrovue/client";
defineProps<{ tag: "div" | "p" }>();
</script>
<template><component :is="tag"><ClientOnly><template #fallback><b>wait</b></template><i>now</i></ClientOnly></component></template>`,
      /X\.vue:5:\d+: `<ClientOnly>` with a `#fallback` in content Vue renders from virtual nodes/,
    ],
    [
      "a slot with fallback content inside a dynamic element",
      `<script setup lang="ts">
defineProps<{ tag: "b" | "i" }>();
</script>
<template><component :is="tag"><slot>none</slot></component></template>`,
      /`<slot>` has fallback content and is rendered inside an element `<component :is>` chooses/,
    ],
    [
      "a slot rendered inside a dynamic element and outside one",
      `<script setup lang="ts">
defineProps<{ tag: "b" | "i"; twice: boolean }>();
</script>
<template><component :is="tag" v-if="twice"><slot /></component><p v-else><slot /></p></template>`,
      /`<slot>` is rendered both inside an element `<component :is>` chooses and outside one/,
    ],
    [
      "a custom directive the configuration does not declare client-only",
      `<script setup lang="ts">
const vFocus = { mounted: (el: HTMLElement) => el.focus() };
defineProps<{ a: string }>();
</script>
<template><input v-focus /></template>`,
      /custom directive `v-focus` may add attributes.*`clientDirectives`/,
    ],
    [
      "a literal class name with spaces around it, which Vue keeps between its neighbours",
      `<script setup lang="ts">
defineProps<{ on: boolean }>();
</script>
<template><i :class="{ ' wide ': on, tall: on }"></i></template>`,
      /class name ` wide ` has spaces around it/,
    ],
    [
      "loose equality, which converts between types as `===` does not",
      `<script setup lang="ts">
defineProps<{ a: string; b: string }>();
</script>
<template><i v-if="a == b">x</i></template>`,
      /`==`/,
    ],
    [
      "a field the object's type does not declare",
      `<script setup lang="ts">
interface User { name: string }
defineProps<{ user: User }>();
</script>
<template><i>{{ user.age }}</i></template>`,
      /`User` has no field `age`/,
    ],
    [
      "computed member access",
      `<script setup lang="ts">
defineProps<{ names: string[]; i: number }>();
</script>
<template><i>{{ names[i] }}</i></template>`,
      /computed member access/,
    ],
    [
      "`.includes()` of a value of another type than the list's",
      `<script setup lang="ts">
defineProps<{ names: string[]; n: number }>();
</script>
<template><i v-if="names.includes(n)">x</i></template>`,
      /`\.includes\(\)` looks for a value of the list's own type/,
    ],
    [
      "`$slots.x` for a slot the template does not render",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><div><i v-if="$slots.footer">x</i><slot /></div></template>`,
      /`\$slots\.footer` names a slot this template does not render/,
    ],
    [
      "an empty literal class name",
      `<script setup lang="ts">
defineProps<{ on: boolean }>();
</script>
<template><i :class="{ '': on }"></i></template>`,
      /class name `` has spaces around it/,
    ],
    [
      "a type that is both null and undefined",
      `<script setup lang="ts">
defineProps<{ a: string | null | undefined }>();
</script>
<template><i>{{ a }}</i></template>`,
      /X\.vue:2:\d+: a type that is both `null` and `undefined`: its Rust type is an `Option`/,
    ],
    [
      "an optional field that may be null",
      `<script setup lang="ts">
defineProps<{ a?: string | null }>();
</script>
<template><i>{{ a }}</i></template>`,
      /X\.vue:2:\d+: `a\?: T \| null` may be absent, which is `undefined`, or `null`: .*declare it `a: T \| null` or `a\?: T`/,
    ],
    [
      "an optional field whose alias may be null",
      `<script setup lang="ts">
type Maybe = string | null;
defineProps<{ a?: Maybe }>();
</script>
<template><i>{{ a }}</i></template>`,
      /X\.vue:3:\d+: `a\?: T \| null` may be absent/,
    ],
    [
      "an alias that may be null, made undefined too",
      `<script setup lang="ts">
type Maybe = string | null;
defineProps<{ a: Maybe | undefined }>();
</script>
<template><i>{{ a }}</i></template>`,
      /a type that is both `null` and `undefined`/,
    ],
    [
      "a default for a nullable prop",
      `<script setup lang="ts">
withDefaults(defineProps<{ a: string | null }>(), { a: "x" });
</script>
<template><i>{{ a }}</i></template>`,
      /X\.vue:2:\d+: a default for `a`, which is `T \| null`: Vue gives it only when `a` is absent/,
    ],
    [
      "a model that may be null and is not required",
      `<script setup lang="ts">
const value = defineModel<string | null>();
</script>
<template><i>{{ value }}</i></template>`,
      /X\.vue:2:\d+: a `defineModel` of `T \| null` that is not `required`/,
    ],
    [
      "options given to useHead",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ title: props.a }, { tagPriority: "high" });
</script>
<template><i>{{ a }}</i></template>`,
      /`useHead`'s options are not translated/,
    ],
    [
      "a head input that is not an object literal",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead(props.a);
</script>
<template><i>{{ a }}</i></template>`,
      /`useHead` takes an object literal, or a getter returning one/,
    ],
    [
      "templateParams in the head",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ templateParams: { site: props.a } });
</script>
<template><i>{{ a }}</i></template>`,
      /`templateParams` needs unhead's template params plugin/,
    ],
    [
      "a head key ferrovue does not translate",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ bodyClass: props.a });
</script>
<template><i>{{ a }}</i></template>`,
      /`bodyClass` is not a key of the head ferrovue translates/,
    ],
    [
      "a spread in a head input",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ ...{ title: props.a } });
</script>
<template><i>{{ a }}</i></template>`,
      /no spread, computed key or method/,
    ],
    [
      "a titleTemplate function",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ titleTemplate: (t: string) => t + " - x" });
</script>
<template><i>{{ a }}</i></template>`,
      /a `titleTemplate` function runs with the title/,
    ],
    [
      "an event handler in the head",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ script: [{ src: "/a.js", onload: () => props.a }] });
</script>
<template><i>{{ a }}</i></template>`,
      /`onload` is an event handler, which runs only on the client/,
    ],
    [
      "a getter taking arguments in the head",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ title: (x: string) => props.a });
</script>
<template><i>{{ a }}</i></template>`,
      /a function in a head input is a getter of its value/,
    ],
    [
      "a head value of a list where one value goes",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ title: props.tags });
</script>
<template><i>{{ a }}</i></template>`,
      /`title` is a list/,
    ],
    [
      "a tagPosition that is not a literal",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ script: [{ src: "/a.js", tagPosition: props.a }] });
</script>
<template><i>{{ a }}</i></template>`,
      /`tagPosition` is one of "head", "bodyClose", "bodyOpen", written as a literal/,
    ],
    [
      "useHeadSafe",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHeadSafe({ title: props.a });
</script>
<template><i>{{ a }}</i></template>`,
      /`useHeadSafe` filters its input through unhead's safe input plugin/,
    ],
    [
      "an object given to a useSeoMeta key",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useSeoMeta({ robots: { index: true } });
</script>
<template><i>{{ a }}</i></template>`,
      /`robots` given an object or an array/,
    ],
    [
      "a class in the head that may be null",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ htmlAttrs: { class: props.n } });
</script>
<template><i>{{ a }}</i></template>`,
      /`class` may be `null`, on which unhead's renderer throws/,
    ],
    [
      "textContent on a meta tag",
      `<script setup lang="ts">
import { useHead, useHeadSafe, useSeoMeta } from "@unhead/vue";
const props = defineProps<{ a: string; n: string | null; tags: string[] }>();
useHead({ meta: [{ name: "x", textContent: props.a }] });
</script>
<template><i>{{ a }}</i></template>`,
      /`textContent` on a `meta`, which has no content/,
    ],
  ];

  const children = {
    Y: `<script setup lang="ts">
defineProps<{ b?: string }>();
</script>
<template><b>{{ b }}</b></template>`,
    Z: `<script setup lang="ts">
defineProps<{ c: string | null }>();
</script>
<template><b>{{ c }}</b></template>`,
  };

  const codes: Record<string, Code> = {
    "a type parameter without a constraint": "FV0302",
    "an enum read whole": "FV0208",
    "an enum read by a key chosen at run time": "FV0222",
    "a value read from `$attrs`, which has no type": "FV0415",
    "a runtime props declaration, which has no types": "FV0303",
    "watchEffect, which runs on the server": "FV0103",
    "a setup statement that changes state": "FV0105",
    "an interface whose name the generated Rust already uses": "FV0318",
    "a strict comparison of a value that may be null or undefined": "FV0626",
    "loose equality between values": "FV0619",
    "a nullable prop the parent leaves out": "FV0507",
    "two halves of surrogate pairs compared, which JavaScript tells apart": "FV0706",
    "a negative literal count for repeat, which throws": "FV0714",
    "toLocaleUpperCase, which depends on the server's locale": "FV0715",
    "replace with a regular expression": "FV0710",
    "an arrow function with a block body": "FV0806",
    "Object.entries outside a v-for": "FV0816",
    "a computed list as a slot prop": "FV0910",
    "a component written with the Options API": "FV0003",
    "a constructor called in the template": "FV0624",
    "a CSS module, whose class names the bundler chooses": "FV1005",
    "a style property whose place would depend on a condition": "FV1011",
    "a dynamic component over any string": "FV0418",
    "a dynamic component over a value from elsewhere": "FV0418",
    "a dynamic component naming a custom element": "FV0419",
    "a dynamic component over an optional prop": "FV0420",
    "a dynamic component reading a key its object lacks": "FV0421",
    "v-html on a dynamic component": "FV0422",
    "a slot with fallback content inside a dynamic element": "FV0919",
    "v-show inside a dynamic element": "FV0423",
    "v-model on a select inside a dynamic element": "FV0423",
    "a ClientOnly fallback inside a dynamic element": "FV1511",
    "a class apart from a later :class inside a dynamic element": "FV1013",
    "a slot rendered inside a dynamic element and outside one": "FV0920",
    "a custom directive the configuration does not declare client-only": "FV0405",
    "a type that is both null and undefined": "FV0311",
    "a default for a nullable prop": "FV0307",
    "options given to useHead": "FV1701",
    "a head input that is not an object literal": "FV1702",
    "templateParams in the head": "FV1703",
    "a head key ferrovue does not translate": "FV1703",
    "a spread in a head input": "FV1704",
    "a titleTemplate function": "FV1705",
    "an event handler in the head": "FV1705",
    "a getter taking arguments in the head": "FV1705",
    "a head value of a list where one value goes": "FV1706",
    "a tagPosition that is not a literal": "FV1707",
    "useHeadSafe": "FV1708",
    "an object given to a useSeoMeta key": "FV1709",
    "a class in the head that may be null": "FV1710",
    "textContent on a meta tag": "FV1711",
  };

  const refusal = (project: string): GenError => {
    try {
      compile(project);
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("names a code for every refusal it checks the code of", () => {
    expect(Object.keys(codes).filter((what) => !refused.some(([w]) => w === what))).toEqual([]);
  });

  for (const [what, source, message] of refused) {
    it(`refuses ${what}`, () => {
      const e = refusal(island(source, children));
      expect(e.message).toMatch(message);
      expect(e.message).toMatch(/^components\/X\.vue:\d+:\d+: /);
      expect(Object.keys(ERRORS)).toContain(e.code);
      expect(e.at).toMatchObject({ file: "components/X.vue", line: Number(e.message.split(":")[1]) });
      expect(e.code).toBe(codes[what] ?? e.code);
    });
  }
});
