<script setup lang="ts">
import { computed } from "vue";
import TileCard from "./TileCard.vue";
import type { Tile } from "../types/tiles";

interface Line {
  text: string;
  size: number;
  mark?: string;
  tag: string | null;
}

interface Sheet {
  head: Line;
  lines: Line[];
  names: string[];
}

const props = defineProps<{ title: string; words: string[]; spare?: Tile; size: number }>();

const fallback: Line = { text: props.title, size: props.size, tag: null };

function line(text: string): Line {
  return { text: text.toUpperCase(), size: text.length, tag: text === "" ? null : text, mark: text.length > 3 ? "long" : undefined };
}

function lines(): Line[] {
  return props.words.map((w) => line(w));
}

const sheet = computed((): Sheet => ({ head: line(props.title), lines: lines(), names: props.words }));

const listed = computed((): Line[] => [fallback, line("x"), { text: "lit", size: 0, tag: "t" }]);

const kept = computed((): Tile => props.spare ?? { title: "spare", count: 0, owner: null, tags: [] });

const label = computed(() => {
  const { text, size } = line(props.title);
  return `${text}:${size}`;
});

function pick(): string {
  const l: Line | undefined = props.size > 0 ? line(props.title) : undefined;
  if (!l) return "none";
  return l.mark ?? l.text;
}
</script>

<template>
  <section>
    <p>{{ fallback.text }}|{{ fallback.tag ?? "null" }}</p>
    <p v-for="(l, i) in sheet.lines" :key="i" :data-mark="l.mark">{{ i }}:{{ l.text }}/{{ l.size }}/{{ l.tag ?? "null" }}</p>
    <p>{{ sheet.head.text }}|{{ sheet.names.join("+") }}|{{ listed.length }}|{{ listed.map((l) => l.text).join(",") }}</p>
    <p v-for="l in lines()" :key="l.text">{{ l.text }}</p>
    <p>{{ line(title).mark ?? "short" }}|{{ label }}|{{ pick() }}</p>
    <TileCard :tile="kept" />
  </section>
</template>
