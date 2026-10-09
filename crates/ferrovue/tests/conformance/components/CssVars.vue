<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ color: string; size: number; ratio: Float; label?: string; font: string; gap?: number }>();
const accent = "teal";
const doubled = computed(() => props.size * 2);
const theme = computed(() => props.label ?? "plain");
</script>

<template>
  <section class="vars" style="margin: 0; --own: 1" :style="{ padding: size + 'px', color }">
    <h2>{{ label }}</h2>
  </section>
</template>

<style scoped>
.vars {
  color: v-bind(color);
  border-width: v-bind('doubled + "px"');
  outline-color: v-bind("accent");
  --label: v-bind(label);
  font-family: v-bind( 'font' );
  content: v-bind('theme');
  opacity: v-bind(ratio);
  gap: v-bind(gap);
  --size: v-bind(size);
}
/* v-bind(ignored) */
.vars h2 { color: v-bind(color); }
</style>
