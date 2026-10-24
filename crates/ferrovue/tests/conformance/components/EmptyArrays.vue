<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ label: string; words: string[]; open: boolean }>();

function count(items: unknown[]): number {
  return items.length;
}

function named(items: unknown[]): string {
  return items.length === 0 ? `${props.label}: none` : props.label;
}

const total = computed(() => [].length + props.words.length);
</script>

<template>
  <p :data-count="[].length" :title="named([])">{{ [].length }}|{{ count([]) }}|{{ named([]) }}|{{ total }}|{{ (open ? [] : words).length }}|{{ [].length === 0 }}</p>
</template>
