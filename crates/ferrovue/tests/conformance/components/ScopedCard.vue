<script setup lang="ts">
defineProps<{ tone?: string }>();
</script>

<template>
  <article class="card" :class="tone">
    <header><slot name="title">Untitled</slot></header>
    <div class="body"><slot><p class="empty">empty</p></slot></div>
    <footer><slot name="footer" :count="3" /></footer>
  </article>
</template>

<style scoped>
.card :slotted(p) {
  margin: 0;
}
</style>
