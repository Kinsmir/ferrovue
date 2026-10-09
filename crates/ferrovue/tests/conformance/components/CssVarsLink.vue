<script setup lang="ts">
defineProps<{ tone: string }>();
</script>

<template>
  <RouterLink to="/about" class="link">{{ tone }}</RouterLink>
</template>

<style scoped>
.link { color: v-bind(tone); }
</style>
