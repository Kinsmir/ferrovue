<script setup lang="ts">
import { relativeTime } from "./text";

defineProps<{ now: Date; then: Date; edited?: Date }>();
</script>

<template>
  <p>
    <time>{{ relativeTime(now, then) }}</time>
    <span v-if="edited">edited {{ relativeTime(now, edited) }}</span>
  </p>
</template>
