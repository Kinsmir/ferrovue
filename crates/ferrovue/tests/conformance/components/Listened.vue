<script setup lang="ts">
export interface Props {
  id: string;
  label: string;
  rows: Props[];
}

defineProps<Props>();
const emit = defineEmits<{ loaded: [rows: Props[]] }>();
function take(row: Props, more: Props[]) {
  emit("loaded", [row, ...more]);
}
</script>

<template>
  <div class="row" :id="id">{{ label }}<Listened v-for="r in rows" :key="r.id" v-bind="r" @loaded="(more) => take(r, more)" /></div>
</template>
