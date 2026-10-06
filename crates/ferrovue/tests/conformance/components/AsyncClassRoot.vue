<script setup lang="ts">
import { defineAsyncComponent } from "vue";

const LazyGlyph = defineAsyncComponent(() => import("./Glyph.vue"));

defineProps<{ tone: string }>();
</script>

<template>
  <LazyGlyph :class="tone" />
</template>
