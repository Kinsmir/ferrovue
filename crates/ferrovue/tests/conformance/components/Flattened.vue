<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

interface Post {
  title: string;
  tags: string[];
  scores: number[];
}

const props = defineProps<{ posts: Post[]; matrix: number[][]; deep: number[][][]; prices: Float[][]; words: string[]; groups: Record<string, string[]>; sep: string }>();

const tags = computed(() => props.posts.flatMap((p) => p.tags));
const cells = computed(() => props.deep.flat());
</script>

<template>
  <p>{{ matrix.flat().join(sep) }}|{{ matrix.flat().length }}|{{ matrix.flat(0).length }}|{{ deep.flat().length }}|{{ deep.flat(2).join() }}|{{ deep.flat(Infinity).reduce((a, x) => a + x, 0) }}|{{ prices.flat().map((x) => 1 / x).join() }}|{{ words.flat().join() }}|{{ [...words, sep].flat().length }}</p>
  <p>{{ tags.join() }}|{{ tags.length }}|{{ posts.flatMap((p) => [p.title, ...p.tags]).join("/") }}|{{ posts.flatMap((p, i) => p.scores.map((s) => s * i)).join() }}|{{ posts.flatMap((p) => p.title).join() }}|{{ posts.flatMap((p) => p.scores.length).join() }}|{{ words.flatMap((w) => w.split("")).join("-") }}|{{ words.flatMap((w) => (w === sep ? [] : [w, w])).join() }}</p>
  <p>{{ Object.values(groups).flat().join() }}|{{ Object.values(groups).length }}|{{ Object.entries(groups).flatMap(([k, list]) => list.map((t) => k + t)).join() }}|{{ cells.length }}|{{ cells.flat().filter((n) => n > 1).join() }}</p>
  <ul>
    <li v-for="(t, i) in posts.flatMap((p) => p.tags).filter((t) => t !== sep)" :key="i">{{ t }}</li>
  </ul>
  <ul>
    <li v-for="(row, i) in Object.values(groups)" :key="i">{{ row.join("+") }}</li>
  </ul>
</template>
