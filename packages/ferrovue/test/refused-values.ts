export const refusedValues: [string, string, RegExp][] = [
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
    /a `Record`'s values are strings, numbers, booleans, dates, objects or lists of those other than dates/,
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
    "a list of lists of dates",
    `<script setup lang="ts">
defineProps<{ weeks: Date[][] }>();
</script>
<template><p>{{ weeks.length }}</p></template>`,
    /a list of lists or dictionaries of `Date`s: hold each inner list in an object, as `\{ at: Date\[\] \}\[\]`/,
  ],
  [
    "a list of dates sorted without a comparator",
    `<script setup lang="ts">
defineProps<{ days: Date[] }>();
</script>
<template><p v-for="d in days.toSorted()">{{ d.getTime() }}</p></template>`,
    /`\.toSorted\(\)` without a comparator orders dates by `String\(x\)`, which writes each in the time zone of the machine running it/,
  ],
  [
    "a date looked for in a list of dates",
    `<script setup lang="ts">
defineProps<{ days: Date[]; at: Date }>();
</script>
<template><p>{{ days.includes(at) }}</p></template>`,
    /`\.includes\(\)` looks for a value of the list's own type, in a list of strings, numbers or booleans/,
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
    "a time formatted by locale",
    `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date(at).toLocaleTimeString() }}</p></template>`,
    /`\.toLocaleTimeString\(\)` formats by locale/,
  ],
  [
    "a date formatted by locale as a whole",
    `<script setup lang="ts">
defineProps<{ at: string }>();
</script>
<template><p>{{ new Date(at).toLocaleString("en-GB") }}</p></template>`,
    /`\.toLocaleString\(\)` formats by locale/,
  ],
  [
    "a list formatted by locale",
    `<script setup lang="ts">
defineProps<{ ns: number[] }>();
</script>
<template><p>{{ ns.toLocaleString() }}</p></template>`,
    /`\.toLocaleString\(\)` formats by locale/,
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
    "a static `is` naming an imported component, at the attribute",
    `<script setup lang="ts">
import P from "./P.vue";
</script>
<template>
  <div>
    <component is="P" />
  </div>
</template>`,
    /^components\/X\.vue:6:16: `P` is not an HTML element `<component :is>` renders/,
  ],
  [
    "an element rendering a component by `is=\"vue:…\"` without its required prop, at the element",
    `<script setup lang="ts">
import P from "./P.vue";
</script>
<template>
  <section>
    <div is="vue:P" />
  </section>
</template>`,
    /^components\/X\.vue:6:5: P requires `p`/,
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
import { ClientOnly } from "ferrovue";
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
];
