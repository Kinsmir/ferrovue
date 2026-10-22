import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileTemplate, parse as parseSfc } from "@vue/compiler-sfc";
import { GenError, GenErrors, generate, loadConfig } from "../src/compiler.ts";
import { type Code, ERRORS } from "../src/errors.ts";
import { GENERATED_VERSION } from "../src/rust.ts";

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

  describe("every refusal of a run", () => {
    const refusals = (project: string): GenErrors => {
      try {
        compile(project);
      } catch (e) {
        if (e instanceof GenErrors) return e;
        throw e;
      }
      throw new Error("compiled without an error");
    };
    const where = (e: GenErrors): string[] => e.errors.map((one) => (one instanceof GenError ? `${one.code} ${one.at?.file}:${one.at?.line}` : "syntax"));

    it("reports each refused statement of a template, and of every component, in the order of files and lines", () => {
      const e = refusals(
        island(
          `<script setup lang="ts">
defineProps<{ n: number; on: boolean }>();
</script>
<template>
  <p>{{ n.toLocaleString() }}</p>
  <p v-if="on">{{ n.toFixed(200) }}</p>
  <i>{{ n }}</i>
</template>`,
          { A: `<script setup lang="ts">\nimport { watchEffect } from "vue";\nwatchEffect(() => {});\n</script>\n<template><i></i></template>` },
        ),
      );
      expect(where(e)).toEqual(["FV0103 components/A.vue:3", "FV1805 components/X.vue:5", expect.stringMatching(/^FV\d{4} components\/X\.vue:6$/)]);
      expect(e).toBeInstanceOf(GenError);
      expect(e.code).toBe("FV0103");
      expect(e.unchecked).toEqual([]);
    });

    it("leaves a component that uses a refused one unchecked, and checks the rest", () => {
      const bad = `<script setup lang="ts">\ndefineProps<{ n: number }>();\n</script>\n<template><p>{{ n.toLocaleString() }}</p></template>`;
      const e = refusals(
        island(`<script setup lang="ts">\nimport B from "./B.vue";\n</script>\n<template><B :n="1" /><p>{{ (1).toLocaleString() }}</p></template>`, { B: bad, C: bad }),
      );
      expect(where(e)).toEqual(["FV1805 components/B.vue:4", "FV1805 components/C.vue:4"]);
      expect(e.unchecked).toEqual(["components/X.vue"]);
    });

    it("names what the template wrote, says how to get around it, and names syntax in words", () => {
      const project = island(
        `<script setup lang="ts">
import { computed } from "vue";
import { fmt } from "./util";
const props = defineProps<{ n: number; pair: [number, number] }>();
function twice(x: number) { return x * 2; }
const big = computed(() => {
  for (const m of [props.n]) return m;
  return 0;
});
</script>
<template>
  <p>{{ fmt(n) }}</p>
  <p>{{ fmt }}</p>
  <p>{{ twice }}</p>
  <p>{{ big }}</p>
  <p>{{ nowhere(n) }}</p>
  <p>{{ ({ a: n }) }}</p>
  <p :title="() => n">x</p>
</template>`,
      );
      writeFileSync(join(project, "components", "util.ts"), "export function fmt(n: number): string { return String(n); }\n");
      const e = refusals(project);
      const said = e.errors.map((one) => [(one as GenError).code, (one as GenError).what, (one as GenError).help]);
      expect(said).toEqual([
        ["FV0316", "a tuple type is not supported as a prop type", null],
      ]);
      writeFileSync(join(project, "components", "X.vue"), readFileSync(join(project, "components", "X.vue"), "utf8").replace("; pair: [number, number]", ""));
      const again = refusals(project).errors.map((one) => [(one as GenError).code, (one as GenError).what, (one as GenError).help]);
      expect(again).toEqual([
        ["FV0613", "`fmt` is set up in a way the server cannot evaluate: it is a function imported from components/util.ts, which the template and a `computed` may call, and only an event handler may name without calling it", "call it, as `fmt(…)`, which the server translates, or name it only in an event handler"],
        ["FV0613", "`twice` is set up in a way the server cannot evaluate: it is a function, which the template and a `computed` may call, and only an event handler may name without calling it", "call it, as `twice(…)`, which the server translates, or name it only in an event handler"],
        [
          "FV0613",
          "`big` is set up in a way the server cannot evaluate: a function's body may not hold a `for…of` loop: it holds `const` (and `let` never assigned again), `if` / `else`, `switch` and `return`; compute a list with `.map()`, `.filter()` or `.reduce()` (line 7)",
          "compute the value in Rust and pass it as a prop, or read it only from an event handler",
        ],
        ["FV0601", "`nowhere()` is not available when rendering on the server", "a template calls JavaScript's built-ins and the helpers with Rust twins under `helpers.functions` in ferrovue.config.json; compute the value in Rust and pass it as a prop"],
        ["FV0625", "an object literal is not supported in a template", null],
        ["FV0625", "an arrow function is not supported in a template", null],
      ]);
    });

    it("refuses a template's read of a constant the compiler cannot evaluate with the constant's own code and place, and a setup binding where it is read", () => {
      const project = island(`<script setup lang="ts">
import { LIMIT } from "./consts";
const local = (1).toLocaleString();
</script>
<template><i>{{ LIMIT }}</i><b>{{ local }}</b></template>`);
      writeFileSync(join(project, "components", "consts.ts"), "export const LIMIT = Math.random();\n");
      const [constant, local] = refusals(project).errors as GenError[];
      expect(constant).toMatchObject({ code: "FV0207", at: { file: "components/consts.ts", line: 1, column: 22 }, readAt: { file: "components/X.vue", line: 5, column: 17 } });
      expect(constant!.what).toMatch(/\(the template reads it as `LIMIT` at components\/X\.vue:5:17\)$/);
      expect(constant!.message).toMatch(/^components\/consts\.ts:1:22: .*\n 1 \| export const LIMIT = Math\.random\(\);/);
      expect(local).toMatchObject({ code: "FV0613", at: { file: "components/X.vue", line: 5, column: 35 }, readAt: null });
    });

    it("raises a `GenErrors` for a single refusal too", () => {
      const e = refusals(island(`<template><p>{{ (1).toLocaleString() }}</p></template>`));
      expect(e.errors).toHaveLength(1);
      expect(e.message).toBe(e.errors[0]!.message);
    });
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

  it("renders the union's last choice in the `_` arm of `<component :is>`, however the choices group", () => {
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
    expect(out).toContain('"b" => {\n            super::z::render(');
    expect(out).toContain("_ => {\n            super::y::render(");
    expect(out).toContain('match &*props.k { "b" => "strong", _ => "em" }');
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

    it("takes Boolean as a list method's function, and keeps the present items of optional ones", () => {
      const out = compile(
        island(`<script setup lang="ts">
interface Row { n: number }
const props = defineProps<{ tags: (string | null)[]; rows: (Row | null)[]; words: string[]; name: string; title?: string }>();
</script>
<template><i>{{ tags.filter(Boolean).join() }}{{ rows.filter(Boolean).length }}{{ words.some(Boolean) }}{{ [name, title, null].filter(Boolean).join(" ") }}{{ Boolean(title) }}</i></template>`),
      ).get("x.rs")!;
      expect(out).toContain("props.tags.iter().filter_map(|v| v.as_deref()).map(std::borrow::Cow::<str>::Borrowed).filter(|fv_s1| !fv_s1.is_empty())");
      expect(out).toContain("props.rows.iter().filter_map(|v| v.as_ref()).count()");
      expect(out).toMatch(/\.any\(\|fv_s\d+\| !fv_s\d+\.is_empty\(\)\)/);
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
      expect(out).toMatch(/\.enumerate\(\)\.filter\(\|fv_e\d+\| \{ let fv_i\d+ = fv_e\d+\.0 as i64; /);
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
      expect(out).toMatch(/let s_a = if let Some\(n\d+\) = props\.item\.as_ref\(\) \{ &n\d+\.children\[\.\.\] \} else \{ (?:&\[\]|s_none|<&\[Props<'_>\]>::default\(\)) \};/);
      expect(out).toContain("for x_ref in s_a.iter() {");
      expect(out).not.toContain(".collect::<Vec<_>>()");
    });

    it("walks a `?:` between a list and an empty one in the template", () => {
      const out = tree("", `<i v-for="x in (flag ? others : [])">{{ x.label }}</i><b>{{ (item ? item.children : []).length }}</b>`);
      expect(out).toContain("for x_ref in (if props.flag { &props.others[..] } else { &[] }).iter() {");
      expect(out).toMatch(/\(if let Some\(n\d+\) = props\.item\.as_ref\(\) \{ &n\d+\.children\[\.\.\] \} else \{ &\[\] \}\)\.len\(\) as i64/);
    });

    it("types the empty array literal a `?:` with a constant test chooses by the branch it leaves", () => {
      const out = tree("", `<i v-for="x in (false ? others : [])">{{ x.label }}</i><b>{{ (true ? [] : item?.tags ?? []).length }}</b>`);
      expect(out).toContain("for x_ref in <&[Props<'_>]>::default().iter() {");
      expect(out).toContain("<&[std::borrow::Cow<str>]>::default().len() as i64");
    });

    it("borrows both lists of a `?:` between two", () => {
      const out = tree("", `<i v-for="x in (flag ? others : item ? item.children : [])">{{ x.label }}</i>`);
      expect(out).toMatch(/if props\.flag \{ &props\.others\[\.\.\] \} else \{ if let Some\(n\d+\) = props\.item\.as_ref\(\) \{ &n\d+\.children\[\.\.\] \} else \{ &\[\] \} \}/);
    });

    it("falls back to an empty list, or another list, with `??` after `?.`", () => {
      const out = tree("const a = computed(() => props.item?.children ?? []);", `<i v-for="x in a">{{ x.label }}</i>{{ (item?.tags ?? []).join() }}{{ (item?.children ?? others).length }}`);
      expect(out).toMatch(/let s_a = props\.item\.as_ref\(\)\.map\(\|(fv_o\d+)\| &\1\.children\)\.map\(\|v\| &v\[\.\.\]\)\.unwrap_or\(&\[\]\);/);
      expect(out).toMatch(/props\.item\.as_ref\(\)\.and_then\(\|(fv_o\d+)\| \1\.tags\.as_ref\(\)\)\.map\(\|v\| &v\[\.\.\]\)\.unwrap_or\(&\[\]\)/);
      expect(out).toMatch(/props\.item\.as_ref\(\)\.map\(\|(fv_o\d+)\| &\1\.children\)\.map\(\|v\| &v\[\.\.\]\)\.unwrap_or\(&props\.others\[\.\.\]\)\.len\(\)/);
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
      expect(out).toMatch(/props\.outer\.as_ref\(\)\.map\(\|(fv_o\d+)\| &\1\.inner\)/);
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
      expect(() => tree(setup, "<i>{{ a }}</i>")).toThrow(expect.objectContaining({ code: "FV0613", message: expect.stringMatching(message) }));
    });

    it("leaves a `?:` between two empty array literals untyped", () => {
      expect(() => tree("", `<i v-for="x in (flag ? [] : [])">{{ x }}</i>`)).toThrow(expect.objectContaining({ code: "FV0819" }));
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

    it("hands a component rendering itself a v-bind of its own Props beside a listener, which the server skips", () => {
      const row = `<script setup lang="ts">
export interface Props { id: string; label: string; rows: Props[] }
defineProps<Props>();
const emit = defineEmits<{ loaded: [rows: Props[]] }>();
function take(row: Props, more: Props[]) {
  emit("loaded", [row, ...more]);
}
</script>
<template><div>{{ label }}<X v-for="r in rows" :key="r.id" v-bind="r" @loaded="(more) => take(r, more)" /></div></template>`;
      const out = compile(island(row)).get("x.rs")!;
      expect(out).toContain("super::x::render(out, r);");
    });

    it("skips listeners beside a v-bind of the child's Props, in every form", () => {
      const parent = `<script setup lang="ts">
import Child from "./Child.vue";
import type { Props as ChildProps } from "./Child.vue";
const props = defineProps<{ items: ChildProps[]; ev: string }>();
function note() {}
const handlers = { click: note, Picked: note };
</script>
<template><ul>
  <Child v-for="item in items" v-bind="item" @picked="note" v-on:hover.once="note" @update:label="note" />
  <Child v-for="item in items" v-bind="item" v-on="handlers" />
  <Child v-for="item in items" v-bind="item" @[ev]="note" />
  <Child label="x" title="t" @[ev]="note" @click="note" />
</ul></template>`;
      const out = compile(island(parent, { Child: child })).get("x.rs")!;
      expect(out.match(/super::child::render(_scoped)?\(out, item(, &fv::Attrs::NONE)?\);/g)).toHaveLength(3);
      expect(out).toContain(`("title", fv::Attr::str("t"))`);
      expect(out).not.toMatch(/"on[A-Z]/);
    });

    it("gives a prop named like a listener the value bound to it, as Vue does", () => {
      const sale = `<script setup lang="ts">
defineProps<{ label: string; onSale?: boolean }>();
</script>
<template><b>{{ label }}<i v-if="onSale">!</i></b></template>`;
      const parent = `<script setup lang="ts">
import Sale from "./Sale.vue";
</script>
<template><div><Sale label="x" :on-sale="true" /></div></template>`;
      expect(compile(island(parent, { Sale: sale })).get("x.rs")).toContain("on_sale: Some(true)");
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
        /`TrustedHtml` is imported from `\.\/somewhere-else`, which the compiler cannot resolve to a `\.ts` file of the project/,
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
      expect(out.get("route_table.rs")).toContain('ferrovue::RouteDef::new("/users/:id").with_name("user"),');
    });

    it("writes nested routes as a tree, and asks a nested route for its parent's parameters too", () => {
      const root = island(linkTo("{ name: 'post', params: { id, post: id } }"));
      writeFileSync(
        join(root, "routes.json"),
        JSON.stringify([{ path: "/users/:id", name: "user", children: [{ path: "", name: "user-home" }, { path: "posts/:post", name: "post" }] }]),
      );
      const out = generate(root, { ...CONFIG, routes: "routes.json" });
      expect(out.get("route_table.rs")).toContain('ferrovue::RouteDef::new("posts/:post").with_name("post"),');
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
      expect(table).toContain('ferrovue::RouteDef::new("/").with_name("/"),');
      expect(table).toContain('ferrovue::RouteDef::new("/books").with_view(false).with_children(&[\n        ferrovue::RouteDef::new(":id").with_name("/books/[id]"),');
      expect(table).toContain('ferrovue::RouteDef::new("/:path(.*)").with_name("/[...path]"),');
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
      expect(out.get("route_table.rs")).toContain('ferrovue::RouteDef::new("/:lang?").with_view(false).with_children(&[');
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
    <p>{{ n.toLocaleString() }}</p>
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
<template><b>{{ n.toLocaleString() }}</b></template>`)).toBe("components/X.vue:4:17");
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
  when: Map<string, string>;
}>();
</script>
<template><i></i></template>`)).toBe("components/X.vue:3:9");
    });

    it("quotes the line with a caret under the construct", () => {
      expect(() =>
        compile(island(`<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><b>{{ n.toLocaleString() }}</b></template>`)),
      ).toThrow(" 4 | <template><b>{{ n.toLocaleString() }}</b></template>\n   |                 ^");
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

    it("writes toPrecision and toExponential with the runtime's twins, a fractional argument truncated as for toFixed", () => {
      const source = numbers.replace(
        "{{ qty % 3 }}",
        "{{ qty % 3 }}|{{ price.toPrecision(3) }}|{{ qty.toPrecision(100.5) }}|{{ price.toPrecision() }}|{{ qty.toPrecision(undefined) }}|{{ price.toExponential(0) }}|{{ qty.toExponential(2.9) }}|{{ price.toExponential() }}|{{ price.toExponential(undefined) }}|{{ price.toFixed(1.5) }}|{{ qty.toFixed(undefined) }}",
      );
      const out = compile(island(source)).get("x.rs")!;
      expect(out).toContain("fv::js_to_precision(props.price, 3)");
      expect(out).toContain("fv::js_to_fixed(props.price, 1)");
      expect(out).toContain("fv::js_to_fixed(props.qty as f64, 0)");
      expect(out).toContain("fv::js_to_precision(props.qty as f64, 100)");
      expect(out).toContain("fv::Js(props.price).to_string()");
      expect(out).toContain("fv::Js(props.qty).to_string()");
      expect(out).toContain("fv::js_to_exponential(props.price, Some(0))");
      expect(out).toContain("fv::js_to_exponential(props.qty as f64, Some(2))");
      expect(out.match(/fv::js_to_exponential\(props\.price, None\)/g)).toHaveLength(2);
    });

    it("refuses toFixed with digits that are not a literal", () => {
      const source = numbers.replace("toFixed(2)", "toFixed(qty)");
      expect(() => compile(island(source))).toThrow(/`\.toFixed\(\)` takes a literal number of digits/);
    });
  });

  describe("dates", () => {
    const dated = (script: string, template: string) => `<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ at: string; ms: number }>();
${script}
</script>
<template><p>${template}</p></template>`;

    it("reads a date as a time value, through the runtime's twins of Date", () => {
      const out = compile(
        island(dated("const d = computed(() => new Date(props.at));", '{{ d.toISOString() }}|{{ d.getUTCFullYear() }}|{{ new Date(ms).getTime() }}|{{ Date.parse(at) }}|{{ new Date("2024-01-15T10:00Z").valueOf() }}|{{ d.getTime() === d.getTime() }}')),
      ).get("x.rs")!;
      expect(out).toContain("let s_d = std::cell::LazyCell::new(|| fv::js_date_parse(&props.at));");
      expect(out).toContain("fv::escape_into(out, &fv::js_to_iso_string(*s_d));");
      expect(out).toContain("fv::push_number(out, fv::js_utc_full_year(*s_d));");
      expect(out).toContain("fv::push_number(out, fv::js_time_clip(props.ms as f64));");
      expect(out).toContain("fv::push_number(out, fv::js_date_parse(&props.at));");
      expect(out).toContain("fv::push_number(out, 1705312800000.0f64);");
      expect(out).toContain("if !(*s_d).is_nan() {");
    });

    it("writes a date as toUTCString, toJSON and JSON.stringify do, builds one with Date.UTC and orders two", () => {
      const out = compile(
        island(dated("const d = computed(() => new Date(props.at));\nconst j = computed(() => d.value.toJSON());", '{{ d.toUTCString() }}|{{ j ?? "none" }}|{{ JSON.stringify(d) }}|{{ Date.UTC(ms) }}|{{ Date.UTC(99, 11, 31, 23, 59, 59.9, 999.5) }}|{{ Date.UTC(ms, 1, 2) }}|{{ d < new Date(ms) }}|{{ d >= d }}<b :title="d.toJSON()"></b>')),
      ).get("x.rs")!;
      expect(out).toContain("let s_j = std::cell::LazyCell::new(|| fv::js_to_json(*s_d).map(std::borrow::Cow::<str>::Owned));");
      expect(out).toContain("fv::escape_into(out, &fv::js_to_utc_string(*s_d));");
      expect(out).toContain('fv::escape_into(out, (*s_j).as_deref().unwrap_or("none"));');
      expect(out).toContain("fv::escape_into(out, &fv::js_json_date(*s_d));");
      expect(out).toContain("fv::push_number(out, fv::js_date_utc(props.ms as f64, 0.0f64, 1.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64));");
      expect(out).toContain('out.push_str("|946684799999|");');
      expect(out).toContain('out.push_str(if (*s_d) < fv::js_time_clip(props.ms as f64) { "true" } else { "false" });');
      expect(out).toContain('out.push_str(if !(*s_d).is_nan() { "true" } else { "false" });');
      expect(out).toContain("if let Some(v) = fv::js_to_json(*s_d).as_deref() {");
    });

    it("tests a number with Number.isNaN and its kin, and takes a date's || as its ??", () => {
      const out = compile(
        island(`<script setup lang="ts">
import type { Float } from "ferrovue/types";
defineProps<{ at: Date; edited?: Date; deleted: Date | null; n: number; x: Float; maybe?: Float }>();
</script>
<template><p v-if="!Number.isNaN(at.getTime())">{{ Number.isFinite(x) }}|{{ Number.isInteger(x) }}|{{ Number.isSafeInteger(x + 1) }}|{{ Number.isSafeInteger(n) }}|{{ Number.isInteger(n) }}|{{ isNaN(x) }}|{{ Number.isNaN(maybe) }}|{{ (edited || at).getTime() }}|{{ (deleted || edited || at).getTime() }}|{{ (at || edited).getTime() }}|{{ Boolean(edited) }}<b v-if="!Number.isSafeInteger(n)">big</b></p></template>`),
      ).get("x.rs")!;
      expect(out).toContain("if !fv::js_time_of(&props.at).is_nan() {");
      expect(out).toContain("if props.x.is_finite() {");
      expect(out).toContain("if props.x.fract() == 0.0 {");
      expect(out).toContain("if matches!(props.x + 1.0, v if v.fract() == 0.0 && v.abs() <= 9_007_199_254_740_991.0) {");
      expect(out).toContain("if (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&props.n) {");
      expect(out).toContain("if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&props.n) {");
      expect(out).toContain("|true|");
      expect(out).toContain("if props.maybe.is_some_and(|v| v.is_nan()) {");
      expect(out).toContain("fv::push_number(out, props.edited.as_ref().map(fv::js_time_of).unwrap_or(fv::js_time_of(&props.at)));");
      expect(out).toContain("props.deleted.as_ref().map(fv::js_time_of).or(props.edited.as_ref().map(fv::js_time_of)).unwrap_or(fv::js_time_of(&props.at))");
      expect(out).toContain("fv::push_number(out, fv::js_time_of(&props.at));");
      expect(out).toContain("if props.edited.as_ref().map(fv::js_time_of).is_some() {");
    });

    const posted = `<script setup lang="ts">
import { computed } from "vue";
import Stamp from "./Stamp.vue";
const props = defineProps<{ posted: Date; edited?: Date; deleted: Date | null }>();
const year = computed(() => props.posted.getUTCFullYear());
</script>
<template><p><time :datetime="posted.toISOString()">{{ year }}</time><b v-if="edited">{{ edited.getTime() }}</b><Stamp :at="posted" :maybe="deleted" :later="edited" :made="new Date(year)" /></p></template>`;
    const stamp = `<script setup lang="ts">
defineProps<{ at: Date; maybe: Date | null; later?: Date; made: Date }>();
</script>
<template><i>{{ at.getTime() }}</i></template>`;

    it("gives a Date prop the Rust type dateType names, read through JsTime and written into data-props as JsDate writes it", () => {
      const out = compile(island(posted, { Stamp: stamp }));
      const x = out.get("x.rs")!;
      expect(x).toContain('    #[serde(rename = "posted", with = "fv::date_prop")]\n    pub posted: ferrovue::JsDate,');
      expect(x).toContain('    #[serde(rename = "edited", default, skip_serializing_if = "Option::is_none", with = "fv::opt_date_prop")]\n    pub edited: Option<ferrovue::JsDate>,');
      expect(x).toContain('    #[serde(rename = "deleted", default, with = "fv::opt_date_prop")]\n    pub deleted: Option<ferrovue::JsDate>,');
      expect(x).toContain("pub fn new(posted: ferrovue::JsDate) -> Self {");
      expect(x).toContain("pub fn edited(mut self, edited: ferrovue::JsDate) -> Self {");
      expect(x).toContain("let s_year = fv::js_utc_full_year(fv::js_time_of(&props.posted));");
      expect(x).toContain("fv::escape_into(out, &fv::js_to_iso_string(fv::js_time_of(&props.posted)));");
      expect(x).toContain("if let Some(n1) = props.edited.as_ref().map(fv::js_time_of) {");
      expect(x).toContain(
        "&super::stamp::Props { at: fv::js_date_prop(fv::js_time_of(&props.posted)), maybe: props.deleted.as_ref().map(fv::js_time_of).map(fv::js_date_prop), later: props.edited.as_ref().map(fv::js_time_of).map(fv::js_date_prop), made: fv::js_date_prop(fv::js_time_clip(s_year)) }",
      );
      const chrono = generate(island(posted, { Stamp: stamp }), { ...CONFIG, dateType: "chrono::DateTime<chrono::Utc>" });
      expect(chrono.get("x.rs")).toContain('    #[serde(rename = "posted", with = "fv::date_prop")]\n    pub posted: chrono::DateTime<chrono::Utc>,');
      expect(chrono.get("stamp.rs")).toContain("    pub later: Option<chrono::DateTime<chrono::Utc>>,");
      expect(chrono.get("x.rs")!.replaceAll("chrono::DateTime<chrono::Utc>", "ferrovue::JsDate")).toBe(x);
    });

    it("gives a Date prop of a props interface the same Rust type", () => {
      const out = compile(island(`<script setup lang="ts">
interface Props { posted: Date; label: string }
const props = defineProps<Props>();
</script>
<template><p>{{ props.posted.getUTCDate() }}{{ label }}</p></template>`)).get("x.rs")!;
      expect(out).toContain("    pub posted: ferrovue::JsDate,");
      expect(out).toContain("fv::push_number(out, fv::js_utc_date(fv::js_time_of(&props.posted)));");
    });

    it("refuses a Date anywhere but a component's own prop, which the client could not revive", () => {
      const refusal = /FV1806|only a component's own prop may be a `Date`, which the client turns back into one from the prop's declared type/;
      const props = (decl: string, extra = "") => `<script setup lang="ts">
${extra}
const props = defineProps<${decl}>();
</script>
<template><i></i></template>`;
      for (const source of [
        props("{ days: Date[] }"),
        props("{ days: Array<Date | null> }"),
        props("{ byName: Record<string, Date> }"),
        props("{ row: Row }", "interface Row { at: Date }"),
        props("{ self: Props; at: Date }", "interface Props { at: Date; self?: Props }"),
      ]) {
        expect(() => compile(island(source)), source).toThrow(refusal);
      }
      const nested = island(props("{ cards: CardProps[] }", 'import type { Props as CardProps } from "./Card.vue";'), { Card: stamp });
      expect(() => compile(nested)).toThrow(/`cards` holds a `Date` inside a list or an object: only a component's own prop may be a `Date`/);
      const typed = `<script setup lang="ts">
import { ref } from "vue";
const at = ref<Date[]>([]);
</script>
<template><i>{{ at.length }}</i></template>`;
      expect(() => compile(island(typed))).toThrow(refusal);
      const model = `<script setup lang="ts">
const at = defineModel<Date>({ required: true });
</script>
<template><i>{{ at.getTime() }}</i></template>`;
      expect(() => compile(island(model))).toThrow(refusal);
    });

    it("refuses a Date prop interpolated, bound to an attribute, given a default or handed to a prop of another type", () => {
      const props = (template: string, script = "") => `<script setup lang="ts">
import Stamp from "./Stamp.vue";
const props = ${script || "defineProps<{ at: Date; maybe?: Date; label: string }>()"};
</script>
<template><p>${template}<Stamp :at="at" :maybe="null" :made="at" /></p></template>`;
      expect(() => compile(island(props("{{ at }}"), { Stamp: stamp }))).toThrow(/`\{\{ \}\}` of a `Date`/);
      expect(() => compile(island(props('<b :title="at"></b>'), { Stamp: stamp }))).toThrow(/a `Date`/);
      expect(() => compile(island(props("{{ maybe }}"), { Stamp: stamp }))).toThrow(/`\{\{ \}\}` of a `Date`/);
      expect(() => compile(island(props("", "withDefaults(defineProps<{ at: Date; maybe?: Date }>(), { maybe: () => new Date(0) })"), { Stamp: stamp }))).toThrow(/the default of `maybe` must be a literal of its type/);
      const wrong = props("").replace(':made="at"', ':made="label"');
      expect(() => compile(island(wrong, { Stamp: stamp }))).toThrow(/the prop is a `Date`, and the value given is a string/);
    });

    it("refuses where a setup binding reads the current time or formats by locale", () => {
      expect(() => compile(island(dated("const now = new Date();", "{{ now.toISOString() }}")))).toThrow(/`now` is set up in a way the server cannot evaluate: .*`new Date\(\)` is the time it runs/);
      const formatter = dated('const money = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });', "{{ money.format(ms) }}");
      expect(() => compile(island(formatter))).toThrow(/`money` is set up in a way the server cannot evaluate: .*`Intl` formats by locale/);
      const i18n = dated('import { useI18n } from "vue-i18n";\nconst { d } = useI18n();', "{{ d(ms) }}");
      expect(() => compile(island(i18n))).toThrow(/`d` from `useI18n\(\)` formats by locale with `Intl`.*`dates_and_prices`/);
    });
  });

  describe("computeds that may throw", () => {
    const setup = (script: string, template: string, style = "") => `<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ at: string; word: string; n: number; tags: string[]; on: boolean }>();
${script}
</script>
<template><section>${template}</section></template>${style}`;
    const render = (script: string, template: string, style = ""): string => {
      const out = compile(island(setup(script, template, style))).get("x.rs")!;
      const at = out.indexOf("pub fn render");
      return out.slice(at, out.indexOf("\n}\n", at));
    };

    it("keeps a computed that cannot panic as a value evaluated before the render", () => {
      const out = render("const upper = computed(() => props.word.toUpperCase());\nconst first = computed(() => props.word.slice(0, 1));", '<p v-if="on">{{ upper }}|{{ first }}</p>');
      expect(out).toContain("let s_upper = props.word.to_uppercase();");
      expect(out).toMatch(/let s_first = fv::js_slice\(/);
      expect(out).not.toContain("LazyCell");
    });

    it("evaluates a computed whose twin panics where JavaScript throws when the render first reads it", () => {
      const out = render(
        "const many = computed(() => props.word.repeat(props.n));\nconst wide = computed(() => props.word.padEnd(props.n));\nconst iso = computed(() => new Date(props.at).toISOString());\nconst ms = computed(() => Date.parse(props.at));",
        '<p v-if="on">{{ many }}|{{ wide }}|{{ iso }}|{{ ms }}</p>',
      );
      expect(out).toContain("let s_many = std::cell::LazyCell::new(|| fv::js_repeat(&props.word, props.n as f64));");
      expect(out).toMatch(/let s_wide = std::cell::LazyCell::new\(\|\| fv::js_pad_end\(/);
      expect(out).toContain("let s_iso = std::cell::LazyCell::new(|| fv::js_to_iso_string(fv::js_date_parse(&props.at)));");
      expect(out).toContain("let s_ms = std::cell::LazyCell::new(|| fv::js_date_parse(&props.at));");
      expect(out).toMatch(/if props\.on \{\n\s+out\.push_str\("<p>"\);\n\s+fv::escape_into\(out, &s_many\);/);
      expect(out).toContain("fv::push_number(out, *s_ms);");
    });

    it("makes a computed lazy when it reads one that is, and leaves one that reads none as it is", () => {
      const out = render(
        "const iso = computed(() => new Date(props.at).toISOString());\nconst stamp = computed(() => `${iso.value}!`);\nconst size = computed(() => stamp.value.length);\nconst label = computed(() => props.word + '?');",
        '<p v-if="on">{{ size }}|{{ label }}</p>',
      );
      expect(out).toContain('let s_stamp = std::cell::LazyCell::new(|| format!("{}!", (*s_iso)));');
      expect(out).toContain("let s_size = std::cell::LazyCell::new(|| fv::js_length(&s_stamp));");
      expect(out).toContain('let s_label = format!("{}?", props.word);');
      expect(out).toContain("fv::push_int(out, *s_size);");
    });

    it("drops a computed the render never reads, and holds lists and optional strings lazily", () => {
      const out = render(
        "const unused = computed(() => props.word.repeat(props.n));\nconst copies = computed(() => props.tags.map((t) => t.repeat(2)));\nconst echoed = computed(() => (props.on ? props.word.repeat(props.n) : undefined));",
        '<i v-for="c in copies">{{ c }}</i>{{ echoed ?? "-" }}',
      );
      expect(out).not.toContain("s_unused");
      expect(out).toMatch(/let s_copies = std::cell::LazyCell::new\(\|\| props\.tags\.iter\(\).*\.collect::<Vec<_>>\(\)\);/);
      expect(out).toContain("for c_cow in (*s_copies).iter()");
      expect(out).toContain('fv::escape_into(out, (*s_echoed).as_deref().unwrap_or("-"));');
    });

    it("evaluates a lazy computed a `v-bind()` in `<style>` reads as the render starts, as Vue's server does", () => {
      const out = render("const wide = computed(() => props.word.padStart(props.n));", '<p v-if="on">x</p>', "\n<style>p { width: v-bind(wide); }</style>");
      expect(out).toMatch(/let s_wide = std::cell::LazyCell::new\(.*\);\n\s+std::cell::LazyCell::force\(&s_wide\);/);
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
      expect(out.get("x.rs")).toContain('fv_i18n.t("apples", &fv::i18n::Args::new().with_plural(props.n))');
      expect(out.get("x.rs")).toContain("fv_i18n: &fv::I18n");
      expect(out.get("i18n.rs")).toContain('("apples", Message::new(&[&[Part::Text("one")], &[Part::Named("n"), Part::Text(" apples")]]))');
      expect(out.get("i18n.rs")).toContain('Part::Linked { key: "a.c", modifier: Some("upper") }');
    });

    it("builds the arguments of a $t call and a locale with no messages through their constructors", () => {
      const out = withLocales(island(translating("$t('a', { n }, [n, 'x'])")), {});
      expect(out.get("x.rs")).toContain('fv_i18n.t("a", &fv::i18n::Args::new().with_named(&[("n", fv::i18n::Value::Int(props.n))]).with_list(&[fv::i18n::Value::Int(props.n), fv::i18n::Value::Str("x")]))');
      expect(out.get("i18n.rs")).toContain('pub static LOCALES: &[Locale] = &[\n    Locale::new("en", &[]),\n];');
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

    it("says a child needs `<script setup>`", () => {
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

    it("refuses a constant it cannot evaluate with its own code and place, naming where it is used", () => {
      const project = withFile(
        island(`<script setup lang="ts">
import { NOW } from "./consts";
</script>
<template><p>{{ NOW }}</p></template>`),
        "consts.ts",
        `export const NOW = Date.now();\n`,
      );
      expect(() => compile(project)).toThrow(
        /^components\/consts\.ts:1:20: a constant the compiler evaluates is a literal.* \(the template reads it as `NOW` at components\/X\.vue:4:17\)\n/,
      );
    });

    const thread = `<script setup lang="ts">
import { load } from "./thread";
defineProps<{ title: string }>();
</script>
<template><h1 @click="load">{{ title }}</h1></template>`;

    it("leaves alone the types of a `.ts` file that nothing the server renders reaches", () => {
      const issue = withFile(island(thread), "thread.ts", "type Row = Record<string, unknown>;\nexport async function load(): Promise<Row[]> { return []; }\n");
      expect([...compile(issue).keys()].toSorted()).toEqual(["mod.rs", "x.rs"]);
      const unreached = withFile(
        island(thread),
        "thread.ts",
        `type Row = Record<string, unknown>;
interface Page { rows: Row[]; next: Date }
export interface Option { a: string }
export interface Unused { a: string }
export async function load(): Promise<Page> { return { rows: [], next: new Date() }; }
`,
      );
      const out = compile(unreached);
      expect(out.has("types.rs")).toBe(false);
      expect(out.get("mod.rs")).not.toContain("pub mod types;");
    });

    it("writes to `types.rs` only the types something reaches, in the order their files declare them", () => {
      const project = withFile(
        island(`<script setup lang="ts">
import { load, type User } from "./models";
import { SORTS } from "./sorts";
defineProps<{ owner: User }>();
</script>
<template><p @click="load">{{ owner.name }}<i v-for="s in SORTS">{{ s.label }}</i></p></template>`),
        "models.ts",
        `export interface Unused { raw: unknown }
export interface Team { title: string }
export interface User { name: string; team: Team }
export interface Draft { body: string }
export function load(): Draft[] { return []; }
`,
      );
      writeFileSync(join(project, "components", "sorts.ts"), `export interface Ignored { x: string }\nexport interface Sort { label: string }\nexport const SORTS: Sort[] = [{ label: "new" }];\n`);
      const types = compile(project).get("types.rs")!;
      expect([...types.matchAll(/^pub struct (\w+)/gm)].map((m) => m[1])).toEqual(["Team", "User", "Sort"]);
      expect(types).toMatch(/^\/\/ @generated by ferrovue from components\/models\.ts, components\/sorts\.ts\./);
    });

    it("refuses a type a prop reaches where the type is declared, with its code", () => {
      const reached = (models: string) =>
        withFile(
          island(`<script setup lang="ts">
import type { Page } from "./models";
defineProps<{ page: Page }>();
</script>
<template><p>{{ page.rows.length }}</p></template>`),
          "models.ts",
          models,
        );
      expect(() => compile(reached("// rows\ntype Row = Record<string, unknown>;\nexport interface Page { rows: Row[] }\n"))).toThrow(
        expect.objectContaining({ code: "FV0316", at: expect.objectContaining({ file: "components/models.ts", line: 2, column: 27 }) }),
      );
      expect(() => compile(reached("export interface Page { rows: Option[] }\nexport interface Option { a: string }\n"))).toThrow(
        expect.objectContaining({ code: "FV0318", at: expect.objectContaining({ file: "components/models.ts", line: 2 }) }),
      );
    });

    it("refuses two `.ts` files declaring one type only once something reaches it", () => {
      const both = (props: string) =>
        island(`<script setup lang="ts">
import { load, type Row } from "./thread";
import { stamp } from "./other";
defineProps<{ ${props} }>();
</script>
<template><h1 @click="load(); stamp()">x</h1></template>`);
      const files = (project: string) => {
        writeFileSync(join(project, "components", "thread.ts"), "export interface Row { id: number }\nexport function load(): void {}\n");
        writeFileSync(join(project, "components", "other.ts"), "interface Row { id: string }\nexport function stamp(): Row { return { id: \"\" }; }\n");
        return project;
      };
      expect(compile(files(both("title?: string"))).has("types.rs")).toBe(false);
      expect(() => compile(files(both("row: Row")))).toThrow(
        expect.objectContaining({ code: "FV0319", message: expect.stringMatching(/^components\/other\.ts:1:1: `Row` is declared by components\/thread\.ts too/) }),
      );
    });

    const cats = (declared: string, template: string, setup = "const cats = shallowRef<Cat[]>([]);") =>
      island(`<script setup lang="ts">
import { shallowRef } from "vue";
${declared}
${setup}
</script>
<template>${template}</template>`);

    it("translates the fields of a component's own type that the server render reads, and drops the others", () => {
      for (const declared of ["interface Cat { id: string; items: HTMLElement[] }", "type Cat = { id: string; items: HTMLElement[] };"]) {
        const x = compile(cats(declared, `<div v-if="cats.length">x</div>`)).get("x.rs")!;
        expect(x).toMatch(/pub struct Cat<'a> \{\n {4}#\[serde\(rename = "id"\)\]\n {4}pub id: Cow<'a, str>,\n\}/);
        expect(x).not.toContain("items");
      }
      expect(compile(cats("interface Cat { id: string; items: HTMLElement[]; pick(): void }", `<b v-for="c in cats">{{ c.id }}</b>`)).get("x.rs")).toContain("pub struct Cat<'a>");
      const shared = withFile(cats(`import type { Cat } from "./cats";`, `<b v-for="c in cats">{{ c.id }}</b>`), "cats.ts", "export interface Cat { id: string; anchor: HTMLElement }\n");
      const types = compile(shared).get("types.rs")!;
      expect(types).toContain("pub struct Cat<'a>");
      expect(types).not.toContain("anchor");
    });

    it("refuses a dropped field where its type is declared once the server render reads it", () => {
      const declared = "interface Cat { id: string; items: HTMLElement[] }";
      for (const template of [`<b v-for="c in cats">{{ c.items.length }}</b>`, `<b v-for="{ items } in cats">{{ items.length }}</b>`]) {
        expect(() => compile(cats(declared, template))).toThrow(
          expect.objectContaining({ code: "FV0315", at: expect.objectContaining({ file: "components/X.vue", line: 3, column: 36 }) }),
        );
      }
      expect(() => compile(cats("interface Cat { id: string; [key: string]: string | HTMLElement }", `<b v-for="c in cats">{{ c.name }}</b>`))).toThrow(
        expect.objectContaining({ code: "FV0320", at: expect.objectContaining({ line: 3, column: 29 }) }),
      );
    });

    it("leaves alone a component's types that nothing the server renders reaches", () => {
      const declared = "interface Cat { el: HTMLElement }\ninterface Option { a: string }";
      for (const setup of ["function pick(c: Cat): Option { return { a: c.el.id }; }", "const picked = shallowRef<Cat | null>(null);", "let els: Array<{ el: HTMLElement }> = [];"]) {
        const x = compile(cats(declared, `<p @click="() => {}">x</p>`, setup)).get("x.rs")!;
        expect(x).not.toMatch(/pub struct (Cat|Option)\b/);
      }
    });

    it("refuses a component's type a prop or a model reaches where its field is declared", () => {
      const declared = "interface Cat { id: string; items: HTMLElement[] }\ninterface Crate { cat: Cat }";
      for (const setup of ["defineProps<{ cat: Cat }>();", "defineProps<Cat>();", "defineProps<{ crates: Crate[] }>();", `const cat = defineModel<Cat>({ required: true });`]) {
        expect(() => compile(cats(declared, "<p>x</p>", setup))).toThrow(
          expect.objectContaining({ code: "FV0315", at: expect.objectContaining({ file: "components/X.vue", line: 3, column: 36 }) }),
        );
      }
      const child = `<script setup lang="ts">
import type { Cat } from "./X.vue";
defineProps<{ cats: Cat[] }>();
</script>
<template><p v-for="c in cats">{{ c.id }}</p></template>`;
      const project = cats("export interface Cat { id: string; items: HTMLElement[] }", `<Child :cats="cats" />`, `import Child from "./Child.vue";\nconst cats = shallowRef<Cat[]>([]);`);
      writeFileSync(join(project, "components", "Child.vue"), child);
      expect(() => compile(project)).toThrow(expect.objectContaining({ code: "FV0315", at: expect.objectContaining({ file: "components/X.vue", line: 3, column: 43 }) }));
    });
  });

  const refused: [string, string, RegExp][] = [
    [
      "a value imported from a module that resolves to no `.ts` file of the project",
      `<script setup lang="ts">
import { LABEL } from "@/lib/format";
</script>
<template><p>{{ LABEL }}</p></template>`,
      /X\.vue:4:\d+: `LABEL` is imported from `@\/lib\/format`, which the compiler cannot resolve to a `\.ts` file of the project: it is a package, or an alias declared neither/,
    ],
    [
      "a listener of a name chosen at run time given to a child with a prop named like a listener",
      `<script setup lang="ts">
import W from "./W.vue";
defineProps<{ ev: string }>();
function note() {}
</script>
<template><W @[ev]="note" /></template>`,
      /X\.vue:6:\d+: a listener whose name is not known before rendering, given to W, which declares `onSale` as a prop/,
    ],
    [
      "listeners from an object given to a child with a prop named like a listener",
      `<script setup lang="ts">
import W from "./W.vue";
function note() {}
const handlers = { sale: note };
</script>
<template><W v-on="handlers" /></template>`,
      /a listener whose name is not known before rendering, given to W, which declares `onSale` as a prop/,
    ],
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
      /`Tone` read by a key that is a `string`, which may name a field every object has, as `toString` or `constructor`: type the key as a union of string literals/,
    ],
    [
      "a constant object read by a key that is a string",
      `<script setup lang="ts">
defineProps<{ k: string }>();
const PAD = { sm: "p-1", md: "p-2" };
</script>
<template><i>{{ PAD[k] }}</i></template>`,
      /`PAD` read by a key that is a `string`, which may name a field every object has, as `toString` or `constructor`: type the key as a union of string literals/,
    ],
    [
      "a constant object read by a key that may be absent",
      `<script setup lang="ts">
defineProps<{ k?: "sm" | "md" }>();
const PAD = { sm: "p-1", md: "p-2" };
</script>
<template><i>{{ PAD[k] }}</i></template>`,
      /`PAD` read by a key that may be absent, where JavaScript reads the field `undefined`: narrow the key with `v-if` first, or give it a default/,
    ],
    [
      "a field of a constant object read by a key it may not have",
      `<script setup lang="ts">
defineProps<{ k: "sm" | "lg" }>();
const PAD = { sm: "p-1", md: "p-2" };
const T = { sm: { label: "S" } };
</script>
<template><i>{{ T[k].label }}</i></template>`,
      /`T\[k\]` may be `undefined`, as it is for the key `lg`, and reading `\.label` of it fails: read it with `\?\.label`/,
    ],
    [
      "a constant object whose values differ in type for the keys of its key",
      `<script setup lang="ts">
defineProps<{ k: "a" | "b" }>();
const PAD = { sm: "p-1", md: "p-2" };
const M = { a: "x", b: 1 };
</script>
<template><i>{{ M[k] }}</i></template>`,
      /`M\[k\]` is a string for some keys and a number for others/,
    ],
    [
      "a constant object without a key that names a field of every object",
      `<script setup lang="ts">
defineProps<{ k: "sm" | "toString" }>();
const PAD = { sm: "p-1", md: "p-2" };
</script>
<template><i>{{ PAD[k] ?? 'x' }}</i></template>`,
      /`PAD` has no field `toString` for the key `toString`, where JavaScript reads `Object\.prototype\.toString`/,
    ],
    [
      "a constant object read by a key that is a union of literals and a string",
      `<script setup lang="ts">
defineProps<{ k: "sm" | "md"; s: string; on: boolean }>();
const PAD = { sm: "p-1", md: "p-2" };
</script>
<template><i>{{ PAD[on ? k : s] }}</i></template>`,
      /`PAD` read by a key that is a `string`/,
    ],
    [
      "a constant object literal that sets its prototype",
      `<script setup lang="ts">
defineProps<{ k: "sm" }>();
const PAD = { sm: "p-1", md: "p-2" };
const P = { __proto__: { sm: "a" } };
</script>
<template><i>{{ P[k] }}</i></template>`,
      /`__proto__:` in an object literal sets its prototype/,
    ],
    [
      "an enum member that is not a literal",
      `<script setup lang="ts">
enum Size { Small = "s".length }
</script>
<template><i>{{ Size.Small }}</i></template>`,
      /X\.vue:2:21: a constant the compiler evaluates is a literal.* \(the template reads it as `Size` at components\/X\.vue:4:17\)/,
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
      "a setup binding it cannot evaluate, located once, where the template reads it",
      `<script setup lang="ts">
const props = defineProps<{ label: string }>();
const label = props.label.normalize();
</script>
<template><i>{{ label }}</i></template>`,
      /^components\/X\.vue:5:17: `label` is set up in a way the server cannot evaluate: (?!.*X\.vue:\d)/,
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
      "encodeURIComponent of a string that may hold half of a surrogate pair",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ encodeURIComponent(a.slice(0, 1)) }}</i></template>`,
      /`encodeURIComponent\(\)` with a string that may hold half of a surrogate pair.*`URIError`/,
    ],
    [
      "encodeURI of an object",
      `<script setup lang="ts">
interface U { n: string }
defineProps<{ u: U }>();
</script>
<template><i>{{ encodeURI(u) }}</i></template>`,
      /`encodeURI\(\)` of an object: it writes strings, numbers and booleans, present or optional, and lists of them/,
    ],
    [
      "String of two values",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ String(a, a) }}</i></template>`,
      /`String\(\)` takes one value/,
    ],
    [
      "String of a value that may be null or undefined",
      `<script setup lang="ts">
defineProps<{ on: boolean; a?: string }>();
</script>
<template><i>{{ String(on ? a : null) }}</i></template>`,
      /`String\(\)` of a value that may be `null` or `undefined`, which JavaScript writes as `null` or `undefined` and its Rust `Option` cannot tell apart/,
    ],
    [
      "a template literal of an object",
      `<script setup lang="ts">
interface U { n: string }
defineProps<{ u: U }>();
</script>
<template><i>{{ \`\${u}\` }}</i></template>`,
      /a template literal of an object: it writes strings, numbers and booleans/,
    ],
    [
      ".concat() of an object",
      `<script setup lang="ts">
interface U { n: string }
defineProps<{ a: string; u: U }>();
</script>
<template><i>{{ a.concat(u) }}</i></template>`,
      /`\.concat\(\)` of an object/,
    ],
    [
      "charCodeAt of a string that may hold half of a surrogate pair",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a.at(0)?.charCodeAt(0) }}</i></template>`,
      /`\.charCodeAt\(\)` with a string that may hold half of a surrogate pair/,
    ],
    [
      "codePointAt of a string that may hold half of a surrogate pair",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a.substr(1).codePointAt(0) }}</i></template>`,
      /`\.codePointAt\(\)` with a string that may hold half of a surrogate pair/,
    ],
    [
      "Math.cbrt, which engines round differently",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ Math.cbrt(x) }}</i></template>`,
      /`Math\.cbrt\(\)` is computed by each JavaScript engine's own routine/,
    ],
    [
      "Math.hypot, which engines round differently",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ Math.hypot(x, x) }}</i></template>`,
      /`Math\.hypot\(\)` is computed by each JavaScript engine's own routine/,
    ],
    [
      "a power of a value known only when rendering",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ x ** 2 }}</i></template>`,
      /`\*\*` of a value known only when rendering: ferrovue works `\*\*` out when compiling/,
    ],
    [
      "a power with a negative exponent",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ 10 ** -2 }}</i></template>`,
      /`\*\*` of 10 and -2, which is not an integer to a whole power from 0/,
    ],
    [
      "Math.pow of a fraction",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ Math.pow(1.5, 2) }}</i></template>`,
      /`Math\.pow\(\)` of 1\.5 and 2/,
    ],
    [
      "a power beyond 2^53",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ 3 ** 34 }}</i></template>`,
      /`\*\*` of 3 and 34, which is not an integer to a whole power from 0 with a result within/,
    ],
    [
      "the in operator",
      `<script setup lang="ts">
interface U { n: string }
defineProps<{ u: U }>();
</script>
<template><i>{{ 'n' in u }}</i></template>`,
      /`in` tests whether an object has a key/,
    ],
    [
      "instanceof",
      `<script setup lang="ts">
interface U { n: string }
defineProps<{ u: U }>();
</script>
<template><i>{{ u instanceof Object }}</i></template>`,
      /`instanceof` tests an object's prototype/,
    ],
    [
      "a bitwise operator",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ x & 1 }}</i></template>`,
      /`&` works on the 32-bit integers JavaScript converts its operands to/,
    ],
    [
      "a shift",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ x >>> 1 }}</i></template>`,
      /`>>>` works on the 32-bit integers/,
    ],
    [
      "JSON.stringify with an indentation",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><pre>{{ JSON.stringify(a, null, 2) }}</pre></template>`,
      /`JSON\.stringify\(\)` with a replacer or an indentation/,
    ],
    [
      "JSON.parse",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ JSON.parse(a) }}</i></template>`,
      /`JSON\.parse\(\)` is not supported: of `JSON`, the server translates `JSON\.stringify\(x\)`/,
    ],
    [
      "String.fromCharCode",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ String.fromCharCode(x) }}</i></template>`,
      /`String\.fromCharCode\(\)` is not supported: of `String`, the server translates `String\(x\)`/,
    ],
    [
      "decodeURIComponent",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ decodeURIComponent(a) }}</i></template>`,
      /`decodeURIComponent\(\)` is not supported: the server does not translate `decodeURIComponent`/,
    ],
    [
      "a Math constant that does not exist",
      `<script setup lang="ts">
defineProps<{ x: number }>();
</script>
<template><i>{{ Math.TAU }}</i></template>`,
      /`Math\.TAU` is not supported: of `Math`, the server translates/,
    ],
    [
      "Number.parseFloat",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ Number.parseFloat(a) }}</i></template>`,
      /`Number\.parseFloat\(\)` is not supported: of `Number`, the server translates/,
    ],
    [
      "typeof compared with undefined of a value that may be null or undefined",
      `<script setup lang="ts">
defineProps<{ on: boolean; a?: string }>();
</script>
<template><i>{{ typeof (on ? a : null) === 'undefined' }}</i></template>`,
      /`typeof` compared with "undefined" of a value that may be `null` \(an "object"\) or `undefined`/,
    ],
    [
      "typeof of a value that may be null or undefined",
      `<script setup lang="ts">
defineProps<{ on: boolean; a?: string }>();
</script>
<template><i>{{ typeof (on ? a : null) }}</i></template>`,
      /`typeof` compared with "string" of a value that may be `null`/,
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
      /`<` is supported between two numbers, two strings or two dates that are present: the other is a string/,
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
      "halves of surrogate pairs either side of a string that may be empty in a template literal",
      `<script setup lang="ts">
const props = defineProps<{ a: string; b: string }>();
</script>
<template><i>{{ \`\${a.charAt(0)}\${b}\${a.slice(1)}\` }}</i></template>`,
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
      "includes with a starting position that is a string",
      `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.includes("x", "2") }}</i></template>`,
      /`\.includes\(\)` takes a number, present or optional/,
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
      "a function that calls itself",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function down(k: number): number {
  return k > 0 ? down(k - 1) : 0;
}
</script>
<template><i>{{ down(n) }}</i></template>`,
      /X\.vue:4:\d+: `down\(\)` calls itself, which the server would inline without end/,
    ],
    [
      "functions that call each other",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function even(k: number): boolean {
  return k === 0 ? true : odd(k - 1);
}
function odd(k: number): boolean {
  return k === 0 ? false : even(k - 1);
}
</script>
<template><i>{{ even(n) }}</i></template>`,
      /`even\(\)` calls itself, through `odd\(\)`/,
    ],
    [
      "a function with a rest parameter",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function all(...xs: string[]): string {
  return xs.join();
}
</script>
<template><i>{{ all('a') }}</i></template>`,
      /`all\(\)` takes `\.\.\.rest` parameters/,
    ],
    [
      "a function given more arguments than it names",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
const twice = (k: number): number => k * 2;
</script>
<template><i>{{ twice(n, 1) }}</i></template>`,
      /`twice\(\)` takes 1 argument, and is given 2/,
    ],
    [
      "an async function called by the template",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
async function load(): Promise<string> {
  return 'x';
}
</script>
<template><i>{{ load() }}</i></template>`,
      /`load\(\)` is `async`, and returns a promise/,
    ],
    [
      "a function given spread arguments",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function pair(a: string, b: string): string {
  return a + b;
}
</script>
<template><i>{{ pair(...tags) }}</i></template>`,
      /`pair\(\)` given `\.\.\.` arguments/,
    ],
    [
      "a default for a parameter given null or undefined",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function or(v: string | null | undefined = 'x'): string {
  return v ?? '-';
}
</script>
<template><i>{{ or(n > 0 ? note : other) }}</i></template>`,
      /a default for a parameter given a value that may be `null` or `undefined`/,
    ],
    [
      "a function with a loop called by the template",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function total(xs: string[]): number {
  let sum = 0;
  for (const x of xs) sum = sum + x.length;
  return sum;
}
</script>
<template><i>{{ total(tags) }}</i></template>`,
      /X\.vue:9:\d+: `total` is set up in a way the server cannot evaluate: `let sum` is assigned again with `=`.*\(components\/X\.vue:5, FV1902\)/,
    ],
    [
      "a function read as a value",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function shout(t: string): string {
  return t.toUpperCase();
}
</script>
<template><i :title="String(shout)">x</i></template>`,
      /`shout` is set up in a way the server cannot evaluate: it is a function, which the template and a `computed` may call/,
    ],
    [
      "a loop in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { for (const c of t) { if (c) return c; } return t; }).join() }}</i></template>`,
      /X\.vue:4:\d+: a function's body may not hold a `for…of` loop: it holds `const`.*compute a list with `\.map\(\)`/,
    ],
    [
      "a while loop in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { while (t) { return t; } return t; }).join() }}</i></template>`,
      /a function's body may not hold a `while` loop/,
    ],
    [
      "try in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { try { return t.trim(); } catch { return t; } }).join() }}</i></template>`,
      /a function's body may not hold `try`, which only catches what the body throws/,
    ],
    [
      "throw in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { if (!t) throw new Error(); return t; }).join() }}</i></template>`,
      /a function's body may not hold `throw`, which ends the render with an error/,
    ],
    [
      "var in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { var u = t.trim(); return u; }).join() }}</i></template>`,
      /a function's body may not hold `var`: declare the value with `const`/
    ],
    [
      "an expression statement in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { t.trim(); return t; }).join() }}</i></template>`,
      /an expression statement \(`CallExpression`\), whose value is dropped/,
    ],
    [
      "a let assigned again in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { let u = t; u += "!"; return u; }).join() }}</i></template>`,
      /`let u` is assigned again with `\+=`/,
    ],
    [
      "an assignment in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { return (props.n = 2) > 1 ? t : ""; }).join() }}</i></template>`,
      /an assignment \(`=`\) changes a value/,
    ],
    [
      "a callback that can end without a return",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { if (t.length > 1) return t; }).join() }}</i></template>`,
      /X\.vue:4:\d+: the function can reach its end here without a `return`, and JavaScript then returns `undefined`/,
    ],
    [
      "a return without a value in a callback",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { if (!t) return; return t; }).join() }}</i></template>`,
      /`return` without a value returns `undefined`/,
    ],
    [
      "a const read before its declaration",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { const a = b; const b = t; return a; }).join() }}</i></template>`,
      /`b` is read before its declaration, where JavaScript throws a `ReferenceError`/,
    ],
    [
      "code after a return",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { return t; const u = t; }).join() }}</i></template>`,
      /code after `return`, which never runs/,
    ],
    [
      "a case that falls through into the next",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { switch (t) { case "a": if (props.n) return "1"; case "b": return "2"; default: return t; } }).join() }}</i></template>`,
      /this case falls through into the next one/,
    ],
    [
      "a body whose switches continue after them on too many paths",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { ${"switch (t) { case \"1\": break; case \"2\": break; case \"3\": break; default: break; } ".repeat(6)}return t; }).join() }}</i></template>`,
      /continue with the statements after them on more than 4096 paths/,
    ],
    [
      "a declaration directly in a case",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { switch (t) { case "a": const u = t; return u; default: return t; } }).join() }}</i></template>`,
      /a declaration directly in a `case`, which the whole `switch` shares: wrap the case's statements in `\{ … \}`/,
    ],
    [
      "a switch with no case for some values and nothing after it",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { switch (t) { case "a": return "1"; } }).join() }}</i></template>`,
      /the function can reach its end here without a `return`/,
    ],
    [
      "a function declared in a callback's body",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { function f() { return t; } return t; }).join() }}</i></template>`,
      /a function's body may not hold a function declared inside it/,
    ],
    [
      "a computed with a loop read by the template",
      `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
