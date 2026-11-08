import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GenError } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import { oneLine } from "./code.ts";
import { CONFIG, compile, island } from "./project.ts";

describe("unions of string literals", () => {
  const project = (source: string, files: Record<string, string> = {}): string => {
    const root = island(source);
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    return root;
  };
  const rendered = (out: string): string => out.slice(out.indexOf("pub fn render"));
  const failure = (run: () => unknown): GenError => {
    try {
      run();
    } catch (e) {
      if (e instanceof GenError) return e;
      throw e;
    }
    throw new Error("compiled without an error");
  };

  it("names each variant after its literal's letters and digits in PascalCase", () => {
    const out = compile(
      island(`<script setup lang="ts">
defineProps<{ a: "sm" | "x-large" | "2xl" | "" | "_self" | "fooBar" | "XL" | "h1" }>();
</script>
<template><p>{{ a }}</p></template>`),
    ).get("x.rs")!;
    for (const [literal, variant] of [["sm", "Sm"], ["x-large", "XLarge"], ["2xl", "V2xl"], ["", "Empty"], ["_self", "Self_"], ["fooBar", "FooBar"], ["XL", "Xl"], ["h1", "H1"]]) {
      expect(out).toContain(`    #[serde(rename = ${JSON.stringify(literal)})]\n    ${variant},`);
      expect(out).toContain(`            XA::${variant} => ${JSON.stringify(literal)},`);
    }
    expect(out).toContain("/// `a` in `X.vue`: `\"sm\" | \"x-large\" | \"2xl\" | \"\" | \"_self\" | \"fooBar\" | \"XL\" | \"h1\"`.");
    expect(out).toContain("#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]\npub enum XA {");
    expect(out).toContain("    pub const ALL: [XA; 8] = [XA::Sm, XA::XLarge, XA::V2xl, XA::Empty, XA::Self_, XA::FooBar, XA::Xl, XA::H1];");
    expect(out).toContain("    pub const fn as_str(self) -> &'static str {");
    expect(out).toContain("impl std::fmt::Display for XA {");
    expect(out).toContain('            _ => Err(ferrovue::props::ParseUnionError::new("XA", s, &["sm", "x-large", "2xl", "", "_self", "fooBar", "XL", "h1"])),');
    expect(out).toContain("impl TryFrom<&str> for XA {");
    expect(out).toContain("pub struct Props {\n    pub a: XA,\n}");
    expect(out).toContain("pub fn new(a: XA) -> Self {");
  });

  it("names a union in place after its component and prop, or its interface and field, and an alias or an enum after itself", () => {
    const out = compile(
      island(`<script setup lang="ts">
type Tone = "calm" | "loud";
enum Rank { Low = "low", HighEnd = "high" }
interface Row { kind: "note" | "tip"; tone?: Tone }
defineProps<{ size: "sm" | "md"; rows: Row[]; tone: Tone; rank: Rank | null }>();
</script>
<template><p v-for="r in rows">{{ size }}{{ r.kind }}{{ r.tone }}{{ tone }}{{ rank }}</p></template>`),
    ).get("x.rs")!;
    expect(out).toContain("pub enum XSize {");
    expect(out).toContain("pub enum RowKind {");
    expect(out).toContain("pub enum Tone {");
    expect(out).toContain('pub enum Rank {\n    #[serde(rename = "low")]\n    Low,\n    #[serde(rename = "high")]\n    HighEnd,\n}');
    expect(out).toContain("    pub kind: RowKind,\n    #[serde(default, skip_serializing_if = \"Option::is_none\")]\n    pub tone: Option<Tone>,");
    expect(out).toContain("    pub rank: Option<Rank>,");
    expect(out.match(/pub enum Tone \{/g)).toHaveLength(1);
  });

  it("makes a `defineModel` of a union an enum, compared by variant and written through `as_str()`", () => {
    const out = compile(
      island(`<script setup lang="ts">
const model = defineModel<"x" | "y">({ required: true });
const other = defineModel<"x" | "y">("other");
</script>
<template><select v-model="model"><option value="x">X</option></select><b v-if="model === 'y'">{{ other }}</b></template>`),
    ).get("x.rs")!;
    expect(out).toContain("pub model_value: XModelValue,");
    expect(out).toContain("pub other: Option<XOther>,");
    expect(out).toContain('if fv::props::Union::as_str(props.model_value) == "x" {');
    expect(out).toContain("if props.model_value == XModelValue::Y {");
  });

  it("keeps a single literal, a union with `string` and integer literals as they were", () => {
    const out = compile(
      island(`<script setup lang="ts">
defineProps<{ one: "a"; open: "a" | string; level: 1 | 2 }>();
</script>
<template><p>{{ one }}{{ open }}{{ level }}</p></template>`),
    ).get("x.rs")!;
    expect(out).not.toContain("pub enum");
    expect(out).toContain("pub one: Cow<'a, str>,");
    expect(out).toContain("pub open: Cow<'a, str>,");
    expect(out).toContain("pub level: i64,");
  });

  it("makes a list of a union a list of its enum, optional and nullable, of optional items, and in an interface", () => {
    const out = compile(
      island(`<script setup lang="ts">
type Tone = "calm" | "loud";
interface Row { tones: Tone[] }
defineProps<{ tags: ("p" | "q")[]; tones: Tone[]; some?: Tone[]; none: Tone[] | null; holes: (Tone | null)[]; rows: Row[] }>();
</script>
<template><p>{{ tags.length }}{{ tones.length }}{{ some?.length }}{{ none?.length }}{{ holes.length }}{{ rows.length }}</p></template>`),
    ).get("x.rs")!;
    expect(out).toContain("pub enum XTags {");
    expect(out).toContain("pub tags: Vec<XTags>,");
    expect(out).toContain("pub tones: Vec<Tone>,");
    expect(out).toContain("pub some: Option<Vec<Tone>>,");
    expect(out).toContain("pub none: Option<Vec<Tone>>,");
    expect(out).toContain("pub holes: Vec<Option<Tone>>,");
    expect(out).toContain("pub struct Row {\n    pub tones: Vec<Tone>,\n}");
    expect(out).toContain("pub fn new(tags: impl IntoIterator<Item = XTags>, tones: impl IntoIterator<Item = Tone>, holes: Vec<Option<Tone>>, rows: Vec<Row>) -> Self {");
    expect(out).toContain("pub fn none(mut self, none: impl IntoIterator<Item = Tone>) -> Self {");
    expect(out).toContain("pub fn some(mut self, some: impl IntoIterator<Item = Tone>) -> Self {");
    expect(out).not.toContain("Cow<'a");
  });

  it("hands each item of a list of a union to a child's prop as the enum, and the list to a child's list of the union", () => {
    const out = oneLine(rendered(
      compile(
        island(
          `<script setup lang="ts">
import Y from "./Y.vue";
type Tone = "calm" | "loud";
const LABEL = { calm: "Calm", loud: "Loud" } as const;
defineProps<{ tones: Tone[]; some?: Tone[]; holes: (Tone | null)[] }>();
</script>
<template><Y v-for="t in tones" :key="t" :tone="t" :wide="t" :all="tones" /><Y :all="some ?? []" :some="some" /><Y v-for="t in holes" :tone="t ?? undefined" :all="[]" /><b v-for="t in some ?? []">{{ LABEL[t] }}</b></template>`,
          {
            Y: `<script setup lang="ts">
type Tone = "calm" | "loud";
defineProps<{ tone?: Tone; wide?: Tone | "hot"; all: Tone[]; some?: Tone[] }>();
</script>
<template><i :data-tone="tone" :data-wide="wide">{{ all.join() }}{{ some?.join() }}</i></template>`,
          },
        ),
      ).get("x.rs")!,
    ));
    expect(out).toContain("for fv_t_ref in props.tones.iter() {\n        let fv_t = *fv_t_ref;");
    expect(out).toContain("tone: Some(match fv_t { Tone::Calm => super::y::Tone::Calm, Tone::Loud => super::y::Tone::Loud }), wide: Some(match fv_t { Tone::Calm => super::y::YWide::Calm, Tone::Loud => super::y::YWide::Loud }), all: props.tones.iter().map(|&v| match v { Tone::Calm => super::y::Tone::Calm, Tone::Loud => super::y::Tone::Loud }).collect(), some: None");
    expect(out).toContain("all: props.some.as_deref().unwrap_or(&[]).iter().map(|&v| match v {");
    expect(out).toContain("some: props.some.as_ref().map(|v| v.iter().map(|&v| match v {");
    expect(out).toContain("tone: fv_t_2.map(|v| match v { Tone::Calm => super::y::Tone::Calm, Tone::Loud => super::y::Tone::Loud }), wide: None, all: Vec::new()");
    expect(out).toContain("out.push_str(match fv_t_3 { Tone::Calm => \"Calm\", Tone::Loud => \"Loud\" });");
    expect(out).not.toContain("_ =>");
    expect(out).not.toContain("parse");
  });

  it("parses a string the Rust caller holds where a child's union prop needs the enum, refusing the render outside the union", () => {
    const out = rendered(
      compile(
        island(
          `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ one: "calm"; byName: Record<string, "calm" | "loud"> }>();
</script>
<template><Y :tone="one" /><Y v-for="t in byName" :tone="t" /></template>`,
          {
            Y: `<script setup lang="ts">
defineProps<{ tone: "calm" | "loud" }>();
</script>
<template><i>{{ tone }}</i></template>`,
          },
        ),
      ).get("x.rs")!,
    );
    expect(out).toContain('tone: match props.one.parse::<super::y::YTone>() { Ok(fv_u) => fv_u, Err(fv_e) => { fv_refusals.keep(Err::<(), _>(fv::render::Refused::new("FV0518", format!("{fv_e}: the template needs one of them here, and Vue would write the string itself: check the value before rendering"))), 5, 21); super::y::YTone::Calm } }');
    expect(out).toContain("tone: match fv_t.parse::<super::y::YTone>() {");
    expect(out).not.toContain("_ =>");
  });

  it("refuses a list of strings given to a child's list of a union", () => {
    const e = failure(() =>
      compile(
        island(
          `<script setup lang="ts">
import Y from "./Y.vue";
defineProps<{ names: string[] }>();
</script>
<template><Y :all="names" /></template>`,
          {
            Y: `<script setup lang="ts">
defineProps<{ all: ("calm" | "loud")[] }>();
</script>
<template><i>{{ all.join() }}</i></template>`,
          },
        ),
      ),
    );
    expect(e.code).toBe("FV0515");
  });

  it("writes a union a `.ts` file declares once, to `types.rs`, for every component that uses it", () => {
    const root = project(
      `<script setup lang="ts">
import type { Size } from "../types/ui";
import Child from "./Child.vue";
defineProps<{ size: Size }>();
</script>
<template><Child :size="size" /></template>`,
      {
        "components/Child.vue": `<script setup lang="ts">
import type { Size as S } from "../types/ui";
defineProps<{ size: S }>();
</script>
<template><b>{{ size }}</b></template>`,
        "types/ui.ts": 'export type Size = "sm" | "md";\n',
        "types/other.ts": 'export type Size = "sm" | "md";\n',
      },
    );
    const out = compile(root);
    expect(out.get("types.rs")).toContain("/// `Size` in `types/ui.ts`: `\"sm\" | \"md\"`.\n#[derive(");
    expect(out.get("types.rs")!.match(/pub enum Size \{/g)).toHaveLength(1);
    expect(out.get("x.rs")).toContain("pub size: super::types::Size,");
    expect(out.get("x.rs")).toContain("super::child::try_render(out, &super::child::Props { size: props.size })?;");
    expect(out.get("child.rs")).toContain("pub size: super::types::Size,");
  });

  it("shares the enum of two `.ts` files that declare one union by one name, and refuses two different ones", () => {
    const using = (other: string): string =>
      project(
        `<script setup lang="ts">
import type { Size } from "../types/ui";
import type { Size as Other } from "../types/other";
defineProps<{ a: Size; b: Other }>();
</script>
<template><p>{{ a }}{{ b }}</p></template>`,
        { "types/ui.ts": 'export type Size = "sm" | "md";\n', "types/other.ts": other },
      );
    expect(compile(using('export type Size = "sm" | "md";\n')).get("x.rs")).toContain("pub b: super::types::Size,");
    const e = failure(() => compile(using('export type Size = "sm" | "lg";\n')));
    expect(e.code).toBe("FV0325");
    expect(e.message).toMatch(/^types\/other\.ts:1:8: this union is the Rust enum `Size`, and types\/ui\.ts declares another union of that name for the same module/);
  });

  it("refuses an enum of a `.ts` file named as one of its interfaces", () => {
    const e = failure(() =>
      compile(
        project(
          `<script setup lang="ts">
import type { Row } from "../types/rows";
defineProps<{ row: Row }>();
</script>
<template><p>{{ row.kind }}</p></template>`,
          { "types/rows.ts": 'export interface RowKind { a: string }\nexport interface Row { kind: "a" | "b"; other: RowKind }\n' },
        ),
      ),
    );
    expect(e.code).toBe("FV0325");
    expect(e.message).toMatch(/^types\/rows\.ts:2:24: this union is the Rust enum `RowKind`, and the module it is written to has another type of that name/);
  });

  it("allows clippy's `enum_variant_names` only where every variant shares a word", () => {
    const out = compile(
      island(`<script setup lang="ts">
defineProps<{ a: "primary-button" | "link-button" | "icon-button"; b: "a-x" | "b-x" }>();
</script>
<template><p>{{ a }}{{ b }}</p></template>`),
    ).get("x.rs")!;
    expect(out).toContain('#[allow(clippy::enum_variant_names, reason = "the variants are named after the union\'s literals")]\npub enum XA {');
    expect(out).toContain("serde::Deserialize)]\npub enum XB {");
  });

  it("writes an enum through `as_str()` and compares it by variant", () => {
    const out = rendered(
      compile(
        island(`<script setup lang="ts">
type K = "a" | "b";
withDefaults(defineProps<{ k: K; m?: K; n?: K; j: K }>(), { n: "b" });
</script>
<template><p :class="k" :title="\`\${k}!\`">{{ k }} {{ m }} {{ n }} {{ k.toUpperCase() }} {{ k.length }}</p><b v-if="k === 'a'">a</b><b v-if="m !== 'b'">b</b><b v-if="k === j">j</b><b v-if="m">{{ m }}</b></template>`),
      ).get("x.rs")!,
    );
    expect(out).toContain("fv::attrs::class_into(out, false, &[fv::props::Union::as_str(props.k)]);");
    expect(out).toContain('out.push_str("\\" title=\\"");\n    fv::core::escape_into(out, fv::props::Union::as_str(props.k));\n    out.push_str("!\\">");');
    expect(out).toContain("if let Some(v) = props.m.map(fv::props::Union::as_str) {");
    expect(out).toContain("fv::core::escape_into(out, fv::props::Union::as_str(props.n.unwrap_or(K::B)));");
    expect(out).toContain("fv::core::escape_into(out, &fv::props::Union::as_str(props.k).to_uppercase());");
    expect(out).toContain("if props.k == K::A {");
    expect(out).toContain("if props.m != Some(K::B) {");
    expect(out).toContain("if props.k == props.j {");
    expect(out).toMatch(/if let Some\((fv_m)\) = props\.m \{\n {8}out\.push_str\("<b>"\);\n {8}fv::core::escape_into\(out, fv::props::Union::as_str\(\1\)\);/);
  });

  it("compiles a `switch` over an enum in a `computed` to variant comparisons", () => {
    const out = rendered(
      compile(
        island(`<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ k: "a" | "b" | "c" }>();
const key = computed(() => props.k);
const label = computed(() => {
  switch (props.k) {
    case "a":
      return "first";
    case "b":
      return "second";
    default:
      return "other";
  }
});
const T = { a: "A", b: "B", c: "C" } as const;
</script>
<template><p>{{ label }} {{ T[key] }}</p></template>`),
      ).get("x.rs")!,
    );
    expect(out).toContain('let s_label = if props.k == XK::A { "first" } else { if props.k == XK::B { "second" } else { "other" } };');
    expect(out).toContain("let s_key = props.k;");
    expect(out).toContain('match s_key { XK::A => "A", XK::B => "B", XK::C => "C" }');
  });

  it("hands a child's prop of a union the enum, a conversion of another enum, of a `computed` annotated as a union or of known strings, or the string", () => {
    const out = rendered(
      compile(
        island(
          `<script setup lang="ts">
import { computed } from "vue";
import Y from "./Y.vue";
type K = "a" | "b" | "c";
const props = defineProps<{ k: K; m?: K; on: boolean }>();
const pick = computed((): K => (props.on ? "b" : "c"));
</script>
<template><Y :k="k" :o="m" :s="k" :q="pick" :r="on ? 'a' : 'b'" lit="c" /></template>`,
          {
            Y: `<script setup lang="ts">
defineProps<{ k: "a" | "b" | "c"; o?: "a" | "b" | "c" | "d"; s: string; q: "a" | "b" | "c"; r: "a" | "b"; lit: "c" | "d" }>();
</script>
<template><i>{{ k }}{{ o }}{{ s }}{{ q }}{{ r }}{{ lit }}</i></template>`,
          },
        ),
      ).get("x.rs")!,
    );
    expect(out).toContain("k: match props.k { K::A => super::y::YK::A, K::B => super::y::YK::B, K::C => super::y::YK::C }");
    expect(out).toContain("o: props.m.map(|v| match v { K::A => super::y::YO::A, K::B => super::y::YO::B, K::C => super::y::YO::C })");
    expect(out).toContain("s: Cow::Borrowed(fv::props::Union::as_str(props.k))");
    expect(out).toContain("q: match s_pick { K::A => super::y::YQ::A, K::B => super::y::YQ::B, K::C => super::y::YQ::C }");
    expect(out).toContain("r: if props.on { super::y::YR::A } else { super::y::YR::B }");
    expect(out).toContain("lit: super::y::YLit::C");
  });

  describe("a string of a wider union, narrowed to a child's prop of a union", () => {
    const TONE = "super::types::Tone";
    const narrowed = (template: string, script = ""): string =>
      rendered(
        compile(
          project(
            `<script setup lang="ts">
import { computed, ref } from "vue";
import Badge from "./Badge.vue";
import type { Tone } from "../types/tone";
const props = defineProps<{ start?: Tone }>();
const tone = ref<Tone | "">(props.start ?? "");
${script}
</script>
<template>${template}</template>`,
            {
              "types/tone.ts": 'export type Tone = "calm" | "loud";\n',
              "components/Badge.vue": `<script setup lang="ts">
import type { Tone } from "../types/tone";
defineProps<{ tone?: Tone }>();
</script>
<template><b>{{ tone ?? "none" }}</b></template>`,
            },
          ),
        ).get("x.rs")!,
      );

    const MATCHED = `tone: match s_tone { XTone::Calm => Some(${TONE}::Calm), XTone::Loud => Some(${TONE}::Loud), XTone::Empty => None }`;

    it("leaves out the falsy member by `||`", () => {
      expect(narrowed(`<Badge :tone="tone || undefined" />`)).toContain(MATCHED);
    });

    it.each([`tone === '' ? undefined : tone`, `'' !== tone ? tone : undefined`, `!(tone === '') ? tone : undefined`, `tone ? tone : undefined`])(
      "leaves out a literal a `?:` tests in the branch where it fails: %s",
      (value) => {
        expect(narrowed(`<Badge :tone="${value}" />`)).toContain(MATCHED);
      },
    );

    it("narrows by `v-if` and `v-else`, to the one member a test leaves", () => {
      const out = narrowed(`<i v-if="tone === ''">none</i><Badge v-else-if="tone === 'calm'" :tone="tone" /><Badge v-else :tone="tone" />`);
      expect(out).toContain("super::badge::try_render(out, &super::badge::Props { tone: Some(super::types::Tone::Calm) })?;");
      expect(out).toContain("super::badge::try_render(out, &super::badge::Props { tone: Some(super::types::Tone::Loud) })?;");
    });

    it("narrows the operands after a test in a `v-if` of `&&`", () => {
      const out = narrowed(`<Badge v-if="on && tone !== ''" :tone="tone" />`, "const on = computed(() => props.start !== undefined);");
      expect(out).toContain(`if s_on && let Some(fv_tone) = match s_tone { XTone::Calm => Some(${TONE}::Calm), XTone::Loud => Some(${TONE}::Loud), XTone::Empty => None } {`);
      expect(out).toContain("tone: Some(fv_tone)");
    });

    it("narrows again in a `v-if` of `&&` a value an outer `v-if` narrowed", () => {
      const out = narrowed(`<template v-if="tone !== ''"><Badge v-if="on && tone !== 'calm'" :tone="tone" /></template>`, "const on = computed(() => props.start !== undefined);");
      expect(out).toContain("if s_on && s_tone != XTone::Calm {\n            super::badge::try_render(out, &super::badge::Props { tone: Some(super::types::Tone::Loud) })?;");
    });

    it("takes a `computed` annotated as the union, whose body narrows the value to it", () => {
      const out = narrowed(`<Badge :tone="shown" />`, `const shown = computed((): Tone | undefined => (tone.value === "" ? undefined : tone.value));`);
      expect(out).toContain(`let s_shown = match s_tone { XTone::Calm => Some(${TONE}::Calm), XTone::Loud => Some(${TONE}::Loud), XTone::Empty => None };`);
      expect(out).toContain("super::badge::Props { tone: s_shown }");
    });

    it("keeps an annotated `computed` the compiler cannot show is the union where the template reads it as a string", () => {
      expect(narrowed(`<p>{{ shown }}</p>`, `const shown = computed((): Tone => tone.value as Tone);`)).toContain("fv::core::escape_into(out, fv::props::Union::as_str(s_shown));");
    });
  });

  describe("a narrowed enum converted to a child's union, one `match` over its variants", () => {
    const T = "super::types::Tone";
    const converted = (template: string, required = false): string => {
      const out = rendered(
        compile(
          project(
            `<script setup lang="ts">
import { computed, ref } from "vue";
import Badge from "./Badge.vue";
import Chip from "./Chip.vue";
import { type Tone, NEXT, PREVIEW } from "../types/tone";
const props = defineProps<{ start?: Tone }>();
const tone = ref<Tone | "">(props.start ?? "");
const on = computed(() => props.start !== undefined);
</script>
<template>${template}</template>`,
            {
              "types/tone.ts": `export type Tone = "calm" | "loud" | "quiet";
export interface Card { tone: Tone; other?: Tone }
export const NEXT: Record<Tone, Tone> = { calm: "loud", loud: "quiet", quiet: "calm" };
export const PREVIEW: Record<Tone | "", Tone> = { "": "quiet", calm: "calm", loud: "loud", quiet: "quiet" };
`,
              "components/Badge.vue": `<script setup lang="ts">
import type { Tone } from "../types/tone";
defineProps<{ tone${required ? "" : "?"}: Tone }>();
</script>
<template><b>{{ tone }}</b></template>`,
              "components/Chip.vue": `<script setup lang="ts">
import type { Card } from "../types/tone";
defineProps<{ card: Card }>();
</script>
<template><b>{{ card.tone }}</b></template>`,
            },
          ),
        ).get("x.rs")!,
      );
      const props = out.slice(out.indexOf("try_render(out, &super::"));
      expect(props).not.toMatch(/_ => super::types::Tone::/);
      expect(props).not.toContain("fv::props::Union::as_str(s_tone)");
      return out;
    };
    const SOME = `match s_tone { XTone::Calm => Some(${T}::Calm), XTone::Loud => Some(${T}::Loud), XTone::Quiet => Some(${T}::Quiet), XTone::Empty => None }`;

    it.each([`tone || undefined`, `tone === '' ? undefined : tone`, `tone !== '' ? tone : undefined`, `tone ? tone : undefined`, `!tone ? undefined : tone`])(
      "gives the member it leaves out `None` in its own arm: %s",
      (value) => {
        expect(converted(`<Badge :tone="${value}" />`)).toContain(`tone: ${SOME} })?;`);
      },
    );

    it.each([
      [`tone || 'calm'`, `match s_tone { XTone::Calm | XTone::Empty => ${T}::Calm, XTone::Loud => ${T}::Loud, XTone::Quiet => ${T}::Quiet }`],
      [`tone === '' ? 'quiet' : tone`, `match s_tone { XTone::Calm => ${T}::Calm, XTone::Loud => ${T}::Loud, XTone::Quiet | XTone::Empty => ${T}::Quiet }`],
      [`tone === 'calm' ? 'loud' : tone || 'calm'`, `match s_tone { XTone::Calm | XTone::Loud => ${T}::Loud, XTone::Quiet => ${T}::Quiet, XTone::Empty => ${T}::Calm }`],
    ])("maps each variant of a required prop to the member the source gives it: %s", (value, code) => {
      expect(converted(`<Badge :tone="${value}" />`, true)).toContain(`tone: ${code} })?;`);
    });

    it("leaves out the members two tests exclude, in one `match`", () => {
      expect(converted(`<Badge :tone="tone === 'calm' ? undefined : tone || undefined" />`)).toContain(
        `tone: match s_tone { XTone::Calm | XTone::Empty => None, XTone::Loud => Some(${T}::Loud), XTone::Quiet => Some(${T}::Quiet) } })?;`,
      );
    });

    it("binds the child's member in the test of a `v-if`, and of its `v-else`", () => {
      const out = converted(`<Badge v-if="tone" :tone="tone" /><i v-if="tone === ''">none</i><Badge v-else :tone="tone" />`, true);
      expect(out).toContain(`if let Some(fv_tone) = ${SOME} {\n        super::badge::try_render(out, &super::badge::Props { tone: fv_tone })?;`);
      expect(out).toContain(`} else if let Some(fv_tone_2) = ${SOME} {\n        super::badge::try_render(out, &super::badge::Props { tone: fv_tone_2 })?;`);
    });

    it("binds in a `v-else-if` through the binding of the `v-else` it is in", () => {
      const out = converted(`<i v-if="tone === ''">none</i><Badge v-else-if="tone === 'calm'" :tone="tone" /><Badge v-else :tone="tone" />`, true);
      expect(out).toContain(`} else if let Some(fv_tone) = match s_tone { XTone::Calm => Some(None), XTone::Loud => Some(Some(${T}::Loud)), XTone::Quiet => Some(Some(${T}::Quiet)), XTone::Empty => None } {`);
      expect(out).toContain(`if s_tone == XTone::Calm {\n            super::badge::try_render(out, &super::badge::Props { tone: ${T}::Calm })?;\n        } else if let Some(fv_tone_2) = fv_tone {`);
    });

    it("binds in a `v-if` of `&&`, through the test before it that narrows the same value", () => {
      const out = converted(`<Badge v-if="on && tone !== '' && tone !== 'calm'" :tone="tone" />`, true);
      expect(out).toContain(`if s_on && let Some(fv_tone) = match s_tone { XTone::Calm => Some(None), XTone::Loud => Some(Some(${T}::Loud)), XTone::Quiet => Some(Some(${T}::Quiet)), XTone::Empty => None } && let Some(fv_tone_2) = fv_tone {`);
      expect(out).toContain("tone: fv_tone_2 })?;");
    });

    it("binds a `?:` and `||` inside a `v-if` that narrows the value", () => {
      const out = converted(`<template v-if="tone !== 'calm'"><Badge :tone="tone || undefined" /><Badge :tone="tone === '' ? undefined : tone" /></template>`);
      expect(out).toContain(`if let Some(fv_tone) = match s_tone { XTone::Calm => None, XTone::Loud => Some(Some(${T}::Loud)), XTone::Quiet => Some(Some(${T}::Quiet)), XTone::Empty => Some(None) } {`);
      expect(out.match(/tone: fv_tone \}\)\?;/g)).toHaveLength(2);
    });

    it("gives an object literal's union field the same `match`", () => {
      const out = converted(`<Chip :card="{ tone: tone || 'calm', other: tone || undefined }" /><Chip v-if="tone" :card="{ tone, other: tone }" />`);
      expect(out).toContain(`card: super::types::Card { tone: match s_tone { XTone::Calm | XTone::Empty => ${T}::Calm, XTone::Loud => ${T}::Loud, XTone::Quiet => ${T}::Quiet }, other: ${SOME} }`);
      expect(out).toContain(`if let Some(fv_tone) = match s_tone { XTone::Calm => Some(${T}::Calm), XTone::Loud => Some(${T}::Loud), XTone::Quiet => Some(${T}::Quiet), XTone::Empty => None } {`);
      expect(out).toContain("card: super::types::Card { tone: fv_tone, other: Some(fv_tone) }");
    });

    it("binds a table read by the narrowed key in the test of the `v-if`", () => {
      const out = converted(`<Badge v-if="tone" :tone="NEXT[tone]" /><Badge :tone="PREVIEW[tone]" />`, true);
      expect(out).toContain(`if let Some(fv_tone) = match s_tone { XTone::Calm => Some(${T}::Loud), XTone::Loud => Some(${T}::Quiet), XTone::Quiet => Some(${T}::Calm), XTone::Empty => None } {`);
      expect(out).toContain(`tone: match s_tone { XTone::Calm => ${T}::Calm, XTone::Loud => ${T}::Loud, XTone::Quiet | XTone::Empty => ${T}::Quiet } })?;`);
    });

    it("keeps the test of a `v-if` whose branch converts nothing", () => {
      const out = converted(`<p v-if="tone !== ''">{{ tone }}</p><Badge v-if="tone === 'loud'" :tone="tone" />`, true);
      expect(out).toContain("if s_tone != XTone::Empty {");
      expect(out).toContain(`if s_tone == XTone::Loud {\n        super::badge::try_render(out, &super::badge::Props { tone: ${T}::Loud })?;`);
    });
  });

  describe("a `ref` of a union whose starting value folds to a constant, handed to a child's union", () => {
    const T = "super::types::Tone";
    const folded = (start: string, template: string): string =>
      rendered(
        compile(
          project(
            `<script setup lang="ts">
import { ref } from "vue";
import Badge from "./Badge.vue";
import Chip from "./Chip.vue";
import Pick from "./Pick.vue";
import type { Tone } from "../types/tone";
const K = "y";
const tone = ref<Tone | "">(${start});
</script>
<template>${template}</template>`,
            {
              "types/tone.ts": `export type Tone = "calm" | "loud" | "quiet";
export interface Card { tone: Tone; other?: Tone }
`,
              "components/Badge.vue": `<script setup lang="ts">
import type { Tone } from "../types/tone";
defineProps<{ tone: Tone; other?: Tone }>();
</script>
<template><b>{{ tone }}{{ other }}</b></template>`,
              "components/Chip.vue": `<script setup lang="ts">
import type { Card } from "../types/tone";
defineProps<{ card: Card }>();
</script>
<template><b>{{ card.tone }}</b></template>`,
              "components/Pick.vue": `<script setup lang="ts">
import type { Tone } from "../types/tone";
defineProps<{ pick: Tone | "" }>();
</script>
<template><b>{{ pick }}</b></template>`,
            },
          ),
        ).get("x.rs")!,
      );

    it("gives a member the constant folds to as its variant", () => {
      const out = folded(`K === "x" ? "calm" : "loud"`, `<Badge :tone="tone || 'calm'" :other="tone || undefined" />`);
      expect(oneLine(out)).toContain(`tone: ${T}::Loud, other: Some(${T}::Loud)`);
    });

    it("gives the empty string the constant folds to `Empty`, and leaves it out by `||`", () => {
      const out = folded(`K === "x" ? "loud" : ""`, `<Pick :pick="tone" /><Badge :tone="tone || 'calm'" :other="tone || undefined" />`);
      expect(out).toContain("pick: super::pick::PickPick::Empty");
      expect(oneLine(out)).toContain(`tone: ${T}::Calm, other: None`);
    });

    it("works out a comparison of the folded value with a literal", () => {
      const out = folded(`K === "x" ? "loud" : ""`, `<Badge :tone="tone === '' ? 'quiet' : tone" /><p>{{ tone !== '' }}</p>`);
      expect(out).toContain(`tone: ${T}::Quiet`);
      expect(out).not.toMatch(/XTone::\w+ [!=]= XTone::/);
    });

    it("gives an object literal's union field the member the constant folds to", () => {
      expect(folded(`K === "x" ? "calm" : "quiet"`, `<Chip :card="{ tone: tone || 'loud' }" />`)).toContain(`tone: ${T}::Quiet, other: None`);
    });
  });

  describe("lookup tables and refs of a union", () => {
    const TYPES = `export type Tone = "calm" | "loud" | "quiet";
export type Choice = Tone | "";
export const NEXT: Record<Tone, Tone> = { calm: "loud", loud: "quiet", quiet: "calm" };
export const PREVIEW: Record<Choice, Tone> = { "": "quiet", calm: "calm", loud: "loud", quiet: "quiet" };
export const LABEL: Record<Choice, string> = { "": "none", calm: "Calm", loud: "Loud", quiet: "Quiet" };
export const PLAIN = { calm: "quiet", loud: "calm", quiet: "loud" } as const;
export const SOME: Partial<Record<Tone, Tone>> = { calm: "loud" };
`;
    const BADGE = `<script setup lang="ts">
import type { Tone } from "../types/tone";
defineProps<{ tone?: Tone }>();
</script>
<template><b>{{ tone }}</b></template>`;
    const using = (setup: string, template: string): string =>
      rendered(
        compile(
          project(
            `<script setup lang="ts">
import { ref } from "vue";
import Badge from "./Badge.vue";
import { NEXT, PREVIEW, LABEL, PLAIN, SOME, type Tone, type Choice } from "../types/tone";
${setup}
</script>
<template>${template}</template>`,
            { "components/Badge.vue": BADGE, "types/tone.ts": TYPES },
          ),
        ).get("x.rs")!,
      );
    const T = "super::types::Tone";
    const C = "super::types::Choice";

    it("hands a typed table's value to a union prop as a match from variant to variant", () => {
      const out = using(
        "const props = defineProps<{ tone: Tone }>();",
        `<Badge :tone="NEXT[tone]" /><Badge :tone="PLAIN[tone]" /><Badge :tone="SOME[tone]" /><i>{{ LABEL[NEXT[tone]] }}</i><b v-if="NEXT[tone] === 'loud'">l</b>`,
      );
      expect(out).toContain(`tone: Some(match props.tone { ${T}::Calm => ${T}::Loud, ${T}::Loud => ${T}::Quiet, ${T}::Quiet => ${T}::Calm })`);
      expect(out).toContain(`tone: Some(match props.tone { ${T}::Calm => ${T}::Quiet, ${T}::Loud => ${T}::Calm, ${T}::Quiet => ${T}::Loud })`);
      expect(out).toContain(`tone: match props.tone { ${T}::Calm => Some(${T}::Loud), ${T}::Loud | ${T}::Quiet => None }`);
      expect(out).toContain(`match match props.tone { ${T}::Calm => ${T}::Loud, ${T}::Loud => ${T}::Quiet, ${T}::Quiet => ${T}::Calm } { ${T}::Calm => "Calm", ${T}::Loud => "Loud", ${T}::Quiet => "Quiet" }`);
      expect(out).toContain(`if (match props.tone { ${T}::Calm => ${T}::Loud, ${T}::Loud => ${T}::Quiet, ${T}::Quiet => ${T}::Calm }) == ${T}::Loud {`);
      expect(out).not.toContain("_ =>");
    });

    it("holds a ref of a union the props never use as its enum, seeded exhaustively", () => {
      const out = using(
        `const props = defineProps<{ pick?: Tone; on: boolean }>();
const choice = ref<Choice>(props.pick ?? "");
const other = ref<Choice>(props.on ? "calm" : "");
const none = ref<Choice>("");`,
        `<Badge :tone="PREVIEW[choice]" /><i>{{ LABEL[choice] }}{{ LABEL[other] }}{{ LABEL[none] }}</i><select v-model="choice"><option value="">none</option><option value="calm">calm</option></select>`,
      );
      expect(out).toContain(`let s_choice = props.pick.map(|v| match v { ${T}::Calm => ${C}::Calm, ${T}::Loud => ${C}::Loud, ${T}::Quiet => ${C}::Quiet }).unwrap_or(${C}::Empty);`);
      expect(out).toContain(`let s_other = if props.on { ${C}::Calm } else { ${C}::Empty };`);
      expect(out).toContain(`tone: Some(match s_choice { ${C}::Calm => ${T}::Calm, ${C}::Loud => ${T}::Loud, ${C}::Quiet | ${C}::Empty => ${T}::Quiet })`);
      expect(out).toContain(`match s_choice { ${C}::Calm => "Calm", ${C}::Loud => "Loud", ${C}::Quiet => "Quiet", ${C}::Empty => "none" }`);
      expect(out).toContain('out.push_str("none</i><select>');
      expect(out).toContain("if fv::props::Union::as_str(s_choice).is_empty() {");
      expect(out).not.toContain("_ =>");
    });

    it("writes the enum of a union only a ref uses", () => {
      const out = compile(
        project(
          `<script setup lang="ts">
import { ref } from "vue";
import type { Choice, Tone } from "../types/tone";
const props = defineProps<{ on: boolean; tone: Tone }>();
const mode = ref<"a" | "b">(props.on ? "a" : "b");
const choice = ref<Choice>(props.tone);
</script>
<template><i>{{ mode }}{{ choice }}</i></template>`,
          { "types/tone.ts": TYPES },
        ),
      );
      expect(out.get("types.rs")).toContain('pub enum Choice {\n    #[serde(rename = "calm")]\n    Calm,');
      expect(out.get("types.rs")).toContain('    #[serde(rename = "")]\n    Empty,\n}');
      expect(out.get("x.rs")).toContain("pub enum XMode {");
    });

    it("keeps a ref of a union whose literals name no variant a string", () => {
      const out = rendered(
        compile(
          island(`<script setup lang="ts">
import { ref } from "vue";
const props = defineProps<{ on: boolean }>();
const sign = ref<"+" | "-">(props.on ? "+" : "-");
</script>
<template><i>{{ sign }}</i></template>`),
        ).get("x.rs")!,
      );
      expect(out).toContain('let s_sign = if props.on { "+" } else { "-" };');
    });

    it("keeps a ref of a union started with any string a string, and refuses it where a union prop takes it", () => {
      const setup = `const props = defineProps<{ text: string }>();\nconst tone = ref<Tone>(props.text as Tone);`;
      expect(using(setup, "<p>{{ tone }}</p>")).toContain("let s_tone = &*props.text;");
      expect(() => using(setup, `<Badge :tone="tone" />`)).toThrow(expect.objectContaining({ code: "FV0111", at: expect.objectContaining({ line: 6, column: 24 }) }));
    });

    describe("a value of a union returned under a wider annotation", () => {
      const returned = (setup: string, template: string, files: Record<string, string> = {}): string =>
        rendered(
          compile(
            project(
              `<script setup lang="ts">
import { computed, ref } from "vue";
${setup}
</script>
<template>${template}</template>`,
              files,
            ),
          ).get("x.rs")!,
        );
      const PROPS = `const props = defineProps<{ size: "big" | "small"; spare?: "big" | "small" }>();`;

      it.each([
        ["a function", `function label(n: number): string {\n  return props.size;\n}`, "label(1)"],
        ["an arrow function", `const label = (): string => props.size;`, "label()"],
        ["a function annotated as a wider union", `const label = (): "big" | "small" | "-" => props.size;`, "label()"],
      ])("holds %s's value as a string of its return type, compared with a literal outside the union", (_, fn, call) => {
        const out = returned(`${PROPS}\n${fn}`, `<p :class="{ dash: ${call} === '-' }">{{ ${call} }}</p>`);
        expect(out).toContain('if fv::props::Union::as_str(props.size) == "-" { "dash" } else { "" }');
        expect(out).toContain("fv::core::escape_into(out, fv::props::Union::as_str(props.size));");
      });

      it("holds a `computed`'s value as a string of its return type, optional too", () => {
        const out = returned(
          `${PROPS}\nconst shown = computed((): string => props.size);\nconst maybe = computed((): string | undefined => props.spare);\nconst held = ref<string>(props.size);`,
          `<p :class="{ a: shown === '-', b: maybe === '-', c: held === '-' }">{{ shown }}</p>`,
        );
        expect(out).toContain("let s_shown = fv::props::Union::as_str(props.size);");
        expect(out).toContain("let s_maybe = props.spare.map(fv::props::Union::as_str);");
        expect(oneLine(out)).toContain('if s_shown == "-" { "a" } else { "" }, if s_maybe == Some("-") { "b" } else { "" }, if s_held == "-" { "c" } else { "" }');
      });

      it("holds the value of a function of a `.ts` file as a string of its return type", () => {
        const out = returned(
          `import { describe } from "../types/size";\n${PROPS}`,
          `<p :class="{ dash: describe(size) === '-' }"></p>`,
          { "types/size.ts": `export type Size = "big" | "small";\nexport function describe(size: Size): string {\n  return size;\n}\n` },
        );
        expect(out).toContain('if fv::props::Union::as_str(props.size) == "-" { "dash" } else { "" }');
      });
    });

    describe("a ref annotated as a union wider than the enum it starts from", () => {
      const wider = (members: string, setup: string, template: string): string =>
        rendered(
          compile(
            project(
              `<script setup lang="ts">
import { ref } from "vue";
import Badge from "./Badge.vue";
import { Level } from "../types/level";
${setup}
</script>
<template>${template}</template>`,
              {
                "types/level.ts": `export enum Level { ${members} }\n`,
                "components/Badge.vue": `<script setup lang="ts">
import { Level } from "../types/level";
defineProps<{ level?: Level }>();
</script>
<template><b>{{ level }}</b></template>`,
              },
            ),
          ).get("x.rs")!,
        );
      const L = "super::types::Level";

      it("names the variants of the wider union by the `enum`'s members where its literals name none, and compares it with the literal it adds", () => {
        const out = wider(
          `High = "&amp; &lt;", Low = "'!", Mid = "0x1F"`,
          `const props = defineProps<{ level: Level }>();\nconst picked = ref<Level | "">(props.level);`,
          `<li :class="{ none: picked === '' }">{{ picked }}</li><Badge v-if="picked !== ''" :level="picked" />`,
        );
        expect(out).toContain(`let s_picked = match props.level { ${L}::High => XPicked::High, ${L}::Low => XPicked::Low, ${L}::Mid => XPicked::Mid };`);
        expect(out).toContain('fv::attrs::class_into(out, false, &[if s_picked == XPicked::Empty { "none" } else { "" }]);');
        expect(out).toContain(`if let Some(fv_picked) = match s_picked { XPicked::High => Some(${L}::High), XPicked::Low => Some(${L}::Low), XPicked::Mid => Some(${L}::Mid), XPicked::Empty => None } {`);
        expect(out).not.toContain("_ =>");
      });

      it("holds an `Option` of the wider union's enum started from an optional value of the enum", () => {
        const out = wider(
          `High = "&amp; &lt;", Low = "'!", Mid = "0x1F"`,
          `const props = defineProps<{ level?: Level }>();\nconst picked = ref<Level | "" | undefined>(props.level);`,
          `<li :class="{ none: picked === '' }">{{ picked }}</li>`,
        );
        expect(out).toContain(`let s_picked = props.level.map(|v| match v { ${L}::High => XPicked::High, ${L}::Low => XPicked::Low, ${L}::Mid => XPicked::Mid });`);
        expect(out).toContain('if s_picked == Some(XPicked::Empty) { "none" } else { "" }');
      });

      it("holds a string of the wider union where a literal it adds names no variant, and parses it into the child's enum", () => {
        const out = wider(
          `High = "&amp; &lt;", Low = "'!"`,
          `const props = defineProps<{ level: Level }>();\nconst picked = ref<Level | "!">(props.level);`,
          `<Badge v-if="picked !== '!'" :level="picked" />`,
        );
        expect(out).toContain("let s_picked = fv::props::Union::as_str(props.level);");
        expect(out).toContain(`level: Some(match s_picked.parse::<${L}>() { Ok(fv_u) => fv_u, Err(fv_e) => {`);
        expect(out).not.toContain("_ =>");
      });

      it("holds the wider union's enum, seeded from a present value where the annotation is optional", () => {
        const out = wider(
          `High = "high", Low = "low"`,
          `const props = defineProps<{ level: Level }>();\nconst picked = ref<Level | "" | undefined>(props.level);`,
          `<li :class="{ none: picked === '' }">{{ picked }}</li><Badge v-if="picked !== ''" :level="picked" />`,
        );
        expect(out).toContain(`let s_picked = match props.level { ${L}::High => XPicked::High, ${L}::Low => XPicked::Low };`);
        expect(out).toContain('if s_picked == XPicked::Empty { "none" } else { "" }');
        expect(out).toContain(`if let Some(fv_picked) = match s_picked { XPicked::High => Some(${L}::High), XPicked::Low => Some(${L}::Low), XPicked::Empty => None } {`);
        expect(out).toContain("level: Some(fv_picked)");
      });
    });
  });

  describe("tables whose type gives a union for their values", () => {
    const TONE = 'export type Tone = "calm" | "loud" | "quiet";\n';
    const BADGE = `<script setup lang="ts">
import type { Tone } from "../types/tone";
defineProps<{ tone?: Tone }>();
</script>
<template><b>{{ tone }}</b></template>`;
    const reading = (tables: string, template = `<b v-if="T[tone] === 'loud'">l</b>`, setup = ""): string =>
      rendered(
        compile(
          project(
            `<script setup lang="ts">
import Badge from "./Badge.vue";
import { T, type Tone } from "../types/tone";
defineProps<{ tone: Tone }>();
${setup}
</script>
<template>${template}</template>`,
            { "components/Badge.vue": BADGE, "types/tone.ts": TONE + tables },
          ),
        ).get("x.rs")!,
      );
    const ENUM = /== (?:Some\()?super::types::Tone::Loud\)? \{/;
    const STRING = /== (?:Some\()?"loud"\)? \{/;

    it.each([
      ["`Readonly`", 'export const T: Readonly<Record<Tone, Tone>> = { calm: "loud", loud: "nope", quiet: "calm" };'],
      ["`Partial`", 'export const T: Partial<Record<Tone, Tone>> = { calm: "loud", loud: "nope", quiet: "calm" };'],
      ["`Required`", 'export const T: Required<Record<Tone, Tone>> = { calm: "loud", loud: "nope", quiet: "calm" };'],
      ["a mapped type", 'export const T: { [K in Tone]: Tone } = { calm: "loud", loud: "nope", quiet: "calm" };'],
      ["`as`", 'export const T = { calm: "loud", loud: "nope", quiet: "calm" } as Record<Tone, Tone>;'],
      ["`satisfies`", 'export const T = { calm: "loud", loud: "nope", quiet: "calm" } satisfies Record<Tone, Tone>;'],
      ["a `type` alias", 'type Table = Partial<Record<Tone, Tone>>;\nexport const T: Table = { calm: "loud", loud: "nope", quiet: "calm" };'],
    ])("refuses a value outside the union a type through %s gives, at the value", (_, table) => {
      const e = failure(() => reading(table));
      expect(e.code).toBe("FV0228");
      const last = table.split("\n").at(-1)!;
      expect(e.at).toMatchObject({ file: "types/tone.ts", line: 1 + table.split("\n").length, column: last.indexOf('"nope"') + 1 });
    });

    it.each([
      ["`Record`", "const OWN: Record<Tone, Tone> = { calm: \"loud\", loud: \"nope\", quiet: \"calm\" };"],
      ["a `type` alias of its own", "type Own = Record<Tone, Tone>;\nconst OWN: Own = { calm: \"loud\", loud: \"nope\", quiet: \"calm\" };"],
    ])("refuses a value outside an imported union a component's own table typed through %s gives, at the value", (_, setup) => {
      const e = failure(() => reading('export const T = { calm: "loud" };', "<Badge :tone=\"OWN[tone]\" />", setup));
      expect(e.code).toBe("FV0228");
      const last = setup.split("\n").at(-1)!;
      expect(e.at).toMatchObject({ file: "components/X.vue", line: 4 + setup.split("\n").length, column: last.indexOf('"nope"') + 1 });
    });

    it("refuses a value outside the union under a computed key, at the table", () => {
      const e = failure(() => reading('export const T: Record<Tone, Tone> = { calm: "loud", ["loud"]: "nope", quiet: "calm" };'));
      expect(e.code).toBe("FV0228");
      expect(e.at).toMatchObject({ file: "types/tone.ts", line: 2, column: 14 });
    });

    it("refuses a value outside the union of a table given by another constant, at the table", () => {
      const e = failure(() => reading('const BASE = { calm: "loud", loud: "nope", quiet: "calm" };\nexport const T: Record<Tone, Tone> = BASE;'));
      expect(e.code).toBe("FV0228");
      expect(e.at).toMatchObject({ file: "types/tone.ts", line: 3, column: 14 });
    });

    it("reads a table through its value's enum, where a key it lacks gives `undefined`", () => {
      expect(reading('export const T: Partial<Record<Tone, Tone>> = { calm: "loud" };')).toMatch(ENUM);
    });

    it("takes no union for the values from a generic alias or an alias of itself", () => {
      expect(reading('type Table<V> = Record<Tone, Tone>;\nexport const T: Table<1> = { calm: "loud", loud: "nope", quiet: "calm" };')).toMatch(STRING);
      expect(reading('type Table = Table;\nexport const T: Table = { calm: "loud", loud: "nope", quiet: "calm" };')).toMatch(STRING);
    });

    it("reads a table holding a value that is no string of the union by the strings it holds", () => {
      expect(reading('export const T: Record<Tone, Tone> = { calm: null as unknown as Tone, loud: "loud", quiet: "calm" };')).toMatch(STRING);
      expect(reading('export const T: Record<Tone, Tone> = { calm: 1 as unknown as Tone, loud: "loud", quiet: "calm" };', "<p>{{ T.calm }}</p>")).toContain('out.push_str("<p>1</p>");');
    });

    it("reads a table whose values another table typed with another union shares by the strings it holds", () => {
      const tables = 'export type Mood = "calm" | "loud";\nexport const T: Record<Tone, Tone> = { calm: "calm", loud: "loud", quiet: "quiet" };\nexport const M: Record<Tone, Mood> = { calm: T.calm, loud: "loud", quiet: "calm" };\n';
      expect(reading(tables, `<b v-if="T[tone] === 'loud'">l</b><i>{{ M.calm }}</i>`, 'import { M } from "../types/tone";')).toMatch(STRING);
    });

    it("reads a type of the project's own named like a utility type as that type", () => {
      expect(reading('type Partial<A, B> = B;\nexport const T: Partial<Record<Tone, Tone>, Record<string, string>> = { calm: "loud", loud: "nope", quiet: "calm" };', "<p>{{ T.loud }}</p>")).toContain(
        'out.push_str("<p>nope</p>");',
      );
      expect(reading('type Record<V> = { [key: string]: V };\nexport const T: Record<Tone> = { calm: "loud", loud: "loud", quiet: "calm" } as { [K in Tone]: Tone };')).toMatch(ENUM);
      expect(reading('type Table<K extends string, V> = { [key in K]: V };\nexport const T: Table<Tone, Tone> = { calm: "loud", loud: "loud", quiet: "calm" };')).toMatch(STRING);
      expect(reading('type Frozen<V> = Readonly<V>;\nexport const T: Frozen<Record<Tone, Tone>> = { calm: "loud", loud: "loud", quiet: "calm" };')).toMatch(STRING);
    });

    it("keeps a list cast to a table's type a list", () => {
      const tables = 'export const T = { calm: "loud" };\nexport const L = ["calm"] as unknown as Record<Tone, Tone>;\n';
      expect(reading(tables, "<p>{{ L[0] }}</p>", 'import { L } from "../types/tone";')).toContain('if let Some(v) = ["calm"].first().map(|v| &**v) {');
    });

    it("hands a table of tables read by two keys to a child's union prop through a `match` over its key", () => {
      const tables = 'export const T = { calm: "loud" };\nexport const NEST = { calm: { calm: "loud", loud: "calm", quiet: "quiet" }, loud: { calm: "calm", loud: "calm", quiet: "calm" }, quiet: { calm: "quiet", loud: "loud", quiet: "loud" } };\n';
      const out = reading(tables, '<Badge :tone="NEST[tone][tone]" />', 'import { NEST } from "../types/tone";');
      expect(out).toContain("tone: Some(match props.tone { super::types::Tone::Calm => match props.tone { super::types::Tone::Calm => super::types::Tone::Loud, super::types::Tone::Loud => super::types::Tone::Calm, super::types::Tone::Quiet => super::types::Tone::Quiet },");
      expect(out).not.toContain("_ =>");
    });

    it("refuses a table's literal outside a child's union prop", () => {
      const e = failure(() => reading('export const T = { calm: "loud", loud: "nope", quiet: "calm" };', '<Badge :tone="T[tone]" />'));
      expect(e.code).toBe("FV0515");
    });
  });

  it("writes a constant list's field of a union as its variant, and refuses a value outside it", () => {
    const using = (value: string): string =>
      project(
        `<script setup lang="ts">
import { SORTS } from "../types/sorts";
</script>
<template><p v-for="s in SORTS">{{ s.dir }}</p></template>`,
        { "types/sorts.ts": `export interface Sort { dir: "asc" | "desc" }\nexport const SORTS: Sort[] = [{ dir: "asc" }, { dir: ${JSON.stringify(value)} }];\n` },
      );
    expect(compile(using("desc")).get("types.rs")).toContain("pub const SORTS: &[Sort] = &[\n    Sort { dir: SortDir::Asc },\n    Sort { dir: SortDir::Desc },\n];");
    const e = failure(() => compile(using("up")));
    expect(e.code).toBe("FV0215");
    expect(e.message).toMatch(/`dir` in a constant list's object is one of "asc" \| "desc", and "up" is not/);
  });

  it("keeps a store's own interfaces' unions as strings", () => {
    const root = island(`<script setup lang="ts">
import { usePrefs } from "../stores/prefs";
const prefs = usePrefs();
</script>
<template><p>{{ prefs.density }}</p></template>`);
    mkdirSync(join(root, "stores"), { recursive: true });
    writeFileSync(join(root, "stores", "prefs.ts"), 'import { defineStore } from "pinia";\nexport interface PrefsState { density: "compact" | "classic" }\nexport const usePrefs = defineStore("prefs", { state: (): PrefsState => ({ density: "classic" }) });\n');
    const out = generate(root, { ...CONFIG, stores: "stores" });
    expect(out.get("stores.rs")).toContain("pub density: Cow<'a, str>,");
  });

  it("builds an object literal's union field as the enum's variant from a literal, a folded constant, the same enum and a narrower union", () => {
    const out = compile(
      project(
        `<script setup lang="ts">
import { computed } from "vue";
import Chip from "./Chip.vue";
import { type Card, type Size, MID } from "../types/ui";
const props = defineProps<{ name: string; size: Size; small: "sm" | "md"; big: boolean; other?: Size }>();
const card = computed<Card>(() => ({ size: props.big ? "lg" : "sm", label: props.name, other: props.other }));
</script>
<template><Chip :card="{ size: 'md', label: name }" /><Chip :card="{ size: MID, label: name }" /><Chip :card="{ size, label: name }" /><Chip :card="{ size: small, label: name }" /><Chip :card="card" /></template>`,
        {
          "types/ui.ts": 'export type Size = "sm" | "md" | "lg";\nexport interface Card { size: Size; label: string; other?: Size }\nconst M = "m";\nexport const MID = `${M}d` as const;\n',
          "components/Chip.vue": '<script setup lang="ts">\nimport type { Card } from "../types/ui";\ndefineProps<{ card: Card }>();\n</script>\n<template><b :class="card.size">{{ card.label }}</b></template>',
        },
      ),
    ).get("x.rs")!;
    const body = rendered(out);
    expect(body.match(/card: super::types::Card \{ size: super::types::Size::Md, /g)).toHaveLength(2);
    expect(body).toContain("card: super::types::Card { size: props.size, ");
    expect(body).toContain("size: match props.small { XSmall::Sm => super::types::Size::Sm, XSmall::Md => super::types::Size::Md }");
    expect(body).toContain("size: if props.big { super::types::Size::Lg } else { super::types::Size::Sm }");
    expect(body).toContain("other: props.other }");
  });

  it("tests a key of a union against a constant's own keys and a constant Map's keys by its variants", () => {
    const out = compile(
      island(`<script setup lang="ts">
const ROLE: Record<string, string> = { sm: "small", lg: "large", toString: "x" };
const PX = new Map([["sm", 12], ["md", 16]]);
const props = defineProps<{ k: "sm" | "md" | "lg" }>();
</script>
<template><p :title="Object.hasOwn(ROLE, k) ? ROLE[k] : 'none'">{{ PX.get(k) ?? 0 }}|{{ PX.has(k) }}|{{ Object.hasOwn(ROLE, k) }}</p></template>`),
    ).get("x.rs")!;
    const body = rendered(out);
    expect(body).toContain("matches!(props.k, XK::Sm | XK::Lg)");
    expect(body).toContain("match props.k { XK::Sm => Some(12i64), XK::Md => Some(16i64), XK::Lg => None }");
    expect(body).toContain("matches!(props.k, XK::Sm | XK::Md)");
    expect(body).not.toContain('"toString"');
  });
});

describe("unions `unions` names an enum of the application's for", () => {
  const MAPPED = { ...CONFIG, unions: { Tone: "app_domain::Tone" } };
  const project = (source: string, others: Record<string, string> = {}): string => {
    const root = island(source, others);
    mkdirSync(join(root, "types"), { recursive: true });
    writeFileSync(join(root, "types/tone.ts"), 'export type Tone = "warm" | "x-cool";\n');
    return root;
  };
  const child = `<script setup lang="ts">
import type { Tone } from "../types/tone";
defineProps<{ tone: Tone; tones?: Tone[] }>();
</script>
<template><span :class="tone">{{ tone }}</span></template>`;
  const parent = `<script setup lang="ts">
import type { Tone } from "../types/tone";
import Y from "./Y.vue";
defineProps<{ tone: Tone; other?: Tone; picked: Tone | null }>();
</script>
<template>
  <p :data-tone="tone">{{ tone }} {{ other ?? "none" }} {{ picked }}</p>
  <b v-if="tone === 'warm'">warm</b>
  <Y :tone="tone" />
  <Y :tone="other ?? 'x-cool'" />
  <Y tone="warm" />
</template>`;

  it("uses the enum the path names, generates no enum for the union, and checks its variants and literals", () => {
    const out = generate(project(parent, { Y: child }), MAPPED);
    const types = out.get("types.rs")!;
    expect(types).not.toContain("pub enum Tone");
    expect(types).toContain(
      "const _: fn(app_domain::Tone) = |v| match v {\n    app_domain::Tone::Warm => {}\n    app_domain::Tone::XCool => {}\n};",
    );
    expect(types).toContain(
      '#[cfg(test)]\n#[test]\nfn tone_gives_each_member_its_literal() {\n    ferrovue::props::check_union::<app_domain::Tone>("app_domain::Tone", &[(app_domain::Tone::Warm, "warm"), (app_domain::Tone::XCool, "x-cool")]);\n}',
    );
    const x = out.get("x.rs")!;
    expect(x).not.toContain("pub enum");
    expect(x).toContain('    #[serde(with = "fv::props::union_prop")]\n    pub tone: app_domain::Tone,');
    expect(x).toContain('    #[serde(default, skip_serializing_if = "Option::is_none", with = "fv::props::union_prop")]\n    pub other: Option<app_domain::Tone>,');
    expect(x).toContain('    #[serde(default, with = "fv::props::union_prop")]\n    pub picked: Option<app_domain::Tone>,');
    expect(x).toContain("pub fn new(tone: app_domain::Tone) -> Self {");
    expect(x).toContain("fv::core::escape_into(out, fv::props::Union::as_str(props.tone));");
    expect(x).toContain('fv::core::escape_into(out, props.other.map(fv::props::Union::as_str).unwrap_or("none"));');
    expect(x).toContain("if props.tone == app_domain::Tone::Warm {");
  });

  it("holds a list of the union as a Vec of the application's enum, written as its literals", () => {
    const y = generate(project(parent, { Y: child }), MAPPED).get("y.rs")!;
    expect(y).toContain('    #[serde(default, skip_serializing_if = "Option::is_none", with = "fv::props::union_prop")]\n    pub tones: Option<Vec<app_domain::Tone>>,');
    expect(y).toContain("pub fn tones(mut self, tones: impl IntoIterator<Item = app_domain::Tone>) -> Self {");
    const x = generate(
      project(`<script setup lang="ts">
import type { Tone } from "../types/tone";
const props = defineProps<{ tones: Tone[]; label: string }>();
</script>
<template><p v-for="t in tones" :key="t" :class="t">{{ t === "warm" ? "w" : t }}</p><b>{{ tones.join() }}</b></template>`),
      MAPPED,
    ).get("x.rs")!;
    expect(x).toContain('    #[serde(with = "fv::props::union_prop")]\n    pub tones: Vec<app_domain::Tone>,');
    expect(x).toContain("fv::props::Union::as_str(");
    expect(x).toContain("== app_domain::Tone::Warm");
  });

  it("hands a child's prop of the union the application's enum", () => {
    const x = generate(project(parent, { Y: child }), MAPPED).get("x.rs")!;
    expect(x).toContain("&super::y::Props { tone: props.tone, tones: None }");
    expect(oneLine(x)).toContain("&super::y::Props { tone: props.other.unwrap_or(app_domain::Tone::XCool), tones: None }");
    expect(x).toContain("&super::y::Props { tone: app_domain::Tone::Warm, tones: None }");
  });

  it("generates the enum of a union of another name, and of the same union with no entry", () => {
    const out = generate(project(parent, { Y: child }), CONFIG);
    expect(out.get("types.rs")).toContain("pub enum Tone {");
    expect(out.get("types.rs")).toContain("impl ferrovue::props::Union for Tone {\n    const ALL: &'static [Self] = &Tone::ALL;");
    expect(out.get("x.rs")).toContain("pub tone: super::types::Tone,");
  });

  it("maps a union a component declares, and leaves a union written in place a generated enum", () => {
    const local = island(`<script setup lang="ts">
type Tone = "warm" | "x-cool";
defineProps<{ tone: Tone; size: "sm" | "md" }>();
</script>
<template><p :class="[tone, size]" /></template>`);
    const x = generate(local, { ...CONFIG, unions: { Tone: "crate::Tone" } }).get("x.rs")!;
    expect(x).toContain("pub tone: crate::Tone,");
    expect(x).toContain("const _: fn(crate::Tone) = |v| match v {");
    expect(x).toContain("pub enum XSize {");
    expect(x).toContain("pub size: XSize,");
    expect(() => generate(local, { ...CONFIG, unions: { XSize: "crate::Size" } })).toThrow(/`unions\.XSize` in ferrovue\.config\.json names `crate::Size` for `XSize`, and no prop or field/);
  });

  it("refuses an entry no prop or field is typed with", () => {
    let e: unknown;
    try {
      generate(project(parent, { Y: child }), { ...MAPPED, unions: { ...MAPPED.unions, Tones: "app_domain::Tones" } });
    } catch (caught) {
      e = caught;
    }
    expect(e).toBeInstanceOf(GenError);
    const err = e as GenError;
    expect(err.code).toBe("FV1120");
    expect(err.message).toBe(
      "`unions.Tones` in ferrovue.config.json names `app_domain::Tones` for `Tones`, and no prop or field of the components is typed with a union of that name: remove the entry, or name the alias as a `.ts` file or a component declares it",
    );
    expect(err.at).toEqual({ file: "ferrovue.config.json" });
  });
});
