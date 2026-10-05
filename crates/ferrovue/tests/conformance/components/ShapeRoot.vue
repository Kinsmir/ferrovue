<script setup lang="ts">
import { SHAPES, type Shape } from "../types/shapes";

defineProps<{ shape: Shape; label: string }>();
</script>

<template>
  <component :is="SHAPES[shape]" :label="label" class="root"><slot /></component>
</template>
