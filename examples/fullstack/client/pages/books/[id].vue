<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useHead, useSeoMeta } from "@unhead/vue";
import type { Book } from "../../components/types";

const props = defineProps<{ book: Book }>();
const route = useRoute();
const permalink = computed(() => `/books/${route.params.id ?? ""}`);
const summary = computed(() => `${props.book.title}, by ${props.book.author} (${props.book.year})`);
useHead({
  title: () => props.book.title,
  meta: [{ name: "description", content: summary }],
  link: [{ rel: "canonical", href: permalink }],
});
useSeoMeta({ ogTitle: () => props.book.title, ogDescription: summary, ogType: "book", bookReleaseDate: String(props.book.year) });
</script>

<template>
  <article class="book" :data-id="route.params.id">
    <h1>{{ book.title }}</h1>
    <p class="by">{{ book.author }}, {{ book.year }}</p>
    <slot name="actions" />
    <p class="permalink">Permalink: <code>{{ permalink }}</code></p>
    <section class="reviews">
      <h2>Reviews</h2>
      <slot name="reviews"><p>Loading reviews…</p></slot>
    </section>
  </article>
</template>
