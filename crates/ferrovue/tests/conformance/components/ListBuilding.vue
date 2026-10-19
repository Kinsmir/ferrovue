<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

interface Row {
  name: string;
  n: number;
  tag?: string;
}

const props = defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; flags: boolean[]; word: string }>();

const total = computed(() => props.rows.reduce((t, r) => t + r.n, 0));
const byName = computed(() => props.rows.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
const everything = computed(() => [...props.nums, ...props.prices]);
const top = computed(() => Math.max(...props.nums));
const flipped = computed(() => props.prices.map((p) => -p));
</script>

<template>
  <p>{{ nums.reduce((a, x) => a + x, 0) }}|{{ prices.reduce((a, x) => a + x, 0) }}|{{ nums.reduce((a, x, i) => a + x * i, 0) }}|{{ nums.reduce((a, x) => a * x, 1) }}|{{ 1 / nums.reduce((a, x) => a * -x, 0) }}|{{ 1 / prices.reduce((a, x) => a + x, -0) }}|{{ nums.reduce((a, x) => (x > a ? x : a), 0) }}|{{ total }}</p>
  <p>{{ words.reduce((acc, w) => acc + w, "") }}|{{ words.reduceRight((acc, w) => acc + w + ",", "") }}|{{ words.reduce((acc, w, i) => acc + i + w, ">") }}|{{ words.reduce((acc, w) => w + acc, word) }}|{{ words.reduce((n, w) => n + w.length, 0) }}|{{ nums.reduceRight((acc, x, i) => acc + x + "@" + i + ";", "") }}|{{ flags.reduce((all, f) => all && f, true) }}|{{ flags.reduce((any, f) => any || f, false) }}|{{ rows.reduce((s, r) => s + (r.tag ?? "-"), "") }}</p>
  <p>{{ words.toReversed().join() }}|{{ nums.toReversed().join() }}|{{ rows.toReversed().map((r) => r.name).join() }}|{{ [...words].reverse().join() }}|{{ words.filter((w) => w !== word).toReversed().join() }}|{{ nums.toReversed().reduce((a, x) => a + x, "") }}</p>
  <p>{{ nums.toSorted().join() }}|{{ prices.toSorted().join() }}|{{ prices.map((p, k) => (k % 2 === 0 ? p : Number(word))).toSorted().join() }}|{{ prices.map((p) => 1 / p).toSorted().join() }}|{{ words.toSorted().join() }}|{{ flags.toSorted().join() }}|{{ [...nums].sort().join() }}|{{ nums.map((x) => -x).toSorted().join() }}</p>
  <p>{{ nums.toSorted((a, b) => a - b).join() }}|{{ nums.toSorted((a, b) => b - a).join() }}|{{ rows.toSorted((a, b) => a.n - b.n).map((r) => r.name).join() }}|{{ rows.toSorted((a, b) => b.n - a.n).map((r) => r.name).join() }}|{{ byName.map((r) => r.name).join() }}|{{ words.toSorted((a, b) => (a > b ? -1 : a < b ? 1 : 0)).join() }}|{{ [...rows].sort((x, y) => x.n - y.n).map((r) => r.name + r.n).join() }}|{{ rows.toSorted((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0)).map((r) => r.name).join() }}|{{ words.toSorted((a, b) => 0).join() }}|{{ nums.toSorted(undefined).join() }}</p>
  <p>{{ [...words, word, ...words].join("|") }}|{{ everything.join() }}|{{ [...nums, 0.5].join() }}|{{ [...[], ...nums].length }}|{{ [word, ...words].length }}|{{ [...words].includes(word) }}|{{ [...nums, ...nums].toSorted().join() }}</p>
  <p>{{ Math.max(...nums) }}|{{ Math.min(...nums) }}|{{ Math.max(...prices) }}|{{ Math.min(...prices) }}|{{ Math.max(...nums, 0) }}|{{ Math.min(...prices.map((p, k) => (k % 2 === 0 ? p : Number(word)))) }}|{{ 1 / Math.max(...prices) }}|{{ 1 / Math.min(...prices) }}|{{ Math.max(...[]) }}|{{ Math.min(0, ...nums) }}|{{ top }}</p>
  <p>{{ 1 / Math.max(...flipped) }}|{{ 1 / Math.min(...flipped) }}|{{ 1 / Math.max(...flipped, 0) }}|{{ 1 / Math.min(0, ...flipped) }}|{{ flipped.toSorted().map((x) => 1 / x).join() }}|{{ 1 / flipped.reduce((a, x) => a + x, -0) }}|{{ 1 / flipped.reduce((a, x) => a + x, 0) }}|{{ [...flipped, ...prices].toSorted().map((x) => 1 / x).join() }}|{{ flipped.toReversed().map((x) => 1 / x).join() }}</p>
  <ul>
    <li v-for="(r, k) in [...rows, ...rows.toReversed()]" :key="k">{{ r.name }}</li>
  </ul>
</template>
