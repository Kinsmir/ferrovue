<script setup lang="ts">
import { provide } from "vue";
import { ThemeKey } from "../types/keys";

const props = defineProps<{ theme: string }>();
provide(ThemeKey, props.theme);
</script>

<template>
  <div class="scope"><slot /></div>
</template>
