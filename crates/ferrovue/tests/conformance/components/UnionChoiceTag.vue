<script setup lang="ts">
import type { Mood } from "../types/tables";

defineProps<{ choice: Mood | ""; label: string }>();
</script>

<template>
  <s :data-choice="choice">{{ label }} {{ choice || "none" }}</s>
</template>
