<script setup lang="ts">
export interface Props {
  label: string;
  count?: number;
}

defineProps<Props>();
defineEmits<{ picked: [label: string]; "update:label": [label: string] }>();
</script>

<template>
  <p class="leaf" :data-count="count">{{ label }}</p>
</template>
