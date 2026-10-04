<script setup lang="ts">
/* What the server shows for a location no route matches, or a book it does not stock. */
defineProps<{ path: string }>();
</script>

<template>
  <section class="not-found">
    <h1>Not found</h1>
    <p>Nothing lives at <code>{{ path }}</code>.</p>
    <RouterLink :to="{ name: 'home' }">Back to all books</RouterLink>
  </section>
</template>
