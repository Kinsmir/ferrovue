<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ show: boolean; count: number; word: string }>();

const guarded = computed(() => {
  if (props.count < 0) return "-";
  const copies = props.word.repeat(props.count);
  if (copies.length > 3) return copies;
  return "short";
});

const late = computed(() => {
  const copies = props.word.repeat(props.count);
  if (!props.show) return "hidden";
  return `${copies}!`;
});
</script>

<template>
  <p>{{ guarded }}</p>
  <p v-if="show">{{ late }}</p>
  <p v-else>hidden</p>
</template>
