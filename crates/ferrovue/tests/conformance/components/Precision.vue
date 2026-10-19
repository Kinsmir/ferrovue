<script setup lang="ts">
import { computed } from "vue";
import type { Float } from "ferrovue/types";

const props = defineProps<{ x: Float; n: number; label: string }>();
const sum = computed(() => props.x + props.n);
const shown = computed(() => `${props.label}: ${props.x.toPrecision(3)}`);
</script>

<template>
  <div :data-p="x.toPrecision(2)" :title="n.toExponential(1)">
    <p>{{ x.toPrecision() }}|{{ x.toPrecision(undefined) }}|{{ x.toPrecision(1) }}|{{ x.toPrecision(2) }}|{{ x.toPrecision(3) }}|{{ x.toPrecision(6) }}|{{ x.toPrecision(17) }}|{{ x.toPrecision(21) }}|{{ x.toPrecision(2.9) }}</p>
    <p>{{ x.toExponential() }}|{{ x.toExponential(undefined) }}|{{ x.toExponential(0) }}|{{ x.toExponential(1) }}|{{ x.toExponential(2) }}|{{ x.toExponential(5) }}|{{ x.toExponential(16) }}|{{ x.toExponential(20) }}|{{ x.toExponential(0.5) }}</p>
    <p>{{ x.toPrecision(100) }}</p>
    <p>{{ x.toExponential(100) }}</p>
    <p>{{ n.toPrecision() }}|{{ n.toPrecision(1) }}|{{ n.toPrecision(4) }}|{{ n.toPrecision(16) }}|{{ n.toExponential() }}|{{ n.toExponential(3) }}|{{ (-n).toPrecision(2) }}</p>
    <p>{{ (x / 0).toPrecision(5) }}|{{ (-x / 0).toExponential(2) }}|{{ (0 / 0).toPrecision(3) }}|{{ (x * 0).toExponential() }}|{{ sum.toPrecision(5) }}|{{ (x / 3).toExponential(4) }}</p>
    <p>{{ x.toFixed(2.7) }}|{{ x.toFixed(undefined) }}|{{ n.toFixed(0.5) }}</p>
    <p>{{ shown }}|{{ `${x.toExponential(2)} and ${n.toPrecision(3)}` }}</p>
  </div>
</template>
