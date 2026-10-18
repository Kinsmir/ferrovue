<script setup lang="ts">
import { useHead, useServerHead, useServerSeoMeta } from "@unhead/vue";

const props = defineProps<{ title: string; theme: string; rank: number }>();

useHead({
  title: () => props.title,
  meta: [{ name: "theme-color", content: props.theme }],
  link: [{ rel: "preload", href: "/late.css", as: "style", tagPriority: "low" }],
});

useServerHead({
  meta: [
    { name: "theme-color", content: "server", tagDuplicateStrategy: "replace" },
    { name: "generator", content: props.title, tagPriority: "critical" },
  ],
  link: [
    { rel: "preload", href: "/early.css", as: "style", tagPriority: "high" },
    { rel: "stylesheet", href: `/rank/${props.rank}.css`, tagPriority: 5 },
  ],
  htmlAttrs: { class: "served", tagDuplicateStrategy: "merge" },
});

useServerSeoMeta({
  description: props.title,
  ogTitle: () => props.title,
  robots: props.rank > 0 ? "index" : null,
});
</script>

<template>
  <section>{{ title }}</section>
</template>
