<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ x: Float; n: number }>();
const root = computed(() => Math.sqrt(props.x));
const kilo = 2 ** 10;
</script>

<template>
  <section :data-sign="Math.sign(x)" :style="{ width: `${Math.sqrt(n) * 10}px` }">
    <p>{{ Math.sqrt(x) }}|{{ Math.sqrt(n) }}|{{ root.toFixed(3) }}|{{ Math.sqrt(x * x) }}|{{ Math.sqrt(2) }}|{{ Math.sqrt(-n) }}</p>
    <p>{{ Math.sign(x) }}|{{ Math.sign(n) }}|{{ Math.sign(-n) }}|{{ 1 / Math.sign(-Math.abs(x)) }}|{{ 1 / Math.sign(n) }}|{{ Math.sign(x - 1) }}|{{ Math.sign(-3) }}</p>
    <p>{{ Math.PI }}|{{ Math.E }}|{{ Math.LN2 }}|{{ Math.LN10 }}|{{ Math.LOG2E }}|{{ Math.LOG10E }}|{{ Math.SQRT2 }}|{{ Math.SQRT1_2 }}|{{ (x * Math.PI).toFixed(2) }}</p>
    <p>{{ kilo }}|{{ 2 ** 53 }}|{{ (-3) ** 3 }}|{{ Math.pow(10, 15) }}|{{ 7 ** 0 }}|{{ 0 ** 0 }}|{{ n * 2 ** 8 }}|{{ Math.pow(-2, 53) }}</p>
    <p>{{ Number.MAX_SAFE_INTEGER }}|{{ Number.MIN_SAFE_INTEGER }}|{{ Number.EPSILON }}|{{ Number.MAX_VALUE }}|{{ Number.MIN_VALUE }}|{{ Number.POSITIVE_INFINITY }}|{{ Number.NEGATIVE_INFINITY }}|{{ Number.NaN }}</p>
    <b v-if="Math.sign(x) < 0">negative</b>
  </section>
</template>
