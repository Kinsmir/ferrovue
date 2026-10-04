<script setup lang="ts">
/* Takes the row type another component declares, as a parent hands it from a slot's props. */
import type { Row } from "./DataList.vue";

defineProps<{ row: Row; first: boolean }>();
</script>

<template>
  <span :class="['chip', { first }]">{{ row.id }}:{{ row.label }} ({{ row.tags.join("/") }})</span>
</template>
