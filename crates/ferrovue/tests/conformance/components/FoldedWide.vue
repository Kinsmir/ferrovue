<script setup lang="ts">
import type { Float } from "ferrovue/types";

const props = defineProps<{ tone: "a&b" | "md"; label: string; n: number; f: Float; parts: string[] }>();
const LIMIT = 3;
</script>

<template>
  <p :title="label" :data-wide="(LIMIT > 5 ? label : tone) !== '-'">
    {{ (Number.isNaN(1.5) ? (1e-7).toFixed(10) : tone) !== "-" }}|{{ (LIMIT < 5 ? tone : label) === "md" }}|{{ (LIMIT > 5 ? label : tone).toUpperCase() }}
  </p>
  <i v-for="(x, i) in [n, 1.5, f, -0]" :key="i">{{ x }}</i>
  <b v-for="(x, i) in parts.map(() => -1).flatMap((b) => [b, 10 * 0, 0.5])" :key="i">{{ x }}</b>
  <s>{{ [n, f].join("/") }}|{{ [2, 0.25].includes(f) }}</s>
</template>
