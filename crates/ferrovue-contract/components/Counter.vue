<script setup lang="ts">
defineProps<{ count: number; step?: number }>();
</script>

<template>
  <output>{{ count }}/{{ step }}</output>
</template>
