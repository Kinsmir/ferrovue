<script setup lang="ts">
import { computed, inject } from "vue";
import { AccentKey, ThemeKey } from "../types/keys";

defineProps<{ label: string }>();
const theme = inject(ThemeKey, "light");
const size = inject<number>("size");
const tone = inject("tone", () => "plain", true);
const accent = inject(AccentKey, computed(() => "none"));
</script>

<template>
  <button type="button" :class="['btn', `btn-${theme}`]" :data-size="size" :data-accent="accent">{{ label }} ({{ tone }})</button>
</template>
