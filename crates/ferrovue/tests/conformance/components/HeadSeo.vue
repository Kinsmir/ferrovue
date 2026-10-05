<script setup lang="ts">
import { useSeoMeta } from "@unhead/vue";

const props = defineProps<{ title: string; description?: string; views: number }>();

useSeoMeta({
  description: () => props.description,
  ogTitle: props.title,
  ogSiteName: "Books",
  twitterCard: "summary",
  twitterTitle: props.title,
  ogImageUrl: `/covers/${props.title}.png`,
  contentType: "text/html",
  articlePublishedTime: props.views > 1 ? "2024-01-01" : "",
  robots: props.views === 0 ? null : "index",
});
</script>

<template>
  <aside>{{ views }}</aside>
</template>
