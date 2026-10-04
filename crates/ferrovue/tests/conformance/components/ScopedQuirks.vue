<script setup lang="ts">
/* Where Vue's server render gives other ids than its client render, ferrovue writes the server's:
 * a `:slotted()` component's slot fallback, which only the client gives the slot scope id, and a
 * root with `inheritAttrs: false`, which only the server denies the id of its parent's parent. */
import PlainForward from "./PlainForward.vue";
import ScopedCard from "./ScopedCard.vue";
import ScopedRoot from "./ScopedRoot.vue";
import ScopedShelf from "./ScopedShelf.vue";

defineProps<{ note?: string }>();
</script>

<template>
  <div class="quirks">
    <ScopedRoot :label="note" />
    <ScopedCard />
    <ScopedShelf />
    <PlainForward />
  </div>
</template>

<style scoped>
.quirks {
  gap: 1em;
}
</style>
