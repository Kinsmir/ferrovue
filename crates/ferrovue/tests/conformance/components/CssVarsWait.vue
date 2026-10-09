<script setup lang="ts">
import CssVarsLeaf from "./CssVarsLeaf.vue";

defineProps<{ tone: string }>();
</script>

<template>
  <Suspense><CssVarsLeaf :tint="tone" /></Suspense>
</template>

<style>
.wait { color: v-bind(tone); }
</style>
