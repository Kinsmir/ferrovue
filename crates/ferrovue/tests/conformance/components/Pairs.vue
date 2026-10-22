<script setup lang="ts">
import { computed } from "vue";

interface Seat {
  row: string;
  n: number;
}

const props = defineProps<{ scores: Record<string, number>; labels: Record<string, string>; seats: Record<string, Seat>; tags: Record<string, string[]>; word: string }>();

const ranked = computed(() => Object.entries(props.scores).toSorted((a, b) => b[1] - a[1]));
const named = computed(() => Object.entries(props.labels).filter(([k, v]) => k !== props.word && v !== ""));
const best = computed(() => {
  const top = ranked.value.at(0);
  if (!top) return "none";
  return `${top[0]}:${top[1]}`;
});
</script>

<template>
  <p>{{ Object.entries(scores).map(([k, v]) => `${k}=${v}`).join(";") }}|{{ Object.entries(scores).length }}|{{ Object.entries(scores).filter(([, n]) => n > 1).length }}|{{ Object.entries(scores).reduce((acc, [, v]) => acc + v, 0) }}|{{ Object.entries(scores).some(([k]) => k === word) }}|{{ Object.entries(scores).every(([, n]) => n >= 0) }}|{{ Object.entries(scores).findIndex(([k]) => k === word) }}</p>
  <p>{{ Object.entries(labels).find(([k]) => k.startsWith(word))?.[1] ?? "none" }}|{{ Object.entries(labels).findLast(([, v]) => v.length > 1)?.[0] ?? "-" }}|{{ Object.entries(labels).map((pair) => pair[0] + pair.length + pair[1]).join() }}|{{ Object.entries(labels).at(-1)?.[0] }}|{{ Object.entries(labels).slice(1).map(([k]) => k).join() }}|{{ Object.entries(labels).toReversed().map(([, v]) => v).join() }}</p>
  <p>{{ best }}|{{ ranked.map(([k]) => k).join() }}|{{ named.length }}|{{ named.map(([k, v]) => k + v).join("+") }}|{{ Object.entries(seats).map(([k, { row, n }]) => k).join() }}|{{ Object.entries(seats).map(([k, s]) => s.row + s.n).join() }}</p>
  <ul>
    <li v-for="([k, v], i) in Object.entries(labels).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))" :key="k">{{ i }}. {{ k }}: {{ v }}</li>
  </ul>
  <ul>
    <li v-for="[k, v] in ranked" :key="k" :title="k">{{ v }}</li>
  </ul>
  <ul>
    <li v-for="[name, list] in Object.entries(tags).filter(([, l]) => l.length > 0)" :key="name">{{ name }}: {{ list.join(", ") }} ({{ list.length }})</li>
  </ul>
</template>