import { computed } from "vue";
const total = computed(() => {
  let sum = 0;
  for (const t of props.tags) sum += t.length;
  return sum;
});
</script>
<template><i>{{ total }}</i></template>`,
      /`total` is set up in a way the server cannot evaluate: `let sum` is assigned again with `\+=`.*\(line 6\)/,
    ],
    [
      "a function other than Boolean passed to map by name",
      `<script setup lang="ts">
const props = defineProps<{ nums: number[] }>();
</script>
<template><i>{{ nums.map(String).join() }}</i></template>`,
      /`\.map\(\)` takes an arrow function of the item, and of its index: `x => …`, `\(x, i\) => …`, or `Boolean`/,
    ],
    [
      "a method other than filter(Boolean) over a list of optional values, whose absent items it would skip",
      `<script setup lang="ts">
const props = defineProps<{ tags: (string | null)[] }>();
</script>
<template><i>{{ tags.every(Boolean) }}</i></template>`,
      /this method takes a list of strings, numbers, booleans or objects/,
    ],
    [
      "an array literal filtered by Boolean whose items are of different types",
      `<script setup lang="ts">
const props = defineProps<{ name?: string; age?: number }>();
</script>
<template><i>{{ [name, age].filter(Boolean).join() }}</i></template>`,
      /an array literal holds strings, numbers or booleans, all of one type, each of which may be absent/,
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
      "Object.entries pairs mapped to themselves",
      `<script setup lang="ts">
