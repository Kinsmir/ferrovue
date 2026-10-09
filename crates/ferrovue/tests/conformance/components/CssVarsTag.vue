<script setup lang="ts">
defineProps<{ tone: string; tag: "div" | "section" }>();
</script>

<template>
  <component :is="tag" class="tag">{{ tone }}</component>
</template>

<style scoped>
.tag { color: v-bind(tone); }
</style>
