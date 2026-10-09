<script setup lang="ts">
import type { Float } from "ferrovue/types";
import CssVars from "./CssVars.vue";
import CssVarsRoot from "./CssVarsRoot.vue";

defineProps<{ color: string; size: number; ratio: Float; label?: string; font: string; tone?: string; items: string[] }>();
</script>

<template>
  <CssVars :color="color" :size="size" :ratio="ratio" :label="label" :font="font" class="given" style="top: 0; --own: 2" :style="{ color: tone }" />
  <CssVarsRoot :tint="color" :shade="font" style="left: 1px" />
  <p v-if="tone" :style="{ color: tone }">{{ tone }}</p>
  <span v-else>none</span>
  <i v-for="item in items">{{ item }}</i>
</template>

<style>
.page { color: v-bind(tone); --size: v-bind(size); }
</style>