defineProps<{ m: Record<string, string> }>();
</script>
<template><i>{{ Object.entries(m).map((e) => e).length }}</i></template>`,
      /`\.map\(\)` to the `\[key, value\]` pairs of `Object\.entries\(\)` makes a list of pairs/,
    ],
    [
      "Object.entries pairs joined",
      `<script setup lang="ts">
defineProps<{ m: Record<string, string> }>();
</script>
<template><i>{{ Object.entries(m).join() }}</i></template>`,
      /`\.join\(\)` of the `\[key, value\]` pairs of `Object\.entries\(\)`, which writes each pair as its key and value joined by `,`/,
    ],
    [
      "Object.entries pairs sorted without a comparator",
      `<script setup lang="ts">
defineProps<{ m: Record<string, number> }>();
</script>
<template><i>{{ Object.entries(m).toSorted().length }}</i></template>`,
      /orders the `\[key, value\]` pairs of `Object\.entries\(\)` by `String\(pair\)`/,
    ],
    [
      "a pair destructured with a default",
      `<script setup lang="ts">
defineProps<{ m: Record<string, number> }>();
</script>
<template><i>{{ Object.entries(m).map(([k = "x"]) => k).join() }}</i></template>`,
      /a `\[key, value\]` pair is destructured to plain names/,
    ],
    [
      "a pair read by a computed index",
      `<script setup lang="ts">
