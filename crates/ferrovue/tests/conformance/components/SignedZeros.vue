<script setup lang="ts">
const { n, m } = defineProps<{ n: number; m: number }>();
</script>

<template>
  <p>{{ 1 / Math.max(n * 0, -1) }} {{ 1 / Math.min(n * 0, 1) }} {{ 1 / Math.max(n * 0, 0) }} {{ 1 / Math.min(n * 0, 0) }} {{ 1 / Math.max(n * 0, m * 0) }} {{ 1 / Math.min(n * 0, m * 0, 2) }} {{ Math.max(n * 0, -1) }} {{ Math.max(n, m) }} {{ Math.min(n * 2, m) }}</p>
</template>
