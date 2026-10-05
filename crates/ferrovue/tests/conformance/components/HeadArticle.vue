<script setup lang="ts">
import { useHead } from "@unhead/vue";

const props = defineProps<{ title: string; tags: string[] }>();

useHead({
  title: `Article: ${props.title}`,
  meta: props.tags.map((tag, i) => ({ property: "article:tag", content: tag, "data-index": i })),
  link: [{ rel: "canonical", href: `/articles/${props.title}` }],
  script: [{ innerHTML: "console.log(1)", key: "inline", tagPosition: "bodyOpen" }],
});
</script>

<template>
  <article>{{ title }}</article>
</template>
