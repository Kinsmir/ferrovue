<script setup lang="ts">
import { computed } from "vue";

const NONE = 0;
const BELOW = 1 - 3;

const props = defineProps<{ n: number; label: string }>();
const shout = computed(() => props.label.toUpperCase());
</script>

<template>
  <div>
    <i v-for="k in 0">{{ k }}</i>
    <b v-for="k in -2">{{ k }}{{ label }}</b>
    <u v-for="k in NONE">{{ shout }}</u>
    <s v-for="(k, i) in BELOW" :key="k">{{ k }}{{ i }}</s>
    <template v-for="k in 0">{{ k }}</template>
    <em v-for="k in 3 - 3">{{ k }}</em>
    <em v-for="k in n - n">{{ k }}</em>
    <p v-for="k in 2">{{ k }}</p>
    <p v-for="k in n">{{ k }}{{ label }}</p>
  </div>
</template>
