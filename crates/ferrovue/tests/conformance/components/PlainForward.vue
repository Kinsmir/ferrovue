<script setup lang="ts">
/* No scoped styles, its root a `:slotted()` component, its own slot forwarded into that one's: the
 * content is given the slot scope id after one more space. */
import ScopedCard from "./ScopedCard.vue";
</script>

<template>
  <ScopedCard tone="forwarded"><slot /></ScopedCard>
</template>
