<script setup lang="ts">
import type { Float } from "ferrovue/types";

const props = defineProps<{ title: string; price: Float; tags: string[] }>();

function shout(text: string): string {
  const loud = text.toUpperCase();
  return `${loud}:${props.price}`;
}
</script>

<template>
  <p>{{ shout(title) }}|{{ JSON.stringify(tags) }}</p>
</template>
