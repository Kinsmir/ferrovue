<script setup lang="ts">
/* A scoped component whose root is another component: the ids it inherits and its own both go to
 * the child's root. */
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
