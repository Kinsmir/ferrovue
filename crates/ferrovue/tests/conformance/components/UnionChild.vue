<script setup lang="ts">
import type { Align } from "../types/unions";

defineProps<{ align: Align; text: string; wide?: "left" | "center" | "right" | "justify"; pick: "a" | "b" | "c"; fixed: "x" | "y" }>();
</script>

<template>
  <span :class="[align, wide]" :data-pick="pick">{{ text }} {{ fixed }}</span>
</template>
