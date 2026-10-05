<script setup lang="ts">
defineProps<{ user: string }>();
</script>

<template>
  <div id="app">
    <nav><RouterLink to="/">home</RouterLink> <RouterLink :to="'/users/' + user">{{ user }}</RouterLink></nav>
    <main><RouterView /></main>
  </div>
</template>
