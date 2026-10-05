<script setup lang="ts">
import { inject, provide } from "vue";
import type { Float } from "ferrovue/types";
import { ThemeKey } from "../types/keys";

const props = defineProps<{ items: string[]; theme: string; wide: boolean }>();
const tags = inject<string[]>("tags");
const ratio = inject<Float>("ratio", 1.5);
provide(ThemeKey, props.theme);
provide("wide", props.wide);
</script>

<template>
  <div class="list" :data-ratio="ratio">
    <ul>
      <li v-for="(item, i) in items" :key="item"><slot name="row" :item="item" :index="i" /></li>
    </ul>
    <p v-if="tags">{{ tags.join(", ") }}</p>
    <slot />
  </div>
</template>

<style scoped>
.list {
  margin: 0;
}
:slotted(button) {
  color: red;
}
</style>
