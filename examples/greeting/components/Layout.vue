<script setup lang="ts">
/* The page around every route: a navigation bar that knows where the reader is. */
defineProps<{ user: string }>();
</script>

<template>
  <div id="app">
    <nav><RouterLink to="/">home</RouterLink> <RouterLink :to="'/users/' + user">{{ user }}</RouterLink></nav>
    <main><RouterView /></main>
  </div>
</template>
