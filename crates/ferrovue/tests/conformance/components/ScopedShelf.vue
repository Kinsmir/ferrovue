<script setup lang="ts">
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
