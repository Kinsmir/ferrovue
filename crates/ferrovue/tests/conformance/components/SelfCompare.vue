<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ x: Float; n: number; s: string; on: boolean; off: boolean; o?: string }>();
const wide = computed(() => props.x * 1e308);
const half = computed(() => wide.value / 2);
const gap = computed(() => wide.value - wide.value);
</script>

<template>
  <div>
    <p>{{ x !== x }} {{ x === x }} {{ n !== n }} {{ n === n }} {{ s === s }} {{ s !== s }} {{ o === o }} {{ on === on }}</p>
    <p>{{ on && on }} {{ on || on }} {{ (on || off) && (on || off) }} {{ !on === !on }} {{ (n > 1) === (n > 1) }} {{ (n > 1) !== (n > 1) }}</p>
    <p>{{ n - n }} {{ n / n }} {{ x - x }} {{ x / x }} {{ n + 1 - (n + 1) }} {{ x * 2 - x * 2 }} {{ -n - -n }} {{ n % n }} {{ n / n ? "one" : "none" }} {{ x - x ? "some" : "zero" }}</p>
    <p>{{ wide - wide }} {{ wide / wide }} {{ wide !== wide }} {{ half - half }} {{ half / half }}</p>
    <p>{{ n > 5 && n > 5 }} {{ n > 3 && n > 4 }} {{ n >= 3 && n > 3 }} {{ n < 3 && n <= 3 }} {{ 2 < n && n < 9 }} {{ n <= 2 && n >= 2 }}</p>
    <p>{{ n > 3 && n < 2 }} {{ n > 2 && n < 2 }} {{ n >= 2 && n < 2 }} {{ x > 1.5 && x < 1.5 }} {{ x < 0 && 1 < x }} {{ x > 0.5 && x > -1 && on }}</p>
    <p>{{ x < n || x > n }} {{ x <= n || n < x }} {{ x === n || x !== n }} {{ x < n && n < x }} {{ x <= n && x >= n }} {{ x === n || x < n }}</p>
    <p>{{ gap < x || gap > x }} {{ gap <= x || x < gap }} {{ gap === x || gap !== x }} {{ gap !== x && gap <= x }}</p>
    <p v-if="s === s && on" :title="String(n === n)">{{ on ? (x === x ? "same" : "nan") : "off" }}</p>
    <p v-else>{{ n - n }}</p>
  </div>
</template>
