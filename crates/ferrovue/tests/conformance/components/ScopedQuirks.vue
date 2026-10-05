<script setup lang="ts">
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
