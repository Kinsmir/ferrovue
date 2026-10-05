<script setup lang="ts">
import { useHead } from "@unhead/vue";
import HeadArticle from "./HeadArticle.vue";
import HeadNote from "./HeadNote.vue";

defineProps<{ article: boolean; kind: "article" | "note"; title: string; tags: string[] }>();
useHead({ titleTemplate: "%s (chosen)" });
const PAGES = { article: HeadArticle, note: HeadNote } as const;
</script>

<template>
  <div>
    <component :is="article ? HeadArticle : HeadNote" :title="title" :tags="tags" />
    <component :is="PAGES[kind]" :title="`${title} again`" :tags="tags" />
  </div>
</template>
