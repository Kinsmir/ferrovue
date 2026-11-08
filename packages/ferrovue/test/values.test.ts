import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GenError, GenErrors } from "../src/errors.ts";
import { generate } from "../src/compiler.ts";
import { like, oneLine } from "./code.ts";
import { CONFIG, compile, island } from "./project.ts";

describe("the generator", () => {
  describe("narrowing", () => {
    it("binds an optional object a v-if found present, and reads it inside the branch", () => {
      const out = compile(
        island(`<script setup lang="ts">
interface Embed { provider: string }
const props = defineProps<{ embed?: Embed }>();
</script>
<template><p v-if="embed">{{ embed.provider }}</p></template>`),
      ).get("x.rs")!;
      expect(out).toMatch(/if let Some\((fv_embed)\) = props\.embed\.as_ref\(\) \{[\s\S]*fv::core::escape_into\(out, &\1\.provider\)/);
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
      expect(out).toContain("if !props.items.is_empty() {");
      expect(out).toContain('out.push_str("<ul title=\\"list of ");\n        fv::core::escape_into(out, &props.name);\n        out.push_str("\\"><!--[-->");');
    });

    it("adds two numbers, and refuses + between a number and anything but a string", () => {
      const sum = compile(
      island(`<script setup lang="ts">
const props = defineProps<{ n: number; m: number }>();
</script>
<template><b :title="n + m"></b></template>`),
    ).get("x.rs")!;
    expect(sum).toContain("fv::core::push_number(out, props.n as f64 + props.m as f64);");
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
      expect(out).toContain("if props.items.is_empty() {");
      expect(out).toContain("if props.items.is_empty() || props.note.as_deref().is_some_and(|v| !v.is_empty()) {");
      expect(out).not.toMatch(/!props\.items/);
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
      expect(out).toContain("fv::strings::js_length(&props.name)");
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
      expect(out).toContain('out.push_str(if !props.on { "<p style=\\"display:none;color:" } else { "<p style=\\"display:block;color:" });');
      expect(out).toContain("fv::core::escape_into(out, &props.c);");
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
      expect(out).toContain("fv::core::js_to_fixed(props.price * props.qty as f64, 2)");
      expect(out).toContain("fv::core::push_number(out, props.qty as f64 / 4.0);");
      expect(out).toContain("fv::core::js_round(props.price)");
      expect(out).toContain("props.rate.unwrap_or(0.5f64)");
      expect(out).toContain("fv::core::push_number(out, props.qty as f64 % 3.0);");
    });

    it("writes toPrecision and toExponential with the runtime's twins, a fractional argument truncated as for toFixed", () => {
      const source = numbers.replace(
        "{{ qty % 3 }}",
        "{{ qty % 3 }}|{{ price.toPrecision(3) }}|{{ qty.toPrecision(100.5) }}|{{ price.toPrecision() }}|{{ qty.toPrecision(undefined) }}|{{ price.toExponential(0) }}|{{ qty.toExponential(2.9) }}|{{ price.toExponential() }}|{{ price.toExponential(undefined) }}|{{ price.toFixed(1.5) }}|{{ qty.toFixed(undefined) }}",
      );
      const out = compile(island(source)).get("x.rs")!;
      expect(out).toContain("fv::core::js_to_precision(props.price, 3)");
      expect(out).toContain("fv::core::js_to_fixed(props.price, 1)");
      expect(out).toContain("fv::core::js_to_fixed(props.qty as f64, 0)");
      expect(out).toContain("fv::core::js_to_precision(props.qty as f64, 100)");
      expect(out).toContain("fv::core::push_number(out, props.price);");
      expect(out).toContain("fv::core::push_int(out, props.qty);");
      expect(out).toContain("fv::core::js_to_exponential(props.price, Some(0))");
      expect(out).toContain("fv::core::js_to_exponential(props.qty as f64, Some(2))");
      expect(out.match(/fv::core::js_to_exponential\(props\.price, None\)/g)).toHaveLength(2);
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
      expect(out).toContain("let s_d = std::cell::LazyCell::new(|| fv_refusals.keep(fv::date::try_date_parse(&props.at), 4, 26));");
      expect(out).toContain("fv::core::escape_into(out, &fv_refusals.keep(fv::date::try_to_iso_string(*s_d), 6, 17));");
      expect(out).toContain("fv::core::push_number(out, fv::date::js_utc_full_year(*s_d));");
      expect(out).toContain("fv::core::push_number(out, fv::date::js_time_clip(props.ms as f64));");
      expect(out).toContain("fv::core::push_number(out, fv_refusals.keep(fv::date::try_date_parse(&props.at), 6, 93));");
      expect(out).toContain("fv::core::push_number(out, 1705312800000.0f64);");
      expect(out).toContain("if !(*s_d).is_nan() {");
    });

    it("writes a date as toUTCString, toJSON and JSON.stringify do, builds one with Date.UTC and orders two", () => {
      const out = compile(
        island(dated("const d = computed(() => new Date(props.at));\nconst j = computed(() => d.value.toJSON());", '{{ d.toUTCString() }}|{{ j ?? "none" }}|{{ JSON.stringify(d) }}|{{ Date.UTC(ms) }}|{{ Date.UTC(99, 11, 31, 23, 59, 59.9, 999.5) }}|{{ Date.UTC(ms, 1, 2) }}|{{ d < new Date(ms) }}|{{ d >= d }}<b :title="d.toJSON()"></b>')),
      ).get("x.rs")!;
      expect(out).toContain("let s_j = std::cell::LazyCell::new(|| fv::date::js_to_json(*s_d).map(Cow::<str>::Owned));");
      expect(out).toContain("fv::core::escape_into(out, &fv::date::js_to_utc_string(*s_d));");
      expect(out).toContain('fv::core::escape_into(out, (*s_j).as_deref().unwrap_or("none"));');
      expect(out).toContain("fv::core::escape_into(out, &fv::date::js_json_date(*s_d));");
      expect(out).toContain("fv::core::push_number(out, fv_refusals.keep(fv::date::try_date_utc(props.ms as f64, 0.0f64, 1.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64), 7, 81));");
      expect(out).toContain('out.push_str("|946684799999|");');
      expect(out).toContain('out.push_str(if (*s_d) < fv::date::js_time_clip(props.ms as f64) { "true" } else { "false" });');
      expect(out).toContain('out.push_str(if !(*s_d).is_nan() { "true" } else { "false" });');
      expect(out).toContain("if let Some(v) = fv::date::js_to_json(*s_d).as_deref() {");
    });

    it("tests a number with Number.isNaN and its kin, and takes a date's || as its ??", () => {
      const out = compile(
        island(`<script setup lang="ts">
import type { Float } from "ferrovue/types";
defineProps<{ at: Date; edited?: Date; deleted: Date | null; n: number; x: Float; maybe?: Float }>();
</script>
<template><p v-if="!Number.isNaN(at.getTime())">{{ Number.isFinite(x) }}|{{ Number.isInteger(x) }}|{{ Number.isSafeInteger(x + 1) }}|{{ Number.isSafeInteger(n) }}|{{ Number.isInteger(n) }}|{{ isNaN(x) }}|{{ Number.isNaN(maybe) }}|{{ (edited || at).getTime() }}|{{ (deleted || edited || at).getTime() }}|{{ (at || edited).getTime() }}|{{ Boolean(edited) }}<b v-if="!Number.isSafeInteger(n)">big</b></p></template>`),
      ).get("x.rs")!;
      expect(out).toContain("if !fv::date::js_time_of(&props.at).is_nan() {");
      expect(out).toContain("if props.x.is_finite() {");
      expect(out).toContain("if props.x.fract() == 0.0 {");
      expect(out).toContain("if matches!(props.x + 1.0, v if v.fract() == 0.0 && v.abs() <= 9_007_199_254_740_991.0) {");
      expect(out).toContain("if (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&props.n) {");
      expect(out).toContain("if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&props.n) {");
      expect(out).toContain("|true|");
      expect(out).toContain("if props.maybe.is_some_and(|v| v.is_nan()) {");
      expect(out).toContain("fv::core::push_number(out, props.edited.as_ref().map(fv::date::js_time_of).unwrap_or(fv::date::js_time_of(&props.at)));");
      expect(out).toContain("props.deleted.as_ref().map(fv::date::js_time_of).or(props.edited.as_ref().map(fv::date::js_time_of)).unwrap_or(fv::date::js_time_of(&props.at))");
      expect(out).toContain("fv::core::push_number(out, fv::date::js_time_of(&props.at));");
      expect(out).toContain("if props.edited.as_ref().map(fv::date::js_time_of).is_some() {");
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
      expect(x).toContain('    #[serde(with = "fv::date::date_prop")]\n    pub posted: ferrovue::date::JsDate,');
      expect(x).toContain('    #[serde(default, skip_serializing_if = "Option::is_none", with = "fv::date::opt_date_prop")]\n    pub edited: Option<ferrovue::date::JsDate>,');
      expect(x).toContain('    #[serde(default, with = "fv::date::opt_date_prop")]\n    pub deleted: Option<ferrovue::date::JsDate>,');
      expect(x).toContain("pub fn new(posted: ferrovue::date::JsDate) -> Self {");
      expect(x).toContain("pub fn edited(mut self, edited: ferrovue::date::JsDate) -> Self {");
      expect(x).toContain("let s_year = fv::date::js_utc_full_year(fv::date::js_time_of(&props.posted));");
      expect(x).toContain("fv::core::escape_into(out, &fv_refusals.keep(fv::date::try_to_iso_string(fv::date::js_time_of(&props.posted)), 7, 31));");
      expect(x).toContain("if let Some(fv_edited) = props.edited.as_ref().map(fv::date::js_time_of) {");
      expect(oneLine(x)).toContain(
        "&super::stamp::Props { at: fv_refusals.date(fv::date::js_time_of(&props.posted), 7, 125), maybe: props.deleted.as_ref().map(fv::date::js_time_of).map(|fv_t| fv_refusals.date(fv_t, 7, 141)), later: props.edited.as_ref().map(fv::date::js_time_of).map(|fv_t| fv_refusals.date(fv_t, 7, 158)), made: fv_refusals.date(fv::date::js_time_clip(s_year), 7, 171) }",
      );
      const chrono = generate(island(posted, { Stamp: stamp }), { ...CONFIG, dateType: "chrono::DateTime<chrono::Utc>" });
      expect(chrono.get("x.rs")).toContain('    #[serde(with = "fv::date::date_prop")]\n    pub posted: chrono::DateTime<chrono::Utc>,');
      expect(chrono.get("stamp.rs")).toContain("    pub later: Option<chrono::DateTime<chrono::Utc>>,");
      expect(chrono.get("x.rs")!.replaceAll("chrono::DateTime<chrono::Utc>", "ferrovue::date::JsDate")).toBe(x);
    });

    it("gives a Date prop of a props interface the same Rust type", () => {
      const out = compile(island(`<script setup lang="ts">
interface Props { posted: Date; label: string }
const props = defineProps<Props>();
</script>
<template><p>{{ props.posted.getUTCDate() }}{{ label }}</p></template>`)).get("x.rs")!;
      expect(out).toContain("    pub posted: ferrovue::date::JsDate,");
      expect(out).toContain("fv::core::push_number(out, fv::date::js_utc_date(fv::date::js_time_of(&props.posted)));");
    });

    it("gives a Date inside lists, dictionaries and objects of the props the date type, with a plan of where the dates are", () => {
      const source = `<script setup lang="ts">
import type { Props as CardProps } from "./Card.vue";
interface Row { at: Date; seen?: Date; marks: Date[]; by: Record<string, Date>; next?: Row }
defineProps<{ days: Date[]; maybe?: (Date | null)[]; byName: Record<string, Date>; rows: Row[]; cards: CardProps[] }>();
</script>
<template><i v-for="d in days">{{ d.getTime() }}</i><b v-for="r in rows">{{ r.at.toISOString() }}{{ r.marks.length }}</b></template>`;
      const card = `<script setup lang="ts">\ndefineProps<{ at: Date }>();\n</script>\n<template><i>{{ at.getTime() }}</i></template>`;
      const out = compile(island(source, { Card: card }));
      const x = out.get("x.rs")!;
      expect(x).toContain('    #[serde(with = "fv::date::dates_in")]\n    pub days: Vec<ferrovue::date::JsDate>,');
      expect(x).toContain('    #[serde(default, skip_serializing_if = "Option::is_none", with = "fv::date::dates_in")]\n    pub maybe: Option<Vec<Option<ferrovue::date::JsDate>>>,');
      expect(x).toContain('    #[serde(rename = "byName", with = "fv::date::dates_in")]\n    pub by_name: ferrovue::props::Record<\'a, ferrovue::date::JsDate>,');
      expect(x).toContain('    #[serde(default, skip_serializing_if = "Option::is_none", with = "fv::date::opt_date_prop")]\n    pub seen: Option<ferrovue::date::JsDate>,');
      expect(x).toContain("for fv_d in props.days.iter().map(fv::date::js_time_of) {");
      expect(x).toContain("fv_refusals.keep(fv::date::try_to_iso_string(fv::date::js_time_of(&fv_r.at)), 6, 77)");
      const plan = '[{"days":[1],"maybe":[1],"byName":{"*":1},"rows":["Row"],"cards":[{"at":1}]},{"Row":{"at":1,"seen":1,"marks":[1],"by":{"*":1},"next":"Row"}}]';
      expect(x).toContain(`    let html: fv::html::Html<'p, Props<'a>> = fv::html::Html::island_fallible(NAME, props, render, try_render);\n    html.dates(${JSON.stringify(plan)})`);
      expect(out.get("card.rs")).not.toContain(".dates(");
    });

    it("refuses a Date in a ref, a defineModel, a list of lists, or the values of a dictionary of lists", () => {
      const typed = `<script setup lang="ts">
import { ref } from "vue";
const at = ref<Date[]>([]);
</script>
<template><i>{{ at.length }}</i></template>`;
      expect(() => compile(island(typed))).toThrow(/a `ref` holds a `Date`: a `Date` reaches the browser as a `Date` from a prop or a loader's result/);
      const model = `<script setup lang="ts">
const at = defineModel<Date>({ required: true });
</script>
<template><i>{{ at.getTime() }}</i></template>`;
      expect(() => compile(island(model))).toThrow(/a `defineModel` holds a `Date`/);
      const props = (decl: string) => `<script setup lang="ts">\ndefineProps<${decl}>();\n</script>\n<template><i></i></template>`;
      expect(() => compile(island(props("{ days: Date[][] }")))).toThrow(/a list of lists or dictionaries of `Date`s/);
      expect(() => compile(island(props("{ days: Array<Record<string, Date>> }")))).toThrow(/a list of lists or dictionaries of `Date`s/);
      expect(() => compile(island(props("{ days: Record<string, Date[]> }")))).toThrow(/other than dates/);
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
      expect(() => compile(island(dated("const now = new Date();", "{{ now.toISOString() }}")))).toThrow(/`new Date\(\)` is the time it runs.*\(the template reads it as `now` at /);
      const formatter = dated('const money = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });', "{{ money.format(ms) }}");
      expect(() => compile(island(formatter))).toThrow(/`Intl` formats by locale.*\(the template reads it as `money` at /);
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
      const at = out.indexOf("pub fn try_render");
      return out.slice(at, out.indexOf("\n}\n", at));
    };

    it("keeps a computed that cannot panic as a value evaluated before the render", () => {
      const out = render("const upper = computed(() => props.word.toUpperCase());\nconst first = computed(() => props.word.slice(0, 1));", '<p v-if="on">{{ upper }}|{{ first }}</p>');
      expect(out).toContain("let s_upper = props.word.to_uppercase();");
      expect(out).toMatch(/let s_first = fv::strings::js_slice\(/);
      expect(out).not.toContain("LazyCell");
    });

    it("evaluates a computed whose twin panics where JavaScript throws when the render first reads it", () => {
      const out = render(
        "const many = computed(() => props.word.repeat(props.n));\nconst wide = computed(() => props.word.padEnd(props.n));\nconst iso = computed(() => new Date(props.at).toISOString());\nconst ms = computed(() => Date.parse(props.at));",
        '<p v-if="on">{{ many }}|{{ wide }}|{{ iso }}|{{ ms }}</p>',
      );
      expect(out).toContain("let s_many = std::cell::LazyCell::new(|| fv_refusals.keep(fv::strings::try_repeat(&props.word, props.n as f64), 4, 29));");
      expect(out).toMatch(/let s_wide = std::cell::LazyCell::new\(\|\| fv_refusals\.keep\(fv::strings::try_pad_end\(/);
      expect(out).toContain("let s_iso = std::cell::LazyCell::new(|| fv_refusals.keep(fv::date::try_to_iso_string(fv_refusals.keep(fv::date::try_date_parse(&props.at), 6, 28)), 6, 28));");
      expect(out).toContain("let s_ms = std::cell::LazyCell::new(|| fv_refusals.keep(fv::date::try_date_parse(&props.at), 7, 27));");
      expect(out).toMatch(/if props\.on \{\n\s+out\.push_str\("<section><p>"\);\n\s+fv::core::escape_into\(out, &s_many\);/);
      expect(out).toContain("fv::core::push_number(out, *s_ms);");
    });

    it("makes a computed lazy when it reads one that is, and leaves one that reads none as it is", () => {
      const out = render(
        "const iso = computed(() => new Date(props.at).toISOString());\nconst stamp = computed(() => `${iso.value}!`);\nconst size = computed(() => stamp.value.length);\nconst label = computed(() => props.word + '?');",
        '<p v-if="on">{{ size }}|{{ label }}</p>',
      );
      expect(out).toContain('let s_stamp = std::cell::LazyCell::new(|| format!("{}!", (*s_iso)));');
      expect(out).toContain("let s_size = std::cell::LazyCell::new(|| fv::strings::js_length(&s_stamp));");
      expect(out).toContain('let s_label = format!("{}?", props.word);');
      expect(out).toContain("fv::core::push_int(out, *s_size);");
    });

    it("drops a computed the render never reads, and holds lists and optional strings lazily", () => {
      const out = render(
        "const unused = computed(() => props.word.repeat(props.n));\nconst copies = computed(() => props.tags.map((t) => t.repeat(2)));\nconst echoed = computed(() => (props.on ? props.word.repeat(props.n) : undefined));",
        '<i v-for="c in copies">{{ c }}</i>{{ echoed ?? "-" }}',
      );
      expect(out).not.toContain("s_unused");
      expect(out).toMatch(/let s_copies = std::cell::LazyCell::new\(\|\| props\.tags\.iter\(\).*\.collect::<Vec<_>>\(\)\);/);
      expect(out).toContain("for fv_c_cow in (*s_copies).iter()");
      expect(out).toContain('fv::core::escape_into(out, (*s_echoed).as_deref().unwrap_or("-"));');
    });

    it("evaluates a lazy computed a `v-bind()` in `<style>` reads as the render starts, as Vue's server does", () => {
      const out = render("const wide = computed(() => props.word.padStart(props.n));", '<p v-if="on">x</p>', "\n<style>p { width: v-bind(wide); }</style>");
      expect(out).toMatch(/let s_wide = std::cell::LazyCell::new\(.*\);\n\s+std::cell::LazyCell::force\(&s_wide\);/);
    });

    it("falls back to a value the render may refuse only where the left side of `??` is absent", () => {
      const out = compile(island(`<script setup lang="ts">
const props = defineProps<{ note?: string; word: string; n: number; count?: number }>();
</script>
<template><p>{{ note ?? word.repeat(n) }}|{{ count ?? n * n }}</p></template>`)).get("x.rs")!;
      expect(out).toContain('props.note.as_deref().map(Cow::<str>::Borrowed).unwrap_or_else(|| Cow::<str>::Owned(fv_refusals.keep(fv::strings::try_repeat(&props.word, props.n as f64), 4, 25)))');
      expect(out).toContain("fv::core::push_number(out, props.count.map(|v| v as f64).unwrap_or(props.n as f64 * props.n as f64));");
    });

    it("writes integer arithmetic chosen by `??`, `?:`, `||`, a computed or a function from its double, with no check of the range of i64", () => {
      const out = compile(island(`<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ n: number; m: number; count?: number; on: boolean }>();
const chosen = computed(() => (props.on ? props.n * props.n : props.m));
function product(a: number, b: number): number {
  return a * b;
}
</script>
<template><p :title="count ?? n * n" :data-or="m || n * n">{{ on ? n * n : m }} {{ chosen }} {{ product(n, m) }} {{ \`\${count ?? n * m}\` }}</p></template>`)).get("x.rs")!;
      expect(out).not.toContain("try_int");
      expect(out).not.toContain("fv_refusals");
      expect(out).toContain("fv::core::push_number(out, if props.on { props.n as f64 * props.n as f64 } else { props.m as f64 });");
    });

    it("refuses at render time an integer beyond the range of i64 handed to a child, and writes one into the page from its double", () => {
      const out = compile(
        island(`<script setup lang="ts">
import Kid from "./Kid.vue";
defineProps<{ n: number }>();
</script>
<template><p>{{ n * n }}</p><Kid :k="n * n" /></template>`, { Kid: '<script setup lang="ts">\ndefineProps<{ k: number }>();\n</script>\n<template><i>{{ k }}</i></template>' }),
      ).get("x.rs")!;
      expect(out).toContain("fv::core::push_number(out, props.n as f64 * props.n as f64);");
      expect(out).toContain("&super::kid::Props { k: fv_refusals.keep(fv::render::try_int(props.n as f64 * props.n as f64), 5, 38) }");
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
      expect(out.get("x.rs")).toContain("for fv_o in super::types::OPTIONS.iter()");
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
        expect(x).toMatch(/pub struct Cat<'a> \{\n {4}pub id: Cow<'a, str>,\n\}/);
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

    it("refuses a prop or a field with no type where it is declared, in the component and in a `.ts` file", () => {
      const caught = (project: string): unknown => {
        try {
          compile(project);
        } catch (e) {
          return e;
        }
        return undefined;
      };
      const untyped = [
        [cats("", "<component :is=\"tag\" />", "defineProps<{ tag }>();"), { file: "components/X.vue", line: 4, column: 15 }],
        [cats("interface Cat { id }", "<p>{{ cat.id }}</p>", "defineProps<{ cat: Cat }>();"), { file: "components/X.vue", line: 3, column: 17 }],
        [withFile(cats(`import type { Cat } from "./cats";`, "<p>{{ cat.id }}</p>", "defineProps<{ cat: Cat }>();"), "cats.ts", "export interface Cat {\n  id\n}\n"), { file: "components/cats.ts", line: 2, column: 3 }],
      ] as const;
      for (const [project, at] of untyped) {
        const e = caught(project);
        expect(e).toBeInstanceOf(GenError);
        expect(e).toMatchObject({ code: "FV0326", at });
      }
      expect(compile(cats("interface Cat { id: string; note }", `<b v-for="c in cats">{{ c.id }}</b>`)).get("x.rs")).toContain("pub struct Cat<'a>");
      expect(compile(cats("", "<component :is=\"tag\" />", "defineProps<{ tag: \"h1\" | \"h2\" }>();")).get("x.rs")).toContain("pub fn render");
    });

    it("reads props of a type imported from a `.ts` file by a relative path, and refuses the forms Vue or the compiler cannot resolve", () => {
      const caught = (project: string): unknown => {
        try {
          compile(project);
        } catch (e) {
          return e;
        }
        return undefined;
      };
      const lib = "export interface Cat { id: string }\nexport type Pick = { id?: string };\nexport interface Events { (e: \"save\"): void }\n";
      const imported = (declared: string, setup: string) => withFile(cats(`import type { Cat, Pick, Events } from "./lib";\n${declared}`, "<p>x</p>", setup), "lib.ts", lib);
      const aliased = withFile(cats('import type { Cat } from "@/lib";', "<p>x</p>", "defineProps<Cat>();"), "lib.ts", lib);
      expect(caught(aliased)).toMatchObject({ code: "FV0327", at: { file: "components/X.vue", line: 4, column: 13 }, message: expect.stringContaining("`Cat`, imported from `@/lib`, which Vue's compiler resolves only by a relative path") });
      expect(caught(imported("type Props = Partial<Cat>;", "defineProps<Props>();"))).toMatchObject({ code: "FV0304", at: { file: "components/X.vue", line: 5, column: 13 } });
      const fromVue = island('<script setup lang="ts">\nimport type { Props } from "./Y.vue";\ndefineProps<Props>();\n</script>\n<template><p>{{ id }}</p></template>', {
        Y: '<script setup lang="ts">\nexport interface Props { id: string }\ndefineProps<Props>();\n</script>\n<template><b>{{ id }}</b></template>',
      });
      expect(caught(fromVue)).toMatchObject({ code: "FV0327", at: { file: "components/X.vue", line: 3, column: 13 }, message: expect.stringContaining("imported from `Y.vue`") });
      expect(caught(imported("", "defineProps<Cat & { id: string }>();"))).toMatchObject({ code: "FV0304", message: expect.stringContaining("`id` is declared twice") });
      for (const [declared, setup, fields] of [
        ["", "defineProps<Cat>();", ["pub id: Cow<'a, str>,"]],
        ["", 'withDefaults(defineProps<Pick>(), { id: "a" });', ["pub id: Option<Cow<'a, str>>,"]],
        ["", "defineProps<Cat & { n: number }>();", ["pub id: Cow<'a, str>,", "pub n: i64,"]],
        ["interface Props extends Cat { n: number }", "defineProps<Props>();", ["pub n: i64,", "pub id: Cow<'a, str>,"]],
        ["", "defineProps<{ n: number }>();\ndefineEmits<Events>();", ["pub n: i64,"]],
        ["", "defineProps<{ cat: Cat; pick?: Pick }>();", ["pub cat: super::types::Cat<'a>,"]],
        ["interface Props { cat: Cat }", "defineProps<Props>();", ["pub cat: super::types::Cat<'a>,"]],
        ["", "const cat = defineModel<Cat>({ required: true });", ["pub model_value: super::types::Cat<'a>,"]],
      ] as const) {
        const out = compile(imported(declared, setup)).get("x.rs")!;
        const props = out.slice(out.indexOf("pub struct Props"), out.indexOf("\n}\n", out.indexOf("pub struct Props")));
        for (const field of fields) expect(props, setup).toContain(field);
      }
    });
  });

  describe("types written in place", () => {
    const of = (props: string, template = "<p>x</p>", before = ""): string => `<script setup lang="ts">\n${before}defineProps<${props}>();\n</script>\n<template>${template}</template>`;
    const caught = (source: string): GenError => {
      try {
        compile(island(source));
      } catch (e) {
        if (e instanceof GenError) return e;
        throw e;
      }
      throw new Error("compiled without an error");
    };

    it("names an object type in place after the type and the field that hold it, alone, in a list and optional", () => {
      const out = compile(island(of("{ owner: { name: string; tags?: { t: string }[] }; rows: { k: string }[]; box?: { on: boolean } }", "<p>{{ owner.name }}{{ rows.length }}{{ box?.on }}</p>"))).get("x.rs")!;
      for (const decl of ["pub struct XOwner<'a> {", "pub struct XOwnerTags<'a> {", "pub struct XRows<'a> {", "pub struct XBox {", "pub owner: XOwner<'a>,", "pub rows: Vec<XRows<'a>>,", "pub r#box: Option<XBox>,"]) expect(out).toContain(decl);
    });

    it("reads a mapped type and a `Record` over a union of names as a struct, by name and by a value of the union", () => {
      const out = compile(island(of("{ side: Side; widths: { [K in Side]: number }; labels: Record<Side, string> }", "<p>{{ widths.left }}{{ labels[side] }}</p>", 'type Side = "left" | "right";\n'))).get("x.rs")!;
      expect(out).toContain("pub widths: XWidths,");
      expect(out).toContain("match props.side { Side::Left => std::ops::Deref::deref(&props.labels.left), Side::Right => std::ops::Deref::deref(&props.labels.right) }");
    });

    it("reads an indexed type as the field it names", () => {
      expect(compile(island(of('{ size: Card["size"] }', "<p>{{ size }}</p>", 'interface Card { size: "sm" | "lg" }\n'))).get("x.rs")).toContain("pub size: CardSize,");
    });

    it("refuses an object type in place it cannot name, and a mapped type over literals that are not names", () => {
      expect(caught(of("{ pick: { a: string } | { b: string } }"))).toMatchObject({ code: "FV0310" });
      expect(caught(of('{ m: { [K in "a-b" | "c"]: string } }'))).toMatchObject({ code: "FV0316" });
      expect(caught(of("{ owner: { name: string } }", "<p>x</p>", "interface XOwner { id: number }\n"))).toMatchObject({ code: "FV0310", message: expect.stringContaining("named `XOwner`") });
    });

    it("holds a tuple as a tuple struct, read by index, by `.length` and by array patterns", () => {
      const out = compile(island(of("{ pair: Pair; rows: [label: string, n: number | null][]; on?: [boolean] }", '<p :title="pair[0]">{{ pair[1] }}{{ pair.length }}{{ on?.[0] }}<i v-for="([l, n], i) in rows" :key="i">{{ l }}{{ n ?? 0 }}</i>{{ rows.map(([l]) => l).join() }}</p>', "type Pair = [string, number];\n"))).get("x.rs")!;
      for (const decl of ["pub struct Pair<'a>(pub Cow<'a, str>, pub i64);", "pub struct XRows<'a>(pub Cow<'a, str>, pub Option<i64>);", "pub struct XOn(pub bool);", "pub rows: Vec<XRows<'a>>,", "pub on: Option<XOn>,"]) expect(out).toContain(decl);
      expect(out).toContain("pub fn new(part0: impl Into<Cow<'a, str>>, part1: Option<i64>) -> Self {\n        XRows(part0.into(), part1)\n    }");
      expect(out).toContain("fv::core::push_int(out, props.pair.1);");
      expect(out).toContain('out.push(\'2\');');
      expect(out).toMatch(like("fv::core::escape_into(out, &fv_item.0);"));
    });

    it("writes a tuple's dates with serde's date helpers, and plans them by their indices", () => {
      const out = compile(island(of("{ span: [Date, string] }", "<p>{{ span[1] }}</p>"))).get("x.rs")!;
      expect(out).toContain('pub struct XSpan<\'a>(#[serde(with = "fv::date::date_prop")] pub ferrovue::date::JsDate, pub Cow<\'a, str>);');
      expect(out).toContain('html.dates("[{\\"span\\":{\\"0\\":1}}]")');
    });

    const refusal = (project: string): unknown => {
      try {
        compile(project);
      } catch (e) {
        return e instanceof GenErrors ? e.errors[0] : e;
      }
      throw new Error("compiled without an error");
    };

    it("builds a child's tuple from an array literal and from a tuple of another component", () => {
      const child = '<script setup lang="ts">\ndefineProps<{ pair: [string, number]; rest?: [string, number][] }>();\n</script>\n<template><b>{{ pair[0] }}</b></template>';
      const parent = (template: string) => island(`<script setup lang="ts">\nimport C from "./C.vue";\ntype Pair = [string, number];\ndefineProps<{ pair: Pair; pairs: Pair[] }>();\n</script>\n<template><div>${template}</div></template>`, { C: child });
      expect(compile(parent(`<C :pair="['a', pair[1]]" />`)).get("x.rs")).toContain("pair: super::c::CPair(Cow::<str>::Borrowed(\"a\"), props.pair.1)");
      const passed = compile(parent('<C :pair="pair" :rest="pairs" />')).get("x.rs")!;
      expect(passed).toMatch(like("pair: { let fv_tuple = &props.pair; super::c::CPair(Cow::Borrowed(&*fv_tuple.0), fv_tuple.1) }"));
      expect(passed).toMatch(like("rest: Some(props.pairs.iter().map(|fv_tuple| super::c::CRest(Cow::Borrowed(&*fv_tuple.0), fv_tuple.1)).collect())"));
      expect(refusal(parent(`<C :pair="['a']" />`))).toMatchObject({ code: "FV0635", message: expect.stringContaining("holds its 2 parts, and this one holds 1") });
      expect(refusal(parent(`<C :pair="['a', 'b']" />`))).toMatchObject({ code: "FV0635", message: expect.stringContaining("part 1 of `CPair` is a number") });
      expect(refusal(parent('<C :pair="[...pair]" />'))).toMatchObject({ code: "FV0635", message: expect.stringContaining("without a spread or a hole") });
    });

    it("names the types FV0510 refuses by their structs", () => {
      const child = '<script setup lang="ts">\ndefineProps<{ box: { on: boolean } }>();\n</script>\n<template><b>{{ box.on }}</b></template>';
      const parent = island('<script setup lang="ts">\nimport C from "./C.vue";\ndefineProps<{ box: { on: boolean } }>();\n</script>\n<template><C :box="box" /></template>', { C: child });
      expect(refusal(parent)).toMatchObject({ code: "FV0510", message: expect.stringContaining("`XBox` where the child takes `CBox`") });
    });

    it.each([
      ["an empty tuple", "{ pair: [] }", "an empty tuple"],
      ["an optional part", "{ pair: [string, number?] }", "a tuple with an optional part"],
      ["an optional labelled part", "{ pair: [a: string, b?: number] }", "a tuple with an optional part"],
      ["a rest part", "{ pair: [string, ...number[]] }", "a tuple with a rest part"],
      ["a part that may be undefined", "{ pair: [string, number | undefined] }", "part 1 of a tuple may be `undefined`"],
    ])("refuses a tuple with %s", (_, props, message) => {
      expect(caught(of(props))).toMatchObject({ code: "FV0316", message: expect.stringContaining(message) });
    });

    it.each([
      ["an index past its parts", "{{ pair[2] }}", "FV0612", "from `0` to `1`"],
      ["an index that is not a literal", "{{ pair[n] }}", "FV0612", "by a literal index"],
      ["a `v-for` over its parts", '<i v-for="x in pair">{{ x }}</i>', "FV0820", "walks an array"],
      ["a pattern with a rest", '<i v-for="([a, ...b]) in pairs">{{ a }}</i>', "FV0821", "without defaults or a rest element"],
      ["a pattern of more names than parts", '<i v-for="([a, b, c]) in pairs">{{ a }}</i>', "FV0821", "a tuple of 2"],
      ["an array method", '{{ pair.join(",") }}', "FV0602", "`.join()`"],
    ])("refuses %s", (_, template, code, message) => {
      expect(caught(of("{ pair: [string, number]; pairs: [string, number][]; n: number }", `<p>${template}</p>`))).toMatchObject({ code, message: expect.stringContaining(message) });
    });
  });
});
