<script setup lang="ts">
type Tone = "warm" | "x-cool";

defineProps<{ tone: Tone; other?: Tone }>();
</script>

<template>
  <i :class="[tone, other]">{{ tone === "warm" ? "w" : "c" }}</i>
</template>
