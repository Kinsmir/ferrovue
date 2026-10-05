<script setup lang="ts">
import DataList from "./DataList.vue";
import RowChip from "./RowChip.vue";
import type { Row } from "./DataList.vue";

defineProps<{ rows: Row[]; heading: string; compact: boolean }>();
</script>

<template>
  <DataList :rows="rows" :title="heading">
    <template #header="{ title, note }"><h2 :title="note">{{ title.toUpperCase() }}</h2></template>
    <template #row="{ row, index, first, tags }">
      <RowChip v-if="!compact" :row="row" :first="first" />
      <template v-else-if="tags.length"><b :data-index="index">{{ row.label }}</b></template>
    </template>
    <template #default="summary">{{ summary.count }} row(s) in {{ summary.title }}</template>
  </DataList>
</template>
