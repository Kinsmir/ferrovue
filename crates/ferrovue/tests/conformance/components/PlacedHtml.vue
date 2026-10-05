<script setup lang="ts">
import type { TrustedHtml } from "ferrovue/types";

defineProps<{ cell: TrustedHtml; label: TrustedHtml; formula: TrustedHtml }>();
</script>

<template>
  <figure>
    <table><tbody><tr><th>Cell</th><td v-html="cell"></td></tr></tbody></table>
    <svg viewBox="0 0 200 40"><foreignObject width="200" height="40" v-html="label"></foreignObject></svg>
    <math><mi>x</mi><mo>=</mo><mtext v-html="formula"></mtext></math>
  </figure>
</template>
