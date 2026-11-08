export const refusedTypes: [string, string, RegExp][] = [
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
  [
    "an object literal with a key its interface does not declare",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ label: name, extra: 1 }" /></div></template>`,
    /`extra` is not a field of `Item`, which an object literal of that type holds only the fields of/,
  ],
  [
    "an object literal that leaves out a required field",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ n }" /></div></template>`,
    /an object literal of type `Item` leaves out `label`, which `Item` requires/,
  ],
  [
    "an object literal that gives a key twice",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ label: name, label: 'b' }" /></div></template>`,
    /`label` given twice in an object literal of type `Item`/,
  ],
  [
    "an object literal with a computed key the compiler does not know",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ [name]: name, label: name }" /></div></template>`,
    /an object literal's computed key is a string or a number the compiler knows/,
  ],
  [
    "an object literal with a method",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ label: name, get n() { return 1; } }" /></div></template>`,
    /a method or an accessor in an object literal of type `Item`/,
  ],
  [
    "an object literal that sets `__proto__`",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ label: name, __proto__: null }" /></div></template>`,
    /`__proto__` in an object literal, which sets the object's prototype/,
  ],
  [
    "an object literal spreading after its own keys",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();
function base(): Item { return { label: "b" }; }
</script>
<template><div><V :item="{ label: name, ...base() }" /></div></template>`,
    /a spread `\.\.\.` after other keys of an object literal of type `Item`.*put the spread first/,
  ],
  [
    "an object literal spreading an object of another type",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();
interface Other { label: string }
function other(): Other { return { label: "o" }; }
</script>
<template><div><V :item="{ ...other() }" /></div></template>`,
    /`\.\.\.` of an object in an object literal of type `Item`: a spread copies an object of the same type/,
  ],
  [
    "an object literal whose field is given a value of another type",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ label: n }" /></div></template>`,
    /`label` of `Item` is a string, and the value given is a number/,
  ],
  [
    "an object literal giving `null` to an optional field",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ label: name, n: null }" /></div></template>`,
    /a value that may be `null` where `n` of `Item` takes an optional number.*write `\?\? undefined` after it/,
  ],
  [
    "an object literal giving an optional value to a required field",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><V :item="{ label: note }" /></div></template>`,
    /a value that may be `undefined` where `label` of `Item` takes a string.*narrow it with `v-if` first/,
  ],
  [
    "an object literal in the template with no type",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();

</script>
<template><div><p>{{ ({ a: n }).a }}</p></div></template>`,
    /an object literal in the template whose type is not known, which the server builds as the Rust struct of an interface/,
  ],
  [
    "a list method of a list `.map()` makes of object literals",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();
function rows(): Item[] { return props.words.map((w) => ({ label: w })); }
</script>
<template><div><p>{{ rows().filter((r) => r.label !== '').length }}</p></div></template>`,
    /`\.filter\(\)` of a value built from object literals in place.*give it a `computed` of its own and read that/,
  ],
  [
    "an item of a list `.map()` makes of object literals",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();
function rows(): Item[] { return props.words.map((w) => ({ label: w })); }
</script>
<template><div><p>{{ rows()[0]?.label }}</p></div></template>`,
    /`\[…\]` of a value built from object literals in place/,
  ],
  [
    "an optional chain of an object literal",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();
function one(): Item | undefined { return props.n > 0 ? { label: props.name } : undefined; }
</script>
<template><div><p>{{ one()?.label }}</p></div></template>`,
    /`\?\.` of a value built from object literals in place/,
  ],
  [
    "an optional list of object literals",
    `<script setup lang="ts">
import V, { type Item } from "./V.vue";
const props = defineProps<{ name: string; n: number; words: string[]; note?: string }>();
function rows(): Item[] | undefined { return props.n > 0 ? props.words.map((w) => ({ label: w })) : undefined; }
</script>
<template><div><V :item="{ label: name }" :items="rows() ?? []" /></div></template>`,
    /`\?:` between a list built from object literals and `undefined` or `null`/,
  ],
  [
    "a literal of a union with no letter or digit to name its variant",
    `<script setup lang="ts">
defineProps<{ sign: "+" | "minus" }>();
</script>
<template><p>{{ sign }}</p></template>`,
    /the literal "\+" of `XSign` has no letter or digit to name its variant/,
  ],
  [
    "two literals of a union that name one variant",
    `<script setup lang="ts">
defineProps<{ size: "md" | "MD" }>();
</script>
<template><p>{{ size }}</p></template>`,
    /the literal "MD" and the literal "md" of `XSize` both name the variant `Md`/,
  ],
  [
    "two members of an enum that hold one value",
    `<script setup lang="ts">
enum Tone { Calm = "calm", Quiet = "calm", Loud = "loud" }
defineProps<{ tone: Tone }>();
</script>
<template><p>{{ tone }}</p></template>`,
    /`Tone` gives two of its members one value/,
  ],
  [
    "a union in place whose enum is named as an interface of the component",
    `<script setup lang="ts">
interface XKind { label: string }
defineProps<{ kind: "a" | "b"; info: XKind }>();
</script>
<template><p>{{ kind }} {{ info.label }}</p></template>`,
    /this union is the Rust enum `XKind`, and the module it is written to has another type of that name/,
  ],
  [
    "a union alias named as a type of Rust's prelude",
    `<script setup lang="ts">
type Option = "a" | "b";
defineProps<{ pick: Option }>();
</script>
<template><p>{{ pick }}</p></template>`,
    /this union is the Rust enum `Option`, which would hide Rust's own `Option`/,
  ],
  [
    "a `unions` entry for an alias of integer literals",
    `<script setup lang="ts">
type Count = 1 | 2 | 3;
defineProps<{ n: Count }>();
</script>
<template><p>{{ n }}</p></template>`,
    /X\.vue:2:\d+: `unions` in ferrovue\.config\.json names a Rust enum for `Count`, which is not a union of two or more string literals: remove `Count` from `unions`, or declare it as one, as `type Count = "a" \| "b"`/,
  ],
  [
    "a `unions` entry for an alias of one literal",
    `<script setup lang="ts">
type Kind = "note";
defineProps<{ kind: Kind }>();
</script>
<template><p>{{ kind }}</p></template>`,
    /X\.vue:2:\d+: `unions` in ferrovue\.config\.json names a Rust enum for `Kind`, which is not a union of two or more string literals/,
  ],
  [
    "a `unions` entry for an alias of a union with `string`",
    `<script setup lang="ts">
type Size = "sm" | "md" | string;
defineProps<{ size: Size }>();
</script>
<template><p>{{ size }}</p></template>`,
    /X\.vue:2:\d+: `unions` in ferrovue\.config\.json names a Rust enum for `Size`, which is not a union/,
  ],
  [
    "a `unions` entry for a union another component declares with other members",
    `<script setup lang="ts">
type Pick = "a" | "b";
defineProps<{ pick: Pick }>();
</script>
<template><p>{{ pick }}</p></template>`,
    /X\.vue:2:\d+: `unions` in ferrovue\.config\.json makes `Pick` the Rust enum `crate::Pick`, and components\/P\.vue declares another `Pick`, "a" \| "c": give the two unions the same members/,
  ],
  [
    "props of a type imported from a component",
    `<script setup lang="ts">
import type { Props } from "./Y.vue";
defineProps<Props>();
</script>
<template><p>{{ b }}</p></template>`,
    /X\.vue:3:13: the props of `defineProps` are read from `Props`, imported from `\.\/Y\.vue`: declare them in the component, as `defineProps<\{ label: string \}>\(\)`/,
  ],
  [
    "props of a type imported from a package",
    `<script setup lang="ts">
import type { ButtonProps } from "some-ui";
defineProps<ButtonProps>();
</script>
<template><p>x</p></template>`,
    /X\.vue:3:13: the props of `defineProps` are read from `ButtonProps`, imported from `some-ui`/,
  ],
  [
    "events of a type imported from a package",
    `<script setup lang="ts">
import type { Events } from "some-ui";
defineEmits<Events>();
</script>
<template><p>x</p></template>`,
    /X\.vue:3:13: the events of `defineEmits` are read from `Events`, imported from `some-ui`: declare them in the component/,
  ],
  [
    "a prop with no type",
    `<script setup lang="ts">
defineProps<{ tag }>();
</script>
<template><component :is="tag" /></template>`,
    /X\.vue:2:15: `tag` has no type: give it one, as `tag: string`/,
  ],
  [
    "a field of an interface with no type that a prop reaches",
    `<script setup lang="ts">
interface Row { id: string; label }
defineProps<{ row: Row }>();
</script>
<template><p>{{ row.label }}</p></template>`,
    /X\.vue:2:29: `label` has no type: give it one, as `label: string`/,
  ],
  [
    "a named slot given under `v-if`",
    `<script setup lang="ts">
import Fr from "./Fr.vue";
defineProps<{ on: boolean }>();
</script>
<template><Fr><template #head>H</template><template v-if="on" #foot>F</template></Fr></template>`,
    /X\.vue:5:43: a slot given under `v-if` makes the child's slots depend on the data: give the slot always, and put the `v-if` on an element or a `<template>` inside its content/,
  ],
  [
    "a named slot given under `v-else`",
    `<script setup lang="ts">
import Fr from "./Fr.vue";
defineProps<{ on: boolean }>();
</script>
<template><Fr>
  <template v-if="on" #head>H</template>
  <template v-else #foot>F</template>
</Fr></template>`,
    /X\.vue:6:3: a slot given under `v-if` makes/,
  ],
  [
    "slots given by `v-for`",
    `<script setup lang="ts">
import Fr from "./Fr.vue";
defineProps<{ names: ("head" | "foot")[] }>();
</script>
<template><Fr><template v-for="n in names" #[n]>F</template></Fr></template>`,
    /X\.vue:5:15: a slot given under `v-for` makes the child's slots depend on the data: give the slot always, and put the `v-for` on an element or a `<template>` inside its content/,
  ],
  [
    "`v-model` on an `<input>` whose `type` is bound",
    `<script setup lang="ts">
defineProps<{ t: string }>();
const v = defineModel<string>();
</script>
<template><div><input :type="t" v-model="v"></div></template>`,
    /X\.vue:5:23: `v-model` on an `<input>` whose `type` is bound, where Vue's server chooses as it renders whether to write `checked` or `value`: write a literal `type`, or one `<input>` for each type under `v-if`/,
  ],
  [
    "an `<option>` with no `value` under a `<select>` whose `v-model` is a number",
    `<script setup lang="ts">
const n = defineModel<number>({ required: true });
</script>
<template><div><select v-model="n"><option>1</option></select></div></template>`,
    /X\.vue:4:\d+: an `<option>` with no `value` under a `<select>` whose `v-model` is a number, which Vue's server compares with `null`: give the option a `value`, and the model a string type/,
  ],
  [
    "a `<select>` whose `v-model` is a number",
    `<script setup lang="ts">
const n = defineModel<number>({ required: true });
</script>
<template><div><select v-model="n"><option value="1">1</option></select></div></template>`,
    /X\.vue:4:\d+: `v-model` of a number compared with a value that is a string: give the model a string type and each option or control a string `value`, or bind `:checked` or `:selected`/,
  ],
  [
    "a string given to a child's prop of a union",
    `<script setup lang="ts">
import U from "./U.vue";
defineProps<{ s: string }>();
</script>
<template><U :k="s" /></template>`,
    /the prop is one of "a" \| "b", the members of `UK`, and the value given is a string that may be any other/,
  ],
  [
    "a literal outside a child's prop of a union",
    `<script setup lang="ts">
import U from "./U.vue";
</script>
<template><U k="z" /></template>`,
    /the prop is one of "a" \| "b", the members of `UK`, and the value given is "z"/,
  ],
  [
    "a string other than the prop's name given to a child's boolean prop",
    `<script setup lang="ts">
import B from "./B.vue";
</script>
<template><B flag="other" /></template>`,
    /X\.vue:4:\d+: the prop is a boolean, and the value given is a string/,
  ],
  [
    "the prop's camelCase name given to a child's boolean prop",
    `<script setup lang="ts">
import B from "./B.vue";
</script>
<template><B flag fooBar="fooBar" /></template>`,
    /X\.vue:4:26: the prop is an optional boolean, and the value given is a string/,
  ],
  [
    "a string bound to a child's boolean prop",
    `<script setup lang="ts">
import B from "./B.vue";
defineProps<{ s: string }>();
</script>
<template><B :flag="s" /></template>`,
    /X\.vue:5:\d+: the prop is a boolean, and the value given is a string/,
  ],
  [
    "a value of a wider union given to a child's prop of a union",
    `<script setup lang="ts">
import U from "./U.vue";
defineProps<{ k: "a" | "b" | "c" }>();
</script>
<template><U :o="k" k="a" /></template>`,
    /X\.vue:5:18: the prop is one of "a" \| "b", the members of `UO`, and the value given may be "c": narrow it to the members, by `===` or `!==` with a literal, by its truth or by `\|\|`, in `\?:`, `&&` or `v-if`, or pass a value typed as the union/,
  ],
  [
    "a wider union that may still be its other member given to a child's prop of a union",
    `<script setup lang="ts">
import { ref } from "vue";
import U from "./U.vue";
const props = defineProps<{ s?: "a" | "b" }>();
const t = ref<"a" | "b" | "">(props.s ?? "");
</script>
<template><U k="a" :o="t" /></template>`,
    /X\.vue:7:24: the prop is one of "a" \| "b", the members of `UO`, and the value given may be "": narrow it to the members/,
  ],
  [
    "a wider union narrowed by a test of another member given to a child's prop of a union",
    `<script setup lang="ts">
import { ref } from "vue";
import U from "./U.vue";
const props = defineProps<{ s?: "a" | "b" }>();
const t = ref<"a" | "b" | "">(props.s ?? "");
</script>
<template><U k="a" :o="t === 'a' ? undefined : t" /></template>`,
    /X\.vue:7:24: the prop is one of "a" \| "b", the members of `UO`, and the value given may be "": narrow it to the members/,
  ],
  [
    "a computed typed as a union whose body may give another member",
    `<script setup lang="ts">
import { computed, ref } from "vue";
import U from "./U.vue";
const props = defineProps<{ s?: "a" | "b" }>();
const t = ref<"a" | "b" | "">(props.s ?? "");
const shown = computed((): "a" | "b" | undefined => (t.value === "a" ? undefined : t.value));
</script>
<template><U k="a" :o="shown" /></template>`,
    /X\.vue:6:54: `shown`, a `computed`, is typed as one of "a" \| "b", and the compiler finds it may be "": it narrows a string by `===` or `!==` with a literal, by its truth and by `\|\|`, in `\?:`, `&&` and `v-if`; narrow the value by one of these, or give each branch a member of the union/,
  ],
  [
    "a computed typed as a union whose body is a string",
    `<script setup lang="ts">
import { computed } from "vue";
import U from "./U.vue";
const props = defineProps<{ s: string }>();
const shown = computed((): "a" | "b" => props.s as "a" | "b");
</script>
<template><U :k="shown" /></template>`,
    /X\.vue:5:41: `shown`, a `computed`, is typed as one of "a" \| "b", and the compiler finds it may be any string/,
  ],
  [
    "a ref typed as a union whose value may be another string",
    `<script setup lang="ts">
import { ref } from "vue";
import U from "./U.vue";
const props = defineProps<{ s: string }>();
const t = ref<"a" | "b">(props.s as "a" | "b");
</script>
<template><U :k="t" /></template>`,
    /X\.vue:5:26: `t`, a `ref`, is typed as one of "a" \| "b", and the compiler finds it may be any string/,
  ],
  [
    "a union compared with a literal outside it",
    `<script setup lang="ts">
defineProps<{ k: "a" | "b" }>();
</script>
<template><p v-if="k === 'z'">z</p></template>`,
    /"z" is not one of "a" \| "b", the members of `XK`, so the comparison is always false/,
  ],
  [
    "an optional union compared with a literal outside it",
    `<script setup lang="ts">
defineProps<{ k?: "a" | "b" }>();
</script>
<template><p v-if="k !== 'z'">z</p></template>`,
    /"z" is not one of "a" \| "b", the members of `XK`, so the comparison is always true/,
  ],
  [
    "a member of a ref other than `.value` read in setup",
    `<script setup lang="ts">
import { computed, ref } from "vue";
const r = ref<string[]>([]);
const n = computed(() => r.length);
</script>
<template><p>{{ n }}</p></template>`,
    /X\.vue:4:26: `r\.length` reads a member of the ref `r`, which in setup has only `\.value`: read `r\.value\.length`/,
  ],
  [
    "a union compared with a literal outside it in a computed's switch",
    `<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ k: "a" | "b" }>();
const label = computed(() => {
  switch (props.k) {
    case "a":
      return "A";
    case "c":
      return "C";
    default:
      return "B";
  }
});
</script>
<template><p>{{ label }}</p></template>`,
    /"c" is not one of "a" \| "b", the members of `XK`/,
  ],
  [
    "a union's default outside it",
    `<script setup lang="ts">
withDefaults(defineProps<{ k?: "a" | "b" }>(), { k: "z" });
</script>
<template><p>{{ k }}</p></template>`,
    /the default of `k`, "z", is not one of its members, "a" \| "b"/,
  ],
  [
    "a lookup table's value outside the union its type gives",
    `<script setup lang="ts">
type Tone = "calm" | "loud";
defineProps<{ k: Tone }>();
const NEXT: Record<Tone, Tone> = { calm: "loud", loud: "quiet" };
</script>
<template><p>{{ NEXT[k] }}</p></template>`,
    /X\.vue:4:56: `loud` of `NEXT` is one of "calm" \| "loud", the members of `Tone` its type gives its values, and "quiet" is not/,
  ],
  [
    "an object literal giving a free string to a field of a union",
    `<script setup lang="ts">
import S from "./S.vue";
defineProps<{ name: string }>();
</script>
<template><S :chip="{ size: name, label: name }" /></template>`,
    /`size` of `Chip` is one of "sm" \| "md", the members of `ChipSize`, and the value given is a string that may be any other: give one of them, or a value typed as the union/,
  ],
  [
    "an object literal giving a literal outside a field's union",
    `<script setup lang="ts">
import S from "./S.vue";
defineProps<{ name: string }>();
</script>
<template><S :chip="{ size: 'lg', label: name }" /></template>`,
    /`size` of `Chip` is one of "sm" \| "md", the members of `ChipSize`, and the value given is "lg"/,
  ],
  [
    "an object literal in a computed giving a wider union to a field of a union",
    `<script setup lang="ts">
import { computed } from "vue";
import S, { type Chip } from "./S.vue";
const props = defineProps<{ name: string; size: "sm" | "md" | "lg" }>();
const chip = computed<Chip>(() => ({ size: props.size, label: props.name }));
</script>
<template><S :chip="chip" /></template>`,
    /`size` of `Chip` is one of "sm" \| "md", the members of `ChipSize`, and the value given is one of "sm" \| "md" \| "lg": .* \(the template reads it as `chip` at components\/X\.vue:7:\d+\)/,
  ],
  [
    "a for loop that does not count",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (let i = 0; out.length < n; i++) out += "x";
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a `for` loop that is no counting loop, which the compiler cannot bound: count with `for \(let i = start; i < end; i\+\+\)` to an integer bound/,
  ],
  [
    "a counting loop whose step is not a whole number",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (let i = 0; i < n; i += 0.5) out += "x";
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a `for` loop that is no counting loop/,
  ],
  [
    "a counting loop that counts away from its bound",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (let i = 0; i < n; i--) out += "x";
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a `for` loop that is no counting loop/,
  ],
  [
    "a counting loop whose body assigns its counter",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += "x";
    i += 1;
  }
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /the body of a counting loop assigns `i`, which the loop's head alone counts/,
  ],
  [
    "a counting loop whose bound the body changes",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let end = n;
  let out = "";
  for (let i = 0; i < end; i++) {
    out += "x";
    end -= 1;
  }
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /the bound of a counting loop reads `end`, which the loop changes/,
  ],
  [
    "a counting loop to a Float bound",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (let i = 0; i < n / 2; i++) out += "x";
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a counting loop runs to an integer bound, and this one is a `Float`, which may hold a fraction or be `NaN`: round it with `Math\.floor\(\)`/,
  ],
  [
    "a counting loop from a fraction",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (let i = 0.5; i < n; i++) out += "x";
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a counting loop counts from an integer/,
  ],
  [
    "for await",
    `<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ words: string[] }>();
const joined = computed(async () => {
  let out = "";
  for await (const w of props.words) out += w;
  return out;
});
</script>
<template><i>{{ joined }}</i></template>`,
    /`for await`, which waits on promises a render cannot wait on/,
  ],
  [
    "a for…of loop over a name declared before it",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  let w = "";
  for (w of words) out += w;
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a `for…of` loop declares its item in its head, as `for \(const x of list\)`/,
  ],
  [
    "a for…of loop over a number",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (const w of n) out += w;
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`for…of` iterates a list of strings, numbers, booleans or objects, or a string by its characters, and this is a number/,
  ],
  [
    "a for…of loop over an optional list",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  for (const w of maybe) out += w;
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`for…of` iterates a list of strings, numbers, booleans or objects, or a string by its characters, and this is an optional list: narrow it first, or iterate `x \?\? \[\]`/,
  ],
  [
    "a loop that carries a list",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let kept = words;
  for (const w of words) kept = kept.filter((k) => k !== w);
  return kept.join();
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /the loop assigns `kept`, which holds a list: a loop carries a string, a number or a boolean from one item to the next/,
  ],
  [
    "a return of a list from inside a loop",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  for (const w of words) {
    if (w) return words;
  }
  return [];
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`return` inside a loop gives a list: a `return` inside a loop gives a string, a number or a boolean that is present/,
  ],
  [
    "returns of two types from inside a loop",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  for (const w of words) {
    if (w) return w;
    return w.length;
  }
  return "";
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /the loop's `return`s give a string and a number/,
  ],
  [
    "a let assigned a value of another type",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let label = "";
  if (n > 1) label = n;
  return String(label);
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`label` is declared as a string, and assigned a number here/,
  ],
  [
    "++ of a string",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let label = "a";
  label++;
  return label;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`\+\+` counts a number, and `label` holds a string/,
  ],
  [
    "a let that starts as undefined without a type",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let label = undefined;
  if (n > 1) label = "big";
  return label ?? "";
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`let label` starts as `undefined` with no type, which TypeScript leaves open: state the type it holds/,
  ],
  [
    "a let holding a function assigned again",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let f = (x: number) => x;
  if (n > 1) f = (x: number) => x * 2;
  return String(f(n));
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`let f` holds a function and is assigned again/,
  ],
  [
    "a const assigned again",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  const label = "";
  label = "x";
  return label;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`label` is a `const`, which JavaScript does not let a body assign/,
  ],
  [
    "a parameter assigned",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  n = n + 1;
  return String(n);
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`n` is assigned \(`=`\), and it is no `let` of this body/,
  ],
  [
    "an assignment inside an expression",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let k = 0;
  return String((k += 1) + k);
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /an assignment \(`\+=`\) inside an expression, whose value JavaScript then reads: write the assignment as a statement of its own/,
  ],
  [
    "an increment inside a call",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let k = 0;
  const s = String(k++);
  return s + k;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /an assignment \(`\+\+`\) inside an expression/,
  ],
  [
    "a destructuring assignment",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let a = 1;
  let b = 2;
  [a, b] = [b, a];
  return \`\${a}\${b}\`;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /an assignment \(`=`\) to a pattern/,
  ],
  [
    "a function of a body reading a let the body assigns",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let k = 1;
  const times = (x: number) => x * k;
  k = 2;
  return String(times(n));
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`times` reads `k`, a `let` the body assigns again: the server gives a function the values the body holds where the function is declared/,
  ],
  [
    "a labelled break",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let out = "";
  outer: for (const w of words) {
    for (const c of w) {
      if (c === "x") break outer;
      out += c;
    }
  }
  return out;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a function's body may not hold a labelled statement/,
  ],
  [
    "a let assigned again declared without a value",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let label: string;
  if (n > 1) label = "big";
  else label = "small";
  return label;
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /`label` is declared without a value, and JavaScript gives it `undefined` until it is assigned: give it a value where it is declared/,
  ],
  [
    "a do…while loop",
    `<script setup lang="ts">
const props = defineProps<{ words: string[]; n: number; maybe?: string[] }>();
function f(words: string[], n: number, maybe?: string[]): string {
  let k = 0;
  do k += 1; while (k < n);
  return String(k);
}
</script>
<template><i>{{ f(words, n, maybe) }}</i></template>`,
    /a function's body may not hold a `do…while` loop, which the compiler cannot bound/,
  ],
  [
    "a prop named with a leading `$`",
    `<script setup lang="ts">
defineProps<{ $label: string; text: string }>();
</script>
<template><p>{{ text }}</p></template>`,
    /the prop `\$label` starts with `\$`, which Vue keeps for its own properties: it leaves the prop out and renders it as an attribute; rename it without the `\$`/,
  ],
  [
    "a defineModel named with a leading `$`",
    `<script setup lang="ts">
const value = defineModel<string>("$value", { required: true });
</script>
<template><p>{{ value }}</p></template>`,
    /the prop `\$value` starts with `\$`/,
  ],
  [
    "a template written in pug",
    `<script setup lang="ts">
defineProps<{ tag: "b" | "i" }>();
</script>
<template lang="pug">component(:is="tag")</template>`,
    /X\.vue:4:1: the `<template>` is written in `pug`: write it in HTML, with no `lang` or `lang="html"`/,
  ],
  [
    "a template in another language than HTML",
    `<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template lang="HTML"><p>{{ label }}</p></template>`,
    /X\.vue:5:1: the `<template>` is written in `HTML`: write it in HTML/,
  ],
  [
    "a template read from another file",
    `<script setup lang="ts">
defineProps<{ tag: "b" | "i" }>();
</script>
<template src="./x.html"></template>`,
    /X\.vue:4:1: the `<template>` is read from `\.\/x\.html`: write the template inside the `<template>` block of the component/,
  ],
  [
    "a root input of a bound type with v-model",
    `<script setup lang="ts">
const text = defineModel<string>({ required: true });
const on = defineModel<boolean>("on", { required: true });
defineProps<{ kind: "text" | "checkbox" }>();
</script>
<template><input :type="kind" v-model="text"></template>`,
    /X\.vue:6:11: an `<input>` with `v-model` at the component's root/,
  ],
  [
    "a textarea given v-bind of an object",
    `<script setup lang="ts">
const text = defineModel<string>({ required: true });
const on = defineModel<boolean>("on", { required: true });
defineProps<{ kind: "text" | "checkbox" }>();
</script>
<template><div><textarea v-bind="{ rows: 2 }">hi</textarea></div></template>`,
    /X\.vue:6:16: a `<textarea>` given `v-bind` of an object renders as its content a `value` among the attributes it merges: bind each attribute by its name/,
  ],
  [
    "an input with v-model given an attribute named at run time",
    `<script setup lang="ts">
const text = defineModel<string>({ required: true });
const on = defineModel<boolean>("on", { required: true });
defineProps<{ kind: "text" | "checkbox" }>();
</script>
<template><div><input :[kind]="text" v-model="text"></div></template>`,
    /X\.vue:6:16: an `<input>` with `v-model` given an attribute named at run time reads its `type` and `value` from the attributes it merges: bind each attribute by its name/,
  ],
  [
    "a textarea given a custom directive",
    `<script setup lang="ts">
const text = defineModel<string>({ required: true });
const on = defineModel<boolean>("on", { required: true });
defineProps<{ kind: "text" | "checkbox" }>();
</script>
<template><div><textarea v-focus>hi</textarea></div></template>`,
    /X\.vue:6:16: a `<textarea>` given the custom directive `v-focus` renders as its content a `value` among the attributes the directive gives it: put the directive on another element/,
  ],
  [
    "a root element with no content given a custom directive",
    `<script setup lang="ts">
const vFocus = {};
</script>
<template><b v-focus /></template>`,
    /X\.vue:4:14: an element with no content given a custom directive renders as its content a `textContent` or `innerHTML` among the attributes passed to the component, when it is the root: wrap it in an element, such as a `<div>`, which then takes those attributes/,
  ],
  [
    "an element with no content given a custom directive and v-bind of an object",
    `<script setup lang="ts">
const vFocus = {};
defineProps<{ o: Record<string, string> }>();
</script>
<template><div><b v-bind="o" v-focus /></div></template>`,
    /X\.vue:5:27: an element with no content given a custom directive renders as its content a `textContent` or `innerHTML` among the attributes it merges: bind each attribute by its name, and write the content inside the element/,
  ],
  [
    "an element with no content given a custom directive and a bound textContent",
    `<script setup lang="ts">
const vFocus = {};
defineProps<{ t: string }>();
</script>
<template><div><b v-focus :textContent="t" /></div></template>`,
    /X\.vue:5:28: an element with no content given a custom directive renders as its content a `textContent` or `innerHTML` among the attributes it merges/,
  ],
  [
    "an element with no content given a custom directive and a bound innerHTML",
    `<script setup lang="ts">
const vFocus = {};
defineProps<{ t: string }>();
</script>
<template><div><b v-focus :innerHTML="t" /></div></template>`,
    /X\.vue:5:28: an element with no content given a custom directive renders as its content a `textContent` or `innerHTML` among the attributes it merges/,
  ],
  [
    "an element with no content given a custom directive and v-bind of an object spread",
    `<script setup lang="ts">
const vFocus = {};
defineProps<{ o: Record<string, string> }>();
</script>
<template><div><b v-focus v-bind="{ ...o }" /></div></template>`,
    /X\.vue:5:\d+: an element with no content given a custom directive renders as its content a `textContent` or `innerHTML` among the attributes it merges/,
  ],
  [
    "an element with no content given a custom directive and v-bind of a call",
    `<script setup lang="ts">
const vFocus = {};
const props = defineProps<{ t: string }>();
function pick() {
  return { title: props.t };
}
</script>
<template><div><b v-focus v-bind="pick()" /></div></template>`,
    /X\.vue:8:\d+: an element with no content given a custom directive renders as its content a `textContent` or `innerHTML` among the attributes it merges/,
  ],
  [
    "an element with no content given a custom directive and an attribute named at run time",
    `<script setup lang="ts">
const vFocus = {};
defineProps<{ k: string }>();
</script>
<template><div><b v-focus :[k]="k" /></div></template>`,
    /X\.vue:5:28: an element with no content given a custom directive renders as its content a `textContent` or `innerHTML` among the attributes it merges/,
  ],
];
