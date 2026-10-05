<script setup lang="ts">
import { inject, provide } from "vue";
import { useHead } from "@unhead/vue";
import { ThemeKey } from "../types/keys";

const props = defineProps<{ label: string }>();
const theme = inject(ThemeKey, "light");
provide(ThemeKey, `${theme}+head`);
useHead({
  title: () => `${props.label} in ${theme}`,
  htmlAttrs: { "data-theme": theme },
  meta: [{ name: "theme", content: theme }],
});
</script>

<template>
  <section :data-theme="theme"><slot /></section>
</template>
