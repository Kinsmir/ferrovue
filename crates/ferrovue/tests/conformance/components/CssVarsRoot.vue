<script setup lang="ts">
import CssVarsLeaf from "./CssVarsLeaf.vue";

defineProps<{ tint: string; shade: string }>();
</script>

<template>
  <CssVarsLeaf :tint="tint" :width="3">{{ shade }}</CssVarsLeaf>
</template>

<style>
.root-shade { border-color: v-bind(shade); }
</style>
