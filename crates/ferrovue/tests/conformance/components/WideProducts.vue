<script setup lang="ts">
import { computed } from "vue";

const { n, m } = defineProps<{ n: number; m: number }>();
const square = computed(() => n * n);
</script>

<template>
  <p :title="n * n" :style="{ width: n * m }">{{ n * n }} {{ n + m }} {{ -n }} {{ square }} {{ `${n * m}` }} {{ String(n * n) }} {{ (n * m).toString() }} {{ JSON.stringify(n * n) }} {{ Math.floor(n * n * 1000) }} {{ n * n * n * n * n * n }} {{ n * n > m }}</p>
</template>
