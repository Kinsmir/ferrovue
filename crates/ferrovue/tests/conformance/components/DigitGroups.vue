<script setup lang="ts">
import { computed } from "vue";
import { duration, grouped, sliced, tagged } from "./digits";

const GAP = 2 * 4;
const SPACING = { sm: GAP, lg: GAP * 2 + 0.5, label: `${GAP}px` } as const;

const props = defineProps<{ n: number; seconds: number; words: string[]; big: boolean }>();

const total = computed(() => {
  const d = String(props.n);
  const dot = (s: string) => `${s}.`;
  return dot(`${d.length}:${d[0]}${d.at(-1)}`);
});

function initials(words: string[]): string {
  const head = (w: string) => w.charAt(0).toUpperCase();
  return words.map((w) => head(w)).join(".");
}
</script>

<template>
  <section :style="{ gap: SPACING.label }">
    <p>{{ grouped(n) }}|{{ sliced(n) }}|{{ grouped(-n) }}|{{ sliced(n * 1000) }}</p>
    <p>{{ duration(seconds) }}|{{ total }}|{{ initials(words) }}</p>
    <p>{{ tagged(words) }}</p>
    <p>{{ big ? SPACING.lg : SPACING.sm }}|{{ String(n).split("").toReversed().join("") }}|{{ n.toFixed(2).slice(-3) }}</p>
  </section>
</template>
