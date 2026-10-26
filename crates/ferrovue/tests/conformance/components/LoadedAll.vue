<script setup lang="ts">
import { loadArticle, loadHits, loadTotal, loadViews, type Query } from "./loaders";

const props = defineProps<{ term: string; page: number; exact?: boolean; query: Query }>();
const [hits, total] = await Promise.all([loadHits({ term: props.term, page: props.page, exact: props.exact, lang: null }), loadTotal(props.query)]);
const [, views] = await Promise.all([loadArticle(props.term), loadViews()]);
await Promise.all([loadTotal(props.query, 2)]);
</script>

<template>
  <section :title="term">
    <p v-for="(h, i) in hits" :key="i">{{ h }}</p>
    <footer>{{ total }} in all, {{ views }} views</footer>
  </section>
</template>
