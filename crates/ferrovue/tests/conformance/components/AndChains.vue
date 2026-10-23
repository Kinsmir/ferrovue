<script setup lang="ts">
import { computed } from "vue";

interface Badge {
  label: string;
}

const TONE = { info: "blue", warn: "amber" } as const;

const props = defineProps<{ n?: number; m: number | null; tone?: "info" | "warn"; badge?: Badge; word?: string }>();

const inRange = computed(() => props.n != null && props.n > 1 && props.n < 9);
const color = computed(() => props.tone && TONE[props.tone]);

function within(x?: number): boolean {
  return x !== undefined && x > 1 && x < 9;
}

function outside(x: number | null): boolean {
  if (x === null || x < 0 || x > 99) return true;
  return false;
}
</script>

<template>
  <section :class="tone && TONE[tone]" :title="tone && TONE[tone]">
    <p>{{ n != null && n > 1 && n < 9 }}|{{ inRange }}|{{ within(n) }}|{{ n == null || n < 1 || n > 9 }}</p>
    <p>{{ n != null && n > 1 ? n * 2 : 0 }}|{{ n == null || n < 0 ? "bad" : n.toFixed(1) }}|{{ (n != null && n > 0 && n < 5) || n === 0 }}</p>
    <p>{{ m !== null && m > 0 && m < 5 }}|{{ outside(m) }}|{{ m !== null && m >= 0 && m <= 99 ? `${m + 1}` : "none" }}</p>
    <p :class="[tone ? TONE[tone] : null, 'fixed']">{{ tone && TONE[tone] }}|{{ (tone && TONE[tone]) ?? "none" }}|{{ color ?? "unset" }}</p>
    <p>{{ badge && badge.label }}|{{ badge != null && badge.label.length > 2 && badge.label !== "none" }}|{{ word != null && word !== "" && word.length < 6 }}</p>
    <i v-if="n != null && n > 1 && n < 9">{{ n * 3 }}</i>
    <i v-else-if="n != null && n >= 9 && n < 100">{{ n - 9 }}</i>
    <i v-else>out</i>
  </section>
</template>
