<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import type { Book } from "./types";

defineProps<{ book: Book }>();
const route = useRoute();
const permalink = computed(() => `/books/${route.params.id ?? ""}`);
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
