export const refusedExpressions: [string, string, RegExp][] = [
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
    "a prop named like a listener given twice in props Vue merges",
    `<script setup lang="ts">
import Q from "./Q.vue";
defineProps<{ n: number }>();
</script>
<template><p><Q :on1="n" :on-at="1" :on-note="null" v-bind="{ on1: 2 }" /></p></template>`,
    /X\.vue:5:\d+: `on1` is given to Q twice in props Vue joins with `mergeProps`, which makes a list of two values of a name like a listener's: give it once/,
  ],
  [
    "a required prop named like a listener given a value that may be falsy in props Vue merges",
    `<script setup lang="ts">
import Q from "./Q.vue";
defineProps<{ n: number }>();
</script>
<template><Q :on-at="n" :on-note="null" /></template>`,
    /X\.vue:5:\d+: `onAt`, a required prop of Q named like a listener, is given a value that may be falsy, which Vue's `mergeProps` leaves out and the child reads as `undefined`/,
  ],
  [
    "a required nullable prop named like a listener given a string that may be empty in props Vue merges",
    `<script setup lang="ts">
import Q from "./Q.vue";
defineProps<{ s: string }>();
</script>
<template><Q :on-at="1" :on-note="s" /></template>`,
    /X\.vue:5:\d+: `onNote`, a required prop of Q named like a listener, is given a value that may be falsy/,
  ],
  [
    "a child's own Props with a required prop named like a listener, merged with attributes",
    `<script setup lang="ts">
import Q from "./Q.vue";
import type { Props as QProps } from "./Q.vue";
defineProps<{ q: QProps }>();
</script>
<template><Q v-bind="q" /></template>`,
    /X\.vue:6:\d+: `onAt`, a required prop of Q named like a listener, may be falsy, .*: bind its props one by one, or make the prop optional/,
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
    "an initial value of setup that changes state",
    `<script setup lang="ts">
import { ref } from "vue";
const count = ref(0);
const next = (count.value = 5);
</script>
<template><b>{{ count }}</b></template>`,
    /an assignment in the initial value of `next` runs during setup on the server/,
  ],
  [
    "a setup binding it cannot evaluate, named like a prop",
    `<script setup lang="ts">
const props = defineProps<{ label: string }>();
const label = props.label.normalize();
</script>
<template><i>{{ label }}</i></template>`,
    /`\.normalize\(\)`.*\(the template reads it as `label` at components\/X\.vue:5:17\)/,
  ],
  [
    "a setup binding it cannot evaluate, located once, where the template reads it",
    `<script setup lang="ts">
const props = defineProps<{ label: string }>();
const label = props.label.normalize();
</script>
<template><i>{{ label }}</i></template>`,
    /^components\/X\.vue:3:15: `\.normalize\(\)`[^\n]*\(the template reads it as `label` at components\/X\.vue:5:17\)\n 3 \| const label/,
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
    "a template literal of a value that may be null or undefined",
    `<script setup lang="ts">
defineProps<{ on: boolean; a?: string; b: string | null }>();
</script>
<template><i :title="\`n=\${on ? a : b}\`"></i></template>`,
    /a template literal of a value that may be `null` or `undefined`, which JavaScript writes as `null` or `undefined` and its Rust `Option` cannot tell apart: give it a fallback with `\?\?`/,
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
    "toLocaleLowerCase, which depends on the server's locale",
    `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.toLocaleLowerCase("tr") }}</i></template>`,
    /`\.toLocaleLowerCase\(\)` maps case by the locale the server runs in/,
  ],
  [
    "replace with a regular expression",
    `<script setup lang="ts">
const props = defineProps<{ a: string }>();
</script>
<template><i>{{ a.replace(/x|z/g, "y") }}</i></template>`,
    /`\/x\|z\/g` in `\.replace\(\)` holds `\|`, outside the regular expressions the server runs/,
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
    "a function with a while loop called by the template",
    `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number; note?: string; other: string | null }>();
function total(xs: string[]): number {
  let sum = 0;
  while (sum < xs.length) sum = sum + 1;
  return sum;
}
</script>
<template><i>{{ total(tags) }}</i></template>`,
    /X\.vue:5:\d+: a function's body may not hold a `while` loop, which the compiler cannot bound.*\(in `total\(\)`, called at components\/X\.vue:9:\d+\)/,
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
    "a for…in loop in a callback's body",
    `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { for (const c in t) { if (c) return c; } return t; }).join() }}</i></template>`,
    /X\.vue:4:\d+: a function's body may not hold a `for…in` loop, which walks an object's keys: iterate `Object\.keys\(…\)` with `for \(const key of …\)`/,
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
    "a let of a body assigned from a callback inside it",
    `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
function joined(tags: string[]): string {
  let count = 0;
  const names = tags.map((t) => { count += 1; return t; });
  return names.join() + count;
}
</script>
<template><i>{{ joined(tags) }}</i></template>`,
    /X\.vue:5:\d+: `count` is a `let` of the body around this function, which a function inside it may not assign \(`\+=`\): return the value from the function, and assign it in the body/,
  ],
  [
    "an assignment in a callback's body",
    `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
</script>
<template><i>{{ tags.map((t) => { return (props.n = 2) > 1 ? t : ""; }).join() }}</i></template>`,
    /an assignment \(`=`\) to a field or an item, which changes an object or a list in place/,
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
    "a constant `Map` read by its size",
    `<script setup lang="ts">
const WIDTH = new Map([["sm", 12], ["md", 16]]);
</script>
<template><i>{{ WIDTH.size }}</i></template>`,
    /X\.vue:4:\d+: `WIDTH` is a constant `Map`, which the server reads with `\.get\(key\)` and `\.has\(key\)`/,
  ],
  [
    "`&&` after an optional string, which may be empty",
    `<script setup lang="ts">
defineProps<{ s?: string }>();
</script>
<template><i>{{ s && s.length }}</i></template>`,
    /X\.vue:4:\d+: `&&` gives its left side where that is falsy, and this one, an optional string, may be falsy where it is present/,
  ],
  [
    "`&&` after a choice that may be `null` or `undefined`",
    `<script setup lang="ts">
defineProps<{ a: string | null; on: boolean }>();
</script>
<template><i>{{ (on ? a : undefined) && "x" }}</i></template>`,
    /^components\/X\.vue:4:17: `&&` is supported between booleans only, and its left side is a string, `null` or `undefined`\n/,
  ],
  [
    "a type imported from a component that is not compiled",
    `<script setup lang="ts">
import type { Item } from "./Missing.vue";
defineProps<{ item: Item }>();
</script>
<template><i>{{ item.label }}</i></template>`,
    /^components\/X\.vue:2:15: `Item` is imported from Missing\.vue, which is not among the components compiled\n/,
  ],
  [
    "`<component :is>` choosing a child whose required prop is left out",
    `<script setup lang="ts">
import U from "./U.vue";
import Y from "./Y.vue";
defineProps<{ on: boolean }>();
</script>
<template>
<p>
  <component :is="on ? U : Y" /></p>
</template>`,
    /^components\/X\.vue:8:3: U requires `k`\n/,
  ],
  [
    "a computed that assigns a prop, read by the template",
    `<script setup lang="ts">
const props = defineProps<{ tags: string[]; n: number }>();
import { computed } from "vue";
const total = computed(() => {
  let sum = 0;
  for (const t of props.tags) props.n += t.length;
  return sum;
});
</script>
<template><i>{{ total }}</i></template>`,
    /X\.vue:6:\d+: an assignment \(`\+=`\) to a field or an item.*\(the template reads it as `total` at components\/X\.vue:10:\d+\)/,
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
    /this method takes a list of strings, numbers, booleans, dates or objects/,
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
];
