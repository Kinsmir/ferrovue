<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

interface Row {
  name: string;
  n: number;
  note?: string;
}

const props = defineProps<{ words: string[]; nums: number[]; prices: Float[]; rows: Row[]; tags: (string | null)[]; i: number; f: Float; word: string; maybe?: string[] }>();

const first = computed(() => props.words[0]);
const last = computed(() => props.words.at(-1) ?? "none");
const chosen = computed(() => props.rows.filter((r) => r.n > 0)[props.i]);
const tail = computed(() => props.words.map((w) => w.trim()).at(-1));
</script>

<template>
  <p>{{ words[0] }}|{{ words[i] }}|{{ words[-1] }}|{{ words[100] }}|{{ nums[i] }}|{{ prices[i] }}|{{ words[i] ?? "none" }}|{{ tags[i] }}|{{ tags[0] ?? "null" }}</p>
  <p>{{ words.at(i) }}|{{ words.at(-1) }}|{{ words.at(-i) }}|{{ words.at(f) }}|{{ nums.at(f) }}|{{ prices.at(-1) }}|{{ tags.at(-1) }}|{{ [1, 2, 3].at(i) }}</p>
  <p v-if="rows[0]">{{ rows[0].name }}:{{ rows[0].n }}</p>
  <p v-else>no rows</p>
  <p v-if="words[1] !== undefined">second {{ words[1] }}</p>
  <p>{{ rows[i]?.name }}|{{ rows.at(-1)?.note }}|{{ rows[i]?.note?.length }}|{{ maybe?.[i] }}|{{ maybe?.at(-1) }}|{{ maybe?.[0] ?? "absent" }}</p>
  <p>{{ words.filter((w) => w !== word)[0] }}|{{ words.map((w) => w.trim()).at(i) }}|{{ nums.slice(1)[i] }}|{{ nums.slice(1).at(-1) }}|{{ first }}|{{ last }}|{{ chosen?.name }}|{{ tail }}</p>
  <p>{{ words.indexOf(word) }}|{{ words.lastIndexOf(word) }}|{{ nums.indexOf(i) }}|{{ nums.lastIndexOf(i) }}|{{ nums.indexOf(f) }}|{{ prices.indexOf(f) }}|{{ prices.lastIndexOf(f) }}|{{ prices.indexOf(Number("x")) }}|{{ prices.includes(Number("x")) }}|{{ prices.indexOf(-0) }}|{{ prices.lastIndexOf(0) }}|{{ prices.map((p) => p * 2).lastIndexOf(f) }}|{{ words.filter((w) => w.length > 0).lastIndexOf(word) }}</p>
  <p>{{ words.findLast((w) => w.length > 1) }}|{{ words.findLastIndex((w) => w === word) }}|{{ rows.findLast((r) => r.n > 1)?.name }}|{{ nums.findLastIndex((n, k) => n > k) }}|{{ words.findLast(Boolean) }}|{{ nums.findLastIndex(Boolean) }}|{{ rows.filter((r) => r.n !== 0).findLast(({ n }) => n < 0)?.name ?? "none" }}|{{ words.findLast((w, k) => k > 0 && w !== word) }}</p>
  <p>{{ words.concat(maybe ?? []).join("/") }}|{{ nums.concat([7, 8], nums).length }}|{{ words.concat([word]).at(-1) }}|{{ rows.concat(rows).findLastIndex((r) => r.n === i) }}|{{ prices.concat([]).indexOf(f) }}|{{ prices.concat(nums).join() }}|{{ nums.concat(prices, [2]).at(-2) }}</p>
  <ul>
    <li v-for="(r, k) in rows.concat(rows.slice(1))" :key="k">{{ r.name }}</li>
  </ul>
  <ul>
    <li v-for="(v, k) in nums" :key="k">{{ nums.filter((n) => n > 1).includes(v) }}:{{ nums.lastIndexOf(v) }}:{{ prices.map((p) => p * 2).includes(v) }}</li>
  </ul>
</template>
