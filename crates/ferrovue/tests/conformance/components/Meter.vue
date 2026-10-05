<script setup lang="ts">
import type { Float } from "ferrovue/types";

defineProps<{ value: Float; max: Float }>();
</script>

<template>
  <meter :value="value" :max="max">{{ (value / max * 100).toFixed(1) }}%</meter>
</template>
