<script setup lang="ts">
defineProps<{ cls?: string; css: string }>();
</script>

<template>
  <span :class="cls" :style="css">binds</span>
</template>
