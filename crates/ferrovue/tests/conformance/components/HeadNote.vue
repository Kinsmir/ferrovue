<script setup lang="ts">
import { useSeoMeta } from "@unhead/vue";

const props = defineProps<{ title: string; tags: string[] }>();
useSeoMeta({ title: () => `Note: ${props.title}`, description: props.tags.join(" / "), ogTitle: props.title });
</script>

<template>
  <aside>{{ title }}</aside>
</template>
