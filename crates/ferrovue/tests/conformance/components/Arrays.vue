<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";
import Chips from "./Chips.vue";

interface Item {
  id: number;
  label: string;
  note?: string;
  tags: string[];
  price: Float;
}

const props = defineProps<{ items: Item[]; words: string[]; nums: number[]; min: number; query: string }>();
const cheap = computed(() => props.items.filter((i) => i.price < 10));
const labels = computed(() => props.items.map((i) => i.label.toUpperCase()));
const found = computed(() => props.words.find((w) => w.length > 3));
const shown = computed(() => (props.min > 2 ? props.words.filter((w) => w.length > 1) : props.words));
</script>

<template>
  <section>
    <ul><li v-for="(item, i) in items.filter((x) => x.id >= min)" :data-i="i">{{ item.label }}<i v-if="item.note">{{ item.note }}</i></li></ul>
    <p>{{ words.map((w) => w.trim()).filter((w) => w).join(", ") }}|{{ words.map((w, i) => `${i}:${w.length}`).join(" ") }}</p>
    <p>{{ nums.filter((n) => n % 2 === 0).map((n) => n * 10).join("-") }}|{{ nums.map((n) => n / 4).join() }}|{{ nums.some((n) => n > min) }}|{{ nums.every((n) => n > 0) }}</p>
    <p>{{ items.find((i) => i.label.includes(query))?.label ?? "no match" }}|{{ items.findIndex((i) => i.note !== undefined && i.note.length > 3) }}|{{ words.find((w) => w.startsWith(query)) ?? "-" }}</p>
    <p>{{ cheap.length }}|{{ labels.slice(1).join(",") }}|{{ labels.slice(-2, -1).join() }}|{{ nums.slice(min).length }}|{{ words.filter((w, i) => i % 2 === 0 && w !== query).length }}</p>
    <ol><li v-for="{ id, tags } in cheap" :data-id="id">{{ tags.filter((t) => t !== query).length }}/{{ tags.length }}</li></ol>
    <p>{{ items.map((i) => i.tags.filter((t) => i.label.includes(t)).length).join() }}|{{ items.map((i) => i.note ?? "–").join(" ") }}</p>
    <p>{{ labels.includes(query.toUpperCase()) }}|{{ items.map((i) => i.price).join(" ") }}|{{ items.some(({ note }) => note === query) }}|{{ words.map((w) => w.length).includes(min) }}</p>
    <p>{{ JSON.stringify(words) }}|{{ JSON.stringify(nums.filter((n) => n > 0)) }}|{{ JSON.stringify(query) }}|{{ JSON.stringify(items.map((i) => i.price)) }}</p>
    <p>{{ found ?? "none" }}|{{ shown.join("/") }}|<i v-for="w in (min > 0 ? words.slice(0, 2) : words)">{{ w }}</i>|{{ (query ? words.find((w) => w.includes(query)) : undefined) ?? "?" }}</p>
    <Chips :chips="words.filter((w) => w !== query)" :counts="nums.map((n) => n + 1)" /><Chips v-for="item in items.filter((i) => i.tags.length > 1)" :chips="item.tags.slice(1)" />
  </section>
</template>