defineProps<{ m: Record<string, number>; i: number }>();
</script>
<template><i>{{ Object.entries(m).map((p) => p[i]).join() }}</i></template>`,
      /reads a part of a `\[key, value\]` pair by a literal index/,
    ],
    [
      "a v-for over pairs with a nested array pattern",
      `<script setup lang="ts">
defineProps<{ m: Record<string, number> }>();
</script>
<template><i v-for="[k, [v]] in Object.entries(m).filter(([, n]) => n > 0)">{{ k }}</i></template>`,
      /a `\[key, value\]` pair is destructured to plain names/,
    ],
    [
      ".flat() with a depth that is not a literal",
      `<script setup lang="ts">
defineProps<{ m: number[][]; d: number }>();
</script>
<template><i>{{ m.flat(d).length }}</i></template>`,
      /`\.flat\(\)` takes its depth as a literal number, or `Infinity`/,
    ],
    [
      ".flat() of a list of optional lists",
      `<script setup lang="ts">
defineProps<{ m: (number[] | undefined)[] }>();
</script>
<template><i>{{ m.flat().length }}</i></template>`,
      /`\.flat\(\)` makes a list of strings, numbers, booleans or objects, or of lists of them, and this one's items are optional lists/,
    ],
    [
      ".flatMap() whose function gives only []",
      `<script setup lang="ts">
defineProps<{ m: number[] }>();
</script>
<template><i>{{ m.flatMap((x) => []).length }}</i></template>`,
      /gives only `\[\]`, whose items have no type/,
    ],
    [
      ".flatMap() to lists of lists",
      `<script setup lang="ts">
interface Row { grid: number[][] }
defineProps<{ rows: Row[] }>();
</script>
<template><i>{{ rows.flatMap((r) => r.grid).length }}</i></template>`,
      /`\.flatMap\(\)` makes a list of strings, numbers, booleans or objects, and its function gives a list of lists/,
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
      /`\.title` of a record, which has no field `title`/,
    ],
    [
      "a ternary whose branches differ in type, compared",
      `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ n: number; tags: string[] }>();
</script>
<template><i v-if="(n ? n : 'none') === 'none'">x</i></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a ternary whose branches differ in type, given to a child's prop",
      `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ n: number; tags: string[] }>();
</script>
<template><Y :b="n ? n : 'none'" /></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a ternary whose branches differ in type, read by a method",
      `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ n: number; tags: string[] }>();
</script>
<template><i>{{ (n ? n : "none").length }}</i></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a ternary whose branches differ in type, bound to a boolean attribute",
      `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ n: number; tags: string[] }>();
</script>
<template><input :disabled="n ? n : ''" /></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a ternary whose branches differ in type, bound as a class",
      `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ n: number; tags: string[] }>();
