<script setup lang="ts">
import { defineAsyncComponent } from "vue";

const Later = defineAsyncComponent(() => import("./CssVarsLeaf.vue"));
defineProps<{ tone: string }>();
</script>

<template>
  <Later :tint="tone" />
</template>

<style>
.later { color: v-bind(tone); }
</style>
