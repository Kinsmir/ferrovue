<script setup lang="ts">
import type { Row } from "./DataList.vue";

defineProps<{ row: Row; first: boolean }>();
</script>

<template>
  <span :class="['chip', { first }]">{{ row.id }}:{{ row.label }} ({{ row.tags.join("/") }})</span>
</template>
