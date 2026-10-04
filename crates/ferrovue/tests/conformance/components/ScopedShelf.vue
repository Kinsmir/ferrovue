<script setup lang="ts">
/* `:slotted()` styles, forwarding its slot into another `:slotted()` component's: the content is
 * given both slot scope ids, this one's first. */
import ScopedCard from "./ScopedCard.vue";
</script>

<template>
  <section class="shelf">
    <ScopedCard><slot>shelf fallback <i>here</i></slot></ScopedCard>
  </section>
</template>

<style scoped>
.shelf :slotted(i) {
  color: gray;
}
</style>
