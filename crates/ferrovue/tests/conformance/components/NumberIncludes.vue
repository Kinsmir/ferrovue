<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{ nums: number[]; prices: Float[]; qty: number; ratio: Float }>();
</script>

<template>
  <p>{{ nums.includes(ratio) }}|{{ nums.slice(1).includes(ratio) }}|{{ prices.includes(qty) }}|{{ prices.filter((p) => p !== 0.5).includes(qty) }}|{{ nums.map((v) => -v).includes(0) }}|{{ nums.map((v) => -v).includes(qty) }}|{{ nums.map((v) => v * 2).includes(4) }}</p>
</template>
