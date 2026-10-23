<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ n: number; m: number; count?: number; on: boolean }>();
const chosen = computed(() => (props.on ? props.n * props.n : props.m));

function product(a: number, b: number): number {
  return a * b;
}
</script>

<template>
  <p :title="count ?? n * n" :data-or="m || n * n" :data-pick="on ? n * m : count ?? 0">{{ count ?? n * m }} {{ on ? n * n : m }} {{ m || n * m }} {{ chosen }} {{ product(n, m) }} {{ `${count ?? n * n}` }}</p>
</template>
