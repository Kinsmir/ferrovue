<script setup lang="ts">
import { useHead } from "@unhead/vue";
import HeadArticle from "./HeadArticle.vue";
import HeadTheme from "./HeadTheme.vue";
import ThemeScope from "./ThemeScope.vue";
import ThemedButton from "./ThemedButton.vue";

const props = defineProps<{ label: string; theme?: string; tags: string[] }>();
useHead({ titleTemplate: `%s | ${props.label}`, meta: [{ name: "theme", content: "page" }] });
</script>

<template>
  <ThemeScope :theme="theme">
    <HeadTheme :label="label">
      <HeadArticle :title="label" :tags="tags" />
      <ThemedButton :label="label" />
    </HeadTheme>
  </ThemeScope>
</template>
