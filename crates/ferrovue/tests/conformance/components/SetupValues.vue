<script setup lang="ts">
import { computed, provide } from "vue";
import ThemedButton from "./ThemedButton.vue";

const props = defineProps<{ n: number; label: string }>();
const zero = (-1) * 0;
const flipped = props.n * -1;
const negated = computed(() => -props.n);
const padded = props.label.toLowerCase().padStart(6, "0");
const marked = "a‮b⁦c";
provide("tone", props.label.toUpperCase().padEnd(4, "!"));
</script>

<template>
  <p :title="marked">{{ 1 / zero }} {{ 1 / flipped }} {{ 1 / negated }} {{ flipped }} {{ padded }}</p>
  <p>‮{{ marked }}</p>
  <ThemedButton :label="padded" />
</template>
