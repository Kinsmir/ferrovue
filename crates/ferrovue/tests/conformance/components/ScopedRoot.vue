<script setup lang="ts">
import QuietLeaf from "./QuietLeaf.vue";
import ScopedLeaf from "./ScopedLeaf.vue";

defineProps<{ label?: string }>();
</script>

<template>
  <ScopedLeaf v-if="label" :label="label" />
  <QuietLeaf v-else note="quiet" />
</template>

<style scoped>
span {
  color: teal;
}
</style>
