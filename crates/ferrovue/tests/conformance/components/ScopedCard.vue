<script setup lang="ts">
/* `:slotted()` styles: every outlet passes the slot scope id `data-v-…-s`, which the content writes
 * onto its elements and hands its components' roots — a scoped slot and fallbacks included. */
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
