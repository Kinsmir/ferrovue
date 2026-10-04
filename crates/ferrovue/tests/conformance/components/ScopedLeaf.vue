<script setup lang="ts">
/* `<style scoped>` on a single root chosen by `v-if`: each branch takes the ids its parent hands it. */
defineProps<{ label?: string }>();
</script>

<template>
  <span v-if="label" class="leaf" :title="label">{{ label }}</span>
  <em v-else>nothing</em>
</template>

<style scoped>
.leaf {
  font-weight: bold;
}
</style>
