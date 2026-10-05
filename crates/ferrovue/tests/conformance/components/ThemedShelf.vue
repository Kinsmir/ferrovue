<script setup lang="ts">
import { inject, provide } from "vue";
import ThemedButton from "./ThemedButton.vue";
import ThemedList from "./ThemedList.vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ items: string[]; theme: string; ratio: Float }>();
provide("tags", props.items);
provide("ratio", props.ratio);
const wide = inject("wide", false);
</script>

<template>
  <section :data-wide="wide">
    <ThemedList :items="items" :theme="theme" :wide="items.length > 1">
      <template #row="{ item, index }"><ThemedButton :label="`${index}: ${item}`" /></template>
      <ThemedButton label="after" />
    </ThemedList>
  </section>
</template>
