<script setup lang="ts">
import type { Hue } from "../types/unions";

defineProps<{ hue?: Hue; wide?: Hue | "blue"; hues: Hue[]; extra?: Hue[]; label: string }>();
</script>

<template>
  <span :data-hue="hue" :data-wide="wide" :title="label">{{ hues.join() }} {{ extra?.join("+") ?? "-" }}</span>
</template>
