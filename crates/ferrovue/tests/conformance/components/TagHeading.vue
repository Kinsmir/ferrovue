<script setup lang="ts">
withDefaults(defineProps<{ as?: "h1" | "h2" | "h3"; text: string }>(), { as: "h2" });
</script>

<template>
  <component :is="as" class="heading" :title="text"><slot />{{ text }}</component>
</template>

<style scoped>
.heading {
  margin: 0;
}
</style>