</script>
<template><i :class="n ? n : 'none'"></i></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a ternary between a list and a string in text, which Vue writes as JSON",
      `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ n: number; tags: string[] }>();
</script>
<template><i>{{ n ? tags : "none" }}</i></template>`,
      /the two branches of `\?:` differ in type/,
    ],
    [
      "a prop type with no Rust twin",
      `<script setup lang="ts">
const props = defineProps<{ when: Map<string, string> }>();
</script>
<template><i></i></template>`,
      /unsupported prop type `Map`/,
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
  <p>{{ new Set([at]).size }}</p>
</template>`,
      /X\.vue:5:9: `new Set\(…\)` builds an object the server has no twin for/,
    ],
    [
      "Number.isNaN of a string, which it does not convert",
      `<script setup lang="ts">
defineProps<{ s: string }>();
</script>
<template><p>{{ Number.isNaN(s) }}</p></template>`,
      /X\.vue:4:30: `Number\.isNaN\(\)` of a string, for which it is `false` whatever it holds, since it does not convert its argument/,
    ],
    [
      "Number.isFinite of a date",
      `<script setup lang="ts">
defineProps<{ d: Date }>();
</script>
<template><p v-if="Number.isFinite(d)">x</p></template>`,
      /`Number\.isFinite\(\)` of a `Date`, for which it is `false` whatever it holds/,
    ],
    [
      "Number.isInteger without an argument",
      `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ Number.isInteger() }}</p></template>`,
      /`Number\.isInteger\(\)` takes one number/,
    ],
    [
      "the global isNaN of a string, which it converts",
      `<script setup lang="ts">
defineProps<{ s: string }>();
</script>
<template><p>{{ isNaN(s) }}</p></template>`,
      /`isNaN\(\)` converts its argument as `Number\(\)` does, which the server does for a number only: write `Number\.isNaN\(Number\(x\)\)` for a string/,
    ],
    [
      "the global isFinite of an optional number",
      `<script setup lang="ts">
defineProps<{ n?: number }>();
</script>
<template><p>{{ isFinite(n) }}</p></template>`,
      /`isFinite\(\)` converts its argument/,
    ],
    [
      "|| between a date and a string",
      `<script setup lang="ts">
defineProps<{ d?: Date }>();
</script>
<template><p>{{ d || "never" }}</p></template>`,
      /`\|\|` between these types/,
    ],
    [
      "the current time with new Date()",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date().toISOString() }}</p></template>`,
      /`new Date\(\)` is the time it runs, which differs between the server's render and the browser's hydration.*`dates_and_prices`/,
    ],
    [
      "the current time with Date.now()",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ Date.now() }}</p></template>`,
      /`Date\.now\(\)` is the time it runs/,
    ],
    [
      "a date built from its parts in the local time zone",
      `<script setup lang="ts">
defineProps<{ y: number }>();
</script>
<template><p>{{ new Date(y, 0).toISOString() }}</p></template>`,
      /`new Date\(year, month, …\)` reads its parts in the time zone of the machine running it/,
    ],
    [
      "a date built from a value that may be absent",
      `<script setup lang="ts">
defineProps<{ at?: string }>();
</script>
<template><p>{{ new Date(at).toISOString() }}</p></template>`,
      /`new Date\(\)` takes one string or one number that is present/,
    ],
    [
      "Date.parse of a number",
      `<script setup lang="ts">
defineProps<{ at: number }>();
</script>
<template><p>{{ Date.parse(at) }}</p></template>`,
      /`Date\.parse\(\)` takes a string that is present/,
    ],
    [
      "a date string read in the local time zone",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date("2024-01-15T10:00").toISOString() }}</p></template>`,
      /`new Date\(\)` of "2024-01-15T10:00", which is not a date alone nor a date and time with a `Z` or an offset/,
    ],
    [
      "a date beyond the range whose offset brings it within",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ Date.parse("+275760-09-13T01:00+01:00") }}</p></template>`,
      /`Date\.parse\(\)` of "\+275760-09-13T01:00\+01:00"/,
    ],
    [
      "a date string outside the date time string format",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ Date.parse("Jan 15 2024") }}</p></template>`,
      /`Date\.parse\(\)` of "Jan 15 2024"/,
    ],
    [
      "a date read in the local time zone",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date(at).getFullYear() }}</p></template>`,
      /X\.vue:4:\d+: `\.getFullYear\(\)` reads the date in the time zone of the machine running it.*use `\.getUTCFullYear\(\)`/,
    ],
    [
      "a date written by toString",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date(at).toString() }}</p></template>`,
      /`\.toString\(\)` on a `Date` is not supported/,
    ],
    [
      "Date.UTC of no parts",
      `<script setup lang="ts">
defineProps<{ y: number }>();
</script>
<template><p>{{ Date.UTC() }}</p></template>`,
      /`Date\.UTC\(\)` takes from one to seven numbers/,
    ],
    [
      "Date.UTC of a value that may be absent",
      `<script setup lang="ts">
defineProps<{ y?: number }>();
</script>
<template><p>{{ Date.UTC(2024, y) }}</p></template>`,
      /`Date\.UTC\(\)` takes numbers that are present: this is an optional number/,
    ],
    [
      "Date.UTC of a year engines compute differently",
      `<script setup lang="ts">
defineProps<{ y: number }>();
</script>
<template><p>{{ Date.UTC(-500000, 0, 182000000) }}</p></template>`,
      /`Date\.UTC\(-500000, 0, 182000000\)` is a date engines compute differently: V8 reads a year beyond ±1,000,000/,
    ],
    [
      "two dates compared with ===",
      `<script setup lang="ts">
defineProps<{ a: Date; b: Date }>();
</script>
<template><p v-if="a === b">same</p></template>`,
      /`===` between a `Date` and a `Date` is true only when the two are one object, so two dates of the same time are unequal: compare time values, `a\.getTime\(\) === b\.getTime\(\)`/,
    ],
    [
      "a date compared with a string by ==",
      `<script setup lang="ts">
defineProps<{ a: Date; s: string }>();
</script>
<template><p v-if="a == s">same</p></template>`,
      /`==` between a `Date` and a string compares the date as an object, or as its `\.toString\(\)` in the time zone of the machine running it: compare time values/,
    ],
    [
      "a date ordered against a number",
      `<script setup lang="ts">
defineProps<{ a: Date; n: number }>();
</script>
<template><p v-if="a < n">before</p></template>`,
      /`<` is supported between two numbers, two strings or two dates that are present: the other is a `Date`/,
    ],
    [
      "JSON.stringify of a date that may be absent",
      `<script setup lang="ts">
defineProps<{ a?: Date }>();
</script>
<template><p>{{ JSON.stringify(a) }}</p></template>`,
      /`JSON\.stringify\(\)` of a string, a number, a boolean, a date or a list of those, present/,
    ],
    [
      "a number formatted by locale",
      `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ n.toLocaleString() }}</p></template>`,
      /`\.toLocaleString\(\)` formats by locale with `Intl`, whose output differs between Node, Chromium, Firefox and Safari.*`dates_and_prices`/,
    ],
    [
      "a date formatted by locale",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date(at).toLocaleDateString("en-GB") }}</p></template>`,
      /`\.toLocaleDateString\(\)` formats by locale/,
    ],
    [
      "strings compared by locale",
      `<script setup lang="ts">
defineProps<{ a: string; b: string }>();
</script>
<template><p>{{ a.localeCompare(b) }}</p></template>`,
      /`\.localeCompare\(\)` formats by locale/,
    ],
    [
      "an Intl formatter",
      `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ new Intl.NumberFormat("en").format(n) }}</p></template>`,
      /`Intl` formats by locale/,
    ],
    [
      "an Intl formatter called without new",
      `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ Intl.NumberFormat("en").format(n) }}</p></template>`,
      /`Intl` formats by locale/,
    ],
    [
      "vue-i18n's number formatting",
      `<script setup lang="ts">
