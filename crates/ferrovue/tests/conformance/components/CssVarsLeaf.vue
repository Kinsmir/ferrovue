<script setup lang="ts">
defineProps<{ tint: string; width?: number }>();
</script>

<template>
  <b class="leaf" :style="{ color: tint }"><slot /></b>
</template>

<style scoped>
.leaf { background: v-bind(tint); width: v-bind(width); }
</style>
