<script setup lang="ts">
import AddToBasket from "./AddToBasket.vue";
import type { Book } from "./types";

defineProps<{ book: Book; note: string }>();
</script>

<template>
  <article class="pick" :data-id="book.id">
    <h2>{{ book.title }}</h2>
    <p class="by">by {{ book.author }} ({{ book.year }})</p>
    <blockquote>{{ note }}</blockquote>
    <AddToBasket :id="book.id" :title="book.title" />
  </article>
</template>