defineProps<{ n: number }>();
</script>
<template><p>{{ $n(n) }}</p></template>`,
      /vue-i18n's `\$n` formats by locale/,
    ],
    [
      "a date interpolated whole",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date(at) }}</p></template>`,
      /`\{\{ \}\}` of a `Date`/,
    ],
    [
      "a date bound to an attribute",
      `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><time :datetime="new Date(at)">x</time></template>`,
      /`datetime` is bound to a `Date`.*bind `\.toISOString\(\)`/,
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
      "a CSS module without `cssModules` in the configuration",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i>{{ a }}</i></template>
<style module>.i { color: red }</style>`,
      /X\.vue:5:1: `<style module>` takes its class names from Vite's `css\.modules`: set `cssModules` in ferrovue\.config\.json/,
    ],
    [
      "v-bind() in a style block of a boolean",
      `<script setup lang="ts">
const props = defineProps<{ a: string; on: boolean }>();
</script>
<template><i>{{ a }}</i></template>
<style>
i { color: v-bind(a); width: v-bind('on'); }
</style>`,
      /X\.vue:6:30: `v-bind\(\)` in `<style>` of a boolean: Vue writes a string or a number/,
    ],
    [
      "v-bind() in a style block of a list",
      `<script setup lang="ts">
const props = defineProps<{ a: string[] }>();
</script>
<template><i>{{ a.length }}</i></template>
<style>i { color: v-bind(a) }</style>`,
      /X\.vue:5:19: `v-bind\(\)` in `<style>` of a list/,
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
      "a component resolved by name with no import",
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
defineProps<{ m: Record<string, string>; k: string }>();
</script>
<template><i>{{ m[k] }}</i></template>`,
      /computed member access of a record/,
    ],
    [
      "a list item read by a `Float` index",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
defineProps<{ names: string[]; f: Float }>();
</script>
<template><i>{{ names[f] }}</i></template>`,
      /reads a list's item by an integer index, .*a `Float`, which may hold a fraction/,
    ],
    [
      "a list item read by a date's month",
      `<script setup lang="ts">
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
defineProps<{ d: Date }>();
</script>
<template><i>{{ MONTHS[d.getUTCMonth()] }}</i></template>`,
      /reads a list's item by an integer index, and `\.getUTCMonth\(\)` of a date is a `Float`: it is `NaN` for an invalid date, where `\[…\]` reads `undefined`/,
    ],
    [
      "a list item read by a string index",
      `<script setup lang="ts">
defineProps<{ names: string[]; k: string }>();
</script>
<template><i>{{ names[k] }}</i></template>`,
      /reads a list's item by an integer index, .*this index is a string/,
    ],
    [
      "a list item read by an optional index",
      `<script setup lang="ts">
defineProps<{ names: string[]; i?: number }>();
</script>
<template><i>{{ names[i] }}</i></template>`,
      /reads a list's item by an integer index, .*this index is an optional number/,
    ],
    [
      "`.at()` of a list given a string",
      `<script setup lang="ts">
defineProps<{ names: string[]; k: string }>();
</script>
<template><i>{{ names.at(k) }}</i></template>`,
      /`\.at\(\)` takes a number that is present, and this index is a string/,
    ],
    [
      "`.at()` of a list given no index",
      `<script setup lang="ts">
defineProps<{ names: string[] }>();
</script>
<template><i>{{ names.at() }}</i></template>`,
      /`\.at\(\)` takes one index/,
    ],
    [
      "`.indexOf()` with a position to start from",
      `<script setup lang="ts">
defineProps<{ names: string[]; a: string }>();
</script>
<template><i>{{ names.indexOf(a, 1) }}</i></template>`,
      /`\.indexOf\(\)` takes one value to look for, without a position to start from/,
    ],
    [
      "`.lastIndexOf()` of a value of another type than the list's",
      `<script setup lang="ts">
defineProps<{ names: string[]; n: number }>();
</script>
<template><i>{{ names.lastIndexOf(n) }}</i></template>`,
      /`\.lastIndexOf\(\)` looks for a value of the list's own type/,
    ],
    [
      "`.indexOf()` of an object",
      `<script setup lang="ts">
interface Row { a: string }
defineProps<{ rows: Row[]; row: Row }>();
</script>
<template><i>{{ rows.indexOf(row) }}</i></template>`,
      /`\.indexOf\(\)` looks for a value of the list's own type, in a list of strings, numbers or booleans/,
    ],
    [
      "`.concat()` of a list of another item type",
      `<script setup lang="ts">
defineProps<{ names: string[]; nums: number[] }>();
</script>
<template><i>{{ names.concat(nums).length }}</i></template>`,
      /`\.concat\(\)` joins lists of the list's own item type, a string/,
    ],
    [
      "`.concat()` of a value that is not a list",
      `<script setup lang="ts">
defineProps<{ names: string[]; a: string }>();
</script>
<template><i>{{ names.concat(a).length }}</i></template>`,
      /`\.concat\(\)` joins lists of the list's own item type/,
    ],
    [
      "`??` after an optional chain that computes a list, falling back to another list",
      `<script setup lang="ts">
defineProps<{ tags?: string[]; others: string[] }>();
</script>
<template><i>{{ (tags?.filter((t) => t !== "") ?? others).length }}</i></template>`,
      /`\?\?` after an optional chain that computes a list, falling back to another list: fall back to `\[\]`/,
    ],
    [
      "an optional call",
      `<script setup lang="ts">
defineProps<{ a: string }>();
function f() { return 1; }
</script>
<template><i>{{ f?.() }}</i></template>`,
      /`\?\.\(\)` calls a function that may be absent/,
    ],
    [
      "a field read from a value that may be absent",
      `<script setup lang="ts">
defineProps<{ a?: string }>();
</script>
<template><i>{{ a.length }}</i></template>`,
      /`\.length` of an optional string, which may be absent: narrow it with `v-if` first, or read it with `\?\.length`/,
    ],
    [
      "an optional chain into a method that is not supported",
      `<script setup lang="ts">
defineProps<{ a?: string }>();
</script>
<template><i>{{ a?.normalize() }}</i></template>`,
      /`\.normalize\(\)` is not supported/,
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
    [
      "an attribute name Vue's server renderer skips as unsafe",
      `<script setup lang="ts">
defineProps<{ a: string }>();
</script>
<template><i :x'y="a">x</i></template>`,
      /unsafe attribute name `x'y`/,
    ],
    [
      "an attribute name chosen at run time",
      `<script setup lang="ts">
defineProps<{ name: string; a: string }>();
</script>
<template><i :[name]="a">x</i></template>`,
      /attribute objects hold plain keys/,
    ],
    [
      "attributes bound from an object that is not a literal",
      `<script setup lang="ts">
const props = defineProps<{ a: string; extra: Record<string, string> }>();
</script>
<template><i v-bind="props.extra">{{ a }}</i></template>`,
      /`_mergeProps` of object literals is supported/,
    ],
    [
      "a precision of 0 for toPrecision, which throws",
      `<script setup lang="ts">
defineProps<{ n: number; p: number }>();
</script>
<template><p>{{ n.toPrecision(0) }}</p></template>`,
      /`\.toPrecision\(\)` takes a literal precision, from 1 to 100/,
    ],
    [
      "a precision that truncates to 0 for toPrecision",
      `<script setup lang="ts">
defineProps<{ n: number; p: number }>();
</script>
<template><p>{{ n.toPrecision(0.9) }}</p></template>`,
      /`\.toPrecision\(\)` takes a literal precision, from 1 to 100/,
    ],
    [
      "a precision above 100 for toPrecision",
      `<script setup lang="ts">
defineProps<{ n: number; p: number }>();
</script>
<template><p>{{ n.toPrecision(101) }}</p></template>`,
      /`\.toPrecision\(\)` takes a literal precision, from 1 to 100/,
    ],
    [
      "a precision for toPrecision that is not a literal",
      `<script setup lang="ts">
defineProps<{ n: number; p: number }>();
</script>
<template><p>{{ n.toPrecision(p) }}</p></template>`,
      /`\.toPrecision\(\)` takes a literal precision, from 1 to 100/,
    ],
    [
      "more than 100 digits for toExponential",
      `<script setup lang="ts">
defineProps<{ n: number; p: number }>();
</script>
<template><p>{{ n.toExponential(101) }}</p></template>`,
      /`\.toExponential\(\)` takes a literal number of digits, from 0 to 100/,
    ],
    [
      "a negative number of digits for toExponential",
      `<script setup lang="ts">
defineProps<{ n: number; p: number }>();
</script>
<template><p>{{ n.toExponential(-1) }}</p></template>`,
      /`\.toExponential\(\)` takes a literal number of digits, from 0 to 100/,
    ],
    [
      "a number of digits for toExponential that is not a literal",
      `<script setup lang="ts">
defineProps<{ n: number; p: number }>();
</script>
<template><p>{{ n.toExponential(p) }}</p></template>`,
      /`\.toExponential\(\)` takes a literal number of digits, from 0 to 100/,
    ],
    [
      "`.reduce()` without an initial value",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ nums.reduce((a, x) => a + x) }}</p></template>`,
      /`\.reduce\(\)` takes an initial value after its function: without one, JavaScript throws/,
    ],
    [
      "`.reduceRight()` without an initial value",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ words.reduceRight((a, w) => a + w) }}</p></template>`,
      /`\.reduceRight\(\)` takes an initial value/,
    ],
    [
      "`.reduce()` whose function changes the accumulator's type",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ nums.reduce((a, x) => a + ",", 0) }}</p></template>`,
      /`\.reduce\(\)` keeps one type of accumulator, and the function gives a string where the accumulator, from its initial value, is a number/,
    ],
    [
      "`.reduce()` into a list",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ nums.reduce((a, x) => a, []).length }}</p></template>`,
      /`\.reduce\(\)` accumulates a string, a number or a boolean that is present/,
    ],
    [
      "`.reduce()` given a function that is not an arrow function of the accumulator and the item",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ nums.reduce((a) => a, 0) }}</p></template>`,
      /`\.reduce\(\)` takes an arrow function of the accumulator, the item and its index/,
    ],
    [
      "`.reduce()` joining halves of surrogate pairs",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ words.reduce((a, w) => a + w.slice(0, 1), "") }}</p></template>`,
      /with a string that may hold half of a surrogate pair/,
    ],
    [
      "`.toSorted()` subtracting `Float` keys",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ prices.toSorted((a, b) => a - b).join() }}</p></template>`,
      /`\.toSorted\(\)` by a `Float`, which may be `NaN`/,
    ],
    [
      "`.toSorted()` with a comparator that is not consistent",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ nums.toSorted((a, b) => (a < b ? -1 : 0)).join() }}</p></template>`,
      /`\.toSorted\(\)` takes a comparator of a shape the server orders by/,
    ],
    [
      "`.toSorted()` with a comparator of another shape",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ nums.toSorted((a, b) => a * b).join() }}</p></template>`,
      /`\.toSorted\(\)` takes a comparator of a shape the server orders by/,
    ],
    [
      "`.toSorted()` subtracting strings",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ words.toSorted((a, b) => a - b).join() }}</p></template>`,
      /`\.toSorted\(\)` orders by integers, and this key is a string/,
    ],
    [
      "`.toSorted()` by `localeCompare`",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ words.toSorted((a, b) => a.localeCompare(b)).join() }}</p></template>`,
      /`\.localeCompare\(\)` formats by locale/,
    ],
    [
      "`.toSorted()` of objects without a comparator",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ rows.toSorted().length }}</p></template>`,
      /`\.toSorted\(\)` without a comparator orders objects by `String\(x\)`/,
    ],
    [
      "`.toSorted()` of strings that may hold halves of surrogate pairs",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ words.map((w) => w.slice(1)).toSorted().join() }}</p></template>`,
      /`\.toSorted\(\)` with a string that may hold half of a surrogate pair/,
    ],
    [
      "`.sort()` of a prop in place",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ nums.sort().join() }}</p></template>`,
      /`\.sort\(\)` changes the list in place.*write `\.toSorted\(\)`, or `\[\.\.\.list\]\.sort\(…\)`/,
    ],
    [
      "`.reverse()` of a prop in place",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ words.reverse().join() }}</p></template>`,
      /`\.reverse\(\)` changes the list in place.*write `\.toReversed\(\)`/,
    ],
    [
      "an array literal spreading lists of different item types",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ [...words, ...nums].length }}</p></template>`,
      /an array literal spreads lists of one item type/,
    ],
    [
      "an array literal spreading a string",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ [...word].length }}</p></template>`,
      /`\.\.\.` in an array literal spreads a list, and this is a string/,
    ],
    [
      "an array literal spreading objects beside a plain value",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ [...rows, word].length }}</p></template>`,
      /an array literal spreads lists of one item type/,
    ],
    [
      "`Math.max()` of a spread list of strings",
      `<script setup lang="ts">
import type { Float } from "ferrovue/types";
interface Row { name: string; n: number }
defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; word: string }>();
</script>
<template><p>{{ Math.max(...words) }}</p></template>`,
      /`Math\.max\(\.\.\.xs\)` spreads a list of numbers, and this is a list of other values/,
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
    W: `<script setup lang="ts">
defineProps<{ onSale?: boolean }>();
</script>
<template><b v-if="onSale">!</b></template>`,
  };

  const codes: Record<string, Code> = {
    "a value imported from a module that resolves to no `.ts` file of the project": "FV0110",
    "a type parameter without a constraint": "FV0302",
    "a listener of a name chosen at run time given to a child with a prop named like a listener": "FV0514",
    "listeners from an object given to a child with a prop named like a listener": "FV0514",
    "an enum read whole": "FV0208",
    "an enum read by a key chosen at run time": "FV0222",
    "a ternary whose branches differ in type, compared": "FV0623",
    "a ternary whose branches differ in type, given to a child's prop": "FV0623",
    "a ternary whose branches differ in type, read by a method": "FV0623",
    "a ternary whose branches differ in type, bound to a boolean attribute": "FV0623",
    "a ternary whose branches differ in type, bound as a class": "FV0623",
    "a ternary between a list and a string in text, which Vue writes as JSON": "FV0623",
    "a constant object read by a key that is a string": "FV0222",
    "a constant object read by a key that may be absent": "FV0223",
    "a field of a constant object read by a key it may not have": "FV0224",
    "a constant object whose values differ in type for the keys of its key": "FV0225",
    "a constant object without a key that names a field of every object": "FV0226",
    "a constant object read by a key that is a union of literals and a string": "FV0222",
    "a constant object literal that sets its prototype": "FV0206",
    "a value read from `$attrs`, which has no type": "FV0415",
    "an attribute name Vue's server renderer skips as unsafe": "FV0404",
    "an attribute name chosen at run time": "FV0408",
    "attributes bound from an object that is not a literal": "FV0410",
    "a runtime props declaration, which has no types": "FV0303",
    "watchEffect, which runs on the server": "FV0103",
    "a setup statement that changes state": "FV0105",
    "an interface whose name the generated Rust already uses": "FV0318",
    "a strict comparison of a value that may be null or undefined": "FV0626",
    "loose equality between values": "FV0619",
    "encodeURIComponent of a string that may hold half of a surrogate pair": "FV0706",
    "encodeURI of an object": "FV0723",
    "String of two values": "FV0723",
    "String of a value that may be null or undefined": "FV0721",
    "a template literal of an object": "FV0708",
    ".concat() of an object": "FV0723",
    "charCodeAt of a string that may hold half of a surrogate pair": "FV0706",
    "codePointAt of a string that may hold half of a surrogate pair": "FV0706",
    "Math.cbrt, which engines round differently": "FV0719",
    "Math.hypot, which engines round differently": "FV0719",
    "a power of a value known only when rendering": "FV0720",
    "a power with a negative exponent": "FV0720",
    "Math.pow of a fraction": "FV0720",
    "a power beyond 2^53": "FV0720",
    "the in operator": "FV0631",
    "instanceof": "FV0631",
    "a bitwise operator": "FV0632",
    "a shift": "FV0632",
    "JSON.stringify with an indentation": "FV0633",
    "JSON.parse": "FV0633",
    "String.fromCharCode": "FV0633",
    "decodeURIComponent": "FV0633",
    "a Math constant that does not exist": "FV0633",
    "Number.parseFloat": "FV0633",
    "typeof compared with undefined of a value that may be null or undefined": "FV0722",
    "typeof of a value that may be null or undefined": "FV0722",
    "a nullable prop the parent leaves out": "FV0507",
    "two halves of surrogate pairs compared, which JavaScript tells apart": "FV0706",
    "a negative literal count for repeat, which throws": "FV0714",
    "toLocaleUpperCase, which depends on the server's locale": "FV0715",
    "a precision of 0 for toPrecision, which throws": "FV0716",
    "a precision that truncates to 0 for toPrecision": "FV0716",
    "a precision above 100 for toPrecision": "FV0716",
    "a precision for toPrecision that is not a literal": "FV0716",
    "more than 100 digits for toExponential": "FV0717",
    "a negative number of digits for toExponential": "FV0717",
    "a number of digits for toExponential that is not a literal": "FV0717",
    "replace with a regular expression": "FV0710",
    "a function that calls itself": "FV1906",
    "functions that call each other": "FV1906",
    "a function with a rest parameter": "FV1907",
    "a function given more arguments than it names": "FV1907",
    "an async function called by the template": "FV1907",
    "a function given spread arguments": "FV1907",
    "a default for a parameter given null or undefined": "FV1907",
    "a function with a loop called by the template": "FV0613",
    "a function read as a value": "FV0613",
    "a loop in a callback's body": "FV1901",
    "a while loop in a callback's body": "FV1901",
    "try in a callback's body": "FV1901",
    "throw in a callback's body": "FV1901",
    "var in a callback's body": "FV1901",
    "an expression statement in a callback's body": "FV1901",
    "a let assigned again in a callback's body": "FV1902",
    "an assignment in a callback's body": "FV1902",
    "a callback that can end without a return": "FV1903",
    "a return without a value in a callback": "FV1903",
    "a const read before its declaration": "FV1901",
    "code after a return": "FV1904",
    "a case that falls through into the next": "FV1904",
    "a declaration directly in a case": "FV1904",
    "a body whose switches continue after them on too many paths": "FV1905",
    "a switch with no case for some values and nothing after it": "FV1903",
    "a function declared in a callback's body": "FV1901",
    "a computed with a loop read by the template": "FV0613",
    "Object.entries pairs mapped to themselves": "FV0816",
    "Object.entries pairs joined": "FV0816",
    "Object.entries pairs sorted without a comparator": "FV0816",
    "a pair destructured with a default": "FV0808",
    "a pair read by a computed index": "FV0612",
    "a v-for over pairs with a nested array pattern": "FV0818",
    ".flat() with a depth that is not a literal": "FV0834",
    ".flat() of a list of optional lists": "FV0834",
    ".flatMap() whose function gives only []": "FV0834",
    ".flatMap() to lists of lists": "FV0834",
    "a computed list as a slot prop": "FV0910",
    "a component written with the Options API": "FV0003",
    "a constructor called in the template": "FV0624",
    "Number.isNaN of a string, which it does not convert": "FV0718",
    "Number.isFinite of a date": "FV0718",
    "Number.isInteger without an argument": "FV0718",
    "the global isNaN of a string, which it converts": "FV0718",
    "the global isFinite of an optional number": "FV0718",
    "|| between a date and a string": "FV0617",
    "computed member access": "FV0612",
    "a list item read by a `Float` index": "FV0824",
    "a list item read by a string index": "FV0824",
    "a list item read by an optional index": "FV0824",
    "`.at()` of a list given a string": "FV0825",
    "`.at()` of a list given no index": "FV0825",
    "`.indexOf()` with a position to start from": "FV0826",
    "`.lastIndexOf()` of a value of another type than the list's": "FV0826",
    "`.indexOf()` of an object": "FV0826",
    "`.concat()` of a list of another item type": "FV0827",
    "`.concat()` of a value that is not a list": "FV0827",
    "`.reduce()` without an initial value": "FV0828",
    "`.reduceRight()` without an initial value": "FV0828",
    "`.reduce()` whose function changes the accumulator's type": "FV0829",
    "`.reduce()` into a list": "FV0829",
    "`.reduce()` given a function that is not an arrow function of the accumulator and the item": "FV0829",
    "`.reduce()` joining halves of surrogate pairs": "FV0706",
    "`.toSorted()` subtracting `Float` keys": "FV0830",
    "`.toSorted()` with a comparator that is not consistent": "FV0830",
    "`.toSorted()` with a comparator of another shape": "FV0830",
    "`.toSorted()` subtracting strings": "FV0830",
    "`.toSorted()` by `localeCompare`": "FV1805",
    "`.toSorted()` of objects without a comparator": "FV0831",
    "`.toSorted()` of strings that may hold halves of surrogate pairs": "FV0706",
    "`.sort()` of a prop in place": "FV0832",
    "`.reverse()` of a prop in place": "FV0832",
    "an array literal spreading lists of different item types": "FV0833",
    "an array literal spreading a string": "FV0833",
    "an array literal spreading objects beside a plain value": "FV0833",
    "`Math.max()` of a spread list of strings": "FV0704",
    "an optional call": "FV0629",
    "`??` after an optional chain that computes a list, falling back to another list": "FV0630",
    "a field read from a value that may be absent": "FV0604",
    "an optional chain into a method that is not supported": "FV0602",
    "the current time with new Date()": "FV1801",
    "the current time with Date.now()": "FV1801",
    "a date built from its parts in the local time zone": "FV1802",
    "a date built from a value that may be absent": "FV1802",
    "Date.parse of a number": "FV1802",
    "a date string read in the local time zone": "FV1803",
    "a date string outside the date time string format": "FV1803",
    "a date beyond the range whose offset brings it within": "FV1803",
    "a date read in the local time zone": "FV1804",
    "a date written by toString": "FV1804",
    "Date.UTC of no parts": "FV1807",
    "Date.UTC of a value that may be absent": "FV1807",
    "Date.UTC of a year engines compute differently": "FV1808",
    "two dates compared with ===": "FV1809",
    "a date compared with a string by ==": "FV1809",
    "a date ordered against a number": "FV0609",
    "JSON.stringify of a date that may be absent": "FV0707",
    "a number formatted by locale": "FV1805",
    "a date formatted by locale": "FV1805",
    "strings compared by locale": "FV1805",
    "an Intl formatter": "FV1805",
    "an Intl formatter called without new": "FV1805",
    "vue-i18n's number formatting": "FV1805",
    "a date interpolated whole": "FV0401",
    "a date bound to an attribute": "FV0403",
    "a CSS module without `cssModules` in the configuration": "FV1005",
    "v-bind() in a style block of a boolean": "FV1006",
    "v-bind() in a style block of a list": "FV1006",
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

describe("imports through aliases", () => {
  const component = (from: string) => `<script setup lang="ts">
import { LABEL } from "${from}";
import type { Row } from "${from}";
defineProps<{ row: Row }>();
</script>
<template><p>{{ LABEL }} {{ row.name }}</p></template>`;
  const lib = 'export const LABEL = "Label";\nexport interface Row { name: string }\n';
  const project = (files: Record<string, string>): string => {
    const made = mkdtempSync(join(tmpdir(), "ferrovue-"));
    roots.push(made);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(made, file, ".."), { recursive: true });
      writeFileSync(join(made, file), text);
    }
    return made;
  };
  const SRC = { components: "src/components", out: "out" };
  /** Whether the component read both the constant and the type through the import. */
  const resolves = (root: string, options: Parameters<typeof generate>[3] = {}): boolean => {
    const out = generate(root, SRC, new Map(), options);
    return out.get("x.rs")!.includes('out.push_str("<p>Label ");') && out.get("types.rs")!.includes("pub struct Row");
  };

  it("resolves the `paths` of the tsconfig.json nearest the component, written with comments and trailing commas", () => {
    const tsconfig = `{
  // as create-vue writes it
  "compilerOptions": {
    "paths": { "@/*": ["./src/*",], /* the root */ "~/*": ["./*"] },
  },
}
`;
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("@/lib/format") }))).toBe(true);
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format/index.ts": lib, "src/components/X.vue": component("~/src/lib/format") }))).toBe(true);
  });

  it("resolves `paths` against `baseUrl`, and a bare path against `baseUrl` alone", () => {
    const tsconfig = JSON.stringify({ compilerOptions: { baseUrl: "src", paths: { "#lib/*": ["lib/*"] } } });
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("#lib/format") }))).toBe(true);
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("lib/format") }))).toBe(true);
  });

  it("takes the pattern with the longest prefix, and an exact one first", () => {
    const tsconfig = JSON.stringify({ compilerOptions: { paths: { "@/*": ["./wrong/*"], "@/lib/*": ["./src/lib/*"], "@/format": ["./src/lib/format.ts"] } } });
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("@/lib/format") }))).toBe(true);
    expect(resolves(project({ "tsconfig.json": tsconfig, "src/lib/format.ts": lib, "src/components/X.vue": component("@/format") }))).toBe(true);
  });

  it("follows `extends`, relative to the file that declares `paths`, as Nuxt's generated tsconfig.json is", () => {
    expect(resolves(
      project({
        "tsconfig.json": JSON.stringify({ extends: "./.nuxt/tsconfig.json" }),
        ".nuxt/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["../*"], "@/*": ["../*"] } } }),
        "lib/format.ts": lib,
        "src/components/X.vue": component("@/lib/format"),
      }),
    )).toBe(true);
  });

  it("follows the projects a solution-style tsconfig.json references, as create-vue's is", () => {
    expect(resolves(
      project({
        "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.node.json" }, { path: "./tsconfig.app.json" }] }),
        "tsconfig.node.json": JSON.stringify({ compilerOptions: { types: ["node"] } }),
        "tsconfig.app.json": JSON.stringify({ extends: ["./tsconfig.base.json"], include: ["src/**/*"] }),
        "tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
        "src/lib/format.ts": lib,
        "src/components/X.vue": component("@/lib/format"),
      }),
    )).toBe(true);
  });

  it("tries the aliases it is given first, as Vite's `resolve.alias` lists them", () => {
    const root = project({ "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./wrong/*"] } } }), "src/lib/format.ts": lib, "src/components/X.vue": component("@/lib/format") });
    expect(resolves(root, { aliases: [{ find: "@", replacement: join(root, "src") }] })).toBe(true);
    expect(resolves(root, { aliases: [{ find: /^@\/(.*)$/, replacement: join(root, "src", "$1") }] })).toBe(true);
    expect(resolves(root, { aliases: [{ find: "@", replacement: "../" }] })).toBe(true);
  });

  it("refuses a name imported from a module it cannot resolve, naming the specifier and where it looked", () => {
    const refused = (files: Record<string, string>, from: string, options: Parameters<typeof generate>[3] = {}): string => {
      try {
        generate(project({ ...files, "src/components/X.vue": component(from) }), SRC, new Map(), options);
      } catch (e) {
        if (!(e instanceof GenError)) throw e;
        return `${e.code}: ${e.message.split("\n")[0]!}`;
      }
      throw new Error("compiled without an error");
    };
    const paths = { "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }) };
    expect(refused(paths, "@/lib/missing")).toBe(
      "FV0110: src/components/X.vue:4:20: `Row` is imported from `@/lib/missing`, which the compiler cannot resolve to a `.ts` file of the project: `@/*` in tsconfig.json's `paths` maps it to src/lib/missing, where there is no `.ts` file",
    );
    expect(refused(paths, "date-fns")).toMatch(
      /^FV0110: .*`Row` is imported from `date-fns`, which .*: it is a package, or an alias declared neither in the `compilerOptions.paths` of tsconfig.json nor in Vite's `resolve.alias` \(read only by the Vite plugin\)$/,
    );
    expect(refused({}, "@/lib/format")).toMatch(/^FV0110: .*it is a package, or an alias declared neither in a tsconfig.json's `compilerOptions.paths` \(there is none\) nor in Vite's `resolve.alias` \(read only by the Vite plugin\)$/);
    expect(refused({ "tsconfig.json": "{ not json" }, "@/lib/format")).toMatch(/^FV0110: .*the `compilerOptions.paths` of tsconfig.json \(tsconfig.json is not valid JSON: .*\) nor/);
    expect(refused({}, "./nope")).toMatch(/^FV0110: .*`Row` is imported from `\.\/nope`, which .*: there is no `\.ts` file at src\/components\/nope$/);
    expect(refused({}, "~/lib/format", { aliases: [{ find: "~", replacement: "some-package" }] })).toMatch(/^FV0110: .*: Vite's alias `~` maps it to a package$/);
  });

  it("refuses a value imported from a package where the server reads it, and leaves one the client alone uses", () => {
    const root = project({
      "src/components/X.vue": `<script setup lang="ts">
import { format } from "date-fns";
import { useQuery } from "@tanstack/vue-query";
</script>
<template><p @click="useQuery">{{ format(1) }}</p></template>`,
    });
    expect(() => generate(root, SRC)).toThrow(/^src\/components\/X\.vue:5:\d+: `format` is imported from `date-fns`, which the compiler cannot resolve/);
    writeFileSync(join(root, "src", "components", "X.vue"), readFileSync(join(root, "src", "components", "X.vue"), "utf8").replace("{{ format(1) }}", "x"));
    expect(generate(root, SRC).get("x.rs")).toContain('out.push_str("<p>x</p>");');
  });
});

