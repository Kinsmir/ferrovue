<script setup lang="ts">
import type { Size } from "../types/models";

defineProps<{ size: Size; tone?: "calm" | "loud" }>();
</script>

<template>
  <b :class="[size, tone]">{{ size }}</b>
</template>
