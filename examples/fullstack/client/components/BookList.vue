<script setup lang="ts">
import type { Book } from "./types";

defineProps<{ books: Book[] }>();
</script>

<template>
  <section class="books">
    <h1>All books</h1>
    <ul v-if="books.length">
      <li v-for="book in books" :key="book.id">
        <RouterLink :to="{ name: 'book', params: { id: book.id } }">{{ book.title }}</RouterLink>
        <span class="by">by {{ book.author }} ({{ book.year }})</span>
        <slot name="actions" :id="book.id" :title="book.title" />
      </li>
    </ul>
    <p v-else>The shelves are empty.</p>
  </section>
</template>
