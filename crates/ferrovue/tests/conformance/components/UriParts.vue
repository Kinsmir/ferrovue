<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ q: string; path: string; page: number; tag?: string; tags: string[] }>();
const search = computed(() => `/search?q=${encodeURIComponent(props.q)}&page=${encodeURIComponent(props.page)}`);
const kept = computed(() => encodeURI(props.path.trim()));
</script>

<template>
  <nav :data-q="encodeURIComponent(q)">
    <a :href="search">{{ search }}</a>
    <a :href="kept">{{ kept }}|{{ encodeURI(path) }}|{{ encodeURI(`${path}#${q}`) }}</a>
    <p>{{ encodeURIComponent(q) }}|{{ encodeURIComponent(q.toUpperCase()) }}|{{ encodeURIComponent(tag) }}|{{ encodeURIComponent(tag ?? "") }}</p>
    <p>{{ encodeURIComponent(tags) }}|{{ encodeURI(String(tags)) }}|{{ encodeURIComponent(page * -1.5) }}|{{ encodeURIComponent(page > 2) }}</p>
    <ul><li v-for="t in tags" :key="t"><a :href="`/tags/${encodeURIComponent(t)}`">{{ encodeURIComponent(t).length }}</a></li></ul>
  </nav>
</template>
