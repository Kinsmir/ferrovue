<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

interface Person {
  name: string;
  title?: string;
  city: string | null;
}

const props = defineProps<{
  person: Person;
  tags: (string | null)[];
  counts: (number | null)[];
  ratios: Float[];
  people: (Person | null)[];
  words: string[];
  flags: boolean[];
  urgent: boolean;
}>();
const byline = computed(() => [props.person.name, props.person.title, props.person.city].filter(Boolean).join(" · "));
</script>

<template>
  <article>
    <h1>{{ byline }}</h1>
    <p>{{ [person.title, urgent ? "urgent" : undefined, "draft", null].filter(Boolean).join(", ") }}</p>
    <ul><li v-for="(t, i) in tags.filter(Boolean)" :data-i="i">{{ t }}</li></ul>
    <p>{{ counts.filter(Boolean).join("+") }}|{{ ratios.filter(Boolean).join(" ") }}|{{ people.filter(Boolean).length }}</p>
    <p>{{ words.filter(Boolean).length }}|{{ words.some(Boolean) }}|{{ words.every(Boolean) }}|{{ words.findIndex(Boolean) }}|{{ words.find(Boolean) ?? "none" }}</p>
    <p>{{ flags.filter(Boolean).length }}/{{ flags.length }}|{{ words.map(Boolean).join() }}|{{ Boolean(person.title) }}|{{ Boolean(person.city) }}</p>
  </article>
</template>
