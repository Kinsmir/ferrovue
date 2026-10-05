<script setup lang="ts">
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
