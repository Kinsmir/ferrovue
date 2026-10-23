<script setup lang="ts">
import type { Step } from "../types/unions";

defineProps<{ step: Step }>();
</script>

<template>
  <li :class="[step.state, step.align]">{{ step.label }}</li>
</template>
