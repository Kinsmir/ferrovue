<script setup lang="ts">
import { computed } from "vue";

interface Post {
  title: string;
  tags: string[];
}

const props = defineProps<{ posts: Post[]; words: string[]; labels?: string[]; groups: Record<string, string[]>; user?: { langs: string[] }; sep: string }>();

const titled = computed(() => props.posts.flatMap((p) => [p.title, ...p.tags]));
const tagged = computed(() => props.posts.flatMap((p) => p.tags.filter((t) => t !== props.sep)));
const grouped = computed(() => Object.entries(props.groups).flatMap(([k, list]) => list.filter((t) => t !== k)));
const kept = computed(() => {
  const all = props.words.filter((w) => w !== props.sep);
  return all.slice(0, 2);
});
const sorted = computed(() => {
  const all = props.words.toSorted();
  const some = all.filter((w) => w.length > 1);
  return some.slice(-2);
});
const first = computed(() => props.words.find((w) => w.startsWith(props.sep)));
const last = computed(() => props.words.map((w) => w.trim()).at(-1));
const long = computed(() => props.labels?.filter((l) => l.length > 1));
</script>

<template>
  <p>{{ titled.join("/") }}|{{ tagged.join() }}|{{ grouped.join("+") }}|{{ kept.join() }}|{{ sorted.join() }}|{{ first ?? "-" }}|{{ last ?? "-" }}</p>
  <p>{{ long?.join() ?? "-" }}|{{ (labels ?? ["none"]).join("-") }}|{{ user?.langs.find((l) => l.startsWith("r")) ?? "-" }}|{{ posts.flatMap((p) => p.tags).length }}</p>
  <ul>
    <li v-for="(t, i) in titled" :key="i">{{ t }}</li>
  </ul>
  <ul>
    <li v-for="w in labels ?? ['first', 'second']" :key="w">{{ w }}</li>
  </ul>
</template>
