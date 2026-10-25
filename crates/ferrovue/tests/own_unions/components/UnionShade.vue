<script setup lang="ts">
import type { Shade } from "../types/unions";

defineProps<{ tone: Shade; text: string }>();
</script>

<template>
  <span :class="tone" :data-tone="tone">{{ text }}</span>
</template>
