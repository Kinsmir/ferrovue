<script setup lang="ts">
type Tone = "calm" | "<loud>" | "a&b";

defineProps<{ tone?: Tone; label: string }>();
</script>

<template>
  <b :class="tone" :data-tone="tone">{{ label }}: {{ tone ?? "none" }}</b>
</template>
