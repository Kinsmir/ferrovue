<script setup lang="ts">
import { inject } from "vue";
import { ThemeKey } from "../types/keys";

defineProps<{ label: string }>();
const theme = inject(ThemeKey, "light");
</script>

<template>
  <button type="button" :class="theme">{{ label }}</button>
</template>
