<script setup lang="ts">
import type { Entry } from "../types/models";

defineProps<{ value: string | null; entry: Entry | null }>();
</script>

<template>
  <span :title="value" :class="{ none: value === null }">{{ value ?? "(none)" }}{{ entry === null ? "" : `:${entry.title}` }}<slot :v="value" :e="entry" /></span>
</template>
