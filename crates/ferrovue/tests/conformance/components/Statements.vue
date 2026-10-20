<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

interface Author {
  name: string;
  title?: string;
  posts: number;
}

const props = defineProps<{ author?: Author; size: "sm" | "md" | "lg"; score: number; ratio?: Float; note?: string; words: string[]; authors: Author[]; lead: Author }>();

const greeting = computed(() => {
  if (!props.author) return "Anonymous";
  const name = props.author.name.trim();
  if (name === "") return "Unnamed";
  const title = props.author.title;
  if (title) return `${title} ${name}`;
  return name;
});

const label = computed(() => {
  switch (props.size) {
    case "sm":
      return "small";
    case "md":
    case "lg": {
      const upper = props.size.toUpperCase();
      return `large ${upper}`;
    }
    default:
      return "unknown";
  }
});

const grade = computed(() => {
  const s = props.score;
  if (s >= 90) return "A";
  else if (s >= 75) return "B";
  else if (s >= 50) return "C";
  return "F";
});

const level = computed(() => {
  switch (props.score) {
    case 0:
      break;
    case 100:
      return "perfect";
  }
  return props.score > 50 ? "pass" : "fail";
});

const titled = computed(() => {
  if (!props.author || !props.author.title) return "untitled";
  return props.author.title.toUpperCase();
});

const posts = computed(() => {
  const a = props.author;
  if (a && a.posts > 0) return `${a.posts} posts`;
  return "no posts";
});

const card = computed(() => {
  if (!props.author) return "-";
  const { name, posts: count } = props.author;
  return `${name}:${count}`;
});

const noteLength = computed(() => {
  const n = props.note;
  if (n === undefined) return -1;
  let length = n.length;
  return length;
});

const percent = computed(() => {
  const r = props.ratio ?? 0;
  if (r <= 0) return "0%";
  return `${(r * 100).toFixed(1)}%`;
});

const joined = computed(() => {
  const long = props.words.filter((w) => w.length > 1);
  const text = long.join("+");
  if (text === "") return "none";
  return text.toUpperCase();
});

const firstTwo = computed(() => {
  const sorted = props.words.toSorted();
  return sorted.slice(0, 2);
});

const firstLong = computed(() => {
  const long = props.words.filter((w) => w.length > 4);
  return long[0];
});

const shouted = computed(() =>
  props.words.map((w) => {
    const trimmed = w.trim();
    if (trimmed.length === 0) return "-";
    return trimmed.toUpperCase();
  }),
);

const kept = computed(() =>
  props.words.filter((w) => {
    const n = w.length;
    return n > 2 && n < 10;
  }),
);

const letters = computed(() =>
  props.words.reduce((acc, w) => {
    const n = w.length;
    if (n > 3) return acc + n;
    return acc;
  }, 0),
);

const byLength = computed(() =>
  props.words.toSorted((a, b) => {
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    return 0;
  }),
);

const busiest = computed(() => {
  const active = props.authors.filter((a) => a.posts > 0);
  return active[0];
});

const top = computed(() => {
  const active = props.authors.filter((a) => a.posts > 1);
  const first = active[0];
  if (!first) return "nobody";
  return first.name;
});

const named = computed(() => {
  const first = props.authors[0];
  if (first === undefined) return props.author;
  return first;
});

const pick = computed(() => {
  const loud = props.size.toUpperCase();
  if (loud === "SM" || !props.author) return props.lead;
  return props.author;
});
</script>

<template>
  <article :class="label">
    <h2>{{ greeting }} ({{ titled }})</h2>
    <p>{{ label }}|{{ grade }}|{{ level }}|{{ posts }}|{{ card }}|{{ noteLength }}|{{ percent }}</p>
    <p>{{ joined }}|{{ firstTwo.join(",") }}|{{ firstLong ?? "none" }}|{{ letters }}</p>
    <ul>
      <li v-for="(w, i) in shouted" :key="i">{{ w }}</li>
    </ul>
    <p>{{ kept.length }}|{{ byLength.join(" ") }}</p>
    <p>{{ busiest?.name ?? "-" }}|{{ top }}|{{ named?.name ?? "-" }}|{{ pick.name }}</p>
  </article>
</template>
