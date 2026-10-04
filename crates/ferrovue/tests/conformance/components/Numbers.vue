<script setup lang="ts">
/* Fractional numbers: arithmetic, `/` on integers, comparisons, `Math`, `toFixed` with its tie
 * rounding, and numbers in attributes, styles and text — each written as JavaScript writes it. */
import { computed } from "vue";
import type { Float } from "ferrovue/types";
import Meter from "./Meter.vue";

const props = defineProps<{ price: Float; qty: number; rate?: Float; ratio: Float }>();
const total = computed(() => props.price * props.qty);
</script>

<template>
  <div :data-ratio="ratio" :style="{ opacity: ratio, width: price + 'px' }">
    <p>{{ total }}|{{ total.toFixed(2) }}|{{ price.toFixed(0) }}|{{ price.toFixed(1) }}|{{ qty / 4 }}|{{ qty / 0 }}|{{ -qty / 0 }}|{{ 0 / 0 }}|{{ price % 1 }}</p>
    <p>{{ Math.round(price) }}|{{ Math.floor(price) }}|{{ Math.ceil(price) }}|{{ Math.trunc(-price) }}|{{ Math.max(price, qty) }}|{{ Math.min(ratio, 0.25) }}|{{ Math.abs(-price) }}</p>
    <p>{{ rate ?? 0.5 }}|{{ rate }}|{{ `${price}/${qty}` }}|{{ String(ratio) }}|{{ price > qty }}|{{ price === 2.5 }}<b v-if="ratio">truthy</b><i v-if="!ratio">falsy</i></p>
    <Meter :value="ratio" :max="qty" />
  </div>
</template>