describe("a `?:` whose branches differ in type, where it is shown as text", () => {
  const render = (props: string, template: string): string => {
    const out = compile(island(`<script setup lang="ts">\nimport type { Float } from "ferrovue/types";\ndefineProps<{ ${props} }>();\n</script>\n<template>${template}</template>`)).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };

  it("writes each branch as `{{ }}` writes it, a number by JavaScript's rules and an absent one as nothing", () => {
    const out = render("n: number; o?: Float; on: boolean", '<i>{{ n > 0 ? n : "none" }}</i><b>{{ on ? o : "absent" }}</b><s>{{ on ? true : "off" }}</s>');
    expect(out).toContain('fv::escape_into(out, &(if props.n as f64 > 0.0 { std::borrow::Cow::<str>::Owned(format!("{}", fv::Js(props.n))) } else { std::borrow::Cow::<str>::Borrowed("none") }));');
    expect(out).toMatch(/if let Some\(v\) = \(if props\.on \{ props\.o\.map\(\|(n\d+)\| std::borrow::Cow::<str>::Owned\(format!\("\{\}", fv::Js\(\1\)\)\)\) \} else \{ Some\(std::borrow::Cow::<str>::Borrowed\("absent"\)\) \}\)\.as_deref\(\) \{/);
  });

  it("writes each branch of an attribute's value as text, leaving the attribute out where a branch is absent", () => {
    const out = render("n: number; o?: number", `<div><i :title="n > 0 ? n : 'none'" :aria-label="o === undefined ? 'unset' : o"></i></div>`);
    expect(out).toContain('out.push_str("<div><i title=\\"");');
    expect(out).toMatch(/aria-label=\\""\);\n {4}fv::escape_into\(out, &\(if let Some\((n\d+)\) = props\.o \{ std::borrow::Cow::<str>::Owned\(format!\("\{\}", fv::Js\(\1\)\)\) \} else \{ std::borrow::Cow::<str>::Borrowed\("unset"\) \}\)\);/);
  });

  it("writes each branch in a template literal as `String()` does, `null` and `undefined` too", () => {
    const out = render("n: number; on: boolean; tags: string[]; o?: number", "<i>{{ `${on ? n : 'none'}|${on ? tags : n}|${on ? o : false}` }}</i>");
    expect(out).toContain('fv::JsOr(props.o.map(fv::Js), "undefined")');
    expect(out).toContain('.collect::<Vec<_>>().join(",")');
  });
});

describe("functions the server calls", () => {
  const project = (source: string, files: Record<string, string>): string => {
    const root = island(source);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "components", name), text);
    return root;
  };
  const caller = (call: string, imports: string) => `<script setup lang="ts">
import { ${imports} } from "./text";
const props = defineProps<{ word: string; n: number }>();
</script>
<template><i>{{ ${call} }}</i></template>`;

  it("inlines a function imported from a .ts file, which may call the file's own functions and read its constants", () => {
    const out = compile(project(caller("shout(word)", "shout"), { "text.ts": `const MARK = "!";
function loud(t: string): string {
  return t.toUpperCase();
}
export function shout(t: string): string {
  const l = loud(t.trim());
  if (l === "") return "-";
  return l + MARK;
}
` })).get("x.rs")!;
    expect(out).toMatch(/fv::js_trim\(&props\.word\)/);
    expect(out).toMatch(/format!\("\{\}!", /);
  });

  it("inlines a function a .ts file exports as its default", () => {
    const out = compile(project(`<script setup lang="ts">
import initial from "./text";
defineProps<{ word: string }>();
</script>
<template><i>{{ initial(word) }}</i></template>`, { "text.ts": "export default function (t: string): string {\n  return t.slice(0, 1).toUpperCase();\n}\n" })).get("x.rs")!;
    expect(out).toMatch(/fv::js_slice\(&props\.word, 0\.0f64, Some\(1\.0f64\)\)/);
  });

  it("refuses an imported function whose body holds a loop, naming the statement", () => {
    const e = (() => {
      try {
        compile(project(caller("sum(n)", "sum"), { "text.ts": "export function sum(k: number): number {\n  let t = 0;\n  while (t < k) t = t + 1;\n  return t;\n}\n" }));
      } catch (err) {
        return err as GenError;
      }
      throw new Error("compiled");
    })();
    expect(e.code).toBe("FV0601");
    expect(e.message).toMatch(/^components\/X\.vue:5:\d+: `sum\(\)` is not available when rendering on the server: its body .*\(components\/text\.ts:3, FV1902\)/);
  });

  it("refuses a const function setup calls above its declaration, and lets a computed or later code call it", () => {
    const refused = (script: string): string | undefined => {
      try {
        compile(island(`<script setup lang="ts">\nimport { computed } from "vue";\nconst props = defineProps<{ n: number }>();\n${script}\n</script>\n<template><i>{{ props.n }}</i></template>`));
      } catch (err) {
        return (err as GenError).code;
      }
      return undefined;
    };
    expect(refused("const label = fmt(props.n);\nconst fmt = (x: number) => `#${x}`;")).toBe("FV1908");
    expect(refused("const label = wrap(props.n);\nfunction wrap(x: number) { return fmt(x); }\nconst fmt = (x: number) => `#${x}`;")).toBe("FV1908");
    expect(refused("const label = computed(() => fmt(props.n));\nconst fmt = (x: number) => `#${x}`;")).toBeUndefined();
    expect(refused("const fmt = (x: number) => `#${x}`;\nconst label = fmt(props.n);")).toBeUndefined();
    expect(refused("const label = wrap(props.n);\nfunction wrap(x: number) { return `#${x}`; }")).toBeUndefined();
  });

  it("leaves a function only an event handler calls client-only, whatever its body holds", () => {
    const out = compile(island(`<script setup lang="ts">
import { ref } from "vue";
const count = ref(0);
function bump() {
  for (let i = 0; i < 3; i++) count.value++;
}
</script>
<template><button @click="bump">{{ count }}</button></template>`)).get("x.rs")!;
    expect(out).toContain("fv::push_int(out, s_count)");
  });

  it("binds each argument once, in order, and gives a missing one its default", () => {
    const out = compile(island(`<script setup lang="ts">
const props = defineProps<{ word: string; n: number }>();
function pad(t: string, width = 3, fill?: string): string {
  return t.padStart(width, fill ?? ".") + t;
}
</script>
<template><i>{{ pad(word.toUpperCase()) }}</i></template>`)).get("x.rs")!;
    expect(out).toMatch(/let (fv_c\d+) = props\.word\.to_uppercase\(\);.*fv::js_pad_start\(&\1, 3\.0f64, "\."\), \1\)/);
    expect(out.match(/to_uppercase/g)).toHaveLength(1);
  });
});

describe("constant lookups", () => {
  const render = (script: string, template: string, files: Record<string, string> = {}): string => {
    const project = island(`<script setup lang="ts">\n${script}\n</script>\n<template>${template}</template>`);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(project, "components", name), text);
    const out = compile(project).get("x.rs")!;
    return out.slice(out.indexOf("pub fn render"), out.indexOf("/// The component's markup"));
  };

  it("reads a constant object by a prop typed as a union of string literals with a `match`", () => {
    const out = render(
      'type Size = "sm" | "md" | "lg";\ndefineProps<{ size: Size }>();\nconst PAD = { sm: "p-1", md: "p-2", lg: "p-4" } as const;',
      '<i :class="PAD[size]">{{ PAD[size] }}</i>',
    );
    expect(out).toContain('fv::class_into(out, false, &[match &*props.size { "sm" => "p-1", "md" => "p-2", _ => "p-4" }]);');
    expect(out).toContain('fv::escape_into(out, match &*props.size { "sm" => "p-1", "md" => "p-2", _ => "p-4" });');
  });

  it("reads the union's last member in the `_` arm, whatever the `??` default and however the values group", () => {
    const out = render(
      'type K = "a" | "b" | "c";\ndefineProps<{ k?: K; j: K }>();\nconst T = { a: "A", b: "B", c: "C" } as const;\nconst U = { a: "A", b: "B", c: "A" } as const;',
      "<i>{{ T[k ?? 'c'] }} {{ T[k ?? 'b'] }} {{ U[j] }}</i>",
    );
    expect(out.match(/match [^{]*\{ "a" => "A", "b" => "B", _ => "C" \}/g)).toHaveLength(2);
    expect(out).toContain('match &*props.j { "b" => "B", _ => "A" }');
  });

  it("reads a value outside the union as the last member in a table of booleans and in `v-if` of a table that lacks members", () => {
    const out = render(
      'type K = "a" | "b" | "c";\ndefineProps<{ k: K }>();\nconst LAST = { a: false, b: false, c: true };\nconst FIRST = { a: true, b: false, c: false };\nconst ICON: Partial<Record<K, { label: string }>> = { a: { label: "ia" }, c: { label: "ic" } };\nconst NONE_LAST: Partial<Record<K, { label: string }>> = { a: { label: "ia" }, b: { label: "ib" } };',
      '<i v-if="LAST[k]">l</i><i v-if="FIRST[k]">f</i><b v-if="ICON[k]">{{ ICON[k].label }}</b><b v-if="NONE_LAST[k]">{{ NONE_LAST[k].label }}</b>',
    );
    expect(out).toContain('if !matches!(&*props.k, "a" | "b") {');
    expect(out).toContain('if matches!(&*props.k, "a") {');
    expect(out).toContain('if !matches!(&*props.k, "b") {');
    expect(out).toContain('if matches!(&*props.k, "a" | "b") {');
  });

  it("reads a constant a `.ts` file exports, keyed by its enum's members, by a prop of the enum and a `v-for` item's field", () => {
    const out = render(
      'import { THEME, Tone } from "./theme";\ninterface Badge { tone: Tone }\ndefineProps<{ tone: Tone; badges: Badge[] }>();',
      '<i :style="{ color: THEME[tone].fg }">{{ THEME[Tone.Warn].fg }}</i><b v-for="b in badges">{{ THEME[b.tone].weight }}</b>',
      { "theme.ts": 'export enum Tone { Info = "info", Warn = "warn" }\nexport const THEME: Record<Tone, { fg: string; weight: number }> = { [Tone.Info]: { fg: "navy", weight: 400 }, [Tone.Warn]: { fg: "red", weight: 700.5 } };\n' },
    );
    expect(out).toContain('fv::escape_into(out, match &*props.tone { "info" => "navy", _ => "red" });');
    expect(out).toContain("red</i>");
    expect(out).toContain('fv::push_number(out, match &*b.tone { "info" => 400.0f64, _ => 700.5f64 });');
  });

  it("reads by integer literal keys, and keeps the literals of a `?:` and a `computed`", () => {
    const out = render(
      'import { computed } from "vue";\nconst props = defineProps<{ level: 1 | 2; on: boolean }>();\nconst NAMES = { 1: "one", 2: "two", x: "ex" };\nconst PAD = { a: "p-1", b: "p-2" };\nconst pick = computed(() => (props.on ? "a" : "b"));',
      "<i>{{ NAMES[level] }} {{ PAD[on ? 'b' : 'a'] }} {{ PAD[pick] }}</i>",
    );
    expect(out).toContain('fv::escape_into(out, match props.level { 1 => "one", _ => "two" });');
    expect(out).toContain('fv::escape_into(out, match if props.on { "b" } else { "a" } { "b" => "p-2", _ => "p-1" });');
    expect(out).toContain('fv::escape_into(out, match s_pick { "a" => "p-1", _ => "p-2" });');
  });

  it("reads `undefined` for the keys an object lacks, narrowed with `??`, `?.` and `v-if`", () => {
    const out = render(
      'defineProps<{ kind: "a" | "b" | "c" }>();\nconst T = { a: "A", b: "B" };\nconst I = { a: { label: "x" } };',
      '<i>{{ T[kind] ?? "-" }} {{ I[kind]?.label }}</i><b v-if="I[kind]">{{ I[kind].label }}</b><s v-if="T[kind]">{{ T[kind] }}</s>',
    );
    expect(out).toContain('fv::escape_into(out, (match &*props.kind { "a" => Some("A"), "b" => Some("B"), _ => None }).unwrap_or("-"));');
    expect(out).toContain('if let Some(v) = match &*props.kind { "a" => Some("x"), _ => None } {');
    expect(out).toContain('if matches!(&*props.kind, "a") {\n        out.push_str("<b>x</b>");');
    expect(out).toMatch(/if let Some\((n\d+)\) = \(match &\*props\.kind \{ "a" => Some\("A"\), "b" => Some\("B"\), _ => None \}\)\.filter\(\|v\| !v\.is_empty\(\)\) \{\n {8}out\.push_str\("<s>"\);\n {8}fv::escape_into\(out, \1\);/);
  });

  it("forgets the literals of a list item or a `??` that another value may be", () => {
    expect(() => render('defineProps<{ k: "sm"; s: string }>();\nconst PAD = { sm: "p-1" };', '<i v-for="x in [k, s]">{{ PAD[x] }}</i>')).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(() => render('defineProps<{ k?: "sm"; s: string }>();\nconst PAD = { sm: "p-1" };', "<i>{{ PAD[k ?? s] }}</i>")).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(() => render('defineProps<{ ks?: "sm"[]; ss: string[] }>();\nconst PAD = { sm: "p-1" };', '<i v-for="x in (ks ?? ss)">{{ PAD[x] }}</i>')).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(() => render('defineProps<{ ns: number[] }>();\nconst START = 0;\nconst N: Record<number, string> = { 0: "a", 1: "b" };', "<i>{{ N[ns.reduce((a, n) => a + n, START)] }}</i>")).toThrow(expect.objectContaining({ code: "FV0222" }));
    expect(render('defineProps<{ ks?: "sm"[] }>();\nconst PAD = { sm: "p-1" };', '<i v-for="x in (ks ?? [])">{{ PAD[x] }}</i>')).toContain('out.push_str("<i>p-1</i>");');
  });
});

describe("`v-bind()` in `<style>`", () => {
  const source = `<script setup lang="ts">
const props = defineProps<{ color: string; gap?: number }>();
</script>
<template><p>x</p></template>
<style>
p { color: v-bind(color); gap: v-bind(gap); width: v-bind('color + "px"'); }
</style>`;
  const vueNames = (id: string, isProd: boolean): string[] => {
    const { descriptor } = parseSfc(source, { filename: "X.vue" });
    const { code } = compileTemplate({ source: descriptor.template!.content, filename: "X.vue", id: `data-v-${id}`, ssr: true, ssrCssVars: descriptor.cssVars, isProd });
    return [...code.matchAll(/^\s*"(:--(?:[^"\\]|\\.)*)":/gm)].map((m) => JSON.parse(`"${m[1]!.slice(1)}"`) as string);
  };
  const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 8);

  it("names the variables as Vue's compiler does, for production by default and for development", () => {
    const root = island(source);
    const production = vueNames(hash(`components/X.vue${source}`), true);
    const development = vueNames(hash("components/X.vue"), false);
    expect(production).toHaveLength(3);
    expect(production.filter((n) => n.includes("color") || n.includes("gap"))).toEqual([]);
    expect(development[2]).toBe(`--${hash("components/X.vue")}-color\\ \\+\\ \\"px\\"`);
    const written = (config: object) => generate(root, { ...CONFIG, ...config }).get("x.rs")!;
    const literal = (name: string): string => `${name.replaceAll('"', "&quot;").replaceAll("\\", "\\\\")}:`;
    for (const name of production) expect(written({})).toContain(literal(name));
    for (const name of development) expect(written({ scopeId: "filepath", isProduction: false })).toContain(literal(name));
    expect(written({})).not.toContain(literal(development[0]!));
  });

  it("writes `initial` for an absent value and a space for an empty string, as `ssrRenderStyle` does", () => {
    const out = generate(island(source), { ...CONFIG, scopeId: "filepath", isProduction: false }).get("x.rs")!;
    expect(out).toContain(`-gap:initial;");`);
    expect(out).toContain("out.push(' ');");
  });
});

