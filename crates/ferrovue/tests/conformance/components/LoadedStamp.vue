<script setup lang="ts">
import { loadViews } from "./loaders";

const props = defineProps<{ year: number }>();
const views = await loadViews();
</script>

<template>
  <time :datetime="new Date(Date.UTC(year, views)).toISOString()">{{ Date.UTC(props.year, views, 1) }}</time>
</template>
