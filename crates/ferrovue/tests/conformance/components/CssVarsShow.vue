<script setup lang="ts">
defineProps<{ tone: string; on: boolean }>();
</script>

<template>
  <div v-show="on" style="top: 0" class="show">{{ tone }}</div>
</template>

<style scoped>
.show { color: v-bind(tone); }
</style>