describe("`<style module>`", () => {
  const MODULES = { ...CONFIG, cssModules: { generateScopedName: "[local]_x" } };
  const refusalWith = (source: string): GenError => {
    try {
      generate(island(source), MODULES);
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it.each([
    ["a module in another file", `<template><i /></template>\n<style module src="./x.css"></style>`, "FV1014", /^components\/X\.vue:2:1: `<style module src>`/],
    ["a module a preprocessor compiles", `<template><i /></template>\n<style module lang="scss">.a { .b { color: red } }</style>`, "FV1014", /^components\/X\.vue:2:1: `<style module lang="scss">`/],
    ["a class composed from another file", `<template><i /></template>\n<style module>.a { composes: b from "./b.css"; }</style>`, "FV1014", /cannot name: it imports from another file/],
    ["a value imported from another file", `<template><i /></template>\n<style module>@value b from "./b.css";\n.a { color: b; }</style>`, "FV1014", /cannot name: it imports from another file/],
    ["CSS that does not parse", `<template><i /></template>\n<style module>.a { color: red</style>`, "FV1014", /cannot name: .*Unclosed block/],
    [
      "`useCssModule` of a module the component lacks",
      `<script setup lang="ts">\nimport { useCssModule } from "vue";\nconst c = useCssModule("nope");\n</script>\n<template><i :class="c.a" /></template>\n<style module>.a { color: red }</style>`,
      "FV1015",
      /^components\/X\.vue:3:11: `useCssModule\("nope"\)` names no `<style module="nope">` of this component/,
    ],
    [
      "`useCssModule` of a name chosen at run time",
      `<script setup lang="ts">\nimport { useCssModule } from "vue";\nconst props = defineProps<{ n: string }>();\nconst c = useCssModule(props.n);\n</script>\n<template><i :class="c.a" /></template>\n<style module>.a { color: red }</style>`,
      "FV1015",
      /takes the name of a `<style module>` as a string literal/,
    ],
  ])("refuses %s", (_, source, code, message) => {
    const e = refusalWith(source);
    expect(e.code).toBe(code);
    expect(e.message).toMatch(message);
  });

  it("reads a module's classes as constant strings, and a class it lacks as `undefined`", () => {
    const out = generate(
      island(`<script setup lang="ts">
import { useCssModule } from "vue";
const theme = useCssModule("theme");
</script>
<template><p :class="[$style.a, $style.missing, theme.b]" :title="$style.missing">{{ $style['a-b'] }}</p></template>
<style module>.a { color: red } .a-b { color: blue }</style>
<style module="theme">.b { color: red }</style>`),
      MODULES,
    ).get("x.rs")!;
    expect(out).toContain('fv::class_into(out, false, &["a_x", "b_x"]);\n    out.push_str("\\">a-b_x</p>");');
  });

  it("refuses a module bound whole", () => {
    const e = refusalWith(`<template><i :title="$style" /></template>\n<style module>.a { color: red }</style>`);
    expect(e.message).toMatch(/`title` is bound to the CSS module `\$style`.*bind one of its classes, as `\$style\.name`/);
  });
});

describe("the configuration", () => {
  const configured = (config: unknown): string => {
    const root = island(`<template><p /></template>`);
    writeFileSync(join(root, "ferrovue.config.json"), JSON.stringify(config));
    return root;
  };
  const refusedWith = (config: unknown): GenError => {
    try {
      loadConfig(configured(config));
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("loaded without an error");
  };
  const helper = (spec: unknown) => ({ ...CONFIG, helpers: { module: "./helpers", functions: { plural: spec } } });
  const cases: [string, unknown, Code, RegExp][] = [
    ["null", null, "FV1113", /^ferrovue\.config\.json holds `null`, where it holds an object/],
    ["an array", [CONFIG], "FV1113", /holds an array/],
    ["a string", "components", "FV1113", /holds a string/],
    ["a misspelt key", { components: "components", out: "out", store: "stores" }, "FV1114", /^ferrovue\.config\.json has no key `store`: did you mean `stores`\?$/],
    ["a misspelt required key", { component: "components", out: "out" }, "FV1114", /did you mean `components`\?/],
    ["a key in the wrong case", { ...CONFIG, I18n: { messages: "locales" } }, "FV1114", /did you mean `i18n`\?/],
    ["a key like none", { ...CONFIG, plugins: [] }, "FV1114", /has no key `plugins`: it takes `components`, `out`/],
    ["a misspelt key in `router`", { ...CONFIG, router: { routes: "routes.json", linkActiveClas: "on" } }, "FV1114", /^`router` in ferrovue\.config\.json has no key `linkActiveClas`: did you mean `linkActiveClass`\?/],
    ["a string of client directives", { ...CONFIG, clientDirectives: "focus" }, "FV1115", /^`clientDirectives` in ferrovue\.config\.json is a list of directive names/],
    ["`isProduction` that is not a boolean", { ...CONFIG, isProduction: "yes" }, "FV1115", /^`isProduction` in ferrovue\.config\.json is `true` or `false`/],
    ["`cssModules` without a pattern", { ...CONFIG, cssModules: {} }, "FV1115", /^`cssModules\.generateScopedName` in ferrovue\.config\.json is a string/],
    ["`cssModules` that is a string", { ...CONFIG, cssModules: "[local]" }, "FV1115", /^`cssModules` in ferrovue\.config\.json is an object/],
    ["a misspelt key in `cssModules`", { ...CONFIG, cssModules: { generateScopedName: "[local]", hashPrefx: "" } }, "FV1114", /did you mean `hashPrefix`\?/],
    ["a helper without `params`", helper({ rust: "crate::plural", returns: "string" }), "FV1115", /`helpers\.functions\.plural\.params` in ferrovue\.config\.json is the list of types/],
    ["a helper without `rust`", helper({ params: [], returns: "string" }), "FV1115", /`helpers\.functions\.plural\.rust` in ferrovue\.config\.json is a string/],
    ["a helper type ferrovue does not know", helper({ rust: "crate::plural", params: ["number"], returns: "string" }), "FV1107", /`helpers\.functions\.plural\.params\[0\]` in ferrovue\.config\.json is "number": a helper or twin takes one of/],
    ["a helper without `returns`", helper({ rust: "crate::plural", params: [] }), "FV1107", /`helpers\.functions\.plural\.returns` in ferrovue\.config\.json is missing/],
    ["a negative `maxLen`", helper({ rust: "crate::plural", params: [], returns: "string", maxLen: -1 }), "FV1115", /`helpers\.functions\.plural\.maxLen`/],
    ["helpers without `functions`", { ...CONFIG, helpers: { module: "./helpers" } }, "FV1115", /`helpers\.functions`/],
    ["a twin prop of an unknown type", { ...CONFIG, twins: { VBtn: { rust: "crate::v_btn", props: { label: "text" } } } }, "FV1107", /`twins\.VBtn\.props\.label` in ferrovue\.config\.json is "text"/],
    ["twins in a list", { ...CONFIG, twins: [] }, "FV1115", /^`twins` in ferrovue\.config\.json is an object of twins/],
    ["twin slots that are not a list", { ...CONFIG, twins: { VBtn: { rust: "crate::v_btn", slots: "default" } } }, "FV1115", /`twins\.VBtn\.slots`/],
    ["routes of neither kind", { ...CONFIG, routes: { folder: "pages" } }, "FV1238", /^`routes` in ferrovue\.config\.json is a JSON file of routes, or `\{ "pages": "…" \}`/],
    ["router routes of neither kind", { ...CONFIG, router: { routes: 1 } }, "FV1238", /^`router\.routes` in/],
    ["a router base that is not a string", { ...CONFIG, router: { routes: "routes.json", base: 1 } }, "FV1115", /^`router\.base` in ferrovue\.config\.json is a string/],
    ["i18n as a string", { ...CONFIG, i18n: "locales" }, "FV1115", /^`i18n` in ferrovue\.config\.json is an object/],
    ["i18n without `messages`", { ...CONFIG, i18n: { locale: "en" } }, "FV1115", /^`i18n\.messages` in ferrovue\.config\.json is a string/],
    ["a fallback locale that is a number", { ...CONFIG, i18n: { messages: "locales", fallbackLocale: 1 } }, "FV1115", /`i18n\.fallbackLocale`/],
    ["stores that is not a string", { ...CONFIG, stores: ["stores"] }, "FV1115", /^`stores` in ferrovue\.config\.json is a string/],
    ["a `trustedHtml` that is not a string", { ...CONFIG, trustedHtml: true }, "FV1115", /^`trustedHtml`/],
    ["a `viteRoot` that is not a string", { ...CONFIG, viteRoot: 1 }, "FV1115", /^`viteRoot`/],
  ];
  for (const [what, config, code, message] of cases) {
    it(`refuses ${what}`, () => {
      const e = refusedWith(config);
      expect(e.code).toBe(code);
      expect(e.message).toMatch(message);
      expect(e.at).toEqual({ file: "ferrovue.config.json" });
    });
  }

  it("takes every key the README lists, and the repository's own configurations", () => {
    const full = {
      ...CONFIG,
      router: { routes: { pages: "pages" }, base: "/app", linkActiveClass: "on", linkExactActiveClass: "here" },
      stores: "stores",
      trustedHtml: "ferrovue::InlineHtml",
      helpers: { module: "./helpers", functions: { plural: { rust: "crate::plural", params: ["int", "string?"], returns: "string", maxLen: 1 } } },
      twins: { VBtn: { rust: "crate::v_btn", props: { label: "string" }, slots: ["default"] } },
      i18n: { messages: "locales", locale: "en", fallbackLocale: ["en"] },
      clientDirectives: ["focus"],
      scopeId: "filepath",
      viteRoot: ".",
      builders: false,
    };
    expect(loadConfig(configured(full))).toEqual(full);
    for (const dir of ["crates/ferrovue/tests/conformance", "examples/fullstack", "examples/greeting"]) {
      expect(() => loadConfig(join(import.meta.dirname, "../../..", dir)), dir).not.toThrow();
    }
  });
});

describe("the project's inputs", () => {
  const failure = (run: () => unknown): GenError => {
    try {
      run();
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };
  const page = `<template><p /></template>`;

  it("refuses a components, stores or messages directory that does not exist", () => {
    const root = island(page);
    expect(failure(() => generate(root, { components: "nowhere", out: "out" }))).toMatchObject({ code: "FV1116", message: "cannot read the `components` directory `nowhere`: it does not exist", at: { file: "nowhere" } });
    expect(failure(() => generate(root, { ...CONFIG, stores: "stores" }))).toMatchObject({ code: "FV1116", message: "cannot read the `stores` directory `stores`: it does not exist" });
    expect(failure(() => generate(root, { ...CONFIG, i18n: { messages: "locales" } }))).toMatchObject({ code: "FV1116", message: "cannot read the `i18n.messages` directory `locales`: it does not exist" });
    writeFileSync(join(root, "locales"), "");
    expect(failure(() => generate(root, { ...CONFIG, i18n: { messages: "locales" } })).message).toMatch(/it is not a directory$/);
  });

  it("refuses a routes file that is missing, is not JSON, or is not a list of routes", () => {
    const root = island(page);
    const routes = (text: string | null) => {
      if (text !== null) writeFileSync(join(root, "routes.json"), text);
      return failure(() => generate(root, { ...CONFIG, routes: "routes.json" }));
    };
    expect(routes(null)).toMatchObject({ code: "FV1246", message: "routes.json: cannot read the file: it does not exist", at: { file: "routes.json" } });
    const malformed = routes(`["/", "/about"`);
    expect(malformed.code).toBe("FV1247");
    expect(malformed.message).toMatch(/^routes\.json: /);
    expect(malformed.at).toEqual({ file: "routes.json" });
    expect(routes(`{ "path": "/" }`)).toMatchObject({ code: "FV1232", at: { file: "routes.json" } });
    expect(routes(`[{ "name": "home" }]`)).toMatchObject({ code: "FV1233", at: { file: "routes.json" } });
  });

  it("refuses a store or a type file that does not parse, naming the file and where it stopped", () => {
    const root = island(`<script setup lang="ts">
import type { Item } from "../types";
defineProps<{ item: Item }>();
</script>
<template><p>{{ item.name }}</p></template>`);
    writeFileSync(join(root, "types.ts"), "export interface Item {\n  name: string\n  size: = 2;\n}\n");
    const typed = failure(() => compile(root));
    expect(typed.code).toBe("FV0001");
    expect(typed.at).toMatchObject({ file: "types.ts", line: 3 });
    expect(typed.message).toMatch(/^types\.ts:3:\d+: Unexpected token\n 3 \| {3}size: = 2;\n/);
    mkdirSync(join(root, "stores"));
    writeFileSync(join(root, "stores", "prefs.ts"), `import { defineStore } from "pinia";\nexport const usePrefs = defineStore("prefs", {\n`);
    const store = failure(() => generate(root, { ...CONFIG, stores: "stores" }));
    expect(store.code).toBe("FV0001");
    expect(store.at).toMatchObject({ file: "stores/prefs.ts", line: 3, column: 1 });
  });
});
